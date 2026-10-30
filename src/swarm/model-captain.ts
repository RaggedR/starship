// model-captain.ts — the LLM captain: the point of the whole swarm. A second
// CaptainBrain behind the same seam the scheduler already speaks, so it cannot tell
// a model from the greedy default. This is the thesis — the model sits at the
// ORCHESTRATION layer, commanding a real delegation hierarchy where it CANNOT cheat,
// because the decoder and the reason-gate bound everything it can say.
//
// A model is String → String; presenting it as plan : CaptainState → Plan is a
// promise kept by a validator. The model may call four tools — assign_scout,
// dispatch_fighter, march, hold — and every item is DECODED against the real state:
//   • a scout id that is not an idle scout           → dropped
//   • a target cell that is not reachable known floor → dropped
//   • a fighter id that is not an idle fighter        → dropped
//   • a monster id not known-alive / not reachable    → dropped
//   • march when no monster-free route is known       → dropped
// An order that does not decode is a REFUSED position, never an escape hatch. And
// if the model's whole decoded plan is unproductive while real work remains, the
// greedy plan fills in — anti-STALL, not anti-idle: the model may still choose to
// leave a fighter idle (that is prioritisation), it just cannot deadlock the swarm.
// So a weak model slows or mis-prioritises; it never breaks and never cheats.

import type { Pos } from "../maze/types.ts";
import { type FogMap, knownPassable } from "../maze/fog.ts";
import { fogGlyph } from "../cli/format.ts";
import { pathOverFog } from "../fleet/ops.ts";
import type { ModelClient, ToolSpec } from "../agent/model.ts";
import { type CaptainBrain, type CaptainState, HOLD, type Plan, scriptedPlan } from "./captain.ts";

const key = (p: Pos) => `${p.x},${p.y}`;

/** A single captain order, with the model's reason — surfaced to the website/console
 *  so the viewer sees the LLM's plan and its reasoning per step (the star of --live). */
export type CaptainOrder =
  | { readonly kind: "assign_scout"; readonly id: string; readonly toward: Pos; readonly reason: string }
  | { readonly kind: "dispatch_fighter"; readonly id: string; readonly target: string; readonly reason: string }
  | { readonly kind: "march"; readonly reason: string }
  | { readonly kind: "hold"; readonly reason: string }
  | { readonly kind: "fallback"; readonly reason: string }; // greedy stepped in

/** Fold the model's prose and the decoded orders into one line of reasoning, for the
 *  scheduler to stamp onto the plan frame (website + console). */
function reasoningOf(prose: string, orders: readonly CaptainOrder[]): string {
  const parts = orders.map((o) => {
    if (o.kind === "assign_scout") return `${o.id}→(${o.toward.x},${o.toward.y}): ${o.reason}`;
    if (o.kind === "dispatch_fighter") return `${o.id}→${o.target}: ${o.reason}`;
    if (o.kind === "march") return `march: ${o.reason}`;
    if (o.kind === "fallback") return `[greedy fallback: ${o.reason}]`;
    return `hold: ${o.reason}`;
  });
  const head = prose.trim();
  return (head ? head + " · " : "") + parts.join(" · ");
}

export const SYSTEM =
  "You are the CAPTAIN of a swarm exploring a grid maze to reach the EXIT. You are " +
  "BLIND: you see only the fog your scouts have revealed, never the true maze. You " +
  "command FIVE scouts (your eyes — they map, they cannot fight) and TWO fighters " +
  "(they clear monsters, they are blind). Each planning step you command only IDLE " +
  "agents:\n" +
  "• assign_scout: send an idle scout to a frontier cell (a '?' on the map) to reveal " +
  "new ground. Spread scouts to DIFFERENT regions so they fan out.\n" +
  "• dispatch_fighter: the MOMENT a scout is blocked and holding a monster (marked " +
  "'guarded' below), send a fighter — do not wait for more to be found. When two " +
  "monsters block in DIFFERENT directions, send your two fighters to OPPOSITE sides — " +
  "one each — so both regions open at once and your scouts can explore the maze in " +
  "both directions. Never send both fighters the same way. Your idle " +
  "fighters automatically trail just behind the scouts, so one is always near; the " +
  "nearest will reach it fast. Monsters on dead-end branches lead nowhere — once you " +
  "have a route to the exit, leave the rest alone. You have only two fighters.\n" +
  "• march: commit YOURSELF to the exit — only valid once a monster-free revealed route " +
  "exists.\n" +
  "• hold: do nothing this step (when every agent is already busy).\n" +
  "Call as many tools as you want per step, each with a short reason. Invalid orders " +
  "are ignored. Your goal: reach the exit having revealed as little as possible.";

