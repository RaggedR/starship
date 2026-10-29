// gates_test.ts — the smart constructors refuse exactly what they should.

import { assertEquals } from "jsr:@std/assert@1";
import {
  authorizeGate,
  burnGate,
  dockGate,
  fireGate,
  powerRouteGate,
  transferGate,
} from "./gates.ts";
import { applyEffect } from "./world.ts";
import { seedWorld } from "./seed.ts";

Deno.test("burnGate: 40-fuel burn OK, 80-fuel burn refused (the english.txt scene)", () => {
  const w = seedWorld();
  const legal = burnGate(w, "NCC-1", "2000,0");
  assertEquals(legal.ok, true);
  if (legal.ok) assertEquals(legal.effect, {
    tag: "burn",
    fuelSpent: 40,
    newPosition: { x: 2000, y: 0 },
    newHeading: 0,
  });
  const illegal = burnGate(w, "NCC-1", "4000,0");
  assertEquals(illegal.ok, false);
  if (!illegal.ok) assertEquals(illegal.reason, "burn needs 80 fuel, have 60");
});

Deno.test("powerRouteGate: refuses when the three channels would exceed 100%", () => {
  const w = seedWorld(); // starts 34/33/33 = 100
  assertEquals(powerRouteGate(w, "NCC-1", "shields", 80).ok, false);
  assertEquals(powerRouteGate(w, "NCC-1", "shields", 30).ok, true);
});

Deno.test("fire needs authorization; propose -> authorize -> fire works", () => {
  const w0 = seedWorld();
  // no token yet
  assertEquals(fireGate(w0, "NCC-1", "minefield-A", undefined).ok, false);
  // captain authorizes
  const auth = authorizeGate(w0, "minefield-A", "TOKEN-1");
  assertEquals(auth.ok, true);
  const w1 = auth.ok ? applyEffect(w0, "NCC-1", auth.effect) : w0;
  // wrong token still refused
  assertEquals(fireGate(w1, "NCC-1", "minefield-A", "WRONG").ok, false);
  // right token fires, hazard destroyed
  const fire = fireGate(w1, "NCC-1", "minefield-A", "TOKEN-1");
  assertEquals(fire.ok, true);
  if (fire.ok) {
    const w2 = applyEffect(w1, "NCC-1", fire.effect);
    assertEquals(w2.hazards.length, 0); // minefield cleared
    assertEquals(w2.ships["NCC-1"].authToken, null); // token consumed
  }
});

Deno.test("dockGate: out of range refused", () => {
  const w = seedWorld(); // ship at origin, starbase at (500,500), dockRange 50
  assertEquals(dockGate(w, "NCC-1", "starbase-12").ok, false);
});

Deno.test("transferGate: unknown cargo and same-ship refused", () => {
  const w = seedWorld();
  assertEquals(transferGate(w, "NCC-1", "nope", "NCC-1").ok, false);
});
