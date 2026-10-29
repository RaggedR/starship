// officers.ts — the officers as in-process Runners (ref: stubRunner in
// ~/git/gold/dungeon/harness.ts). Each officer is a leaf: its answer function
// plays the part a subprocess or language model would, producing a RAW reply that
// the decoder validates into a typed position (leafLocal). The reasoning is
// scripted/deterministic, so the demo replays identically; swapping in a real
// model later means replacing only the answer function.
//
// Every officer touches ONLY the con surface — reads via conRead, writes via
// runMutation — and only the commands in its registry (the allowlist IS the
// permission grant). Nothing here reads the world object directly, so
// con's world file is the single source of truth and reads never go stale.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import { burnCost } from "../world/gates.ts";
import type { PowerBudget, SensorContact } from "../world/types.ts";
import type {
  Assessment,
  BurnProposal,
  Contact,
  EngineeringC,
  HelmC,
  OfficerResult,
  PowerReport,
  ScienceC,
  WeaponsC,
} from "./containers.ts";
import {
  conRead,
  type HarnessCtx,
  type MutationOutcome,
  type Registry,
  runMutation,
} from "./harness.ts";

// ── decoders ──────────────────────────────────────────────────────────
function isContact(u: unknown): u is Contact {
  if (!u || typeof u !== "object") return false;
  const c = u as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.kind === "string" &&
    typeof c.bearing === "number" && typeof c.range === "number";
}

function decodeAssessment(u: unknown): Assessment | null {
  if (!u || typeof u !== "object") return null;
  const a = u as Record<string, unknown>;
  if (!Array.isArray(a.threats) || !a.threats.every(isContact)) return null;
  if (!Array.isArray(a.opportunities) || !a.opportunities.every(isContact)) return null;
  if (typeof a.recommendation !== "string") return null;
  return {
    threats: a.threats as Contact[],
    opportunities: a.opportunities as Contact[],
    recommendation: a.recommendation,
  };
}

function decodeOfficerResult(u: unknown): OfficerResult | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  if (r.tag === "done" && typeof r.correlationId === "string") {
    return { tag: "done", correlationId: r.correlationId, result: r.result };
  }
  if (r.tag === "refused" && typeof r.reason === "string") {
    return { tag: "refused", reason: r.reason };
  }
  return null;
}

/** Turn a harness MutationOutcome into the raw OfficerResult the leaf will decode. */
function asResult(o: MutationOutcome): OfficerResult {
  return o.ok
    ? { tag: "done", correlationId: o.correlationId, result: o.result }
    : { tag: "refused", reason: o.reason };
}

const strip = (c: SensorContact): Contact => ({
  id: c.id,
  kind: c.kind,
  bearing: c.bearing,
  range: c.range,
});

// ── Science officer (read-only): a threat-and-opportunity assessment ──
export function scienceOfficer(ctx: HarnessCtx): Runner<ScienceC> {
  const reg: Registry = {
    agentId: "officer:science",
    allowed: new Set(["scan", "status", "manifest", "log recent", "log trace"]),
  };
  return leafLocal<ScienceC>(
    "officer:science",
    (shape) => {
      const contacts = conRead(
        ctx,
        reg,
        "scan",
        ["scan", "--ship", shape.ship],
        { ship: shape.ship },
      ) as SensorContact[];
      const threats = contacts.filter((c) => c.hazard).map(strip);
      const opportunities = contacts.filter((c) => c.kind === "station").map(strip);
      const nearest = threats[0];
      const recommendation = nearest
        ? `evade ${nearest.id}: ${nearest.kind} at ${nearest.range} km, bearing ${nearest.bearing}`
        : "no threats on sensors; proceed";
      return { threats, opportunities, recommendation };
    },
    { assess: decodeAssessment },
  );
}

