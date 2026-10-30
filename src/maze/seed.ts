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
// about ALLOCATING TWO FIGHTERS rather than feeding one. A DETERMINISTIC maze (25×17
// cells → 51×35 grid, ~1.5× the first swarm maze) carved by
// scratchpad/genmaze-swarm-lobes.ts, rooted at the CENTRE: the agents start in the
// middle flanked by two gate monsters, and the maze splits there into two halves — one
// holding the exit, one a decoy. The two halves are DIFFERENT mazes, carved from two
// seeded PRNGs (organic/random-looking, NOT a tiled arithmetic pattern and NOT mirror
// images), so each is its own thing to explore; but under fog they are indistinguishable
// — all the captain sees is two identical gates — so it cannot tell which half holds the
// exit, and must open BOTH. That is the point.
//
// The story is guaranteed by construction, not discovered: the two gates sit one cell
// out of the start on IDENTICAL necks, so they are equidistant and found on the SAME tick
// (⟹ both fighters dispatched at once); and because the whole maze is a tree, each gate
// seals its ENTIRE lobe (no way around), so clearing both is necessary, not optional.
// Size note: this is deliberately NOT 10× bigger — with one replay frame per scout
// footstep, a 10× maze is either a near-empty black void (fog never lifts) or a ~17 MB,
// 20k-frame page; ~1.5× is the largest that reveals-to-~half in a watchable ~2k frames.
//
// Agents (all STACKED at the centre (25,17) — friendly units may share a cell, see
// moveGate): FIVE scouts (speed 5) fan out across the two lobes once the gates fall;
// TWO fighters (speed 1) the captain must ALLOCATE; the captain (speed 1) marches itself
// out on borrowed perception. The scripted solve reaches the exit with ~41% of the maze
// still unrevealed — the fog-of-war claim (matching the original's feel at a larger scale).
//
// Monsters — FIVE, and the captain is told only geometry, never which half wins:
//   • TWO GATE monsters (ogre-1, ogre-2), one at the mouth of each half, discovered at
//     the same depth. Every reachable frontier sits behind one or the other, so the
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
  return {
    width: 51,
    height: 35,
    walls: [
      "###################################################",
      "#.............#.........###.....#.........#.......#",
      "#.#########.#.###.#####.###.#####.###.###.#######.#",
      "#.....#.....#.....#.#...###.#.....#...#.#.........#",
      "#####.#.###########.#.#####.#.#####.###.#########.#",
      "#...#.#...#.#.........#.###.....#...#.........#...#",
      "###.#.###.#.#.#####.###.#######.#.###.#####.#.#.###",
      "#...#.#...#...#...#.....###...#.#...#.#.....#.#...#",
      "#.###.#.#######.#.#####.###.#.###.#.###.#####.###.#",
      "#.....#.........#...#...###.#...#.#...#...#.#...#.#",
      "#############.#####.#######.###.###.#.###.#.#.###.#",
      "#...#.......#...#...#...###.#.....#.#...#.#...#...#",
      "#.#.#.#####.#####.#.#.#.###.#####.#####.#.#.###.###",
      "#.#.#...#.#.....#.#.#.#.###.....#...#...#.#.#...#.#",
      "#.#.###.#.#####.#.#.#.#.#######.###.#.###.###.###.#",
      "#.#.....#.....#...#.#.#.###.....#.#.#...#.........#",
      "#.###########.#####.#.#.###.#####.#.###.#.#########",
      "#.....#.......#.....#.#.....#...#...#...#.#.......#",
      "#.###.#.#####.#.#####.#######.#.#.###.###.#.#####.#",
      "#.#.#.#.#.....#.#...#...###...#.#.#...#...#.....#.#",
      "#.#.#.#.#.#####.#.#####.###.###.#.#.#######.#####.#",
      "#...#.#.#...#...#...#...###.#...#.#.........#...#.#",
      "#####.#.###.#.#####.#.#####.#####.#.#########.#.#.#",
      "#...#.#.#...#.......#.#.###.#.....#.........#.#.#.#",
      "#.#.#.#.###########.#.#.###.#.#############.#.#.#.#",
      "#.#...#.#...........#.#.###.#...#.....#.....#.#...#",
      "#.#####.#.###########.#.###.###.###.#.#######.###.#",
      "#.#.....#.#.........#...###.#...#...#.........#.#.#",
      "#.###.#.#.#.#######.###.###.#.###.#############.#.#",
      "#...#.#...#.#.....#.#...###.#.#...#.............#.#",
      "#.#.#######.#.#.###.#.#####.#.#.###.#####.#######.#",
      "#.#.#.....#...#.#...#.#.###.#...#.....#...#.....#.#",
      "#.#.#.###.#####.#.###.#.###.#####.###.#####.###.#.#",
      "#.#.....#.......#.......###.........#.........#...#",
      "###################################################",
    ],
    units: [
      { id: "scout-1", pos: { x: 25, y: 17 }, hp: 10, atk: 1, speed: 5 },
      { id: "scout-2", pos: { x: 25, y: 17 }, hp: 10, atk: 1, speed: 5 },
      { id: "scout-3", pos: { x: 25, y: 17 }, hp: 10, atk: 1, speed: 5 },
      { id: "scout-4", pos: { x: 25, y: 17 }, hp: 10, atk: 1, speed: 5 },
      { id: "scout-5", pos: { x: 25, y: 17 }, hp: 10, atk: 1, speed: 5 },
      { id: "fighter-1", pos: { x: 25, y: 17 }, hp: 20, atk: 3, speed: 1 },
      { id: "fighter-2", pos: { x: 25, y: 17 }, hp: 20, atk: 3, speed: 1 },
      { id: "captain", pos: { x: 25, y: 17 }, hp: 10, atk: 0, speed: 1 },
    ],
    monsters: [
      { id: "ogre-1", pos: { x: 27, y: 17 }, hp: 5, atk: 2 }, // exit-half gate
      { id: "ogre-2", pos: { x: 23, y: 17 }, hp: 5, atk: 2 }, // decoy-half gate
      { id: "orc-1", pos: { x: 29, y: 25 }, hp: 5, atk: 2 }, // exit route, past ogre-1
      { id: "goblin-1", pos: { x: 9, y: 23 }, hp: 3, atk: 1 }, // deep in decoy
      { id: "goblin-2", pos: { x: 11, y: 5 }, hp: 3, atk: 1 }, // deep in decoy
    ],
    exit: { x: 35, y: 25 },
  };
}
