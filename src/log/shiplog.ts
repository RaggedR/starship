// shiplog.ts — Layer 1 of the two-layer log: the SHIP'S LOG (the CLI's audit).
//
// The ship's log records WHAT happened, append-only, as the tamper-evident source
// of truth for EFFECTS. Here `con` writes one JSONL line per committed mutation. It
// never records WHY — that is Layer 2, the intent-log (intentlog.ts), joined to this
// one by correlation_id.
//
// Refusals are NOT written here. A burn that the fuel gate rejected never
// committed, so from the ship's log it simply did not happen — which is exactly
// why the second log is needed to see it.

export type ShipLogEntry = {
  readonly id: string; // this entry's own id
  readonly ts: string;
  readonly ship: string;
  readonly command: string; // e.g. "helm burn"
  readonly effect: unknown; // the committed effect, as data
  readonly correlation_id: string; // joins to the intent-log
};

export interface ShipLog {
  append(entry: ShipLogEntry): void;
  all(): readonly ShipLogEntry[];
  recent(n: number): readonly ShipLogEntry[];
  trace(correlationId: string): ShipLogEntry | null;
}

/** An in-memory ship's log — for tests and in-process demos. */
export function memShipLog(seed: readonly ShipLogEntry[] = []): ShipLog {
  const entries: ShipLogEntry[] = [...seed];
  return {
    append(e) {
      entries.push(e);
    },
    all() {
      return entries;
    },
    recent(n) {
      return entries.slice(Math.max(0, entries.length - n));
    },
    trace(corr) {
      return entries.find((e) => e.correlation_id === corr) ?? null;
    },
  };
}

/** A file-backed ship's log — append-only JSONL, one entry per line. This is the
 *  shape `con` persists to between invocations, since the CLI is run fresh per
 *  command (like a typical CLI). Reads parse the whole file; appends add one line. */
export function fileShipLog(path: string): ShipLog {
  const readAll = (): ShipLogEntry[] => {
    let text: string;
    try {
      text = Deno.readTextFileSync(path);
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ShipLogEntry);
  };
  const mem = memShipLog(readAll());
  return {
    append(e) {
      mem.append(e);
      // Append-only: one line, never a rewrite. A rewrite would defeat the point.
      Deno.writeTextFileSync(path, JSON.stringify(e) + "\n", { append: true });
    },
    all: () => mem.all(),
    recent: (n) => mem.recent(n),
    trace: (c) => mem.trace(c),
  };
}
