// fog_test.ts — the amalgamation is a join, and we prove it.
//
// The claim that `mergeFog` is an AMALGAMATION (not a mere gather) is a claim that
// it is the join of a semilattice: idempotent, commutative, associative, and
// monotone (knowledge never decreases). These are the org-chart / treasury
// "real algebra" pole the gold-demo skill names. We test the scalar join
// (joinKnown) exhaustively over its 5 values, and the lifted map join on a small
// battery of hand-built fog maps.

import { assertEquals } from "jsr:@std/assert@1";
import {
  clearMonster,
  emptyFog,
  type FogMap,
  frontier,
  joinKnown,
  type Known,
  knownPassable,
  leqKnown,
  mergeFog,
  mergeSighting,
  monsterKnownAt,
  type Sighting,
} from "./fog.ts";

const KNOWNS: Known[] = ["unknown", "floor", "wall", "exit", "conflict"];

// ── The scalar lattice: exhaustive over 5×5(×5) ───────────────────────────
Deno.test("joinKnown: idempotent", () => {
  for (const a of KNOWNS) assertEquals(joinKnown(a, a), a);
});

Deno.test("joinKnown: commutative", () => {
  for (const a of KNOWNS) {
    for (const b of KNOWNS) assertEquals(joinKnown(a, b), joinKnown(b, a));
  }
});

Deno.test("joinKnown: associative", () => {
  for (const a of KNOWNS) {
    for (const b of KNOWNS) {
      for (const c of KNOWNS) {
        assertEquals(
          joinKnown(joinKnown(a, b), c),
          joinKnown(a, joinKnown(b, c)),
        );
      }
    }
  }
});

Deno.test("joinKnown: unknown is the identity (bottom)", () => {
  for (const a of KNOWNS) assertEquals(joinKnown("unknown", a), a);
});

Deno.test("joinKnown: conflict is absorbing (top)", () => {
  for (const a of KNOWNS) assertEquals(joinKnown("conflict", a), "conflict");
});

Deno.test("joinKnown: two distinct terrains disagree to conflict", () => {
  assertEquals(joinKnown("floor", "wall"), "conflict");
  assertEquals(joinKnown("floor", "exit"), "conflict");
  assertEquals(joinKnown("wall", "exit"), "conflict");
});

Deno.test("leqKnown: unknown ⊑ everything, everything ⊑ conflict", () => {
  for (const a of KNOWNS) {
    assertEquals(leqKnown("unknown", a), true);
    assertEquals(leqKnown(a, "conflict"), true);
  }
  assertEquals(leqKnown("floor", "wall"), false); // incomparable middles
});

// ── A small battery of fog maps for the lifted laws ────────────────────────
function fog(width: number, height: number, rows: Known[][]): FogMap {
  return { width, height, cells: rows, monsters: {}, exitSeen: false };
}

// Three partial 2×2 maps that overlap and disagree about nothing.
const A = fog(2, 2, [["floor", "unknown"], ["unknown", "unknown"]]);
const B = fog(2, 2, [["unknown", "wall"], ["floor", "unknown"]]);
const C = fog(2, 2, [["unknown", "unknown"], ["unknown", "exit"]]);

Deno.test("mergeFog: idempotent", () => {
  assertEquals(mergeFog(A, A).cells, A.cells);
});

Deno.test("mergeFog: commutative", () => {
  assertEquals(mergeFog(A, B).cells, mergeFog(B, A).cells);
});

Deno.test("mergeFog: associative", () => {
  assertEquals(
    mergeFog(mergeFog(A, B), C).cells,
    mergeFog(A, mergeFog(B, C)).cells,
  );
});

Deno.test("mergeFog: monotone — merging only ever climbs the lattice", () => {
  const m = mergeFog(A, B);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      assertEquals(leqKnown(A.cells[y][x], m.cells[y][x]), true);
      assertEquals(leqKnown(B.cells[y][x], m.cells[y][x]), true);
    }
  }
});

Deno.test("mergeFog: unions monster knowledge and ORs exitSeen", () => {
  const left: FogMap = { ...A, monsters: { "goblin-1": { x: 0, y: 0 } }, exitSeen: false };
  const right: FogMap = { ...B, monsters: { "orc-1": { x: 1, y: 1 } }, exitSeen: true };
  const m = mergeFog(left, right);
  assertEquals(m.monsters, { "goblin-1": { x: 0, y: 0 }, "orc-1": { x: 1, y: 1 } });
  assertEquals(m.exitSeen, true);
});

Deno.test("mergeFog: honest static maze never produces conflict", () => {
  // A and B agree where they overlap (all overlaps involve unknown), so no cell
  // should reach the top. This is the invariant the top element exists to detect.
  const m = mergeFog(mergeFog(A, B), C);
  for (const row of m.cells) {
    for (const k of row) assertEquals(k === "conflict", false);
  }
});

