// world_test.ts — reducers are pure, total, and replay identically.

import { assertEquals } from "jsr:@std/assert@1";
import { applyEffect, getShip, scan } from "./world.ts";
import { seedWorld } from "./seed.ts";

Deno.test("burn reducer: spends fuel, moves ship, leaves old world untouched", () => {
  const w0 = seedWorld();
  const w1 = applyEffect(w0, "NCC-1", {
    tag: "burn",
    fuelSpent: 40,
    newPosition: { x: 10, y: 1000 },
    newHeading: 95,
  });
  assertEquals(getShip(w1, "NCC-1").fuel, 20);
  assertEquals(getShip(w1, "NCC-1").position, { x: 10, y: 1000 });
  // purity: the original world is unchanged
  assertEquals(getShip(w0, "NCC-1").fuel, 60);
});

Deno.test("transfer reducer: moves cargo and reassigns ownership", () => {
  const w0 = {
    ...seedWorld(),
    ships: {
      ...seedWorld().ships,
      "NCC-2": { ...seedWorld().ships["NCC-1"], id: "NCC-2", cargo: [] },
    },
  };
  const w1 = applyEffect(w0, "NCC-1", { tag: "transfer", cargoId: "crate-7", toShip: "NCC-2" });
  assertEquals(getShip(w1, "NCC-1").cargo.length, 0);
  assertEquals(getShip(w1, "NCC-2").cargo[0].owner, "NCC-2");
});

Deno.test("scan is order-stable (sorted by range) => replayable output", () => {
  const w = seedWorld();
  assertEquals(scan(w, "NCC-1"), scan(w, "NCC-1"));
  const ranges = scan(w, "NCC-1").map((c) => c.range);
  assertEquals([...ranges].sort((a, b) => a - b), ranges);
});
