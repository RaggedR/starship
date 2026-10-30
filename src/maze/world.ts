// world.ts — the deterministic maze: reads (what the hero perceives) and the
// reducers (how a committed effect changes the world). Mirrors src/world/world.ts.
//
// Everything here is a pure total function of (world, args): no randomness, no
// clock, no I/O. The gates (gates.ts) decide WHICH effects are legal; this file
// only applies ones already found legal, and answers the read `look`.

import type { Dir, Hero, MazeWorld, Monster, Pos } from "./types.ts";

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
};

/** What the hero perceives: its own state, what lies in each of the four
 *  directions (wall / floor / exit, and any monster there), and where the exit
 *  is. This is the agent's only window on the world — it reads nothing else. */
export type Look = {
  readonly hero: Pos & { readonly hp: number };
  readonly onExit: boolean;
  readonly neighbours: readonly Neighbour[];
  readonly exit: Pos;
  readonly exitDistance: number;
  readonly exitBearing: string;
};

export function look(world: MazeWorld): Look {
  const h = world.hero;
  const neighbours: Neighbour[] = DIRS.map((dir) => {
    const p = step(h.pos, dir);
    const cell: "wall" | "floor" | "exit" = isWall(world, p)
      ? "wall"
      : eq(p, world.exit)
      ? "exit"
      : "floor";
    const m = monsterAt(world, p);
    return { dir, cell, monster: m ? m.id : null };
  });
  return {
    hero: { x: h.pos.x, y: h.pos.y, hp: h.hp },
    onExit: eq(h.pos, world.exit),
    neighbours,
    exit: world.exit,
    exitDistance: manhattan(h.pos, world.exit),
    exitBearing: bearingOf(h.pos, world.exit),
  };
}

export function heroStatus(world: MazeWorld): Hero & { readonly alive: boolean } {
  return { ...world.hero, alive: world.hero.hp > 0 };
}

export function solved(world: MazeWorld): boolean {
  return eq(world.hero.pos, world.exit);
}

export function dead(world: MazeWorld): boolean {
  return world.hero.hp <= 0;
}

// ── Committed effects (produced by gates.ts, applied here) ───────────────
export type MazeEffect =
  | { readonly tag: "move"; readonly to: Pos; readonly dir: Dir }
  | {
    readonly tag: "attack";
    readonly targetId: string;
    readonly monsterHpAfter: number;
    readonly heroHpAfter: number;
    readonly lethal: boolean;
  };

/** Apply a committed effect. Pure: returns a new MazeWorld, never mutates the old.
 *  In worker terms (MacBeth Note 5) this IS bwdS — the writeback of a new state
 *  from a position the gate already certified legal. */
export function applyEffect(world: MazeWorld, effect: MazeEffect): MazeWorld {
  switch (effect.tag) {
    case "move":
      return { ...world, hero: { ...world.hero, pos: effect.to } };
    case "attack": {
      const monsters = effect.lethal
        ? world.monsters.filter((m) => m.id !== effect.targetId)
        : world.monsters.map((m) =>
          m.id === effect.targetId ? { ...m, hp: effect.monsterHpAfter } : m
        );
      return { ...world, monsters, hero: { ...world.hero, hp: effect.heroHpAfter } };
    }
  }
}

/** A reference error (a named thing that does not exist) — distinct from a gate
 *  refusal. The CLI maps both to exit 1, but they are different failures: this is
 *  "you named a monster that is not here", a refusal is "that move is illegal". */
export class RefError extends Error {}
