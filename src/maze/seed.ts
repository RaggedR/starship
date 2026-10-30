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

// ── the swarm maze ─────────────────────────────────────────────────────────
// The fleet grown to a world with something to DECIDE, and shaped so the decision is
// about ALLOCATING TWO FIGHTERS rather than feeding one. A DETERMINISTIC perfect maze
// (20×14 cells → 41×29 grid) carved by scratchpad/genmaze-swarm2.ts, rooted at the
// CENTRE: the agents start in the middle and the maze splits there into two large
// halves — one holding the exit, one a decoy. The captain cannot tell from fog which
// half holds the exit, so it must open BOTH — and that is the point.
//
// Agents (all STACKED at the centre (21,15) — friendly units may share a cell, see
// moveGate): FIVE scouts (speed 5) fan out in several directions at once; TWO fighters
// (speed 1) the captain must ALLOCATE; the captain (speed 1) marches itself out on
// borrowed perception.
//
// Monsters — FIVE, and the captain is told only geometry, never which half wins:
//   • TWO GATE monsters (ogre-1, ogre-2), one a few cells into each half, discovered
//     at the same depth. Every reachable frontier sits behind one or the other, so the
//     captain dispatches BOTH fighters at once — fighter-1 to one gate, fighter-2 to
//     the other. This concurrent dispatch is the "which fighter to which monster"
//     decision the swarm exists to show; the first maze's single corridor never forced
//     it (one fighter cleared everything, the other never moved).
//   • ONE on the exit route past its gate (orc-1): sequential work after the gates.
//   • TWO deep in the DECOY half (goblin-1, goblin-2): once the exit is found in the
//     other half, a monster-free route is known and these are left alone — the
//     prioritisation, visible as the captain declining to clear half the maze.
// Stats mirror the fleet: a goblin (hp 3) falls to one blow, an ogre/orc (hp 5) needs
// two and strikes back once — so a cleared gate actually costs a fighter some hp.

export function seedSwarm(): MazeWorld {
  const c = { x: 21, y: 15 }; // the central start — the fork into the two halves
  return {
    width: 41,
    height: 29,
    walls: [
      "#########################################",
      "#.....#.......#.......#.......#.......#.#",
      "#####.#.#####.#.#####.#.#####.#.#####.#.#",
      "#...#...#...#...#...#...#...#...#...#...#",
      "#.#######.#######.#######.#######.#####.#",
      "#...#...........#...#...........#...#...#",
      "#.#.#.#####.###.#.#.#.#####.###.#.#.#.###",
      "#.#...#.#...#...#.#...#.#...#...#.#...#.#",
      "#.#####.#.#######.#####.#.#######.#####.#",
      "#.....#.#.......#.....#.#.......#.....#.#",
      "#####.#.#######.#####.#.#######.#####.#.#",
      "#...#.......#.......#.......#.......#...#",
      "#.#######.###.#.#########.###.#.#######.#",
      "#...#.....#...#.#...#.....#...#.#...#...#",
      "#.#.#.#####.###.#.#.#.#####.###.#.#.#.###",
      "#.#...#.#...#...#.#...#.#...#...#.#...#.#",
      "#.#####.#.#######.#####.#.#######.#####.#",
      "#.....#.#.......#.....#.#.......#.....#.#",
      "#####.#.#######.#####.#.#######.#####.#.#",
      "#...#.......#.......#.......#.......#...#",
      "#.#######.###.#.#########.###.#.#######.#",
      "#...#.....#...#.#...#.....#...#.#...#...#",
      "#.#.#.#####.###.#.#.#.#####.###.#.#.#.###",
      "#.#.....#...#...#.#.....#...#...#.#...#.#",
      "#.#######.#.#####.#######.#.#####.#####.#",
      "#.....#...#.#...#.....#...#.#...#.....#.#",
      "#####.#.#####.#.#####.#.#####.#.#####.#.#",
      "#.....#.......#.......#.......#.........#",
      "#########################################",
    ],
    units: [
      { id: "scout-1", pos: c, hp: 10, atk: 1, speed: 5 },
      { id: "scout-2", pos: c, hp: 10, atk: 1, speed: 5 },
      { id: "scout-3", pos: c, hp: 10, atk: 1, speed: 5 },
      { id: "scout-4", pos: c, hp: 10, atk: 1, speed: 5 },
      { id: "scout-5", pos: c, hp: 10, atk: 1, speed: 5 },
      { id: "fighter-1", pos: c, hp: 20, atk: 3, speed: 1 },
      { id: "fighter-2", pos: c, hp: 20, atk: 3, speed: 1 },
      { id: "captain", pos: c, hp: 10, atk: 0, speed: 1 },
    ],
    monsters: [
      // the two GATE monsters — one into each half, discovered together
      { id: "ogre-1", pos: { x: 25, y: 13 }, hp: 5, atk: 2 }, // exit-half gate
      { id: "ogre-2", pos: { x: 17, y: 13 }, hp: 5, atk: 2 }, // decoy-half gate
      // sequential work on the exit route, past ogre-1
      { id: "orc-1", pos: { x: 24, y: 5 }, hp: 5, atk: 2 },
      // deep in the decoy half — ignorable once the exit is found
      { id: "goblin-1", pos: { x: 1, y: 27 }, hp: 3, atk: 1 },
      { id: "goblin-2", pos: { x: 3, y: 19 }, hp: 3, atk: 1 },
    ],
    exit: { x: 29, y: 7 },
  };
}
