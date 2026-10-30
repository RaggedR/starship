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
    units: [{ id: "hero", pos: { x: 0, y: 0 }, hp: 20, atk: 3, speed: 1 }],
    monsters: [
      { id: "goblin-1", pos: { x: 2, y: 0 }, hp: 3, atk: 1 },
      { id: "orc-1", pos: { x: 2, y: 2 }, hp: 5, atk: 2 },
    ],
    exit: { x: 0, y: 2 },
  };
}

// ── the fleet maze ─────────────────────────────────────────────────────────
// A large DETERMINISTIC perfect maze (a spanning tree): exactly one route between
// any two cells, so every branch off the solution is a dead end the scout must
// explore and retreat from — the backtracking the fleet demo is built to show.
// 21×15, start→exit path length 71, ten dead ends. Generated once by
// scratchpad/genmaze.ts (fixed per-cell neighbour order, no RNG) and pasted here
// as data, so it is part of the serialisable world like every other seed.
//
// All three units start STACKED on the entrance (1,1): the captain sends the scout
// and fighter out from its own position each round. Two monsters sit on the unique
// corridor to the exit, so the fighter must clear both before the captain can pass.
// Speeds: the scout ranges at 5 cells per dispatch, the fighter and captain at 1.

export function seedFleet(): MazeWorld {
  return {
    width: 21,
    height: 15,
    walls: [
      "#####################",
      "#.....#.......#.....#",
      "#####.#.#####.#.###.#",
      "#.#...#.#.#...#.#.#.#",
      "#.#.###.#.#.###.#.#.#",
      "#.#.....#.#.....#.#.#",
      "#.#######.#######.#.#",
      "#.....#.......#...#.#",
      "#.###.#.#.###.#.#.#.#",
      "#...#.#.#...#.#.#...#",
      "#.#.###.###.###.#####",
      "#.#...#.#.#...#.#...#",
      "#.###.#.#.###.#.#.#.#",
      "#...#.......#.....#.#",
      "#####################",
    ],
    units: [
      { id: "scout", pos: { x: 1, y: 1 }, hp: 10, atk: 1, speed: 5 },
      { id: "fighter", pos: { x: 1, y: 1 }, hp: 20, atk: 3, speed: 1 },
      { id: "captain", pos: { x: 1, y: 1 }, hp: 10, atk: 0, speed: 1 },
    ],
    monsters: [
      { id: "goblin-1", pos: { x: 12, y: 1 }, hp: 3, atk: 1 },
      { id: "orc-1", pos: { x: 19, y: 6 }, hp: 5, atk: 2 },
    ],
    exit: { x: 19, y: 13 },
  };
}
