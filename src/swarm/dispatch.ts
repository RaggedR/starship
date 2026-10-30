// dispatch.ts — the swarm's per-TICK hands. Unlike the fleet's leaves (which run a
// whole explore/engage to completion in one call), these advance an agent by ONE
// tick's worth of its speed, so the scheduler can interleave eight agents and the
// trace shows them moving together. They reuse the fleet's gated primitives
// (ops.ts): every move/attack still passes the registry allowlist and the reason
// gate, and every read is logged — the only addition is a per-UNIT registry so the
// two-layer log names scout-3 or fighter-1, not a single "scout".

import type { HarnessCtx, Registry } from "../bridge/harness.ts";
import type { Dir, Pos } from "../maze/types.ts";
import { DIRS, eq, step } from "../maze/world.ts";
import {
  type FogMap,
  knownPassable,
  mergeSighting,
  monsterKnownAt,
} from "../maze/fog.ts";
import type { SwarmAgent } from "./types.ts";
import {
  type FleetEmit,
  lookToSighting,
  nearestFrontierStep,
  pathOverFog,
  type ScoutReport,
  unitAttack,
  unitLook,
  unitMove,
} from "../fleet/ops.ts";

// ── per-unit registries: the permission grant, now keyed by agent id ────────
export const scoutReg = (id: string): Registry => ({
  agentId: `agent:${id}`,
  allowed: new Set(["look", "move"]),
});
export const fighterReg = (id: string): Registry => ({
  agentId: `agent:${id}`,
  allowed: new Set(["move", "attack"]),
});
export const captainReg = (id: string): Registry => ({
  agentId: `agent:${id}`,
  allowed: new Set(["move"]),
});

// ── the scout: a scripted navigator (decision 3 — scouts are not models) ────
/** Advance scout `id` up to `speed` cells this tick, heading toward its assigned
 *  frontier `toward` (routing over known floor) and exploring locally once there.
 *  Navigates on `baseFog` plus its OWN sightings this tick — it does NOT see the
 *  other scouts' sightings from this same tick (those fold in at tick end, the N-ary
 *  join). Stops early if the way forward is a known monster (reports `blockedBy` and
 *  holds — retreat is handing control back) or nothing productive remains. Reads its
 *  own eyes each step; returns the sightings for the captain to amalgamate. */
export type SwarmScoutReport = ScoutReport & {
  /** The assigned goal was reached (or found unreachable) during this sortie, so the
   *  scheduler should clear `toward` — the scout is now free-exploring, and a stale
   *  goal would drag it backward. */
  readonly goalDone: boolean;
};

export function dispatchScout(
  ctx: HarnessCtx,
  id: string,
  baseFog: FogMap,
  toward: Pos | null,
  speed: number,
  emit: FleetEmit,
): SwarmScoutReport {
  const reg = scoutReg(id);
  let fog = baseFog; // the scout's working view this tick
  const sightings: ScoutReport["sightings"][number][] = [];
  let blockedBy: ScoutReport["blockedBy"] = null;
  let exhausted = false;
  let movesMade = 0;
  // A ONE-WAY latch: a scout commutes to its goal, then free-explores and never
  // routes back. Without this it ping-pongs — reach goal, step off, route back,
  // step off — burning its whole speed revealing nothing.
  let freeExplore = toward === null;

  let look = unitLook(ctx, reg, id);
  let pos: Pos = { x: look.unit.x, y: look.unit.y };

  while (true) {
    const sighting = lookToSighting(look);
    fog = mergeSighting(fog, sighting);
    sightings.push(sighting);

    if (movesMade >= speed) break;

    // choose the step: commute toward the goal, else free-explore
    let dir: Dir | null;
    if (!freeExplore && toward && !eq(pos, toward)) {
      const path = pathOverFog(fog, pos, toward, { avoidMonsters: true });
      if (path && path.length > 0) {
        dir = path[0];
      } else {
        freeExplore = true; // goal unreachable on known floor — explore from here
        dir = nearestFrontierStep(fog, pos);
      }
    } else {
      freeExplore = true; // reached the goal (or had none) — latch into exploration
      dir = nearestFrontierStep(fog, pos);
    }

    if (dir === null) {
      exhausted = true; // nothing productive reachable from here
      break;
    }
    const target = step(pos, dir);
    const blocker = monsterKnownAt(fog, target);
    if (blocker) {
      blockedBy = { monsterId: blocker, at: target };
      break; // the way forward is held — stop and report
    }
    const out = unitMove(ctx, reg, id, dir, `scouting ${dir} toward unmapped ground`, emit);
    if (!out.ok) {
      exhausted = true; // routed over known floor; a refusal means a dead end
      break;
    }
    movesMade++;
    pos = target;
    look = unitLook(ctx, reg, id);
  }

  return { sightings, scoutPos: pos, blockedBy, exhausted, movesMade, goalDone: freeExplore };
}