function toolSpecs(): ToolSpec[] {
  const obj = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  return [
    {
      name: "assign_scout",
      description: "Send an idle scout to a frontier cell (x,y) to explore from there.",
      mutates: true,
      inputSchema: obj({
        scout_id: { type: "string", description: "An idle scout, e.g. scout-3." },
        x: { type: "number", description: "Target cell column." },
        y: { type: "number", description: "Target cell row." },
        reason: { type: "string", description: "Why send it there (one short clause)." },
      }, ["scout_id", "x", "y", "reason"]),
    },
    {
      name: "dispatch_fighter",
      description: "Send an idle fighter to clear a known monster that blocks the route.",
      mutates: true,
      inputSchema: obj({
        fighter_id: { type: "string", description: "An idle fighter, e.g. fighter-1." },
        monster_id: { type: "string", description: "A known-alive monster, e.g. orc-2." },
        reason: { type: "string", description: "Why this monster is worth clearing." },
      }, ["fighter_id", "monster_id", "reason"]),
    },
    {
      name: "march",
      description: "Commit yourself to the exit along a known monster-free route.",
      mutates: true,
      inputSchema: obj({ reason: { type: "string", description: "Why commit now." } }, ["reason"]),
    },
    {
      name: "hold",
      description: "Do nothing this step (all agents already busy).",
      mutates: true,
      inputSchema: obj({ reason: { type: "string", description: "Why hold." } }, ["reason"]),
    },
  ];
}

// ── serialise the captain's state into the prompt ───────────────────────────
function renderFog(st: CaptainState): string {
  const fog = st.fog;
  const mark = new Map<string, string>();
  // frontier cells the model can target
  for (const f of st.frontier) if (!mark.has(key(f))) mark.set(key(f), "?");
  for (const m of st.monsters) mark.set(key(m.pos), "M");
  for (const a of st.agents) {
    if (a.kind === "captain") mark.set(key(a.pos), "C");
    else if (a.kind === "fighter") mark.set(key(a.pos), "f");
    else mark.set(key(a.pos), "s");
  }
  const rows: string[] = [];
  for (let y = 0; y < fog.height; y++) {
    let row = "";
    for (let x = 0; x < fog.width; x++) {
      const k = key({ x, y });
      row += mark.get(k) ?? fogGlyph(fog.cells[y][x]);
    }
    rows.push(row);
  }
  return rows.join("\n");
}

export function renderState(st: CaptainState): string {
  const idleScouts = st.agents.filter((a) => a.kind === "scout" && a.state === "idle");
  const busyScouts = st.agents.filter((a) => a.kind === "scout" && a.state !== "idle");
  const idleFighters = st.agents.filter((a) => a.kind === "fighter" && a.state === "idle");
  const busyFighters = st.agents.filter((a) => a.kind === "fighter" && a.state !== "idle");

  const posStr = (p: Pos) => `(${p.x},${p.y})`;
  const assignedMonsters = new Set(
    st.agents.map((a) => a.targetMonster).filter((t): t is string => t !== null),
  );
  const guardedMonsters = new Set(
    st.agents.map((a) => a.guarding).filter((t): t is string => t !== null),
  );
  const frontierList = st.frontier.slice(0, 30).map(posStr).join(" ");

  const lines: string[] = [];
  lines.push("FOG (legend: ' '=unknown ?=frontier .=floor #=wall X=exit C=you s=scout f=fighter M=monster):");
  lines.push(renderFog(st));
  lines.push("");
  lines.push(`You (captain) are at ${posStr(st.captainPos)}.`);
  lines.push(`Exit: ${st.exit ? posStr(st.exit) : "NOT yet found"}.`);
  lines.push(
    `Idle scouts: ${idleScouts.map((a) => `${a.id}@${posStr(a.pos)}`).join(", ") || "none"}.`,
  );
  lines.push(
    `Busy scouts: ${busyScouts.map((a) => a.id).join(", ") || "none"}.`,
  );
  lines.push(
    `Idle fighters: ${idleFighters.map((a) => `${a.id}@${posStr(a.pos)}`).join(", ") || "none"}.`,
  );
  lines.push(
    `Busy fighters: ${busyFighters.map((a) => `${a.id}(->${a.targetMonster})`).join(", ") || "none"}.`,
  );
  lines.push(
    `Known monsters: ${
      st.monsters.map((m) => {
        const tag = assignedMonsters.has(m.id)
          ? "(being cleared)"
          : guardedMonsters.has(m.id)
          ? "(GUARDED — a scout is blocked here, send a fighter)"
          : "";
        return `${m.id}@${posStr(m.pos)}${tag}`;
      }).join(", ") || "none"
    }.`,
  );
  lines.push(`Some frontier cells to explore: ${frontierList || "none"}.`);
  lines.push("");
  lines.push("Command your idle agents now.");
  return lines.join("\n");
}

