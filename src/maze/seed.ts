// seed.ts — one fixed, hand-laid maze (mirrors src/world/seed.ts). Deterministic:
// the same maze every run, so the demo replays byte-identically.
//
// The layout is a compact snake corridor: two full-width floor rows joined by one
// connector on the right. There is exactly one route from the start to the exit,
// and a monster sits squarely on each leg — so they must be fought, not skirted.
// That is deliberate: it guarantees the agent exercises both `move` and `attack`
// (and, for the orc, a two-hit fight that actually costs the hero hp) while still
// finishing in about a dozen steps.
//
//   col →   01234
//   row 0   @ . G . .      hero starts top-left; goblin-1 at (2,0)
//       1   # # # # .      the only way down is the connector at x=4
//       2   X . O . .      exit at (0,2); orc-1 at (2,2) guards the way back

import type { MazeWorld } from "./types.ts";

export function seedMaze(): MazeWorld {
  return {
    width: 5,
    height: 3,
    walls: [
      ".....",
      "####.",
      ".....",
    ],
    hero: { pos: { x: 0, y: 0 }, hp: 20, atk: 3 },
    monsters: [
      { id: "goblin-1", pos: { x: 2, y: 0 }, hp: 3, atk: 1 },
      { id: "orc-1", pos: { x: 2, y: 2 }, hp: 5, atk: 2 },
    ],
    exit: { x: 0, y: 2 },
  };
}