// ── Helm officer: proposes and executes burns, and docks. Cannot fire. ─
export function helmOfficer(ctx: HarnessCtx): Runner<HelmC> {
  const reg: Registry = {
    agentId: "officer:helm",
    allowed: new Set(["status", "helm burn", "dock"]),
  };
  const decodeProposal = (u: unknown): BurnProposal | null => {
    if (!u || typeof u !== "object") return null;
    const p = u as Record<string, unknown>;
    return typeof p.vector === "string" && typeof p.fuelCost === "number" &&
        typeof p.haveFuel === "number" && typeof p.feasible === "boolean"
      ? { vector: p.vector, fuelCost: p.fuelCost, haveFuel: p.haveFuel, feasible: p.feasible }
      : null;
  };
  return leafLocal<HelmC>(
    "officer:helm",
    (shape) => {
      switch (shape.tag) {
        case "proposeBurn": {
          // A proposal is a read: compute cost and feasibility WITHOUT committing —
          // "it will cost forty units of fuel, we have sixty" (english.txt).
          const status = conRead(
            ctx,
            reg,
            "status",
            ["status", "--ship", shape.ship],
            { ship: shape.ship },
          ) as { fuel: number };
          const cost = burnCost(shape.vector) ?? Number.NaN;
          return {
            vector: shape.vector,
            fuelCost: cost,
            haveFuel: status.fuel,
            feasible: cost <= status.fuel,
          };
        }
        case "executeBurn":
          return asResult(runMutation(
            ctx,
            reg,
            "helm burn",
            ["helm", "burn", "--vector", shape.vector, "--ship", shape.ship],
            { vector: shape.vector },
            shape.reason,
          ));
        case "dock":
          return asResult(runMutation(
            ctx,
            reg,
            "dock",
            ["dock", "--station", shape.station, "--ship", shape.ship],
            { station: shape.station },
            shape.reason,
          ));
      }
    },
    { proposeBurn: decodeProposal, executeBurn: decodeOfficerResult, dock: decodeOfficerResult },
  );
}

// ── Weapons officer: fires only on an authorized target. Cannot steer. ─
export function weaponsOfficer(ctx: HarnessCtx): Runner<WeaponsC> {
  const reg: Registry = {
    agentId: "officer:weapons",
    allowed: new Set(["weapons authorize", "weapons fire"]),
  };
  return leafLocal<WeaponsC>(
    "officer:weapons",
    (shape) => {
      switch (shape.tag) {
        case "authorize":
          return asResult(runMutation(
            ctx,
            reg,
            "weapons authorize",
            ["weapons", "authorize", "--target", shape.target, "--ship", shape.ship],
            { target: shape.target },
            shape.reason,
          ));
        case "fire":
          return asResult(runMutation(
            ctx,
            reg,
            "weapons fire",
            ["weapons", "fire", "--target", shape.target, "--token", shape.token, "--ship", shape.ship],
            { target: shape.target },
            shape.reason,
          ));
      }
    },
    { authorize: decodeOfficerResult, fire: decodeOfficerResult },
  );
}

// ── Engineering officer: allocates power and moves cargo. ──────────────
export function engineeringOfficer(ctx: HarnessCtx): Runner<EngineeringC> {
  const reg: Registry = {
    agentId: "officer:engineering",
    allowed: new Set(["status", "power route", "transfer"]),
  };
  const decodeReport = (u: unknown): PowerReport | null => {
    if (!u || typeof u !== "object") return null;
    const r = u as Record<string, unknown>;
    const p = r.power as Record<string, unknown> | undefined;
    return p && typeof p.shields === "number" && typeof p.weapons === "number" &&
        typeof p.engines === "number" && typeof r.routedTotal === "number" &&
        typeof r.headroom === "number"
      ? {
        power: { shields: p.shields, weapons: p.weapons, engines: p.engines },
        routedTotal: r.routedTotal,
        headroom: r.headroom,
      }
      : null;
  };
  return leafLocal<EngineeringC>(
    "officer:engineering",
    (shape) => {
      switch (shape.tag) {
        case "report": {
          const status = conRead(
            ctx,
            reg,
            "status",
            ["status", "--ship", shape.ship],
            { ship: shape.ship },
          ) as { power: PowerBudget };
          const { shields, weapons, engines } = status.power;
          const routedTotal = shields + weapons + engines;
          return { power: status.power, routedTotal, headroom: 100 - routedTotal };
        }
        case "route":
          return asResult(runMutation(
            ctx,
            reg,
            "power route",
            ["power", "route", "--to", shape.to, "--pct", String(shape.pct), "--ship", shape.ship],
            { to: shape.to, pct: shape.pct },
            shape.reason,
          ));
        case "transfer":
          return asResult(runMutation(
            ctx,
            reg,
            "transfer",
            ["transfer", "--cargo", shape.cargo, "--to", shape.to, "--ship", shape.ship],
            { cargo: shape.cargo, to: shape.to },
            shape.reason,
          ));
      }
    },
    { report: decodeReport, route: decodeOfficerResult, transfer: decodeOfficerResult },
  );
}
