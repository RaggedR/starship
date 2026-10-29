// flagship_test.ts — nesting works, and the flagship sees only status reports.

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "../cli/con.ts";
import { flagship, shipCaptain } from "./flagship.ts";
import { tensorC } from "../lib/algebra.ts";
import { type HarnessCtx } from "../bridge/harness.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { memIntentLog } from "../log/intentlog.ts";
import { saveWorld } from "../world/store.ts";
import { seedFleet } from "../world/seed.ts";

/** A rig whose con world file is pre-seeded with the two-ship fleet. */
function fleetRig(): { ctx: HarnessCtx; wp: string; lp: string } {
  const tmp = Deno.makeTempDirSync();
  const wp = `${tmp}/w.json`;
  const lp = `${tmp}/log.jsonl`;
  saveWorld(wp, seedFleet());
  const conIds = seededIds("con");
  const conClock = fixedClock();
  const conRun = (argv: string[]) => run([...argv, "--world", wp, "--log", lp], conIds, conClock);
  const ctx: HarnessCtx = {
    ids: seededIds("bridge"),
    clock: fixedClock(),
    intentLog: memIntentLog(),
    sessionId: "SESSION-FLEET",
    conRun,
  };
  return { ctx, wp, lp };
}

Deno.test("flagship delegates to each ship-captain; both evade; amalgamated report", async () => {
  const { ctx } = fleetRig();
  const report = await flagship(ctx, ["NCC-1", "NCC-2"]);
  assertEquals(report.ships.length, 2);
  assertEquals(report.ships.every((s) => s.acted), true);
  assertEquals(report.ships.map((s) => s.fuelAfter), [20, 20]); // each spent 40 of 60
  assertEquals(report.summary, "2/2 ships evaded a hazard");
});

Deno.test("existential hiding: the flagship's report carries ONLY the status fields", async () => {
  const { ctx } = fleetRig();
  const report = await flagship(ctx, ["NCC-1"]);
  // The ship-captain's internal Assessment/PowerReport/proposal do NOT leak up.
  const keys = Object.keys(report.ships[0]).sort();
  assertEquals(keys, ["acted", "correlationId", "decision", "fuelAfter", "ship"]);
});

Deno.test("ship-captains compose with the SAME combinator (tensorC nests)", async () => {
  const { ctx } = fleetRig();
  // A flagship built from tensorC over two ship-captains. The composite's position
  // is {left: ShipStatusReport, right: ShipStatusReport} — nesting, type-checked.
  const pair = tensorC(shipCaptain(ctx), shipCaptain(ctx));
  const out = await pair.run(
    {
      left: { tag: "handleHazard", ship: "NCC-1" },
      right: { tag: "handleHazard", ship: "NCC-2" },
    },
    0,
  );
  assertEquals(out.left.ship, "NCC-1");
  assertEquals(out.right.ship, "NCC-2");
  assertEquals(out.left.acted && out.right.acted, true);
});
