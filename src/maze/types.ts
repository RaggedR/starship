// types.ts — the maze world, as plain data (mirrors src/world/types.ts).
//
// Same discipline as the star system: the state is the whole world, held as
// serialisable data with no behaviour. The reducers live in world.ts and the
// smart constructors in gates.ts. Keeping it as data is what lets the maze demo
// serialise to one JSON file and replay to the same bytes.
//
// Coordinates: x is the column (0..width-1), y is the row (0..height-1), with y
// increasing DOWNWARD (row 0 at the top). The four moves are therefore:
//   N → y-1   S → y+1   E → x+1   W → x-1

export type Pos = { readonly x: number; readonly y: number };

export type Dir = "N" | "S" | "E" | "W";

/** A monster is a deterministic obstacle: hit points and an attack. It is NOT an
 *  agent (contrast ~/git/gold/dungeon, where each monster is its own model). A unit
 *  must reduce its hp to 0 to pass — or route around it if the maze allows. */
export type Monster = {
  readonly id: string;
  readonly pos: Pos;
  readonly hp: number;
  readonly atk: number;
};

/** A named piece on the board. The single-agent maze has one unit, `hero`; the
 *  fleet has `scout`, `fighter`, `captain`. `speed` is how many move-actions the
 *  unit may take within ONE dispatch (a captain round): the scout ranges ahead at
 *  speed 5, the fighter trudges at 1. It is a fixed attribute, not a mutable
 *  budget, so it stays clear of the determinism contract's "budgets aren't state". */
export type Unit = {
  readonly id: string;
  readonly pos: Pos;
  readonly hp: number;
  readonly atk: number;
  readonly speed: number;
};

/** The whole maze. `walls` is `height` rows, each `width` chars, '#' = wall and
 *  '.' = floor. Walls never change, so they stay as laid; only the units and the
 *  monsters move or die. A unit cannot share a cell with a wall, a monster, or
 *  another unit. */
export type MazeWorld = {
  readonly width: number;
  readonly height: number;
  readonly walls: readonly string[];
  readonly units: readonly Unit[];
  readonly monsters: readonly Monster[];
  readonly exit: Pos;
};
