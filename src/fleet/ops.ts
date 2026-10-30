// ops.ts — the fleet's shared plumbing: the three registries (each agent's
// permission grant), the per-unit dispatch helpers (every agent's only hands), the
// typed reports the leaves return, the event seam the demo/website consume, and the
// fog-pathing the scout and captain plan with.
//
// Every move/attack goes through the SAME runMutation gate as the star-system
// bridge and the single-agent maze: the registry allowlist is checked, the reason
// gate enforced, the write-ahead intent record and correlation id minted. The only
// thing the fleet adds is `--unit <id>` on the argv, so the one dungeon CLI serves
// three distinct actors — and the ship's log records which unit acted.

import { conRead, type HarnessCtx, type Registry, runMutation } from "../bridge/harness.ts";
import type { Dir, Pos } from "../maze/types.ts";
import { DIRS, eq, step } from "../maze/world.ts";
import type { Look } from "../maze/world.ts";
import { type FogMap, frontier, knownPassable, monsterKnownAt } from "../maze/fog.ts";
import type { Sighting } from "../maze/fog.ts";

// ── registries: the permission grant, enforced by absence ──────────────────
/** The scout perceives and roams, but cannot fight. */
export function scoutRegistry(): Registry {
  return { agentId: "agent:scout", allowed: new Set(["look", "move"]) };
}
/** The fighter moves and kills, but is BLIND — no `look`. It acts on orders. */
export function fighterRegistry(): Registry {
  return { agentId: "agent:fighter", allowed: new Set(["move", "attack"]) };
}
/** The captain only moves itself, and only onto ground a scout has revealed. It
 *  holds neither perception nor force — only the authority to delegate. */
export function captainRegistry(): Registry {
  return { agentId: "agent:captain", allowed: new Set(["move"]) };
}

// ── the typed reports (the leaves' positions) ───────────────────────────────
export type ScoutReport = {
  readonly sightings: readonly Sighting[]; // each look taken, for the captain to merge
  readonly scoutPos: Pos;
  readonly blockedBy: { readonly monsterId: string; readonly at: Pos } | null;
  readonly exhausted: boolean; // no reachable frontier from here
  readonly movesMade: number;
};

export type FighterReport = {
  readonly engaged: boolean;
  readonly target: string | null;
  readonly killed: boolean;
  readonly fighterPos: Pos;
  readonly hp: number;
};

export type ScoutShape = { readonly tag: "explore" };
export type FighterShape =
  | { readonly tag: "engage"; readonly target: string; readonly path: readonly Dir[] }
  | { readonly tag: "standby" };

// ── the event seam (the demo turns these into website frames) ───────────────
/** One thing an agent did, worth a frame. Reads (`look`) are NOT emitted — they are
 *  logged in Layer 2 as reads but do not animate; only committed mutations and the
 *  captain's structural notes become frames. The captain stamps its current FogMap
 *  onto each (so the website shows what the CAPTAIN knew at that moment). */
export type FleetAction = {
  readonly actor: string; // unit id, or "captain", or "-"
  readonly action: string; // move | attack | merge | phase | done | engage | standby
  readonly detail?: string;
  readonly reason?: string;
  readonly ok?: boolean;
  readonly corr?: string;
};
export type FleetEmit = (a: FleetAction) => void;

// ── per-unit dispatch helpers ───────────────────────────────────────────────
/** A free read through the gate (registry-checked, logged in Layer 2). Not emitted
 *  as a frame. Returns the typed Look. */
export function unitLook(ctx: HarnessCtx, reg: Registry, unitId: string): Look {
  return conRead(ctx, reg, "look", ["look", "--unit", unitId], { unit: unitId }) as Look;
}

export type MoveResult = { ok: boolean; corr?: string; reason?: string };

/** A gated move for `unitId`. Emits a frame. */
export function unitMove(
  ctx: HarnessCtx,
  reg: Registry,
  unitId: string,
  dir: Dir,
  reason: string,
  emit: FleetEmit,
): MoveResult {
  const out = runMutation(
    ctx,
    reg,
    "move",
    ["move", "--dir", dir, "--unit", unitId],
    { dir, unit: unitId },
    reason,
  );
  emit({
    actor: unitId,
    action: "move",
    detail: dir,
    reason,
    ok: out.ok,
    corr: out.ok ? out.correlationId : undefined,
  });
  return out.ok ? { ok: true, corr: out.correlationId } : { ok: false, reason: out.reason };
}

export type AttackEffect = {
  tag: "attack";
  unitId: string;
  targetId: string;
  monsterHpAfter: number;
  unitHpAfter: number;
  lethal: boolean;
};

