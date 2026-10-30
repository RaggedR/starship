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
 *  agent (contrast ~/git/gold/dungeon, where each monster is its own model). The
 *  hero must reduce its hp to 0 to pass — or route around it if the maze allows. */
export type Monster = {
  readonly id: string;
  readonly pos: Pos;
  readonly hp: number;
  readonly atk: number;
};

export type Hero = {
  readonly pos: Pos;
  readonly hp: number;
  readonly atk: number;
};

/** The whole maze. `walls` is `height` rows, each `width` chars, '#' = wall and
 *  '.' = floor. Walls never change, so they stay as laid; only the hero and the
 *  monsters move or die. */
export type MazeWorld = {
  readonly width: number;
  readonly height: number;
  readonly walls: readonly string[];
  readonly hero: Hero;
  readonly monsters: readonly Monster[];
  readonly exit: Pos;
};
