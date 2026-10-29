// reconcile_test.ts — the two-log cross-check raises exactly the right findings.

import { assertEquals } from "jsr:@std/assert@1";
import { memShipLog, type ShipLogEntry } from "./shiplog.ts";
import { type IntentRecord, memIntentLog } from "./intentlog.ts";
import { reconcile } from "./reconcile.ts";

const ship = (correlation_id: string, command = "helm burn"): ShipLogEntry => ({
  id: "e-" + correlation_id,
  ts: "t",
  ship: "NCC-1",
  command,
  effect: {},
  correlation_id,
});

const intent = (
  correlation_id: string,
  status: IntentRecord["status"],
  reason = "r",
): IntentRecord => ({
  call_id: "c-" + correlation_id + "-" + status,
  ts: "t",
  agent_id: "officer:helm",
  session_id: "S",
  tool: "helm burn",
  args: {},
  reason,
  mutates: true,
  status,
  correlation_id,
});

Deno.test("healthy: committed mutation with a logged reason => matched, ok", () => {
  const r = reconcile(
    memShipLog([ship("C1")]),
    memIntentLog([intent("C1", "attempted"), intent("C1", "ok")]),
  );
  assertEquals(r.ok, true);
  assertEquals(r.matched.length, 1);
  assertEquals(r.alarms.length, 0);
});

Deno.test("alarm: ship's-log entry with no ok intent => write-without-reason", () => {
  const r = reconcile(memShipLog([ship("ROGUE")]), memIntentLog([]));
  assertEquals(r.ok, false);
  assertEquals(r.alarms[0].kind, "write-without-reason");
});

Deno.test("alarm: ok intent that never landed => reason-without-write", () => {
  const r = reconcile(
    memShipLog([]),
    memIntentLog([intent("GHOST", "ok")]),
  );
  assertEquals(r.ok, false);
  assertEquals(r.alarms[0].kind, "reason-without-write");
});

Deno.test("blocked: a refused intent is visible only in Layer 2 (no alarm)", () => {
  const r = reconcile(
    memShipLog([]),
    memIntentLog([intent("X", "refused")]),
  );
  assertEquals(r.ok, true); // a refusal is expected, not an alarm
  assertEquals(r.blocked.length, 1);
  assertEquals(r.matched.length, 0);
});
