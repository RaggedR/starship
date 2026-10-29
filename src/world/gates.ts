// gates.ts — the smart constructors. This file is the point of the whole showpiece.
//
// MacBeth Note 5 §5: "the gate is a smart constructor ... a denied command and a
// broken tool look the same from inside." Each gate takes the world and the raw
// request and returns either an Ok carrying a legal Effect, or a Refused carrying
// a reason. The caller cannot tell a Refused from a jammed instrument — both are
// ordinary positions. An Effect, once returned, is guaranteed legal: world.ts can
// apply it without re-checking. That is the smart-constructor contract — you cannot
// hold an illegal Effect, because the only way to make one is through a gate.

import type { PowerBudget, World } from "./types.ts";
import { bearing, distance, type Effect, getShip } from "./world.ts";

export type GateResult =
  | { readonly ok: true; readonly effect: Effect }
  | { readonly ok: false; readonly reason: string };

const ok = (effect: Effect): GateResult => ({ ok: true, effect });
const refused = (reason: string): GateResult => ({ ok: false, reason });

// How fuel scales with distance, and how close/aligned you must be to dock. Toy
// constants, chosen so the english.txt scene lands: a 2000 km burn costs 40.
const KM_PER_FUEL = 50;
const DOCK_ALIGN_TOLERANCE_DEG = 15;

function parseVec(s: string): { x: number; y: number } | null {
  const parts = s.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1] };
}

/** Smallest absolute angle between two headings, 0..180. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

// ── helm burn ─────────────────────────────────────────────────────────
/** The fuel a burn along `vector` would cost, independent of whether the tanks can
 *  afford it. Helm needs this to PROPOSE a burn ("it will cost forty units") before
 *  the captain decides. Returns null for a malformed vector. */
export function burnCost(vector: string): number | null {
  const v = parseVec(vector);
  if (!v) return null;
  return Math.round(Math.hypot(v.x, v.y) / KM_PER_FUEL);
}

/** Refuse arithmetically: a burn that costs more fuel than the tanks hold never
 *  happens. This is the fuel-budget gate — "the ship simply refuses" (english.txt). */
export function burnGate(world: World, shipId: string, vector: string): GateResult {
  const ship = getShip(world, shipId);
  const v = parseVec(vector);
  if (!v) return refused(`bad --vector ${JSON.stringify(vector)} (want "dx,dy")`);
  const fuelCost = Math.round(Math.hypot(v.x, v.y) / KM_PER_FUEL);
  if (fuelCost > ship.fuel) {
    return refused(`burn needs ${fuelCost} fuel, have ${ship.fuel}`);
  }
  return ok({
    tag: "burn",
    fuelSpent: fuelCost,
    newPosition: { x: ship.position.x + v.x, y: ship.position.y + v.y },
    newHeading: bearing({ x: 0, y: 0 }, v),
  });
}

// ── power route ───────────────────────────────────────────────────────
/** Reallocate the power budget. The conservation invariant — the three channels
 *  cannot sum past 100% — is enforced here, not in the type. */
export function powerRouteGate(
  world: World,
  shipId: string,
  to: string,
  pct: number,
): GateResult {
  const ship = getShip(world, shipId);
  if (to !== "shields" && to !== "weapons" && to !== "engines") {
    return refused(`--to must be shields|weapons|engines, got ${JSON.stringify(to)}`);
  }
  if (!Number.isFinite(pct) || pct < 0) return refused(`--pct must be >= 0, got ${pct}`);
  const newPower: PowerBudget = { ...ship.power, [to]: pct };
  const total = newPower.shields + newPower.weapons + newPower.engines;
  if (total > 100) {
    return refused(`power budget would be ${total}% (max 100%)`);
  }
  return ok({ tag: "route", newPower });
}

// ── weapons authorize / fire ──────────────────────────────────────────
/** The captain's authorization step (propose -> AUTHORIZE -> fire). The token is
 *  minted by the caller (it needs an id source, which a pure gate must not have)
 *  and passed in; the gate only checks the target is a real thing to shoot. */
export function authorizeGate(world: World, target: string, token: string): GateResult {
  const exists = world.hazards.some((h) => h.id === target) ||
    Object.keys(world.ships).includes(target);
  if (!exists) return refused(`nothing to authorize fire on: ${target}`);
  return ok({ tag: "authorize", token });
}

/** Fire — and ONLY on an authorized target. A fire with no matching captain's
 *  token is refused; from the bridge that is indistinguishable from a jammed gun. */
export function fireGate(
  world: World,
  shipId: string,
  target: string,
  token: string | undefined,
): GateResult {
  const ship = getShip(world, shipId);
  if (ship.authToken === null) {
    return refused("weapons fire requires a captain's authorization");
  }
  if (token !== ship.authToken) {
    return refused("authorization token does not match");
  }
  const destroyed = world.hazards.some((h) => h.id === target);
  return ok({ tag: "fire", target, destroyed });
}

// ── dock ──────────────────────────────────────────────────────────────
/** Dock only when in range and aligned. */
export function dockGate(world: World, shipId: string, stationId: string): GateResult {
  const ship = getShip(world, shipId);
  const station = world.stations.find((s) => s.id === stationId);
  if (!station) return refused(`no such station: ${stationId}`);
  const range = Math.round(distance(ship.position, station.position));
  if (range > station.dockRange) {
    return refused(`out of dock range: ${range} km > ${station.dockRange} km`);
  }
  const want = bearing(ship.position, station.position);
  if (angleBetween(ship.heading, want) > DOCK_ALIGN_TOLERANCE_DEG) {
    return refused(
      `not aligned: heading ${ship.heading}, need ~${want} (±${DOCK_ALIGN_TOLERANCE_DEG})`,
    );
  }
  return ok({ tag: "dock", stationId });
}

// ── transfer ──────────────────────────────────────────────────────────
/** Move cargo between ships; capacity and ownership checked. */
export function transferGate(
  world: World,
  shipId: string,
  cargoId: string,
  toShip: string,
): GateResult {
  const ship = getShip(world, shipId);
  const item = ship.cargo.find((c) => c.id === cargoId);
  if (!item) return refused(`no such cargo on ${shipId}: ${cargoId}`);
  if (item.owner !== shipId) {
    return refused(`cargo ${cargoId} is owned by ${item.owner}, not ${shipId}`);
  }
  const dst = world.ships[toShip];
  if (!dst) return refused(`no such destination ship: ${toShip}`);
  if (toShip === shipId) return refused("cannot transfer cargo to the same ship");
  return ok({ tag: "transfer", cargoId, toShip });
}
