// flagship.ts — nesting: a fleet is just ships nested inside a ship (english.txt).
//
// A flagship captain delegates not to officers but to the CAPTAINS of other ships,
// each of whom runs their own bridge below. The flagship never sees inside another
// ship — it only hears each ship's status report come back up. This is MacBeth
// Note 5 §4 exactly: spawn is worker composition, the child's store is existentially
// hidden, the parent amalgamates only the child's single returned position.
//
// The hiding is enforced by the TYPE: a ship-captain is a Runner<ShipCaptainC>
// whose position is ShipStatusReport. The internal Bridge, the CaptainReport, the
// four officers' positions — none of them appear in the flagship's type. The
// flagship literally cannot reach them.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import { type Bridge, handleHazard, mkBridge } from "../bridge/captain.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { ShipCaptainC, ShipStatusReport } from "../bridge/containers.ts";

function decodeShipStatusReport(u: unknown): ShipStatusReport | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  return typeof r.ship === "string" && typeof r.acted === "boolean" &&
      typeof r.decision === "string" && typeof r.fuelAfter === "number" &&
      (r.correlationId === null || typeof r.correlationId === "string")
    ? {
      ship: r.ship,
      acted: r.acted,
      decision: r.decision,
      fuelAfter: r.fuelAfter,
      correlationId: r.correlationId as string | null,
    }
    : null;
}

/** One ship's captain, as a Runner the flagship can delegate to. It builds its OWN
 *  bridge (internal, invisible above) and, asked to handle a hazard, runs the full
 *  delegate→amalgamate→decide→act cycle, then condenses the result to a single
 *  status report. Everything richer than that report stays hidden on this level. */
export function shipCaptain(ctx: HarnessCtx): Runner<ShipCaptainC> {
  const bridge: Bridge = mkBridge(ctx); // internal — never exposed to the flagship
  return leafLocal<ShipCaptainC>(
    "captain:ship",
    async (shape) => {
      const report = await handleHazard(bridge, shape.ship);
      const status = ctx.conRun(["status", "--ship", shape.ship]).value as { fuel: number };
      const correlationId = report.order?.outcome.tag === "done"
        ? report.order.outcome.correlationId
        : null;
      // Only this crosses back up — the Assessment, PowerReport and proposal do not.
      return {
        ship: shape.ship,
        acted: report.order?.outcome.tag === "done",
        decision: report.decision,
        fuelAfter: status.fuel,
        correlationId,
      };
    },
    { handleHazard: decodeShipStatusReport },
  );
}

export type FleetReport = {
  readonly ships: readonly ShipStatusReport[];
  readonly summary: string;
};

/** The flagship: delegate the hazard to each ship's captain, amalgamate the status
 *  reports that come back. Sequential, so the shared world file and the two logs
 *  are written in a deterministic order (the DoD wants byte-identical replays). */
export async function flagship(
  ctx: HarnessCtx,
  shipIds: readonly string[],
): Promise<FleetReport> {
  const ships: ShipStatusReport[] = [];
  for (const ship of shipIds) {
    const captain = shipCaptain(ctx);
    ships.push(await captain.run({ tag: "handleHazard", ship }, 1));
  }
  const acted = ships.filter((s) => s.acted).length;
  return { ships, summary: `${acted}/${ships.length} ships evaded a hazard` };
}
