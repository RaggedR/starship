// scheduler.ts — the tick loop that replaces the fleet's two-phase round. The fleet
// ran one scout to completion, then one fighter, then marched; that shape does not
// survive contention. Here a POOL of eight agents is advanced one tick at a time,
// and the captain RE-PLANS around whoever has gone idle — which scout to send where,
// which fighter to which monster, when to commit itself to the exit.
//
// Determinism contract (the whole risk lives here): agents are processed in a FIXED
// id order within a tick, and their gated CLI calls run SERIALLY — never Promise.all
// over agents that mutate the shared world file, or the move order (and the audit)
// stops being reproducible. `tensorC` means "all scout reports are owed," NOT
// "executed concurrently"; we serialise it. One planning step reads as
// seqC(tensor(scout₁…scout₅), dispatch): gather every scout report (serial, fixed
// order), fold them into the fog by the N-ary join, THEN let the captain decide the
// fighter dispatches and the march.

import type { HarnessCtx } from "../bridge/harness.ts";
import type { Dir, Pos } from "../maze/types.ts";
import { eq } from "../maze/world.ts";
import {
  clearMonster,
  emptyFog,
  exitCell,
  type FogMap,
  frontier,
  mergeSighting,
  unknownCount,
} from "../maze/fog.ts";
import {
  adjacentFreeCell,
  type FleetAction,
  type FleetEmit,
  frontierField,
  lookToSighting,
  pathOverFog,
  unitLook,
} from "../fleet/ops.ts";
import { amalgamate } from "./amalgamate.ts";
import { byKind, makePool, type SwarmAgent } from "./types.ts";
import {
  type AgentView,
  type CaptainBrain,
  type CaptainState,
  type Plan,
  scriptedCaptainBrain,
  scriptedPlan,
} from "./captain.ts";
import { dispatchFighter, dispatchScout, marchCaptain, scoutReg, trailFront } from "./dispatch.ts";

export type SwarmResult = {
  readonly solved: boolean;
  readonly ticks: number;
  readonly scoutMoves: number;
  readonly fighterMoves: number;
  readonly captainMoves: number;
  readonly kills: number;
  readonly unknownAtEnd: number;
  readonly finalFog: FogMap;
  readonly captainPos: Pos;
  readonly plans: number; // how many times the captain was consulted (bounds LLM calls)
};

export type SwarmParams = {
  readonly ctx: HarnessCtx;
  readonly width: number;
  readonly height: number;
  readonly units: readonly { id: string; pos: Pos; hp: number; speed: number }[];
  readonly brain?: CaptainBrain;
  readonly maxTicks?: number;
  readonly sink?: (a: FleetAction, fog: FogMap) => void;
};

