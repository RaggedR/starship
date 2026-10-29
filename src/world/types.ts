// types.ts — the whole world, as plain data.
//
// This is the "state is the whole world" claim of english.txt: a ship's state is
// fuel, hull, position, heading, how its power is split, and what is in the hold.
// Nothing here is a class with behaviour; the behaviour lives in world.ts (the
// reducers) and gates.ts (the smart constructors). Keeping the state as data is
// what lets us serialise it to one JSON file and replay it to the same bytes.

export type Vec = { readonly x: number; readonly y: number };

/** The power budget, as three percentages. The invariant (sum <= 100) is NOT
 *  encoded in the type — it is enforced by the gate in gates.ts, which is the
 *  point: a type can hold an illegal budget, a smart constructor cannot build one. */
export type PowerBudget = {
  readonly shields: number;
  readonly weapons: number;
  readonly engines: number;
};

export type CargoItem = {
  readonly id: string;
  readonly name: string;
  readonly mass: number;
  readonly owner: string; // a ship id — ownership is checked on transfer
};

export type CrewMember = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
};

export type ShipState = {
  readonly id: string;
  readonly hull: number; // 0..100
  readonly fuel: number; // units
  readonly position: Vec;
  readonly heading: number; // degrees, 0..359
  readonly power: PowerBudget;
  readonly cargo: readonly CargoItem[];
  readonly crew: readonly CrewMember[];
  /** The captain's weapons authorization, when one has been issued. A fire with
   *  no matching token is refused by the weapons gate — a propose -> authorize
   *  -> fire (human-in-the-loop) gate. */
  readonly authToken: string | null;
};

export type HazardKind = "minefield" | "asteroid" | "anomaly";

export type Hazard = {
  readonly id: string;
  readonly kind: HazardKind;
  readonly position: Vec;
};

export type Station = {
  readonly id: string;
  readonly name: string;
  readonly position: Vec;
  readonly heading: number;
  readonly dockRange: number; // how close, and how aligned, you must be to dock
};

/** The whole star system. Ships are keyed by id so a fleet is a map, and nesting
 *  (a flagship over ship-captains) does not need a new container — it reads the
 *  same map one level up. */
export type World = {
  readonly ships: Record<string, ShipState>;
  readonly hazards: readonly Hazard[];
  readonly stations: readonly Station[];
};

// ── Sensor view (what `scan` returns) ─────────────────────────────────
export type SensorContact = {
  readonly id: string;
  readonly kind: string;
  readonly bearing: number; // degrees from the ship, 0..359
  readonly range: number; // kilometres
  readonly hazard: boolean;
};
