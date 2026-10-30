// gates_test.ts — the maze smart constructors refuse exactly what they should.

import { assertEquals } from "jsr:@std/assert@1";
import { attackGate, moveGate } from "./gates.ts";
import { applyEffect } from "./world.ts";
import { seedMaze } from "./seed.ts";
import type { MazeWorld } from "./types.ts";

Deno.test("moveGate: a step onto floor is OK", () => {
  const w = seedMaze();
  const g = moveGate(w, "hero", "E");
  assertEquals(g.ok, true);
  if (g.ok) {
    assertEquals(g.effect, { tag: "move", unitId: "hero", to: { x: 1, y: 0 }, dir: "E" });
  }
});

Deno.test("moveGate: stepping off the edge is refused", () => {
  const w = seedMaze(); // hero at (0,0); north is off the grid
  const g = moveGate(w, "hero", "N");
  assertEquals(g.ok, false);
  if (!g.ok) assertEquals(g.reason, "the edge of the maze is to the N");
});

Deno.test("moveGate: a step into a wall is refused", () => {
  const w = seedMaze(); // (0,1) is a wall
  const g = moveGate(w, "hero", "S");
  assertEquals(g.ok, false);
  if (!g.ok) assertEquals(g.reason, "a wall blocks the way S");
});

Deno.test("moveGate: a monster blocks the way (and is named)", () => {
  // Move the hero to (1,0) so goblin-1 at (2,0) is directly east.
  const w = applyEffect(seedMaze(), { tag: "move", unitId: "hero", to: { x: 1, y: 0 }, dir: "E" });
  const g = moveGate(w, "hero", "E");
  assertEquals(g.ok, false);
  if (!g.ok) assertEquals(g.reason, "goblin-1 blocks the way E — attack it or go around");
});

Deno.test("moveGate: friendly units may share a cell (no unit-unit collision)", () => {
  // Two units: hero at (0,0), ally at (1,0) directly east. The fleet starts all
  // three stacked and must pass each other in 1-wide corridors, so a step onto a
  // friendly unit's cell is allowed — only walls and monsters block.
  const w: MazeWorld = {
    width: 3,
    height: 1,
    walls: ["..."],
    units: [
      { id: "hero", pos: { x: 0, y: 0 }, hp: 10, atk: 3, speed: 1 },
      { id: "ally", pos: { x: 1, y: 0 }, hp: 10, atk: 3, speed: 1 },
    ],
    monsters: [],
    exit: { x: 2, y: 0 },
  };
  const g = moveGate(w, "hero", "E");
  assertEquals(g.ok, true);
  if (g.ok) assertEquals(g.effect, { tag: "move", unitId: "hero", to: { x: 1, y: 0 }, dir: "E" });
});

Deno.test("moveGate: a bad direction is refused", () => {
  const g = moveGate(seedMaze(), "hero", "up");
  assertEquals(g.ok, false);
});

// A tiny hand-built world where the hero stands next to a monster.
function adjacentWorld(monsterHp: number, monsterAtk: number): MazeWorld {
  return {
    width: 3,
    height: 1,
    walls: ["..."],
    units: [{ id: "hero", pos: { x: 0, y: 0 }, hp: 10, atk: 3, speed: 1 }],
    monsters: [{ id: "ogre", pos: { x: 1, y: 0 }, hp: monsterHp, atk: monsterAtk }],
    exit: { x: 2, y: 0 },
  };
}

Deno.test("attackGate: a non-adjacent target is refused", () => {
  const w = seedMaze(); // hero (0,0), goblin-1 at (2,0) — two cells away
  const g = attackGate(w, "hero", "goblin-1");
  assertEquals(g.ok, false);
  if (!g.ok) assertEquals(g.reason, "goblin-1 is not adjacent — move next to it first");
});

Deno.test("attackGate: an unknown target is refused", () => {
  const g = attackGate(seedMaze(), "hero", "dragon");
  assertEquals(g.ok, false);
  if (!g.ok) assertEquals(g.reason, "no such monster: dragon");
});

Deno.test("attackGate: a lethal blow lands with no counter-attack", () => {
  const w = adjacentWorld(3, 4); // hero.atk 3 >= hp 3 → lethal
  const g = attackGate(w, "hero", "ogre");
  assertEquals(g.ok, true);
  if (g.ok) {
    assertEquals(g.effect, {
      tag: "attack",
      unitId: "hero",
      targetId: "ogre",
      monsterHpAfter: 0,
      unitHpAfter: 10, // unhurt: the lethal blow lands first
      lethal: true,
    });
  }
});

Deno.test("attackGate: a survivor strikes back", () => {
  const w = adjacentWorld(5, 2); // hp 5 - atk 3 = 2 > 0 → survives, counters for 2
  const g = attackGate(w, "hero", "ogre");
  assertEquals(g.ok, true);
  if (g.ok) {
    assertEquals(g.effect, {
      tag: "attack",
      unitId: "hero",
      targetId: "ogre",
      monsterHpAfter: 2,
      unitHpAfter: 8, // 10 - 2
      lethal: false,
    });
  }
});
