// world.ts — the deterministic world: sensor reads, geometry, and the reducers.
//
// Everything here is a pure total function of (world, args). No randomness, no
// clock, no I/O. That is what "runs in seconds and gives the same answer twice"
// (PLAN §1) rests on. In worker terms (MacBeth Note 5) applyEffect IS bwdS — the
// writeback of a new state from a committed position. The gates (gates.ts) decide
// WHICH effects are legal; this file only applies ones already found legal.

import type {
  CargoItem,
  PowerBudget,
  SensorContact,
  ShipState,
  Vec,
  World,
} from "./types.ts";

// ── Geometry (deterministic) ──────────────────────────────────────────
export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bearing from `from` to `to`, in degrees 0..359, 0 = +x axis, rounded so the
 *  display and the logs are stable. */
export function bearing(from: Vec, to: Vec): number {
  const deg = Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI);
  return ((Math.round(deg) % 360) + 360) % 360;
}

// ── Reads ─────────────────────────────────────────────────────────────
export function getShip(world: World, shipId: string): ShipState {
  const s = world.ships[shipId];
  if (!s) throw new RefError(`no such ship: ${shipId}`);
  return s;
}

/** A sensor sweep from a ship: every hazard and every other ship, as a contact
 *  with bearing and range. Sorted by range so the nearest threat reads first and
 *  the output is order-stable. */
export function scan(world: World, shipId: string): SensorContact[] {
  const me = getShip(world, shipId);
  const contacts: SensorContact[] = [];
  for (const h of world.hazards) {
    contacts.push({
      id: h.id,
      kind: h.kind,
      bearing: bearing(me.position, h.position),
      range: Math.round(distance(me.position, h.position)),
      hazard: true,
    });
  }
  for (const s of Object.values(world.ships)) {
    if (s.id === shipId) continue;
    contacts.push({
      id: s.id,
      kind: "ship",
      bearing: bearing(me.position, s.position),
      range: Math.round(distance(me.position, s.position)),
      hazard: false,
    });
  }
  for (const st of world.stations) {
    contacts.push({
      id: st.id,
      kind: "station",
      bearing: bearing(me.position, st.position),
      range: Math.round(distance(me.position, st.position)),
      hazard: false,
    });
  }
  return contacts.sort((a, b) => a.range - b.range || a.id.localeCompare(b.id));
}

// ── Committed effects (produced by gates.ts, applied here) ────────────
export type Effect =
  | { readonly tag: "burn"; readonly fuelSpent: number; readonly newPosition: Vec; readonly newHeading: number }
  | { readonly tag: "route"; readonly newPower: PowerBudget }
  | { readonly tag: "fire"; readonly target: string; readonly destroyed: boolean }
  | { readonly tag: "dock"; readonly stationId: string }
  | { readonly tag: "transfer"; readonly cargoId: string; readonly toShip: string }
  | { readonly tag: "authorize"; readonly token: string };

function putShip(world: World, ship: ShipState): World {
  return { ...world, ships: { ...world.ships, [ship.id]: ship } };
}

/** Apply a committed effect. Pure: returns a new World, never mutates the old. */
export function applyEffect(world: World, shipId: string, effect: Effect): World {
  const me = getShip(world, shipId);
  switch (effect.tag) {
    case "burn":
      return putShip(world, {
        ...me,
        fuel: me.fuel - effect.fuelSpent,
        position: effect.newPosition,
        heading: effect.newHeading,
      });
    case "route":
      return putShip(world, { ...me, power: effect.newPower });
    case "authorize":
      return putShip(world, { ...me, authToken: effect.token });
    case "fire": {
      // Firing consumes the captain's authorization (one token, one shot) and, if
      // the target was a hazard, clears it from the system.
      const afterToken = putShip(world, { ...me, authToken: null });
      return effect.destroyed
        ? { ...afterToken, hazards: afterToken.hazards.filter((h) => h.id !== effect.target) }
        : afterToken;
    }
    case "dock": {
      const station = world.stations.find((s) => s.id === effect.stationId);
      if (!station) throw new RefError(`no such station: ${effect.stationId}`);
      return putShip(world, { ...me, position: station.position, heading: station.heading });
    }
    case "transfer": {
      const item = me.cargo.find((c) => c.id === effect.cargoId);
      if (!item) throw new RefError(`no such cargo on ${shipId}: ${effect.cargoId}`);
      const dst = getShip(world, effect.toShip);
      const moved: CargoItem = { ...item, owner: effect.toShip };
      const fromShip: ShipState = { ...me, cargo: me.cargo.filter((c) => c.id !== effect.cargoId) };
      const toShip: ShipState = { ...dst, cargo: [...dst.cargo, moved] };
      return putShip(putShip(world, fromShip), toShip);
    }
  }
}

/** A reference error (bad ship/station/cargo id) — distinct from a gate refusal.
 *  The CLI maps both to exit 1, but they are different failures: this is "you
 *  named something that does not exist", a refusal is "that move is illegal". */
export class RefError extends Error {}
