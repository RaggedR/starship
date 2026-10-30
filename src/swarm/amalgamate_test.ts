// amalgamate_test.ts — the N-ary amalgamation is order-independent, and we prove it
// on REAL scout data. The fleet never exercised this (it merged one report at a
// time); the swarm folds five per tick, so "the captain's map does not depend on
// which scout reported first" is the property that makes the fixed-order scheduler
// sound. It follows from mergeFog's laws (fog_test.ts proves those); here we show it
// holds end-to-end on sightings taken off the actual swarm maze.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { emptyFog, type FogMap, mergeSighting, type Sighting } from "../maze/fog.ts";
import { seedSwarm } from "../maze/seed.ts";
import type { MazeWorld, Pos } from "../maze/types.ts";
import { eq, step } from "../maze/world.ts";
import { DIRS } from "../maze/world.ts";
import { amalgamate, type FogContribution } from "./amalgamate.ts";

/** Build the Sighting a unit standing on `at` would take, straight from the maze —
 *  the same shape lookToSighting produces, without needing a unit on the board. */
function sightingAt(w: MazeWorld, at: Pos): Sighting {
  const cellOf = (p: Pos): "wall" | "floor" | "exit" => {
    if (p.x < 0 || p.y < 0 || p.x >= w.width || p.y >= w.height) return "wall";
    if (w.walls[p.y][p.x] === "#") return "wall";
    return eq(p, w.exit) ? "exit" : "floor";
  };
  const monsterAt = (p: Pos) => w.monsters.find((m) => eq(m.pos, p))?.id ?? null;
  return {
    at,
    onExit: eq(at, w.exit),
    neighbours: DIRS.map((dir) => {
      const p = step(at, dir);
      return { pos: p, cell: cellOf(p), monster: monsterAt(p) };
    }),
  };
}

// Six observation points across the swarm maze: the entrance, a few corridor cells,
// one next to a monster (so occupancy is exercised), and the cell beside the exit
// (so exitSeen flips). They overlap, so the join genuinely combines knowledge.
const W = seedSwarm();

/** A floor cell adjacent to `p` (so an observer can stand there and see `p`). */
function floorBeside(p: Pos): Pos {
  for (const d of DIRS) {
    const n = step(p, d);
    if (n.x >= 0 && n.y >= 0 && n.x < W.width && n.y < W.height && W.walls[n.y][n.x] !== "#") {
      return n;
    }
  }
  throw new Error(`no floor beside ${p.x},${p.y}`);
}

// Observation points derived from the seed (robust to maze edits): the start, a cell
// beside each of the first two monsters (so occupancy is exercised), and a cell beside
// the exit (so exitSeen flips). They overlap, so the join genuinely combines knowledge.
const POINTS: Pos[] = [
  W.units[0].pos, // the central start
  floorBeside(W.monsters[0].pos), // beside a gate monster
  floorBeside(W.monsters[1].pos), // beside the other gate monster
  floorBeside(W.monsters[2].pos), // beside the exit-route monster
  floorBeside(W.exit), // beside the exit
];

const REPORTS: FogContribution[] = POINTS.map((p) => ({ sightings: [sightingAt(W, p)] }));

function foldOrder(order: number[]): FogMap {
  return amalgamate(emptyFog(W.width, W.height), order.map((i) => REPORTS[i]));
}

/** Canonical form of the monster dict: sorted by id, so comparison ignores the
 *  insertion order mergeFog's spread happens to produce (the dict is a map, not a
 *  list — key order carries no meaning). */
function canonMonsters(m: Record<string, Pos>): string {
  return JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));
}

function fogEqual(a: FogMap, b: FogMap): boolean {
  if (JSON.stringify(a.cells) !== JSON.stringify(b.cells)) return false;
  if (canonMonsters(a.monsters) !== canonMonsters(b.monsters)) return false;
  return a.exitSeen === b.exitSeen;
}

Deno.test("amalgamate: report order does not change the captain's map", () => {
  const natural = foldOrder([0, 1, 2, 3, 4]);
  const reversed = foldOrder([4, 3, 2, 1, 0]);
  const shuffled = foldOrder([3, 0, 4, 1, 2]);
  assert(fogEqual(natural, reversed), "reversed order diverged");
  assert(fogEqual(natural, shuffled), "shuffled order diverged");
});

Deno.test("amalgamate: idempotent — re-merging a report changes nothing", () => {
  const once = foldOrder([0, 1, 2, 3, 4]);
  const twice = amalgamate(once, REPORTS); // fold them all in a second time
  assert(fogEqual(once, twice), "re-merging reports changed the map");
});

Deno.test("amalgamate: agrees with the fleet's one-sighting-at-a-time fold", () => {
  // The swarm's N-ary fog fold must land on exactly what the fleet's sequential
  // mergeSighting loop would — same join, expressed two ways.
  const viaFold = foldOrder([0, 1, 2, 3, 4]);
  let viaLoop: FogMap = emptyFog(W.width, W.height);
  for (const r of REPORTS) for (const s of r.sightings) viaLoop = mergeSighting(viaLoop, s);
  assert(fogEqual(viaFold, viaLoop), "N-ary fold disagreed with sequential merge");
});

Deno.test("amalgamate: actually learns — monsters recorded, exit seen, cells lit", () => {
  const fog = foldOrder([0, 1, 2, 3, 4]);
  assert(fog.exitSeen, "the point beside the exit should have revealed it");
  // standing beside the first three monsters, their positions should be recorded
  for (const m of W.monsters.slice(0, 3)) {
    assertEquals(fog.monsters[m.id], m.pos, `${m.id} should be recorded`);
  }
  // the central start cell is now known floor, not unknown
  const s = W.units[0].pos;
  assertEquals(fog.cells[s.y][s.x], "floor");
});
