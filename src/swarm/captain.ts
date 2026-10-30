// captain.ts — the captain's DECISION, behind a seam. The scheduler hands the
// captain a CaptainState (its fog and the agent roster — never the true maze) and
// receives a Plan: which idle scouts to send to which frontiers, which idle fighters
// to send to which monsters, and whether to commit itself to the march. Exactly the
// ScoutBrain move (fleet/scout.ts) one level up — the model now sits at the
// ORCHESTRATION layer, not the leaf.
//
// This file holds the seam (CaptainBrain), the state/plan types, and the SCRIPTED
// greedy captain — deterministic, keyless, the default that keeps verify.sh byte-
// identical. The LLM captain (model-captain.ts) is a second CaptainBrain behind the
// same interface; the scheduler cannot tell them apart.
//
// The greedy captain in one breath:
//   • EXPLORE: fan idle scouts across open frontiers (those reachable without a
//     fight). While open frontier remains, do NOT spend a fighter — exploring is
//     free. Only when exploration STALLS (every remaining frontier sits behind a
//     monster) dispatch the nearest idle fighter to the nearest reachable monster.
//   • COMMIT: once a known-floor corridor to the exit exists, stop exploring and
//     clear only the monsters ON that corridor; ignore every other monster (the
//     dead-end ones). March the moment a monster-free route is known.
// It cannot tell a dead-end monster from a path monster before clearing one — from
// fog alone they look identical — so in explore-stall it clears nearest-first. The
// prioritisation it CAN make honestly is commit-mode: off-route monsters are left
// alone. Sharper judgement (skipping dead-ends earlier) is the LLM captain's job.

import type { Pos } from "../maze/types.ts";
import { manhattan } from "../maze/world.ts";
import { type FogMap, monsterKnownAt } from "../maze/fog.ts";
import { adjacentFreeCell, pathOverFog } from "../fleet/ops.ts";
import type { AgentKind, AgentState } from "./types.ts";

const key = (p: Pos) => `${p.x},${p.y}`;

// ── what the captain may see (its fog, never the maze) ──────────────────────
export type AgentView = {
  readonly id: string;
  readonly kind: AgentKind;
  readonly state: AgentState;
  readonly pos: Pos;
  readonly hp: number;
  readonly toward: Pos | null;
  readonly guarding: string | null; // a scout holding this monster in view
  readonly targetMonster: string | null;
};

export type CaptainState = {
  readonly fog: FogMap;
  readonly captainPos: Pos;
  readonly agents: readonly AgentView[];
  readonly monsters: readonly { readonly id: string; readonly pos: Pos }[]; // known alive
  readonly frontier: readonly Pos[];
  readonly exit: Pos | null;
};

// ── the captain's order for one planning step ───────────────────────────────
/** Assignments for idle agents plus the march bit. The captain never reassigns an
 *  ACTIVE agent — it commands only idle ones — so the scheduler may re-plan every
 *  tick (scripted) or only on events (LLM) without thrashing standing orders. */
export type Plan = {
  readonly scouts: readonly { readonly id: string; readonly toward: Pos }[];
  readonly fighters: readonly { readonly id: string; readonly target: string }[];
  readonly march: boolean;
};

export const HOLD: Plan = { scouts: [], fighters: [], march: false };

// ── the seam ────────────────────────────────────────────────────────────────
export type CaptainBrain = {
  readonly name: string;
  plan(state: CaptainState): Promise<Plan>;
  /** The most recent plan's reasoning, for the website/console to surface. The
   *  scripted captain leaves it undefined (it has no prose); the LLM captain sets it
   *  to its reply plus the per-order reasons. Read by the scheduler after plan(). */
  lastReasoning?: string;
};

// ── helpers the greedy plan reasons with ────────────────────────────────────
function reachable(fog: FogMap, from: Pos, to: Pos): boolean {
  return pathOverFog(fog, from, to, { avoidMonsters: true }) !== null;
}

/** Frontier cells a scout can reach and explore WITHOUT a fight: not monster-
 *  occupied, and reachable from the captain over monster-free known floor. When this
 *  is empty, exploration has stalled and only a fighter can reopen it. */
function openFrontiers(st: CaptainState): Pos[] {
  return st.frontier.filter(
    (f) => !monsterKnownAt(st.fog, f) && reachable(st.fog, st.captainPos, f),
  );
}

/** Walk a dir-path from `from`, returning every cell it visits (including `from`). */
function cellsAlong(from: Pos, dirs: readonly { x: number; y: number }[]): Pos[] {
  const out = [from];
  let cur = from;
  for (const d of dirs) {
    cur = { x: cur.x + d.x, y: cur.y + d.y };
    out.push(cur);
  }
  return out;
}

const DELTA: Record<string, { x: number; y: number }> = {
  N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 },
};

