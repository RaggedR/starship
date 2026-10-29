// seed.ts — the starting world for the demo, straight from english.txt.
//
// "a mine field two thousand kilometres off the port bow ... it will cost forty
// units of fuel, we have sixty." These numbers are chosen so the legal burn
// (40) commits and the illegal one (80) is refused by the fuel gate — the two
// outcomes the Definition of Done needs on screen.

import type { World } from "./types.ts";

export function seedWorld(): World {
  return {
    ships: {
      "NCC-1": {
        id: "NCC-1",
        hull: 100,
        fuel: 60,
        position: { x: 0, y: 0 },
        heading: 90,
        power: { shields: 34, weapons: 33, engines: 33 },
        cargo: [
          { id: "crate-7", name: "medical supplies", mass: 12, owner: "NCC-1" },
        ],
        crew: [
          { id: "c1", name: "Science", role: "science" },
          { id: "c2", name: "Helm", role: "helm" },
          { id: "c3", name: "Weapons", role: "weapons" },
          { id: "c4", name: "Engineering", role: "engineering" },
          { id: "c5", name: "Captain", role: "captain" },
        ],
        authToken: null,
      },
    },
    // ~2000 km off the port bow: the ship points at heading 90 (+y), so port is
    // -x. Place the minefield there, just over 2000 km out.
    hazards: [
      { id: "minefield-A", kind: "minefield", position: { x: -2000, y: 100 } },
    ],
    stations: [
      {
        id: "starbase-12",
        name: "Starbase 12",
        position: { x: 500, y: 500 },
        heading: 270,
        dockRange: 50,
      },
    ],
  };
}

/** A fleet of two ships, each with its own minefield off its port bow. The M5
 *  nesting demo: a flagship delegates to each ship's captain, who runs their own
 *  bridge below — and the flagship sees only each ship's status report come back up
 *  ("a fleet is just ships nested inside a ship", english.txt). */
export function seedFleet(): World {
  const base = seedWorld();
  const ncc1 = base.ships["NCC-1"];
  return {
    ships: {
      "NCC-1": ncc1,
      "NCC-2": {
        ...ncc1,
        id: "NCC-2",
        fuel: 60,
        position: { x: 5000, y: 0 },
        cargo: [{ id: "crate-9", name: "deuterium", mass: 20, owner: "NCC-2" }],
      },
    },
    hazards: [
      { id: "minefield-A", kind: "minefield", position: { x: -2000, y: 100 } },
      // off NCC-2's port bow (NCC-2 at x=5000, heading 90 => port is -x)
      { id: "minefield-B", kind: "asteroid", position: { x: 3000, y: 150 } },
    ],
    stations: base.stations,
  };
}
