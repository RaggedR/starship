// dungeon.ts — "the conn" for the maze. A second single-command CLI surface, the
// exact shape of con.ts but over the maze world. Kept separate so the star-system
// con.ts stays pristine; the two are different domains, and con.ts's dispatch was
// always domain-specific.
//
// Read commands are free (no reason). Mutating commands (move, attack) require
// --reason and go through a gate in maze/gates.ts before anything commits. On
// commit, one line is written to the ship's log (Layer 1, WHAT happened) with a
// correlation id — but NOT the reason: the why is Layer 2, the harness intent-log.
// Exit 0 on success, 1 on any refusal/failure. JSON is the default output so the
// agent's harness can parse it.

import { mazeMap, render } from "./format.ts";
import type { Format } from "./format.ts";
import { loadMaze, saveMaze } from "../maze/store.ts";
import { applyEffect, look, RefError, unitStatus } from "../maze/world.ts";
import { attackGate, type GateResult, moveGate } from "../maze/gates.ts";
import { fileShipLog, type ShipLogEntry } from "../log/shiplog.ts";
import { type Clock, type IdSource, realClock, realIds } from "../log/ids.ts";

// ── tiny arg parser (no deps; same shape as con.ts) ───────────────────
type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

class Refusal extends Error {}

function str(flags: Parsed["flags"], key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function reqReason(flags: Parsed["flags"], command: string): string {
  const reason = str(flags, "reason");
  if (!reason || reason.trim() === "") {
    throw new Refusal(`${command} requires a non-empty --reason`);
  }
  return reason;
}

// ── dispatch ──────────────────────────────────────────────────────────
function run(argv: string[], ids: IdSource, clock: Clock): { value: unknown } {
  const { positional, flags } = parseArgs(argv);
  const worldPath = str(flags, "world") ?? "maze-state.json";
  const logPath = str(flags, "log") ?? "dungeon-log.jsonl";
  const world = loadMaze(worldPath);
  // Which piece acts. Defaults to "hero" so the single-agent maze never passes it
  // and is unchanged; the fleet passes --unit scout|fighter|captain.
  const unitId = str(flags, "unit") ?? "hero";

  // Commit a gate result: refuse (nothing written) or apply + save + ship's-log.
  // The --reason is required by the caller but NOT written here — it belongs to
  // Layer 2 (the harness intent-log), joined to this entry by correlation_id.
  const commit = (command: string, gate: GateResult): unknown => {
    reqReason(flags, command);
    if (!gate.ok) throw new Refusal(gate.reason);
    const newWorld = applyEffect(world, gate.effect);
    saveMaze(worldPath, newWorld);
    const correlationId = str(flags, "corr") ?? ids.next();
    const entry: ShipLogEntry = {
      id: ids.next(),
      ts: clock.now(),
      ship: unitId,
      command,
      effect: gate.effect,
      correlation_id: correlationId,
    };
    fileShipLog(logPath).append(entry);
    return {
      committed: true,
      command,
      correlation_id: correlationId,
      effect: gate.effect,
    };
  };

  const [group, sub, ...rest] = positional;

  switch (group) {
    // ── reads (free) ──
    case "look":
      return { value: look(world, unitId) };
    case "hero":
      return { value: unitStatus(world, unitId) };
    case "map":
      return { value: mazeMap(world) };
    case "log": {
      const slog = fileShipLog(logPath);
      if (sub === "recent") {
        return { value: slog.recent(Number(str(flags, "n") ?? "10")) };
      }
      if (sub === "trace") {
        const corr = rest[0] ?? str(flags, "corr");
        if (!corr) throw new Refusal("log trace needs a correlation id");
        const entry = slog.trace(corr);
        if (!entry) throw new RefError(`no ship's-log entry for ${corr}`);
        return { value: entry };
      }
      throw new Refusal(`unknown log command: ${sub ?? "(none)"}`);
    }

    // ── mutations (audited, reason required, gated) ──
    case "move": {
      const dir = str(flags, "dir");
      if (!dir) throw new Refusal("move needs --dir N|S|E|W");
      return { value: commit("move", moveGate(world, unitId, dir)) };
    }
    case "attack": {
      const target = str(flags, "target");
      if (!target) throw new Refusal("attack needs --target <monster-id>");
      return { value: commit("attack", attackGate(world, unitId, target)) };
    }

    default:
      throw new Refusal(
        `unknown command: ${group ?? "(none)"}. ` +
          `try: look | hero | map | log recent|trace | move --dir | attack --target`,
      );
  }
}

function main() {
  const { flags } = parseArgs(Deno.args);
  const format = (str(flags, "format") ?? "json") as Format;
  try {
    const { value } = run(Deno.args, realIds(), realClock());
    console.log(render(value, format));
    Deno.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`refused: ${msg}`);
    Deno.exit(1);
  }
}

if (import.meta.main) main();

// Exported for the in-process demo/tests and the agent loop, which supply
// deterministic seams and drive `run` directly in-memory (no subprocess).
export { run };