/** A gated attack for `unitId` on `targetId`. Emits a frame. Returns the committed
 *  effect (so a blind fighter can read its own hp and the kill from the result). */
export function unitAttack(
  ctx: HarnessCtx,
  reg: Registry,
  unitId: string,
  targetId: string,
  reason: string,
  emit: FleetEmit,
): { ok: boolean; effect?: AttackEffect; reason?: string } {
  const out = runMutation(
    ctx,
    reg,
    "attack",
    ["attack", "--target", targetId, "--unit", unitId],
    { target: targetId, unit: unitId },
    reason,
  );
  emit({
    actor: unitId,
    action: "attack",
    detail: targetId,
    reason,
    ok: out.ok,
    corr: out.ok ? out.correlationId : undefined,
  });
  if (!out.ok) return { ok: false, reason: out.reason };
  const effect = (out.result as { effect: AttackEffect }).effect;
  return { ok: true, effect };
}

// ── Look → Sighting (strip to what the fog needs) ───────────────────────────
export function lookToSighting(look: Look): Sighting {
  const at: Pos = { x: look.unit.x, y: look.unit.y };
  return {
    at,
    onExit: look.onExit,
    neighbours: look.neighbours.map((n) => ({
      pos: step(at, n.dir),
      cell: n.cell,
      monster: n.monster,
    })),
  };
}

// ── fog pathing (the scout and captain plan on known cells only) ────────────
const key = (p: Pos) => `${p.x},${p.y}`;

/** Shortest path of directions from `from` to `to` over KNOWN-passable cells.
 *  `avoidMonsters` excludes cells with a known live monster (the captain marching,
 *  which must not step onto one). BFS in the fixed DIRS order, so deterministic.
 *  Returns [] if already there, or null if `to` is unreachable on what is known. */
export function pathOverFog(
  fog: FogMap,
  from: Pos,
  to: Pos,
  opts: { avoidMonsters: boolean },
): Dir[] | null {
  if (eq(from, to)) return [];
  const walkable = (p: Pos) =>
    knownPassable(fog, p) && (!opts.avoidMonsters || !monsterKnownAt(fog, p));
  const prev = new Map<string, { from: Pos; dir: Dir }>();
  const seen = new Set<string>([key(from)]);
  let q: Pos[] = [from];
  while (q.length) {
    const next: Pos[] = [];
    for (const p of q) {
      for (const dir of DIRS) {
        const nxt = step(p, dir);
        if (seen.has(key(nxt)) || !walkable(nxt)) continue;
        seen.add(key(nxt));
        prev.set(key(nxt), { from: p, dir });
        if (eq(nxt, to)) {
          const dirs: Dir[] = [];
          let cur = nxt;
          while (!eq(cur, from)) {
            const e = prev.get(key(cur))!;
            dirs.unshift(e.dir);
            cur = e.from;
          }
          return dirs;
        }
        next.push(nxt);
      }
    }
    q = next;
  }
  return null;
}

/** The first step toward the nearest frontier cell, over known-passable ground
 *  (monsters are passable FOR ROUTING — their cell's terrain is floor — so the
 *  scout heads toward frontiers beyond a monster; the scout loop stops it one cell
 *  short). Null when no frontier is reachable: the region is fully mapped. */
export function nearestFrontierStep(fog: FogMap, from: Pos): Dir | null {
  const fset = new Set(frontier(fog).map(key));
  if (fset.size === 0) return null;
  const prev = new Map<string, { from: Pos; dir: Dir }>();
  const seen = new Set<string>([key(from)]);
  let q: Pos[] = [from];
  while (q.length) {
    const next: Pos[] = [];
    for (const p of q) {
      for (const dir of DIRS) {
        const nxt = step(p, dir);
        if (seen.has(key(nxt)) || !knownPassable(fog, nxt)) continue;
        seen.add(key(nxt));
        prev.set(key(nxt), { from: p, dir });
        if (fset.has(key(nxt))) {
          let cur = nxt;
          // walk back to the first step out of `from`
          while (true) {
            const e = prev.get(key(cur))!;
            if (eq(e.from, from)) return e.dir;
            cur = e.from;
          }
        }
        next.push(nxt);
      }
    }
    q = next;
  }
  return null;
}

/** A known-passable, monster-free cell adjacent to `at` (where the fighter stands
 *  to strike). Deterministic by DIRS order. Null if none is known yet. */
export function adjacentFreeCell(fog: FogMap, at: Pos): Pos | null {
  for (const dir of DIRS) {
    const p = step(at, dir);
    if (knownPassable(fog, p) && !monsterKnownAt(fog, p)) return p;
  }
  return null;
}