export function orchestrateSwarm(params: SwarmParams): Promise<SwarmResult> {
  const { ctx, width, height } = params;
  const brain = params.brain ?? scriptedCaptainBrain();
  const maxTicks = params.maxTicks ?? 2000;
  const rawSink = params.sink ?? (() => {});

  const speedOf = new Map(params.units.map((u) => [u.id, u.speed]));
  const pool = makePool(params.units);
  const captain = pool.find((a) => a.kind === "captain")!;
  let captainFog: FogMap = emptyFog(width, height);

  const counts = { scout: 0, fighter: 0, captain: 0, kills: 0, plans: 0 };
  const emit: FleetEmit = (a) => {
    if (a.action === "move" && a.ok) {
      if (a.actor.startsWith("scout")) counts.scout++;
      else if (a.actor.startsWith("fighter")) counts.fighter++;
      else if (a.actor === "captain") counts.captain++;
    }
    rawSink(a, captainFog);
  };

  // ── the captain's view of one agent, and of the whole state ───────────────
  const viewOf = (a: SwarmAgent): AgentView => ({
    id: a.id, kind: a.kind, state: a.state, pos: a.pos, hp: a.hp,
    toward: a.toward, guarding: a.guarding, targetMonster: a.targetMonster,
  });
  const buildState = (): CaptainState => ({
    fog: captainFog,
    captainPos: captain.pos,
    agents: pool.map(viewOf),
    monsters: Object.entries(captainFog.monsters).map(([id, pos]) => ({ id, pos })),
    frontier: frontier(captainFog),
    exit: exitCell(captainFog),
  });

  // ── apply a plan: activate idle agents only (never touch a mid-order agent) ─
  const applyPlan = (plan: Awaited<ReturnType<CaptainBrain["plan"]>>): void => {
    for (const { id, toward } of plan.scouts) {
      const a = pool.find((x) => x.id === id);
      if (a && a.kind === "scout" && a.state === "idle") {
        a.toward = toward;
        a.state = "exploring";
      }
    }
    for (const { id, target } of plan.fighters) {
      const a = pool.find((x) => x.id === id);
      if (!a || a.kind !== "fighter" || a.state !== "idle") continue;
      const mpos = captainFog.monsters[target];
      if (!mpos) continue;
      const adj = adjacentFreeCell(captainFog, mpos);
      if (!adj) continue;
      const path = pathOverFog(captainFog, a.pos, adj, { avoidMonsters: true });
      if (path === null) continue;
      a.targetMonster = target;
      a.path = path;
      a.state = path.length > 0 ? "travelling" : "fighting";
    }
  };

  // Emit a compact plan frame when the captain actually commands something — the
  // website's "captain's plan + reasoning" strip. Carries brain.lastReasoning, which
  // the LLM captain fills with its prose + per-order reasons (empty for scripted).
  const emitPlan = (plan: Plan): void => {
    if (plan.scouts.length === 0 && plan.fighters.length === 0 && !plan.march) return;
    const parts: string[] = [];
    for (const s of plan.scouts) parts.push(`${s.id}→(${s.toward.x},${s.toward.y})`);
    for (const f of plan.fighters) parts.push(`${f.id}→${f.target}`);
    if (plan.march) parts.push("march");
    emit({
      actor: "captain", action: "plan",
      detail: parts.join("  "),
      reason: brain.lastReasoning ?? "",
    });
  };

  async function solve(): Promise<SwarmResult> {
    emit({
      actor: "-", action: "phase", detail: "explore",
      reason: "fan the scouts across the maze and clear only what blocks the way out",
    });

    // ── bootstrap: a look-round so the captain's fog knows the entrance ───────
    // The captain plans on frontiers; frontiers need something known; only scouts'
    // eyes seed it. Each scout looks once from the entrance and the sighting folds in.
    for (const s of byKind(pool, "scout")) {
      const look = unitLook(ctx, scoutReg(s.id), s.id);
      s.pos = { x: look.unit.x, y: look.unit.y };
      s.hp = look.unit.hp;
      captainFog = mergeSighting(captainFog, lookToSighting(look));
    }

    counts.plans++;
    const firstPlan = await brain.plan(buildState());
    emitPlan(firstPlan);
    applyPlan(firstPlan);

    let ticks = 0;
    while (ticks < maxTicks) {
      ticks++;

      // 1. scouts — the tensor, serialised in fixed id order, folded by the N-ary join
      const baseFog = captainFog;
      const reports = [];
      for (const s of byKind(pool, "scout")) {
        if (s.state !== "exploring") continue;
        const rep = dispatchScout(ctx, s.id, baseFog, s.toward, speedOf.get(s.id)!, emit);
        s.pos = rep.scoutPos;
        reports.push(rep);
        // the goal is spent once reached (or found unreachable) — clear it so a stale
        // target does not drag the scout backward next tick.
        if (rep.goalDone) s.toward = null;
        if (rep.blockedBy) {
          // a monster holds the way: the FIRST scout to find it stays and GUARDS it —
          // keeping it in view so it can explore beyond the instant a fighter clears it
          // — while any later scout that meets the same monster is freed to explore on.
          const m = rep.blockedBy.monsterId;
          const held = pool.some((a) =>
            a.kind === "scout" && a.state === "guarding" && a.guarding === m
          );
          s.toward = null;
          if (held) {
            s.state = "idle";
          } else {
            s.state = "guarding";
            s.guarding = m;
          }
        } else if (rep.exhausted) {
          s.state = "idle"; // region mapped — hand control back to the captain
          s.toward = null;
        }
      }
      if (reports.length > 0) {
        captainFog = amalgamate(captainFog, reports);
        emit({
          actor: "captain", action: "merge",
          detail: `+${reports.length} scout reports · ${unknownCount(captainFog)} cells still dark`,
          reason: "amalgamate the scouts' reports into the fog — the N-ary join",
        });
      }

      // 2. fighters — one step or one strike each, fixed id order. A fighter with no
      // target is a forward RESERVE: it trails the search front (toward the nearest
      // frontier, over monster-free known floor) so it is already close when the next
      // monster surfaces, rather than waiting at the start.
      const field = frontierField(captainFog); // distance-to-nearest-frontier, computed once
      for (const f of byKind(pool, "fighter")) {
        if (f.state === "travelling" || f.state === "fighting") {
          const res = dispatchFighter(
            ctx, f.id, f.pos, f.hp, f.targetMonster!, f.state,
            f.path ?? [], speedOf.get(f.id)!, emit,
          );
          f.pos = res.pos;
          f.hp = res.hp;
          if (res.killed) {
            captainFog = clearMonster(captainFog, f.targetMonster!);
            counts.kills++;
            emit({
              actor: "captain", action: "note",
              detail: `${f.targetMonster} cleared by ${f.id}`,
              reason: "the way is open where a scout was blocked",
            });
            // release the scout guarding this monster — it explores beyond at once
            for (const g of pool) {
              if (g.kind === "scout" && g.guarding === f.targetMonster) {
                g.state = "idle";
                g.guarding = null;
              }
            }
            f.state = "idle";
            f.targetMonster = null;
            f.path = null;
          } else if (res.aborted) {
            f.state = "idle";
            f.targetMonster = null;
            f.path = null;
          } else if (res.arrived && f.state === "travelling") {
            f.state = "fighting"; // adjacent now; strike next tick
          }
        } else if (f.state === "idle") {
          trailFront(ctx, f, captainFog, field, emit); // forward reserve
        }
      }

      // 3. re-plan — but ONLY on an event (decision 6). The gate oracle is the GREEDY
      // plan: if the keyless, deterministic scripted captain finds nothing to assign
      // (no idle scout with open frontier, no idle fighter with a reachable monster,
      // no march), then there is genuinely nothing to decide this tick — an idle
      // fighter held in reserve is not an event — so we do NOT consult the captain.
      // Between events the standing orders carry on, bounding the LLM captain to a few
      // dozen calls over a solve, not one per tick. For the scripted captain this is
      // byte-identical: on a skipped tick its plan was empty and changed nothing.
      const active = pool.some((a) =>
        a.state === "exploring" || a.state === "travelling" ||
        a.state === "fighting" || a.state === "guarding"
      );
      const st = buildState();
      const greedy = scriptedPlan(st);
      if (greedy.scouts.length === 0 && greedy.fighters.length === 0 && !greedy.march) {
        if (!active) break; // nothing to assign and nothing moving ⟹ stuck
        continue; // nothing to decide; let the standing orders run another tick
      }

      counts.plans++;
      const plan = await brain.plan(st);

      if (plan.march) {
        const exit = exitCell(captainFog)!;
        const safe = pathOverFog(captainFog, captain.pos, exit, { avoidMonsters: true });
        if (safe !== null) {
          emit({
            actor: "-", action: "phase", detail: "march",
            reason: "a monster-free route to the exit is known; the captain advances on it",
          });
          captain.pos = marchCaptain(ctx, captain.id, captain.pos, safe as Dir[], emit);
          captain.state = "done";
          return finish(ticks, eq(captain.pos, exit));
        }
      }

      // stall guard — nothing active and nothing new to assign ⟹ cannot progress
      const planEmpty = plan.scouts.length === 0 && plan.fighters.length === 0;
      if (!active && planEmpty) break;

      emitPlan(plan);
      applyPlan(plan);
    }

    return finish(ticks, eq(captain.pos, exitCell(captainFog) ?? { x: -1, y: -1 }));
  }

  function finish(ticks: number, solved: boolean): SwarmResult {
    emit({
      actor: "-", action: "done",
      detail: solved ? "the captain reached the exit" : "the captain did not reach the exit",
      reason: "",
    });
    return {
      solved, ticks,
      scoutMoves: counts.scout,
      fighterMoves: counts.fighter,
      captainMoves: counts.captain,
      kills: counts.kills,
      unknownAtEnd: unknownCount(captainFog),
      finalFog: captainFog,
      captainPos: captain.pos,
      plans: counts.plans,
    };
  }

  return solve();
}
