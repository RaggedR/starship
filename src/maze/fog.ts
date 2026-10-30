// fog.ts — the captain's partial map, and the amalgamation that grows it.
//
// This is the heart of the fleet extension. The captain never sees the true
// MazeWorld; its ONLY state is a FogMap it assembles from scout reports. That is
// existential hiding made literal (MacBeth Note 5, the nested worker whose store
// is hidden): the captain reasons and moves on borrowed perception.
//
// Terrain vs occupancy — the one subtlety that makes the maths honest.
//   Terrain (floor/wall/exit) is PERMANENT in a static maze, so what a scout
//   learns about it only ever accumulates: `unknown ⊑ {floor, wall, exit}`. That
//   is a flat semilattice, and `joinKnown` is its join. We add a top `conflict`
//   so the join is TOTAL (two disagreeing non-bottom terrains ⟹ ⊤), which makes
//   idempotence/commutativity/associativity hold universally — the honest-scout
//   invariant is then exactly "conflict never arises", a thing the tests assert.
//
//   Occupancy (which monster is where) is DIFFERENT: a monster dies when the
//   fighter clears it, so a cell's occupancy can retract. If we had folded
//   "monster" into the terrain enum (as the first-draft plan did), killing a
//   monster would drop a cell monster → floor and monotonicity would be a lie.
//   So occupancy lives in its own `monsters` dict, updated (not joined) as the
//   fleet learns of kills. Terrain joins monotonically; occupancy is revised.
//
// Pure, total, deterministic: no clock, no randomness, no I/O. mergeFog is the
// amalgamation and is law-tested in fog_test.ts.

import type { Pos } from "./types.ts";
import { eq } from "./world.ts";

// ── The terrain semilattice ───────────────────────────────────────────────
/** What the fleet knows about a cell's TERRAIN. A flat lattice:
 *    bottom = "unknown"  (we have learned nothing)
 *    middle = floor | wall | exit  (three incomparable, permanent facts)
 *    top    = "conflict" (two scouts reported different terrain — a bug/lie)
 *  Occupancy (monsters) is NOT here; it is revisable and lives in FogMap.monsters. */
export type Known = "unknown" | "floor" | "wall" | "exit" | "conflict";

/** The join (least upper bound) of two terrain facts. Commutative, associative,
 *  idempotent by construction; `unknown` is the identity, `conflict` is absorbing.
 *  Two distinct non-bottom terrains have no common refinement, so they join to
 *  `conflict` — which, on an honest static maze, never happens. */
export function joinKnown(a: Known, b: Known): Known {
  if (a === b) return a;
  if (a === "unknown") return b;
  if (b === "unknown") return a;
  // Two different, both non-unknown: either one is already conflict, or two
  // incomparable terrains disagree. Both cases are the top.
  return "conflict";
}

/** Is `a ⊑ b` in the terrain lattice? Used to state monotonicity precisely. */
export function leqKnown(a: Known, b: Known): boolean {
  return joinKnown(a, b) === b;
}

// ── The fog map (the captain's whole state) ───────────────────────────────
/** What a single unit perceives in one `look`, stripped to what the fog needs.
 *  Decoupled from world.ts's `Look` on purpose: the fog does not care whose eyes
 *  these are, only what they saw. A call site maps a `Look` into a `Sighting`. */
export type Sighting = {
  readonly at: Pos; // the cell the observer stands on (always floor-or-exit)
  readonly onExit: boolean;
  readonly neighbours: readonly {
    readonly pos: Pos;
    readonly cell: "wall" | "floor" | "exit";
    readonly monster: string | null;
  }[];
};

export type FogMap = {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly (readonly Known[])[]; // [y][x], as in MazeWorld.walls
  readonly monsters: Readonly<Record<string, Pos>>; // id → last-known position
  readonly exitSeen: boolean;
};

/** An all-unknown fog of the given size: the captain's prior, knowing nothing. */
export function emptyFog(width: number, height: number): FogMap {
  const cells: Known[][] = [];
  for (let y = 0; y < height; y++) {
    cells.push(new Array<Known>(width).fill("unknown"));
  }
  return { width, height, cells, monsters: {}, exitSeen: false };
}

function inBounds(fog: FogMap, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < fog.width && p.y < fog.height;
}

/** Set one cell's terrain to the JOIN of its current value and `k` — the only way
 *  terrain ever changes, so the map can only climb the lattice. Out-of-bounds is
 *  ignored (the edge is implicitly wall and carries no information worth storing). */
function learnCell(cells: Known[][], p: Pos, k: Known): void {
  const row = cells[p.y];
  if (!row || p.x < 0 || p.x >= row.length) return;
  row[p.x] = joinKnown(row[p.x], k);
}

function copyCells(fog: FogMap): Known[][] {
  return fog.cells.map((row) => row.slice());
}

