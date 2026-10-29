// con.ts — "the conn". The one executable: a single-command CLI surface.
//
// Read commands are free (no reason). Mutating commands require --reason (the conn
// will not act on an unreasoned order) and go through a gate in gates.ts before
// anything commits. On commit, con writes ONE line to the ship's log (Layer 1,
// WHAT happened) with a correlation id — but NOT the reason: the why is Layer 2,
// the harness intent-log. Exit 0 on success, 1 on any refusal/failure.
// JSON is the default output so an officer's harness can parse it.

import { render } from "./format.ts";
import type { Format } from "./format.ts";
import { loadWorld, saveWorld } from "../world/store.ts";
import { applyEffect, getShip, RefError, scan } from "../world/world.ts";
import {
  authorizeGate,
  burnGate,
  dockGate,
  fireGate,
  type GateResult,
  powerRouteGate,
  transferGate,
} from "../world/gates.ts";
import { fileShipLog, type ShipLogEntry } from "../log/shiplog.ts";
import { type Clock, type IdSource, realClock, realIds } from "../log/ids.ts";

// ── tiny arg parser (no deps) ─────────────────────────────────────────
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
  const worldPath = str(flags, "world") ?? "starship-state.json";
  const logPath = str(flags, "log") ?? "ships-log.jsonl";
  const world = loadWorld(worldPath);
  const shipId = str(flags, "ship") ?? Object.keys(world.ships)[0];

  // Commit a gate result: refuse (nothing written) or apply + save + ship's-log.
  // The --reason is required by the caller but is NOT written here — it belongs to
  // Layer 2 (the harness intent-log), joined to this entry by correlation_id.
  const commit = (command: string, gate: GateResult): unknown => {
    reqReason(flags, command);
    if (!gate.ok) throw new Refusal(gate.reason);
    const newWorld = applyEffect(world, shipId, gate.effect);
    saveWorld(worldPath, newWorld);
    const correlationId = str(flags, "corr") ?? ids.next();
    const entry: ShipLogEntry = {
      id: ids.next(),
      ts: clock.now(),
      ship: shipId,
      command,
      effect: gate.effect,
      correlation_id: correlationId,
    };
    fileShipLog(logPath).append(entry);
    return { committed: true, command, ship: shipId, correlation_id: correlationId, effect: gate.effect };
  };

  const [group, sub, ...rest] = positional;

  switch (group) {
    // ── reads (free) ──
    case "scan":
      return { value: scan(world, shipId) };
    case "status": {
      const s = getShip(world, shipId);
      return {
        value: {
          ship: s.id,
          hull: s.hull,
          fuel: s.fuel,
          position: s.position,
          heading: s.heading,
          power: s.power,
          authorized: s.authToken !== null,
        },
      };
    }
    case "manifest": {
      const s = getShip(world, shipId);
      return { value: { ship: s.id, cargo: s.cargo, crew: s.crew } };
    }
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
    case "helm": {
      if (sub === "burn") {
        const vector = str(flags, "vector");
        if (!vector) throw new Refusal("helm burn needs --vector dx,dy");
        return { value: commit("helm burn", burnGate(world, shipId, vector)) };
      }
      throw new Refusal(`unknown helm command: ${sub ?? "(none)"}`);
    }
    case "power": {
      if (sub === "route") {
        const to = str(flags, "to");
        const pct = Number(str(flags, "pct"));
        if (!to) throw new Refusal("power route needs --to shields|weapons|engines");
        return { value: commit("power route", powerRouteGate(world, shipId, to, pct)) };
      }
      throw new Refusal(`unknown power command: ${sub ?? "(none)"}`);
    }
    case "weapons": {
      if (sub === "authorize") {
        const target = str(flags, "target");
        if (!target) throw new Refusal("weapons authorize needs --target");
        // The captain mints the token here; the gate only checks the target exists.
        const token = ids.next();
        return { value: commit("weapons authorize", authorizeGate(world, target, token)) };
      }
      if (sub === "fire") {
        const target = str(flags, "target");
        if (!target) throw new Refusal("weapons fire needs --target");
        return { value: commit("weapons fire", fireGate(world, shipId, target, str(flags, "token"))) };
      }
      throw new Refusal(`unknown weapons command: ${sub ?? "(none)"}`);
    }
    case "dock": {
      const station = str(flags, "station");
      if (!station) throw new Refusal("dock needs --station");
      return { value: commit("dock", dockGate(world, shipId, station)) };
    }
    case "transfer": {
      const cargo = str(flags, "cargo");
      const to = str(flags, "to");
      if (!cargo || !to) throw new Refusal("transfer needs --cargo and --to");
      return { value: commit("transfer", transferGate(world, shipId, cargo, to)) };
    }

    default:
      throw new Refusal(
        `unknown command: ${group ?? "(none)"}. ` +
          `try: scan | status | manifest | log | helm burn | power route | ` +
          `weapons authorize|fire | dock | transfer`,
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

// Exported for the in-process demo/tests, which supply deterministic seams.
export { run };
