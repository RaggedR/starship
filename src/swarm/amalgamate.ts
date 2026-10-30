// amalgamate.ts — the N-ary amalgamation: fold MANY scout reports into one fog.
//
// This is where the fleet's semilattice join earns its keep. The fleet merged one
// scout's sightings at a time; the swarm gathers FIVE scout reports in a single
// planning step and folds them all into the captain's map. We express that fold
// over the LAW-TESTED fog-to-fog join `mergeFog` (maze/fog.ts, idempotent +
// commutative + associative + monotone), so the result is provably independent of
// the order the reports arrive — the N-ary fold is well-defined *because* of those
// laws. amalgamate_test.ts asserts that order-independence on real report data.
//
// Why fold per-report fogs rather than just looping mergeSighting over every
// sighting (which the fleet does, and which gives the same answer here)? Because
// the showpiece claim is about mergeFog, the amalgamation: each scout returns a
// partial PICTURE, and the captain's picture is the join of the pictures. Building
// each report's fog and joining them makes that reading literal — the tensor of
// scouts (all reports owed) collapses into the captain's fog by ⊔.

import { type FogMap, mergeFog, mergeSighting } from "../maze/fog.ts";
import type { Sighting } from "../maze/fog.ts";

/** One scout's contribution, reduced to what the fog needs: the sightings it took.
 *  (A full ScoutReport carries more — position, blockedBy — but the amalgamation
 *  only consumes sightings, so this is the minimal input and keeps the fold pure.) */
export type FogContribution = { readonly sightings: readonly Sighting[] };

/** The fog a single scout's report implies, built on an empty map of the given
 *  size: the partial picture that one scout alone could draw. */
export function fogOfSightings(
  width: number,
  height: number,
  sightings: readonly Sighting[],
): FogMap {
  let f: FogMap = { width, height, cells: emptyCells(width, height), monsters: {}, exitSeen: false };
  for (const s of sightings) f = mergeSighting(f, s);
  return f;
}

function emptyCells(width: number, height: number): FogMap["cells"] {
  const rows: FogMap["cells"][number][] = [];
  for (let y = 0; y < height; y++) rows.push(new Array(width).fill("unknown"));
  return rows;
}

/** Fold N scout reports into `base`, by joining each report's fog in turn. The
 *  accumulator is the captain's growing map; `⊔` is mergeFog. Order-independent and
 *  idempotent by mergeFog's laws, so the scheduler may process scouts in any fixed
 *  order and re-merge a report harmlessly — the captain's map is the same either way.
 *
 *  Occupancy note: monsters are unioned by mergeFog and, within one tick with static
 *  monsters and no mid-tick kills, every report that mentions a cell agrees on it —
 *  so the union is unambiguous. Kills are applied OUTSIDE this fold (clearMonster),
 *  keeping the fold a pure monotone climb. */
export function amalgamate(
  base: FogMap,
  reports: readonly FogContribution[],
): FogMap {
  let fog = base;
  for (const r of reports) {
    fog = mergeFog(fog, fogOfSightings(base.width, base.height, r.sightings));
  }
  return fog;
}