/** Fan idle scouts across open frontiers: each idle scout (in id order) claims the
 *  nearest unclaimed open frontier. Fewer frontiers than scouts ⟹ some stay idle.
 *  Manhattan distance keeps it cheap and deterministic; row-major frontier order
 *  breaks ties (strict `<` keeps the earlier cell). */
function assignScouts(
  idleScouts: readonly AgentView[],
  open: readonly Pos[],
): Plan["scouts"] {
  const claimed = new Set<string>();
  const out: { id: string; toward: Pos }[] = [];
  for (const s of idleScouts) {
    let best: Pos | null = null;
    let bestD = Infinity;
    for (const f of open) {
      if (claimed.has(key(f))) continue;
      const d = manhattan(s.pos, f);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (best) {
      claimed.add(key(best));
      out.push({ id: s.id, toward: best });
    }
  }
  return out;
}

/** Dispatch idle fighters to monsters: each idle fighter (in id order) takes the
 *  nearest unclaimed reachable candidate by fighter path-length. A monster with no
 *  known adjacent free cell, or none a fighter can reach, is skipped (queued for a
 *  later plan once a scout reveals a standing cell). */
function assignFighters(
  fog: FogMap,
  idleFighters: readonly AgentView[],
  candidates: readonly { id: string; pos: Pos }[],
): Plan["fighters"] {
  const claimed = new Set<string>();
  const out: { id: string; target: string }[] = [];
  for (const f of idleFighters) {
    let best: string | null = null;
    let bestLen = Infinity;
    for (const m of candidates) {
      if (claimed.has(m.id)) continue;
      const adj = adjacentFreeCell(fog, m.pos);
      if (!adj) continue;
      const path = pathOverFog(fog, f.pos, adj, { avoidMonsters: true });
      if (path === null) continue;
      if (path.length < bestLen) {
        bestLen = path.length;
        best = m.id;
      }
    }
    if (best) {
      claimed.add(best);
      out.push({ id: f.id, target: best });
    }
  }
  return out;
}

// ── the scripted greedy plan ────────────────────────────────────────────────
export function scriptedPlan(st: CaptainState): Plan {
  const idleScouts = st.agents.filter((a) => a.kind === "scout" && a.state === "idle");
  const idleFighters = st.agents.filter((a) => a.kind === "fighter" && a.state === "idle");

  // Monsters already being cleared by a busy fighter are OFF the candidate list —
  // never double-book two fighters onto one monster; the second would arrive to find
  // it already dead. This is what frees the second fighter for a different monster.
  const taken = new Set(
    st.agents
      .filter((a) => a.kind === "fighter" && a.state !== "idle" && a.targetMonster)
      .map((a) => a.targetMonster as string),
  );
  const freeMonsters = st.monsters.filter((m) => !taken.has(m.id));

  // ── COMMIT: a known-floor corridor to the exit exists (possibly through monsters)
  if (st.exit) {
    const corridor = pathOverFog(st.fog, st.captainPos, st.exit, { avoidMonsters: false });
    if (corridor !== null) {
      const safe = pathOverFog(st.fog, st.captainPos, st.exit, { avoidMonsters: true });
      if (safe !== null) return { scouts: [], fighters: [], march: true };
      // clear only the monsters sitting ON the corridor — ignore all others
      const onCorridor = new Set(
        cellsAlong(st.captainPos, corridor.map((d) => DELTA[d])).map(key),
      );
      const blockers = freeMonsters.filter((m) => onCorridor.has(key(m.pos)));
      return { scouts: [], fighters: assignFighters(st.fog, idleFighters, blockers), march: false };
    }
  }

  // ── EXPLORE: fan idle scouts across open frontiers …
  const open = openFrontiers(st);
  const scouts = assignScouts(idleScouts, open);

  // … and dispatch a fighter the MOMENT a scout is holding a monster — do not wait for
  // exploration to stall. A guarded monster is one a scout has found and is keeping in
  // view; the nearest reserve fighter (which has been trailing the front) goes to it.
  // Idle fighters not sent here keep trailing (handled by the scheduler), so the second
  // fighter stays forward, close to the next monster when it surfaces.
  const guarded = freeMonsters.filter((m) =>
    st.agents.some((a) => a.kind === "scout" && a.guarding === m.id)
  );
  let fighters = assignFighters(st.fog, idleFighters, guarded);

  // Fallback for the rare stall with no guard (e.g. a monster known but unguarded while
  // every reachable frontier sits behind it): still reopen with the nearest fighter.
  if (fighters.length === 0 && guarded.length === 0 && open.length === 0) {
    fighters = assignFighters(st.fog, idleFighters, freeMonsters);
  }
  return { scouts, fighters, march: false };
}

/** The default brain: the greedy plan, deterministic and keyless. Keeps verify.sh
 *  byte-identical and is what the scheduler runs when no model is supplied. */
export function scriptedCaptainBrain(): CaptainBrain {
  return {
    name: "scripted-greedy",
    // deno-lint-ignore require-await
    async plan(state) {
      return scriptedPlan(state);
    },
  };
}