// ── mergeSighting: fold one observation into the map ───────────────────────
/** Join a single unit's `look` into the fog. The observer's own cell is floor
 *  (or exit), each neighbour contributes its terrain, and any monster seen is
 *  recorded by id at its position. Monsters are REVISED into the dict, not joined:
 *  a sighting is the freshest truth about where that monster is. */
export function mergeSighting(fog: FogMap, s: Sighting): FogMap {
  const cells = copyCells(fog);
  const monsters: Record<string, Pos> = { ...fog.monsters };

  // Retract any monster recorded at a cell now observed to be empty — occupancy is
  // the one revisable fact (a monster the fighter killed is seen gone on re-look).
  const retractAt = (p: Pos) => {
    for (const [id, pos] of Object.entries(monsters)) {
      if (eq(pos, p)) delete monsters[id];
    }
  };

  // The observer stands on passable ground, and nothing stands on it.
  learnCell(cells, s.at, s.onExit ? "exit" : "floor");
  retractAt(s.at);
  let exitSeen = fog.exitSeen || s.onExit;

  for (const n of s.neighbours) {
    learnCell(cells, n.pos, n.cell);
    if (n.cell === "exit") exitSeen = true;
    if (n.monster) monsters[n.monster] = n.pos;
    else retractAt(n.pos); // observed empty: forget any monster we had there
  }
  return { ...fog, cells, monsters, exitSeen };
}

// ── mergeFog: the amalgamation (the showpiece operation) ───────────────────
/** Join two fog maps cellwise. THIS is the amalgamation the fleet is built to
 *  demonstrate: two partial pictures combine into one that knows everything
 *  either knew. Idempotent, commutative, associative, and monotone — law-tested
 *  in fog_test.ts. Occupancy is unioned (both dicts' knowledge of monster
 *  positions); terrain is joined per cell. Requires equal dimensions. */
export function mergeFog(a: FogMap, b: FogMap): FogMap {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `mergeFog: size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`,
    );
  }
  const cells: Known[][] = [];
  for (let y = 0; y < a.height; y++) {
    const row: Known[] = [];
    for (let x = 0; x < a.width; x++) {
      row.push(joinKnown(a.cells[y][x], b.cells[y][x]));
    }
    cells.push(row);
  }
  return {
    width: a.width,
    height: a.height,
    cells,
    monsters: { ...a.monsters, ...b.monsters },
    exitSeen: a.exitSeen || b.exitSeen,
  };
}

// ── Queries the captain plans on ───────────────────────────────────────────
/** Is this cell passable ground the captain may stand on? Floor or exit — never
 *  wall, never unknown (the captain refuses to step into fog it has not revealed). */
export function knownPassable(fog: FogMap, p: Pos): boolean {
  if (!inBounds(fog, p)) return false;
  const k = fog.cells[p.y][p.x];
  return k === "floor" || k === "exit";
}

/** The frontier: known-passable cells with at least one in-bounds UNKNOWN
 *  neighbour — the edge of the explored region, where sending a scout buys new
 *  knowledge. Returned in a fixed scan order (row-major) for deterministic plans. */
export function frontier(fog: FogMap): Pos[] {
  const out: Pos[] = [];
  const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  for (let y = 0; y < fog.height; y++) {
    for (let x = 0; x < fog.width; x++) {
      if (!knownPassable(fog, { x, y })) continue;
      for (const d of dirs) {
        const q = { x: x + d.x, y: y + d.y };
        if (inBounds(fog, q) && fog.cells[q.y][q.x] === "unknown") {
          out.push({ x, y });
          break;
        }
      }
    }
  }
  return out;
}

/** Any monster the fleet currently believes sits on `p`. The captain routes the
 *  fighter at these; it will not walk the captain through one. */
export function monsterKnownAt(fog: FogMap, p: Pos): string | null {
  for (const [id, pos] of Object.entries(fog.monsters)) {
    if (eq(pos, p)) return id;
  }
  return null;
}

/** Forget a monster the fleet has killed — the one sanctioned retraction. This is
 *  why occupancy is not part of the monotone terrain join: kills revise it. */
export function clearMonster(fog: FogMap, id: string): FogMap {
  if (!(id in fog.monsters)) return fog;
  const monsters = { ...fog.monsters };
  delete monsters[id];
  return { ...fog, monsters };
}

/** Where the fleet has discovered the exit to be, or null if no scout has seen it
 *  yet. The captain cannot plan a route to an exit it has not been told about. */
export function exitCell(fog: FogMap): Pos | null {
  for (let y = 0; y < fog.height; y++) {
    for (let x = 0; x < fog.width; x++) {
      if (fog.cells[y][x] === "exit") return { x, y };
    }
  }
  return null;
}

/** How many cells remain `unknown`. The fog-of-war proof: at the end of a solve
 *  this is still > 0 — the captain reached the exit without ever learning the
 *  whole maze (the dead ends it never needed stay dark). */
export function unknownCount(fog: FogMap): number {
  let n = 0;
  for (const row of fog.cells) for (const k of row) if (k === "unknown") n++;
  return n;
}
