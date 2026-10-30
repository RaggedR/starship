// loop_test.ts — the five-part loop end to end: a model (the deterministic scripted
// solver) drives the maze to the exit through the reason-gate, and the two logs
// reconcile clean. Also: the reason-gate itself — a mutation with no reason never
// commits, and is visible only in Layer 2.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { run as dungeonRun } from "../cli/dungeon.ts";
import { saveMaze } from "../maze/store.ts";
import { seedMaze } from "../maze/seed.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { fileIntentLog } from "../log/intentlog.ts";
import { fileShipLog } from "../log/shiplog.ts";
import { reconcile } from "../log/reconcile.ts";
import { type HarnessCtx, runMutation } from "../bridge/harness.ts";
import { adventurerRegistry, runMaze } from "./loop.ts";
import { scriptedClient } from "./scripted.ts";

/** A rig over temp files, all seams seeded — the test analogue of the demo's rig. */
function rig() {
  const dir = Deno.makeTempDirSync();
  const wp = `${dir}/maze.json`;
  const lp = `${dir}/dungeon-log.jsonl`;
  const ip = `${dir}/intent-log.jsonl`;
  saveMaze(wp, seedMaze());
  const conIds = seededIds("dungeon");
  const conClock = fixedClock();
  const conRun = (argv: string[]) =>
    dungeonRun([...argv, "--world", wp, "--log", lp], conIds, conClock);
  const ctx: HarnessCtx = {
    ids: seededIds("agent"),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "TEST",
    conRun,
  };
  return { ctx, wp, lp };
}

Deno.test("scripted agent reaches the exit; the two logs reconcile clean", async () => {
  const { ctx, wp, lp } = rig();
  const reg = adventurerRegistry();
  const result = await runMaze({ ctx, reg, client: scriptedClient(wp), worldPath: wp });

  assertEquals(result.solved, true);
  assertEquals(result.dead, false);
  assertEquals(result.heroHp, 18); // one counter from the orc

  const rec = reconcile(fileShipLog(lp), ctx.intentLog);
  assertEquals(rec.ok, true);
  assertEquals(rec.alarms.length, 0);
  assert(
    rec.matched.length >= 10,
    `expected a solved trace, got ${rec.matched.length} matched`,
  );
});

Deno.test("reason-gate: a move with no reason is refused and never commits", () => {
  const { ctx, lp } = rig();
  const reg = adventurerRegistry();

  const outcome = runMutation(ctx, reg, "move", ["move", "--dir", "E"], { dir: "E" }, "");
  assertEquals(outcome.ok, false);

  // It appears in Layer 2 as refused, and NOT at all in Layer 1 (it never ran).
  const rec = reconcile(fileShipLog(lp), ctx.intentLog);
  assertEquals(rec.alarms.length, 0);
  assert(rec.blocked.some((b) => b.tool === "move" && b.status === "refused"));
  assertEquals(fileShipLog(lp).all().length, 0);
});

Deno.test("registry: a tool outside the allowlist cannot be invoked", () => {
  const { ctx } = rig();
  const reg = adventurerRegistry();
  // "fire" is a star-system capability, not the adventurer's — refused by absence.
  const outcome = runMutation(
    ctx,
    reg,
    "fire",
    ["fire"],
    {},
    "try to use a weapon we do not have",
  );
  assertEquals(outcome.ok, false);
  if (!outcome.ok) assert(outcome.reason.includes("registry"));
});
