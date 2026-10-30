// fleet_test.ts — the fleet solves the maze, the fog stays partial, the logs
// reconcile, and the --live brain plumbing works (exercised with a stub model so no
// key or network is needed). The scripted path is covered by verify.sh's
// byte-identical replay; these are the properties that matter beyond the bytes.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { run as dungeonRun } from "../cli/dungeon.ts";
import { saveMaze } from "../maze/store.ts";
import { seedFleet } from "../maze/seed.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { fileIntentLog } from "../log/intentlog.ts";
import { fileShipLog } from "../log/shiplog.ts";
import { reconcile } from "../log/reconcile.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { MazeWorld } from "../maze/types.ts";
import { orchestrateFleet } from "./fleet-captain.ts";
import { modelScoutBrain, scriptedScoutBrain } from "./scout.ts";
import type { ModelClient, ToolSpec } from "../agent/model.ts";

function rig() {
  const dir = Deno.makeTempDirSync();
  const wp = `${dir}/maze.json`;
  const lp = `${dir}/dungeon-log.jsonl`;
  const ip = `${dir}/intent-log.jsonl`;
  const world: MazeWorld = seedFleet();
  saveMaze(wp, world);
  const conIds = seededIds("dungeon");
  const conClock = fixedClock();
  const ctx: HarnessCtx = {
    ids: seededIds("agent"),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "TEST",
    conRun: (argv) => dungeonRun([...argv, "--world", wp, "--log", lp], conIds, conClock),
  };
  return { ctx, wp, lp, world };
}

function params(ctx: HarnessCtx, world: MazeWorld) {
  const u = (id: string) => world.units.find((x) => x.id === id)!;
  return {
    ctx,
    width: world.width,
    height: world.height,
    captainStart: u("captain").pos,
    scout: { speed: u("scout").speed },
    fighter: { start: u("fighter").pos, hp: u("fighter").hp },
  };
}

Deno.test("fleet: the captain reaches the exit and the fog stays partial", async () => {
  const { ctx, lp, world } = rig();
  const result = await orchestrateFleet({ ...params(ctx, world), scoutBrain: scriptedScoutBrain() });

  assertEquals(result.solved, true);
  assertEquals(result.kills, 2); // both monsters on the path were cleared
  // existential hiding: the captain never learned the whole maze
  assert(result.unknownAtEnd > 0, `expected partial fog, got ${result.unknownAtEnd} unknown`);
  assert(
    result.unknownAtEnd < world.width * world.height,
    "the captain should have learned SOMETHING",
  );

  // the two logs reconcile clean across three actors
  const rec = reconcile(fileShipLog(lp), ctx.intentLog);
  assertEquals(rec.ok, true);
  assertEquals(rec.alarms.length, 0);
});

/** A stub model that always picks the first offered direction — deterministic, no
 *  network. It exercises the whole modelScoutBrain path: tool offered, reply parsed,
 *  choice validated against the candidates, move committed. */
const stubClient: ModelClient = {
  name: "stub-model",
  // deno-lint-ignore require-await
  async converse(_system, _messages, tools: readonly ToolSpec[]) {
    const go = tools.find((t) => t.name === "go");
    const props = (go?.inputSchema as { properties?: { dir?: { enum?: string[] } } })?.properties;
    const dir = props?.dir?.enum?.[0] ?? "N";
    return { text: "", toolCalls: [{ id: "c0", name: "go", input: { dir, reason: "stub pick" } }] };
  },
};

Deno.test("fleet: the --live brain plumbing solves it too (stub model, no key)", async () => {
  const { ctx, world } = rig();
  const result = await orchestrateFleet({
    ...params(ctx, world),
    scoutBrain: modelScoutBrain(stubClient),
  });
  assertEquals(result.solved, true);
  assert(result.unknownAtEnd > 0, "fog still partial under the model brain");
});

Deno.test("fleet: a model that replies off-menu falls back to a productive step", async () => {
  // A stub that names a bogus direction ('Q') must not stall the scout: the brain
  // falls back to the BFS pick, so the fleet still solves.
  const bogus: ModelClient = {
    name: "bogus-model",
    // deno-lint-ignore require-await
    async converse() {
      return { text: "", toolCalls: [{ id: "c0", name: "go", input: { dir: "Q", reason: "x" } }] };
    },
  };
  const { ctx, world } = rig();
  const result = await orchestrateFleet({
    ...params(ctx, world),
    scoutBrain: modelScoutBrain(bogus),
  });
  assertEquals(result.solved, true);
});
