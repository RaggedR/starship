// officers_test.ts — the full bridge: officers plug into gold, read/write only
// through con, obey their registries, and the captain amalgamates and orders.

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "../cli/con.ts";
import {
  engineeringOfficer,
  helmOfficer,
  scienceOfficer,
  weaponsOfficer,
} from "./officers.ts";
import { type HarnessCtx } from "./harness.ts";
import { type Bridge, handleHazard } from "./captain.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { memIntentLog } from "../log/intentlog.ts";
import { fileShipLog } from "../log/shiplog.ts";

/** A full in-process rig: con backed by temp files, officers over it. */
function rig(): { ctx: HarnessCtx; bridge: Bridge; wp: string; lp: string } {
  const tmp = Deno.makeTempDirSync();
  const wp = `${tmp}/w.json`;
  const lp = `${tmp}/log.jsonl`;
  const conIds = seededIds("con");
  const conClock = fixedClock();
  const conRun = (argv: string[]) => run([...argv, "--world", wp, "--log", lp], conIds, conClock);
  const ctx: HarnessCtx = {
    ids: seededIds("bridge"),
    clock: fixedClock(),
    intentLog: memIntentLog(),
    sessionId: "SESSION-TEST",
    conRun,
  };
  const bridge: Bridge = {
    science: scienceOfficer(ctx),
    helm: helmOfficer(ctx),
    weapons: weaponsOfficer(ctx),
    engineering: engineeringOfficer(ctx),
  };
  return { ctx, bridge, wp, lp };
}

Deno.test("Science returns a typed Assessment naming the minefield", async () => {
  const { bridge } = rig();
  const a = await bridge.science.run({ tag: "assess", ship: "NCC-1" }, 0);
  assertEquals(a.threats.map((t) => t.id), ["minefield-A"]);
  assertEquals(a.recommendation.startsWith("evade minefield-A"), true);
});

Deno.test("Captain amalgamates (Science ⊗ Engineering), decides, and orders the burn", async () => {
  const { bridge, ctx, lp } = rig();
  const report = await handleHazard(bridge, "NCC-1");
  // the amalgamated picture carries BOTH officers' positions
  assertEquals(report.assessment.threats[0].id, "minefield-A");
  assertEquals(report.power.routedTotal, 100);
  // the order committed, with a reason drawn from the sweep
  assertEquals(report.order?.outcome.tag, "done");
  assertEquals(report.order?.reason.includes("minefield-A"), true);
  // and it landed in the ship's log, joined by the correlation id
  const corr = report.order?.outcome.tag === "done" ? report.order.outcome.correlationId : "";
  assertEquals(fileShipLog(lp).trace(corr)?.command, "helm burn");
  // write-ahead intent for the same order exists in Layer 2
  const intents = ctx.intentLog.all().filter((r) => r.correlation_id === corr);
  assertEquals(intents.some((r) => r.status === "attempted"), true);
  assertEquals(intents.some((r) => r.status === "ok" && r.reason.includes("minefield-A")), true);
});

Deno.test("reason-gate: an empty-reason order is refused BEFORE con, no ship's-log entry", async () => {
  const { bridge, ctx, lp } = rig();
  const outcome = await bridge.helm.run(
    { tag: "executeBurn", ship: "NCC-1", vector: "1000,0", reason: "" },
    0,
  );
  assertEquals(outcome.tag, "refused");
  // nothing committed
  assertEquals(fileShipLog(lp).all().length, 0);
  // but the refusal IS visible in Layer 2 (the whole point of two logs)
  assertEquals(ctx.intentLog.all().some((r) => r.mutates && r.status === "refused"), true);
});

Deno.test("weapons: fire without authorization is refused (a position, not a crash)", async () => {
  const { bridge } = rig();
  const outcome = await bridge.weapons.run(
    { tag: "fire", ship: "NCC-1", target: "minefield-A", token: "bogus", reason: "clear mines" },
    0,
  );
  assertEquals(outcome.tag, "refused");
});

Deno.test("weapons: propose -> authorize -> fire clears the minefield", async () => {
  const { bridge, lp } = rig();
  const auth = await bridge.weapons.run(
    { tag: "authorize", ship: "NCC-1", target: "minefield-A", reason: "threat confirmed" },
    0,
  );
  assertEquals(auth.tag, "done");
  // recover the minted token from the ship's-log effect
  const corr = auth.tag === "done" ? auth.correlationId : "";
  const effect = fileShipLog(lp).trace(corr)?.effect as { token: string };
  const fire = await bridge.weapons.run(
    { tag: "fire", ship: "NCC-1", target: "minefield-A", token: effect.token, reason: "clearing the field" },
    0,
  );
  assertEquals(fire.tag, "done");
});
