// world.ts — the deterministic maze: reads (what a unit perceives) and the
// reducers (how a committed effect changes the world). Mirrors src/world/world.ts.
//
// Everything here is a pure total function of (world, args): no randomness, no
// clock, no I/O. The gates (gates.ts) decide WHICH effects are legal; this file
// only applies ones already found legal, and answers the read `look`.
//
// Multi-unit: every read and reducer is keyed by a unit id. The single-agent maze
// has one unit, "hero"; the fleet has "scout"/"fighter"/"captain". A unit's `look`
// is its OWN window on the world — the captain, having no unit it perceives with
// directly, reads nothing here and plans only on its fog (maze/fog.ts).

import type { Dir, MazeWorld, Monster, Pos, Unit } from "./types.ts";

// ── Geometry ──────────────────────────────────────────────────────────
export function step(pos: Pos, dir: Dir): Pos {
  switch (dir) {
    case "N":
      return { x: pos.x, y: pos.y - 1 };
    case "S":
      return { x: pos.x, y: pos.y + 1 };
    case "E":
      return { x: pos.x + 1, y: pos.y };
    case "W":
      return { x: pos.x - 1, y: pos.y };
  }
}

export const DIRS: readonly Dir[] = ["N", "E", "S", "W"];

export function eq(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Off-grid counts as a wall, so you cannot step off the edge of the maze. */
export function isWall(world: MazeWorld, pos: Pos): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) {
    return true;
  }
  return world.walls[pos.y][pos.x] === "#";
}

export function monsterAt(world: MazeWorld, pos: Pos): Monster | null {
  return world.monsters.find((m) => eq(m.pos, pos)) ?? null;
}

/** The unit standing on `pos`, if any — the basis for unit-unit collision. */
export function unitAt(world: MazeWorld, pos: Pos): Unit | null {
  return world.units.find((u) => eq(u.pos, pos)) ?? null;
}

export function unitById(world: MazeWorld, id: string): Unit | null {
  return world.units.find((u) => u.id === id) ?? null;
}

/** The unit `id`, or a RefError — distinct from a gate refusal: naming a unit that
 *  is not on the board is a reference error, not an illegal move. */
export function requireUnit(world: MazeWorld, id: string): Unit {
  const u = unitById(world, id);
  if (!u) throw new RefError(`no such unit: ${id}`);
  return u;
}

/** A coarse compass bearing from `from` to `to`, e.g. "SE", or "here". A hint for
 *  the agent, not a path — the maze may force a detour. */
export function bearingOf(from: Pos, to: Pos): string {
  const v = to.y < from.y ? "N" : to.y > from.y ? "S" : "";
  const h = to.x < from.x ? "W" : to.x > from.x ? "E" : "";
  return (v + h) || "here";
}

// ── Reads ───────────────────────────────────────────────────────────────
export type Neighbour = {
  readonly dir: Dir;
  readonly cell: "wall" | "floor" | "exit";
  readonly monster: string | null;
  readonly unit: string | null;
};

/** What a unit perceives: its own state, what lies in each of the four directions
 *  (wall / floor / exit, and any monster or other unit there), and where the exit
 *  is. This is the unit's only window on the world — it reads nothing else. */
export type Look = {
  readonly unit: Pos & { readonly id: string; readonly hp: number };
  readonly onExit: boolean;
  readonly neighbours: readonly Neighbour[];
  readonly exit: Pos;
  readonly exitDistance: number;
  readonly exitBearing: string;
};

export function look(world: MazeWorld, unitId: string): Look {
  const u = requireUnit(world, unitId);
  const neighbours: Neighbour[] = DIRS.map((dir) => {
    const p = step(u.pos, dir);
    const cell: "wall" | "floor" | "exit" = isWall(world, p)
      ? "wall"
      : eq(p, world.exit)
      ? "exit"
      : "floor";
    const m = monsterAt(world, p);
    const other = unitAt(world, p);
    return { dir, cell, monster: m ? m.id : null, unit: other ? other.id : null };
  });
  return {
    unit: { id: u.id, x: u.pos.x, y: u.pos.y, hp: u.hp },
    onExit: eq(u.pos, world.exit),
    neighbours,
    exit: world.exit,
    exitDistance: manhattan(u.pos, world.exit),
    exitBearing: bearingOf(u.pos, world.exit),
  };
}

export function unitStatus(
  world: MazeWorld,
  id: string,
): Unit & { readonly alive: boolean } {
  const u = requireUnit(world, id);
  return { ...u, alive: u.hp > 0 };
}

/** Is unit `id` standing on the exit? The win condition is phrased per-unit: the
 *  single-agent maze asks it of "hero", the fleet of "captain". */
export function atExit(world: MazeWorld, id: string): boolean {
  const u = unitById(world, id);
  return u ? eq(u.pos, world.exit) : false;
}

export function isDead(world: MazeWorld, id: string): boolean {
  const u = unitById(world, id);
  return u ? u.hp <= 0 : true;
}

// ── Committed effects (produced by gates.ts, applied here) ───────────────
export type MazeEffect =
  | { readonly tag: "move"; readonly unitId: string; readonly to: Pos; readonly dir: Dir }
  | {
    readonly tag: "attack";
    readonly unitId: string;
    readonly targetId: string;
    readonly monsterHpAfter: number;
    readonly unitHpAfter: number;
    readonly lethal: boolean;
  };

function mapUnit(world: MazeWorld, id: string, f: (u: Unit) => Unit): MazeWorld {
  return { ...world, units: world.units.map((u) => (u.id === id ? f(u) : u)) };
}

/** Apply a committed effect. Pure: returns a new MazeWorld, never mutates the old.
 *  In worker terms (MacBeth Note 5) this IS bwdS — the writeback of a new state
 *  from a position the gate already certified legal. */
export function applyEffect(world: MazeWorld, effect: MazeEffect): MazeWorld {
  switch (effect.tag) {
    case "move":
      return mapUnit(world, effect.unitId, (u) => ({ ...u, pos: effect.to }));
    case "attack": {
      const monsters = effect.lethal
        ? world.monsters.filter((m) => m.id !== effect.targetId)
        : world.monsters.map((m) =>
          m.id === effect.targetId ? { ...m, hp: effect.monsterHpAfter } : m
        );
      const withUnit = mapUnit(world, effect.unitId, (u) => ({ ...u, hp: effect.unitHpAfter }));
      return { ...withUnit, monsters };
    }
  }
}

/** A reference error (a named thing that does not exist) — distinct from a gate
 *  refusal. The CLI maps both to exit 1, but they are different failures: this is
 *  "you named a monster/unit that is not here", a refusal is "that move is illegal". */
export class RefError extends Error {}
