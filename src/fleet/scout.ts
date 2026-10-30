// scout.ts — the scout: a nested worker whose store is its OWN fog, hidden from the
// captain. Registry {look, move}: it perceives and roams, but cannot fight.
//
// One `explore` dispatch runs a mini look/move loop of up to `speed` moves. Each
// step it looks (revealing four neighbours into its private fog), then heads one
// cell toward the nearest frontier — the edge of what it has mapped. It stops early
// when the way forward is a monster (reporting `blockedBy` and holding position:
// "retreat" is handing control back, not walking home) or when no frontier is
// reachable (the region is mapped). It returns the sightings it took, so the
// captain can amalgamate them into ITS fog — the only channel by which the captain
// ever learns anything. This is MacBeth's spawn: a worker ∆S ⊗ X → Y whose store S
// (the fog) is existentially hidden; the captain sees only the report, one position
// up.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import type { Fib } from "../lib/algebra.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { Dir, Pos } from "../maze/types.ts";
import { step } from "../maze/world.ts";
import {
  emptyFog,
  type FogMap,
  mergeSighting,
  monsterKnownAt,
} from "../maze/fog.ts";
import type { Sighting } from "../maze/fog.ts";
import {
  type FleetEmit,
  lookToSighting,
  nearestFrontierStep,
  type ScoutReport,
  scoutRegistry,
  type ScoutShape,
  unitLook,
  unitMove,
} from "./ops.ts";

/** The scout's container: one shape, `explore`; its position is a ScoutReport. */
export type ScoutC = Fib<ScoutShape, ScoutReport>;

function isPos(u: unknown): u is Pos {
  return typeof u === "object" && u !== null &&
    typeof (u as Pos).x === "number" && typeof (u as Pos).y === "number";
}

/** Validate a raw reply into a ScoutReport, or null (the leaf then throws — the
 *  decoder forgives nothing, so a malformed report never passes as typed). */
function decodeReport(u: unknown): ScoutReport | null {
  if (typeof u !== "object" || u === null) return null;
  const r = u as Record<string, unknown>;
  if (!Array.isArray(r.sightings)) return null;
  if (!isPos(r.scoutPos)) return null;
  if (typeof r.exhausted !== "boolean") return null;
  if (typeof r.movesMade !== "number") return null;
  if (r.blockedBy !== null) {
    const b = r.blockedBy as Record<string, unknown>;
    if (typeof b?.monsterId !== "string" || !isPos(b?.at)) return null;
  }
  return r as unknown as ScoutReport;
}

/** Build the scout leaf. `width`/`height` size its private fog; `speed` is how far
 *  it ranges per dispatch (5 for the fleet). `emit` carries its moves out as
 *  frames. The leaf is a Runner<ScoutC>, composable with seqC. */
export function makeScout(
  ctx: HarnessCtx,
  emit: FleetEmit,
  dims: { width: number; height: number; speed: number },
): Runner<ScoutC> {
  const reg = scoutRegistry();
  let fog: FogMap = emptyFog(dims.width, dims.height); // the hidden store

  const explore = (): ScoutReport => {
    const sightings: Sighting[] = [];
    let blockedBy: ScoutReport["blockedBy"] = null;
    let exhausted = false;
    let movesMade = 0;

    let look = unitLook(ctx, reg, "scout");
    let pos: Pos = { x: look.unit.x, y: look.unit.y };

    while (true) {
      const sighting = lookToSighting(look);
      fog = mergeSighting(fog, sighting);
      sightings.push(sighting);

      if (movesMade >= dims.speed) break; // spent this dispatch's range

      const dir: Dir | null = nearestFrontierStep(fog, pos);
      if (dir === null) {
        exhausted = true; // nothing left to map from here
        break;
      }
      const target = step(pos, dir);
      const blocker = monsterKnownAt(fog, target);
      if (blocker) {
        blockedBy = { monsterId: blocker, at: target }; // the way forward is held
        break; // retreat = stop advancing, hand control back
      }

      const out = unitMove(
        ctx,
        reg,
        "scout",
        dir,
        `scouting ${dir} toward unmapped ground`,
        emit,
      );
      if (!out.ok) {
        // We routed over known floor, so a refusal is unexpected; treat as a wall.
        exhausted = true;
        break;
      }
      movesMade++;
      pos = target;
      look = unitLook(ctx, reg, "scout");
    }

    return { sightings, scoutPos: pos, blockedBy, exhausted, movesMade };
  };

  return leafLocal<ScoutC>(
    "scout",
    // deno-lint-ignore require-await
    async () => explore(),
    { explore: decodeReport },
  );
}
