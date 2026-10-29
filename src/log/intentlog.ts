// intentlog.ts — Layer 2 of the two-layer log: the HARNESS INTENT-LOG (the why).
//
// Written by an officer's harness, NOT by con. It records the ONE thing the ship's
// log deliberately does not: the reason an order was given — required and non-empty
// on every mutation, and write-ahead: an `attempted` record is appended BEFORE con
// runs, then an outcome record sharing the same call_id is appended after. Two
// append-only lines per mutation; reconciliation reads the last status per call_id.
//
// It also captures what the ship's log never can: a mutation the gate REFUSED,
// which never reached con and so left no Layer-1 trace.

export type IntentStatus = "attempted" | "ok" | "refused" | "error";

/** One intent record. `reason` is required and non-empty iff `mutates` is true. */
export type IntentRecord = {
  readonly call_id: string; // unique per tool call; the two lines of a mutation share it
  readonly ts: string;
  readonly agent_id: string; // e.g. "officer:science" — the typed agent
  readonly session_id: string; // the harness session
  readonly tool: string; // the con capability, e.g. "helm burn" — never "bash"
  readonly args: Record<string, unknown>;
  readonly reason: string; // "" allowed only for read-only (mutates:false) tools
  readonly mutates: boolean;
  readonly status: IntentStatus;
  readonly correlation_id: string; // joins to the ship's log
  readonly exit_code?: number;
  readonly duration_ms?: number;
};

export interface IntentLog {
  append(record: IntentRecord): void;
  all(): readonly IntentRecord[];
  /** The final record per call_id (outcome wins over attempt) — for reconciliation. */
  latestByCall(): Map<string, IntentRecord>;
}

function latest(entries: readonly IntentRecord[]): Map<string, IntentRecord> {
  const m = new Map<string, IntentRecord>();
  for (const e of entries) m.set(e.call_id, e); // later lines overwrite earlier
  return m;
}

export function memIntentLog(seed: readonly IntentRecord[] = []): IntentLog {
  const entries: IntentRecord[] = [...seed];
  return {
    append(r) {
      entries.push(r);
    },
    all: () => entries,
    latestByCall: () => latest(entries),
  };
}

export function fileIntentLog(path: string): IntentLog {
  const readAll = (): IntentRecord[] => {
    try {
      return Deno.readTextFileSync(path)
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as IntentRecord);
    } catch {
      return [];
    }
  };
  const mem = memIntentLog(readAll());
  return {
    append(r) {
      mem.append(r);
      Deno.writeTextFileSync(path, JSON.stringify(r) + "\n", { append: true });
    },
    all: () => mem.all(),
    latestByCall: () => mem.latestByCall(),
  };
}
