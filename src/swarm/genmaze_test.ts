// genmaze_test.ts — the pure swarm-maze generator.
//
// The strongest check is free: the committed seedSwarm() literal was pasted from this
// construction at the frozen seeds, so genSwarmMaze(FROZEN_R, FROZEN_L) must reproduce
// it byte-for-byte. The rest assert the by-construction STORY holds at arbitrary seeds
// (the browser button mints a random seed each click), so no seed can break the demo.

import { assert, assertEquals } from "jsr:@std/assert";
import { FROZEN_SEED_L, FROZEN_SEED_R, genSwarmMaze } from "./genmaze.ts";
import { seedSwarm } from "../maze/seed.ts";
import type { MazeWorld, Pos } from "../maze/types.ts";

const pk = (p: Pos) => `${p.x},${p.y}`;

/** BFS distance from the start to every reachable floor cell. */
function distances(w: MazeWorld, start: Pos): Map<string, number> {
  const dist = new Map<string, number>([[pk(start), 0]]);
  const floor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w.width && y < w.height && w.walls[y][x] !== "#";
  let q: Pos[] = [start];
  const D = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  while (q.length) {
    const next: Pos[] = [];
    for (const p of q) {
      for (const d of D) {
        const n = { x: p.x + d.dx, y: p.y + d.dy };
        if (!floor(n.x, n.y) || dist.has(pk(n))) continue;
        dist.set(pk(n), dist.get(pk(p))! + 1);
        next.push(n);
      }
    }
    q = next;
  }
  return dist;
}

Deno.test("genSwarmMaze(frozen seeds) reproduces the committed seedSwarm() literal", () => {
  assertEquals(genSwarmMaze(FROZEN_SEED_R, FROZEN_SEED_L), seedSwarm());
});

Deno.test("genSwarmMaze() with no args defaults to the frozen featured maze", () => {
  assertEquals(genSwarmMaze(), seedSwarm());
});

Deno.test("the construction guarantee holds at arbitrary seeds (gates equidistant, exit reachable)", () => {
  // A spread of seeds standing in for random button clicks.
  for (const [r, l] of [[1, 2], [999, 7], [0xabcdef, 0x123456], [42, 42], [7, 999]]) {
    const w = genSwarmMaze(r, l);
    const start = w.units.find((u) => u.id === "captain")!.pos;
    const dist = distances(w, start);

    // Eight agents stacked at the centre; five monsters; a right/left gate.
    assertEquals(w.units.length, 8, `seed ${r}/${l}: eight units`);
    assertEquals(w.monsters.length, 5, `seed ${r}/${l}: five monsters`);
    for (const u of w.units) assertEquals(pk(u.pos), pk(start), `seed ${r}/${l}: ${u.id} stacked`);

    const gR = w.monsters.find((m) => m.id === "ogre-1")!.pos;
    const gL = w.monsters.find((m) => m.id === "ogre-2")!.pos;

    // GUARANTEE: both gates found on the same tick ⟺ equal distance from the start.
    assertEquals(
      dist.get(pk(gR)),
      dist.get(pk(gL)),
      `seed ${r}/${l}: gates must be equidistant (both fighters dispatched at once)`,
    );

    // The exit and the exit-route monster are reachable, and genuinely deep (a real
    // journey, not a blob at the start).
    assert(dist.has(pk(w.exit)), `seed ${r}/${l}: exit reachable`);
    assert(dist.get(pk(w.exit))! > 20, `seed ${r}/${l}: exit is a deep march, got ${dist.get(pk(w.exit))}`);
    for (const m of w.monsters) assert(dist.has(pk(m.pos)), `seed ${r}/${l}: ${m.id} reachable`);

    // VARIETY: two different seeds give two genuinely different mazes.
    const other = genSwarmMaze(r + 1, l + 1);
    assert(other.walls.join("") !== w.walls.join(""), `seed ${r}/${l}: a different seed is a different maze`);
  }
});

Deno.test("same seeds ⟹ byte-identical maze (determinism for replay)", () => {
  assertEquals(genSwarmMaze(12345, 67890), genSwarmMaze(12345, 67890));
});
