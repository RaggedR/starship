// world_test.ts — the maze reducers are pure and total, and look reads the truth.

import { assertEquals } from "jsr:@std/assert@1";
import { applyEffect, atExit, isDead, look, unitById } from "./world.ts";
import { seedMaze } from "./seed.ts";

const heroPos = (w: ReturnType<typeof seedMaze>) => unitById(w, "hero")!.pos;
const heroHp = (w: ReturnType<typeof seedMaze>) => unitById(w, "hero")!.hp;

Deno.test("move reducer: relocates the hero, leaves the old world untouched", () => {
  const w0 = seedMaze();
  const w1 = applyEffect(w0, { tag: "move", unitId: "hero", to: { x: 1, y: 0 }, dir: "E" });
  assertEquals(heroPos(w1), { x: 1, y: 0 });
  assertEquals(heroPos(w0), { x: 0, y: 0 }); // purity
});

Deno.test("attack reducer: a lethal blow removes the monster and spares the hero", () => {
  const w0 = seedMaze();
  const w1 = applyEffect(w0, {
    tag: "attack",
    unitId: "hero",
    targetId: "goblin-1",
    monsterHpAfter: 0,
    unitHpAfter: 20,
    lethal: true,
  });
  assertEquals(w1.monsters.some((m) => m.id === "goblin-1"), false);
  assertEquals(heroHp(w1), 20);
  assertEquals(w0.monsters.length, 2); // purity
});

Deno.test("attack reducer: a survivor keeps its reduced hp and the hero takes damage", () => {
  const w0 = seedMaze();
  const w1 = applyEffect(w0, {
    tag: "attack",
    unitId: "hero",
    targetId: "orc-1",
    monsterHpAfter: 2,
    unitHpAfter: 18,
    lethal: false,
  });
  assertEquals(w1.monsters.find((m) => m.id === "orc-1")?.hp, 2);
  assertEquals(heroHp(w1), 18);
});

Deno.test("look: reports the four neighbours and the exit bearing", () => {
  const l = look(seedMaze(), "hero"); // hero (0,0)
  assertEquals(l.onExit, false);
  assertEquals(l.exitBearing, "S");
  assertEquals(l.exitDistance, 2);
  const byDir = Object.fromEntries(l.neighbours.map((n) => [n.dir, n.cell]));
  assertEquals(byDir.N, "wall"); // off the grid
  assertEquals(byDir.E, "floor");
  assertEquals(byDir.S, "wall"); // (0,1) is '#'
  assertEquals(byDir.W, "wall"); // off the grid
});

Deno.test("atExit / isDead predicates", () => {
  const arrived = applyEffect(seedMaze(), {
    tag: "move",
    unitId: "hero",
    to: { x: 0, y: 2 },
    dir: "S",
  });
  assertEquals(atExit(arrived, "hero"), true);
  assertEquals(atExit(seedMaze(), "hero"), false);

  const slain = applyEffect(seedMaze(), {
    tag: "attack",
    unitId: "hero",
    targetId: "orc-1",
    monsterHpAfter: 2,
    unitHpAfter: 0,
    lethal: false,
  });
  assertEquals(isDead(slain, "hero"), true);
  assertEquals(isDead(seedMaze(), "hero"), false);
});