// ── the fighter: one step OR one strike per tick (blind, dead-reckoning) ─────
export type FighterTick = {
  readonly pos: Pos;
  readonly hp: number;
  readonly killed: boolean; // the target fell this tick
  readonly arrived: boolean; // reached the target and is now adjacent (fighting)
  readonly aborted: boolean; // target gone / not adjacent — hand control back
};

/** Advance fighter `id` one tick toward/at its target. `travelling`: walk up to
 *  `speed` steps along `path` (mutated in place as it is consumed); on arrival it is
 *  adjacent and `arrived` flips. `fighting`: strike once, reading its own hp back
 *  from the committed effect (the one thing a blind unit learns). A lethal blow sets
 *  `killed`; a refusal (not adjacent / already gone) sets `aborted`. */
export function dispatchFighter(
  ctx: HarnessCtx,
  id: string,
  pos: Pos,
  hp: number,
  target: string,
  phase: "travelling" | "fighting",
  path: Dir[],
  speed: number,
  emit: FleetEmit,
): FighterTick {
  const reg = fighterReg(id);

  if (phase === "travelling") {
    let steps = 0;
    let p = pos;
    while (steps < speed && path.length > 0) {
      const dir = path[0];
      const out = unitMove(ctx, reg, id, dir, `advancing ${dir} to engage ${target}`, emit);
      if (!out.ok) return { pos: p, hp, killed: false, arrived: false, aborted: true };
      path.shift();
      p = step(p, dir);
      steps++;
    }
    return { pos: p, hp, killed: false, arrived: path.length === 0, aborted: false };
  }

  // fighting: one strike this tick
  const out = unitAttack(ctx, reg, id, target, `attacking ${target} to clear the route`, emit);
  if (!out.ok || !out.effect) {
    return { pos, hp, killed: false, arrived: true, aborted: true };
  }
  return {
    pos,
    hp: out.effect.unitHpAfter,
    killed: out.effect.lethal,
    arrived: true,
    aborted: false,
  };
}

// ── the forward reserve: an idle fighter trails the search front ────────────
/** Advance an idle (unassigned) fighter ONE step toward the search front, so it sits
 *  close to where the next monster will surface rather than waiting at the start.
 *  `field` is frontierField(fog) — distance from every known cell to the nearest
 *  frontier — computed once per tick and shared. The fighter descends that field over
 *  monster-free known floor and stops ~one cell behind the front (never onto a monster,
 *  never into the unknown). Mutates `f.pos`. */
export function trailFront(
  ctx: HarnessCtx,
  f: SwarmAgent,
  fog: FogMap,
  field: Map<string, number>,
  emit: FleetEmit,
): void {
  const key = (p: Pos) => `${p.x},${p.y}`;
  const d0 = field.get(key(f.pos));
  if (d0 === undefined || d0 <= 1) return; // already just behind the front (or no frontier)
  let best: Dir | null = null;
  let bestD = d0;
  for (const dir of DIRS) {
    const n = step(f.pos, dir);
    if (!knownPassable(fog, n) || monsterKnownAt(fog, n)) continue;
    const dn = field.get(key(n));
    if (dn !== undefined && dn < bestD) {
      bestD = dn;
      best = dir;
    }
  }
  if (!best) return;
  const out = unitMove(ctx, fighterReg(f.id), f.id, best, "moving up behind the search front", emit);
  if (out.ok) f.pos = step(f.pos, best);
}

// ── the captain: march a known safe route to the exit, step by step ─────────
/** Walk the captain along `path` (a monster-free known-floor route the plan found),
 *  emitting a frame per step. Returns the final position. By march time every other
 *  agent is idle, so walking the whole route in one dispatch — as the fleet does — is
 *  equivalent to one-step-per-tick and far kinder to the trace. */
export function marchCaptain(
  ctx: HarnessCtx,
  id: string,
  from: Pos,
  path: readonly Dir[],
  emit: FleetEmit,
): Pos {
  const reg = captainReg(id);
  let pos = from;
  for (const dir of path) {
    const out = unitMove(
      ctx,
      reg,
      id,
      dir,
      `advancing ${dir} along the mapped safe route to the exit`,
      emit,
    );
    if (!out.ok) break;
    pos = step(pos, dir);
  }
  return pos;
}
