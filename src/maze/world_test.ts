// world_test.ts — the maze reducers are pure and total, and look reads the truth.

import { assertEquals } from "jsr:@std/assert@1";
import { applyEffect, dead, look, solved } from "./world.ts";
import { seedMaze } from "./seed.ts";

Deno.test("move reducer: relocates the hero, leaves the old world untouched", () => {
  const w0 = seedMaze();
  const w1 = applyEffect(w0, { tag: "move", to: { x: 1, y: 0 }, dir: "E" });
  assertEquals(w1.hero.pos, { x: 1, y: 0 });
  assertEquals(w0.hero.pos, { x: 0, y: 0 }); // purity
});

Deno.test("attack reducer: a lethal blow removes the monster and spares the hero", () => {
  const w0 = seedMaze();
  const w1 = applyEffect(w0, {
    tag: "attack",
    targetId: "goblin-1",
    monsterHpAfter: 0,
    heroHpAfter: 20,
    lethal: true,
  });
  assertEquals(w1.monsters.some((m) => m.id === "goblin-1"), false);
  assertEquals(w1.hero.hp, 20);
  assertEquals(w0.monsters.length, 2); // purity
});

Deno.test("attack reducer: a survivor keeps its reduced hp and the hero takes damage", () => {
  const w0 = seedMaze();
  const w1 = applyEffect(w0, {
    tag: "attack",
    targetId: "orc-1",
    monsterHpAfter: 2,
    heroHpAfter: 18,
    lethal: false,
  });
  assertEquals(w1.monsters.find((m) => m.id === "orc-1")?.hp, 2);
  assertEquals(w1.hero.hp, 18);
});

Deno.test("look: reports the four neighbours and the exit bearing", () => {
  const l = look(seedMaze()); // hero (0,0)
  assertEquals(l.onExit, false);
  assertEquals(l.exitBearing, "S");
  assertEquals(l.exitDistance, 2);
  const byDir = Object.fromEntries(l.neighbours.map((n) => [n.dir, n.cell]));
  assertEquals(byDir.N, "wall"); // off the grid
  assertEquals(byDir.E, "floor");
  assertEquals(byDir.S, "wall"); // (0,1) is '#'
  assertEquals(byDir.W, "wall"); // off the grid
});

Deno.test("solved / dead predicates", () => {
  const atExit = applyEffect(seedMaze(), { tag: "move", to: { x: 0, y: 2 }, dir: "S" });
  assertEquals(solved(atExit), true);
  assertEquals(solved(seedMaze()), false);

  const slain = applyEffect(seedMaze(), {
    tag: "attack",
    targetId: "orc-1",
    monsterHpAfter: 2,
    heroHpAfter: 0,
    lethal: false,
  });
  assertEquals(dead(slain), true);
  assertEquals(dead(seedMaze()), false);
});
