// seed_test.ts — lock the shape of the seeds, especially the swarm maze. These are
// hand-pasted data (carved offline by scratchpad/genmaze*.ts); a test guards against
// an edit that silently breaks the one property the demo depends on — that the
// captain CAN reach the exit, and that each monster is where the design says it is.

import { assert, assertEquals } from "jsr:@std/assert";
import { seedFleet, seedSwarm } from "./seed.ts";
import type { MazeWorld, Pos } from "./types.ts";

const pk = (p: Pos) => `${p.x},${p.y}`;
const DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

function isFloor(w: MazeWorld, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w.width && y < w.height && w.walls[y][x] !== "#";
}

/** Shortest path over floor, monsters ignored (they are cleared, not walls). */
function floorPath(w: MazeWorld, from: Pos, to: Pos): Pos[] {
  const prev = new Map<string, Pos>();
  const seen = new Set<string>([pk(from)]);
  const q: Pos[] = [from];
  while (q.length) {
    const p = q.shift()!;
    if (pk(p) === pk(to)) {
      const r: Pos[] = [];
      let c: Pos | undefined = p;
      while (c) {
        r.unshift(c);
        c = prev.get(pk(c));
      }
      return r;
    }
    for (const d of DIRS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (!isFloor(w, n.x, n.y) || seen.has(pk(n))) continue;
      seen.add(pk(n));
      prev.set(pk(n), p);
      q.push(n);
    }
  }
  return [];
}

Deno.test("seedFleet: walls are rectangular and the exit is reachable", () => {
  const w = seedFleet();
  assertEquals(w.walls.length, w.height);
  for (const row of w.walls) assertEquals(row.length, w.width);
  const sp = floorPath(w, w.units[0].pos, w.exit);
  assert(sp.length > 0, "fleet: no floor path start->exit");
});

Deno.test("seedSwarm: five scouts, two fighters, one captain, all stacked at the centre", () => {
  const w = seedSwarm();
  const ids = w.units.map((u) => u.id);
  assertEquals(ids, [
    "scout-1", "scout-2", "scout-3", "scout-4", "scout-5",
    "fighter-1", "fighter-2", "captain",
  ]);
  // scouts range at 5, fighters and captain trudge at 1; all start at the central fork
  const startKey = pk(w.units[0].pos);
  for (const u of w.units) {
    const want = u.id.startsWith("scout") ? 5 : 1;
    assertEquals(u.speed, want, `${u.id} speed`);
    assertEquals(pk(u.pos), startKey, `${u.id} starts at the centre`);
  }
});

Deno.test("seedSwarm: walls rectangular, every unit and monster on floor, exit on floor", () => {
  const w = seedSwarm();
  assertEquals(w.walls.length, w.height);
  for (const row of w.walls) assertEquals(row.length, w.width);
  for (const u of w.units) assert(isFloor(w, u.pos.x, u.pos.y), `${u.id} off floor`);
  assert(isFloor(w, w.exit.x, w.exit.y), "exit off floor");
  const seen = new Set<string>();
  for (const m of w.monsters) {
    assert(isFloor(w, m.pos.x, m.pos.y), `${m.id} on a wall`);
    assert(!seen.has(pk(m.pos)), `${m.id} shares a cell`);
    seen.add(pk(m.pos));
  }
});

Deno.test("seedSwarm: the captain CAN reach the exit (over floor, monsters clearable)", () => {
  const w = seedSwarm();
  const sp = floorPath(w, { x: 1, y: 1 }, w.exit);
  assert(sp.length > 0, "no floor path start->exit — the maze is unsolvable");
});

Deno.test("seedSwarm: the exit-route monsters are on the path; the decoy monsters are not", () => {
  const w = seedSwarm();
  const start = w.units.find((u) => u.id === "captain")!.pos;
  const sp = floorPath(w, start, w.exit);
  const onPath = new Set(sp.map(pk));

  // ogre-1 (the exit-half gate) and orc-1 (deeper) sit on the unique route to the
  // exit — the captain cannot pass until a fighter clears each.
  for (const id of ["ogre-1", "orc-1"]) {
    const m = w.monsters.find((x) => x.id === id)!;
    assert(onPath.has(pk(m.pos)), `${id} should block the route to the exit`);
  }
  // ogre-2 (the decoy gate) and the two decoy-half goblins are NOT on the exit route
  // — the captain can reach the exit without clearing them, so they are ignorable.
  for (const id of ["ogre-2", "goblin-1", "goblin-2"]) {
    const m = w.monsters.find((x) => x.id === id)!;
    assert(!onPath.has(pk(m.pos)), `${id} should be off the exit route (ignorable)`);
  }
});

Deno.test("seedSwarm: the two gate monsters are discovered at the same depth (parallel dispatch)", () => {
  const w = seedSwarm();
  const start = w.units.find((u) => u.id === "captain")!.pos;
  // BFS depth over floor from the start, monsters passable (terrain is floor)
  const depth = new Map<string, number>();
  depth.set(pk(start), 0);
  let q: Pos[] = [start];
  while (q.length) {
    const next: Pos[] = [];
    for (const p of q) {
      for (const d of DIRS) {
        const n = { x: p.x + d.x, y: p.y + d.y };
        if (!isFloor(w, n.x, n.y) || depth.has(pk(n))) continue;
        depth.set(pk(n), depth.get(pk(p))! + 1);
        next.push(n);
      }
    }
    q = next;
  }
  const dA = depth.get(pk(w.monsters.find((m) => m.id === "ogre-1")!.pos))!;
  const dB = depth.get(pk(w.monsters.find((m) => m.id === "ogre-2")!.pos))!;
  // the two gates sit at an equal, shallow depth — so a scout meets each at about the
  // same tick and the captain must allocate BOTH fighters at once
  assertEquals(dA, dB, "the two gates should be at equal depth from the start");
  assert(dA <= 8, `gates should be shallow (near the fork), got depth ${dA}`);
});
