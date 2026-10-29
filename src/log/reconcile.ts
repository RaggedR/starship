// reconcile.ts — the two logs audit each other.
//
// Reconciliation is not a bonus feature; it is the whole reason there are two logs.
// Joined by correlation_id, the ship's log (WHAT committed) and the intent-log (WHY,
// plus what was only attempted) cross-check into three findings:
//
//   matched   — a committed mutation WITH a logged reason. The healthy case.
//   alarm     — a ship's-log entry with NO matching `ok` intent: a change to the
//               world with no logged reason. This must never exist; it is exactly
//               the condition the whole design exists to surface.
//               (Also: an `ok` intent with no ship's-log entry — a write the harness
//               believed landed but did not.)
//   blocked   — an intent `refused`: an order proposed and stopped (by a gate, the
//               reason-gate, or the registry). It never reached the ship's log, so it
//               is visible ONLY here. Expected, and valuable — the asymmetry that a
//               single merged log could never show.

import type { ShipLog, ShipLogEntry } from "./shiplog.ts";
import type { IntentLog, IntentRecord } from "./intentlog.ts";

export type Matched = {
  readonly correlationId: string;
  readonly command: string;
  readonly agentId: string;
};

export type Alarm =
  | { readonly kind: "write-without-reason"; readonly entry: ShipLogEntry }
  | { readonly kind: "reason-without-write"; readonly intent: IntentRecord };

export type ReconReport = {
  readonly ok: boolean; // true iff there are no alarms
  readonly matched: readonly Matched[];
  readonly blocked: readonly IntentRecord[];
  readonly alarms: readonly Alarm[];
};

export function reconcile(shipLog: ShipLog, intentLog: IntentLog): ReconReport {
  // The final record per call; then index the mutating ones by correlation id.
  const latest = [...intentLog.latestByCall().values()];
  const okByCorr = new Map<string, IntentRecord>();
  for (const r of latest) {
    if (r.mutates && r.status === "ok" && r.correlation_id) {
      okByCorr.set(r.correlation_id, r);
    }
  }

  const matched: Matched[] = [];
  const alarms: Alarm[] = [];

  const shipEntries = shipLog.all();
  const shipCorrs = new Set(shipEntries.map((e) => e.correlation_id));

  // Every committed mutation must have a matching `ok` intent (a logged reason).
  for (const e of shipEntries) {
    const intent = okByCorr.get(e.correlation_id);
    if (intent) {
      matched.push({ correlationId: e.correlation_id, command: e.command, agentId: intent.agent_id });
    } else {
      alarms.push({ kind: "write-without-reason", entry: e });
    }
  }

  // Every `ok` intent must have landed in the ship's log.
  for (const [corr, intent] of okByCorr) {
    if (!shipCorrs.has(corr)) alarms.push({ kind: "reason-without-write", intent });
  }

  // Refusals: proposed-but-blocked, visible only in Layer 2.
  const blocked = latest.filter((r) => r.mutates && r.status === "refused");

  return { ok: alarms.length === 0, matched, blocked, alarms };
}

/** A short human summary line for the demo. */
export function reconSummary(r: ReconReport): string {
  const head = r.ok ? "OK" : `${r.alarms.length} ALARM(S)`;
  return `reconciliation: ${head} — ${r.matched.length} matched, ` +
    `${r.blocked.length} blocked (refused, visible only in the intent-log), ` +
    `${r.alarms.length} alarm(s)`;
}