Deno.test("mergeFog: size mismatch throws", () => {
  let threw = false;
  try {
    mergeFog(A, emptyFog(3, 3));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ── mergeSighting folds a look in as a join ────────────────────────────────
Deno.test("mergeSighting: records the observer's cell, neighbours, and a monster", () => {
  const f0 = emptyFog(3, 3);
  const f1 = mergeSighting(f0, {
    at: { x: 1, y: 1 },
    onExit: false,
    neighbours: [
      { pos: { x: 1, y: 0 }, cell: "wall", monster: null },
      { pos: { x: 2, y: 1 }, cell: "floor", monster: "goblin-1" },
      { pos: { x: 1, y: 2 }, cell: "floor", monster: null },
      { pos: { x: 0, y: 1 }, cell: "exit", monster: null },
    ],
  });
  assertEquals(f1.cells[1][1], "floor"); // the observer stands on floor
  assertEquals(f1.cells[0][1], "wall");
  assertEquals(f1.cells[1][2], "floor");
  assertEquals(f1.cells[1][0], "exit");
  assertEquals(f1.exitSeen, true);
  assertEquals(f1.monsters, { "goblin-1": { x: 2, y: 1 } });
  // purity: the original fog is untouched
  assertEquals(f0.cells[1][1], "unknown");
});

Deno.test("mergeSighting: a cell observed empty retracts a monster recorded there", () => {
  // First the scout sees goblin-1 to its east; later it re-looks and the cell is
  // empty (the fighter killed it). Occupancy must track the latest look, or the
  // scout would refuse to advance past a monster that is already dead.
  const f0 = emptyFog(3, 1);
  const sawMonster: Sighting = {
    at: { x: 0, y: 0 },
    onExit: false,
    neighbours: [{ pos: { x: 1, y: 0 }, cell: "floor", monster: "goblin-1" }],
  };
  const f1 = mergeSighting(f0, sawMonster);
  assertEquals(monsterKnownAt(f1, { x: 1, y: 0 }), "goblin-1");

  const nowEmpty: Sighting = {
    at: { x: 0, y: 0 },
    onExit: false,
    neighbours: [{ pos: { x: 1, y: 0 }, cell: "floor", monster: null }],
  };
  const f2 = mergeSighting(f1, nowEmpty);
  assertEquals(monsterKnownAt(f2, { x: 1, y: 0 }), null); // retracted
  assertEquals(f2.cells[0][1], "floor"); // terrain still known (monotone)
});

Deno.test("mergeSighting: repeated identical sightings are idempotent on terrain", () => {
  const f0 = emptyFog(3, 3);
  const s = {
    at: { x: 0, y: 0 },
    onExit: false,
    neighbours: [{ pos: { x: 1, y: 0 }, cell: "floor" as const, monster: null }],
  };
  assertEquals(mergeSighting(mergeSighting(f0, s), s).cells, mergeSighting(f0, s).cells);
});

// ── frontier + occupancy queries ───────────────────────────────────────────
Deno.test("frontier: known-passable cells adjacent to unknown, row-major order", () => {
  // A 3×1 strip: floor at x=0, floor at x=1, unknown at x=2. Only x=1 touches the
  // unknown; x=0's only unknown-ward neighbour is x=1 which is floor, so x=0 is
  // interior, not frontier.
  const f = fog(3, 1, [["floor", "floor", "unknown"]]);
  assertEquals(frontier(f), [{ x: 1, y: 0 }]);
});

Deno.test("frontier: a fully-known map has no frontier", () => {
  const f = fog(2, 1, [["floor", "exit"]]);
  assertEquals(frontier(f), []);
});

Deno.test("knownPassable: floor and exit yes; wall, unknown, off-grid no", () => {
  const f = fog(2, 1, [["floor", "wall"]]);
  assertEquals(knownPassable(f, { x: 0, y: 0 }), true);
  assertEquals(knownPassable(f, { x: 1, y: 0 }), false);
  assertEquals(knownPassable(f, { x: 5, y: 0 }), false);
  assertEquals(knownPassable(emptyFog(2, 1), { x: 0, y: 0 }), false); // unknown
});

Deno.test("monsterKnownAt / clearMonster: occupancy is revisable, unlike terrain", () => {
  const f0: FogMap = { ...emptyFog(2, 1), monsters: { "orc-1": { x: 1, y: 0 } } };
  assertEquals(monsterKnownAt(f0, { x: 1, y: 0 }), "orc-1");
  const f1 = clearMonster(f0, "orc-1");
  assertEquals(monsterKnownAt(f1, { x: 1, y: 0 }), null);
  assertEquals(monsterKnownAt(f0, { x: 1, y: 0 }), "orc-1"); // purity
});
