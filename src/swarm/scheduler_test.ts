// scheduler_test.ts — the swarm solves it: the captain reaches the exit under the
// scripted greedy brain, the fog stays partial (existential hiding survives the
// scale-up), the three corridor monsters are cleared, and the two logs reconcile
// across all eight agents. The byte-identical replay is verify.sh's job; these are
// the properties beyond the bytes.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { run as dungeonRun } from "../cli/dungeon.ts";
import { saveMaze } from "../maze/store.ts";
import { seedSwarm } from "../maze/seed.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { fileIntentLog } from "../log/intentlog.ts";
import { fileShipLog } from "../log/shiplog.ts";
import { reconcile } from "../log/reconcile.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { MazeWorld } from "../maze/types.ts";
import { orchestrateSwarm } from "./scheduler.ts";

function rig() {
  const dir = Deno.makeTempDirSync();
  const wp = `${dir}/maze.json`;
  const lp = `${dir}/dungeon-log.jsonl`;
  const ip = `${dir}/intent-log.jsonl`;
  const world: MazeWorld = seedSwarm();
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

function paramsOf(ctx: HarnessCtx, world: MazeWorld) {
  return {
    ctx,
    width: world.width,
    height: world.height,
    units: world.units.map((u) => ({ id: u.id, pos: u.pos, hp: u.hp, speed: u.speed })),
  };
}

Deno.test("swarm: the captain reaches the exit, fog stays partial, logs reconcile", async () => {
  const { ctx, lp, world } = rig();
  const result = await orchestrateSwarm(paramsOf(ctx, world));

  assertEquals(result.solved, true, "the captain should reach the exit");

  // existential hiding survives: the captain never learned the whole maze
  assert(result.unknownAtEnd > 0, `expected partial fog, got ${result.unknownAtEnd} unknown`);
  assert(
    result.unknownAtEnd < world.width * world.height,
    "the captain should have learned a great deal",
  );

  // the two logs reconcile clean across all eight agents (5 scouts, 2 fighters, captain)
  const rec = reconcile(fileShipLog(lp), ctx.intentLog);
  assertEquals(rec.ok, true);
  assertEquals(rec.alarms.length, 0);
});

Deno.test("swarm: the three corridor monsters are cleared; dead-end ones may be ignored", async () => {
  const { ctx, world } = rig();
  const result = await orchestrateSwarm(paramsOf(ctx, world));
  // At least the three path monsters must fall (the captain cannot pass otherwise);
  // the four dead-end monsters are the captain's to leave alone, so kills is in [3,7].
  assert(result.kills >= 3, `expected >=3 kills (the corridor), got ${result.kills}`);
  assert(result.kills <= 7, `at most 7 monsters exist, got ${result.kills}`);
});

Deno.test("swarm: the captain is consulted a bounded number of times", async () => {
  const { ctx, world } = rig();
  const result = await orchestrateSwarm(paramsOf(ctx, world));
  // plans == ticks + 1 (one per tick plus the bootstrap) — a few hundred at most, so
  // the LLM captain (same seam) makes a tractable number of calls when gated on events.
  assert(result.plans > 0);
  assert(result.plans < 2000, `unexpectedly many plans: ${result.plans}`);
});