// ── decode the model's tool calls into a validated Plan ─────────────────────
function reachable(fog: FogMap, from: Pos, to: Pos): boolean {
  return knownPassable(fog, to) && pathOverFog(fog, from, to, { avoidMonsters: true }) !== null;
}

function decode(
  st: CaptainState,
  calls: readonly { name: string; input: Record<string, unknown> }[],
): { plan: Plan; orders: CaptainOrder[] } {
  const idleScouts = new Set(
    st.agents.filter((a) => a.kind === "scout" && a.state === "idle").map((a) => a.id),
  );
  const idleFighters = new Set(
    st.agents.filter((a) => a.kind === "fighter" && a.state === "idle").map((a) => a.id),
  );
  const aliveMonsters = new Map(st.monsters.map((m) => [m.id, m.pos] as const));

  const scoutClaims = new Set<string>();
  const fighterClaims = new Set<string>();
  const monsterClaims = new Set<string>();
  const scouts: { id: string; toward: Pos }[] = [];
  const fighters: { id: string; target: string }[] = [];
  let march = false;
  const orders: CaptainOrder[] = [];

  const safeRoute = st.exit
    ? pathOverFog(st.fog, st.captainPos, st.exit, { avoidMonsters: true }) !== null
    : false;

  for (const c of calls) {
    const inp = c.input ?? {};
    const reason = typeof inp.reason === "string" && inp.reason.trim() ? inp.reason.trim() : "";
    if (!reason) continue; // the reason-gate, on orders: no reason ⟹ the order is refused

    if (c.name === "assign_scout") {
      const id = String(inp.scout_id ?? "");
      const x = Number(inp.x), y = Number(inp.y);
      if (!idleScouts.has(id) || scoutClaims.has(id)) continue;
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      const toward = { x, y };
      if (!reachable(st.fog, st.captainPos, toward)) continue; // not reachable known floor
      scoutClaims.add(id);
      scouts.push({ id, toward });
      orders.push({ kind: "assign_scout", id, toward, reason });
    } else if (c.name === "dispatch_fighter") {
      const id = String(inp.fighter_id ?? "");
      const target = String(inp.monster_id ?? "");
      if (!idleFighters.has(id) || fighterClaims.has(id)) continue;
      if (!aliveMonsters.has(target) || monsterClaims.has(target)) continue;
      fighterClaims.add(id);
      monsterClaims.add(target);
      fighters.push({ id, target });
      orders.push({ kind: "dispatch_fighter", id, target, reason });
    } else if (c.name === "march") {
      if (!safeRoute) continue; // no monster-free known route ⟹ cannot march
      march = true;
      orders.push({ kind: "march", reason });
    } else if (c.name === "hold") {
      orders.push({ kind: "hold", reason });
    }
  }

  return { plan: { scouts, fighters, march }, orders };
}

function productive(plan: Plan): boolean {
  return plan.scouts.length > 0 || plan.fighters.length > 0 || plan.march;
}

/** The LLM captain. Reuses the model stack (ModelClient + Groq's 429 backoff) verbatim;
 *  on a parse/transport error it falls back to the greedy plan, so a flaky model never
 *  stalls the solve. After each step it records `lastReasoning` — the model's prose
 *  plus the decoded orders — which the scheduler stamps onto the plan frame. */
export function modelCaptainBrain(client: ModelClient): CaptainBrain {
  const brain: CaptainBrain = {
    name: client.name,
    async plan(state) {
      let turn;
      try {
        turn = await client.converse(SYSTEM, [{ role: "user", text: renderState(state) }], toolSpecs());
      } catch (err) {
        console.error(`  [captain model error: ${err instanceof Error ? err.message : err}]`);
        brain.lastReasoning = reasoningOf("(model error — greedy fallback)", [
          { kind: "fallback", reason: "model/transport error" },
        ]);
        return scriptedPlan(state);
      }
      const { plan, orders } = decode(state, turn.toolCalls);

      if (productive(plan)) {
        brain.lastReasoning = reasoningOf(turn.text ?? "", orders);
        return plan;
      }
      // the model did nothing useful — anti-stall: let greedy step in IF work remains
      const greedy = scriptedPlan(state);
      if (productive(greedy)) {
        brain.lastReasoning = reasoningOf(turn.text ?? "", [
          ...orders,
          { kind: "fallback", reason: "model left idle agents with work to do" },
        ]);
        return greedy;
      }
      // genuinely nothing to do (all agents busy) — hold, as both agree
      brain.lastReasoning = reasoningOf(
        turn.text ?? "",
        orders.length ? orders : [{ kind: "hold", reason: "all agents busy" }],
      );
      return HOLD;
    },
  };
  return brain;
}
