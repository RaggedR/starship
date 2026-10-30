// genmaze.ts — the swarm maze as a PURE FUNCTION of two carve seeds.
//
// Extracted from scratchpad/genmaze-swarm-lobes.ts (which freezes one maze into the
// seedSwarm() literal at build time). This is the same construction, but parameterised
// on its two lobe seeds and returning a MazeWorld directly — so the browser can mint a
// BRAND-NEW random maze on every click (PLAN-browser-maze.md §3), while the committed
// seed.ts literal stays the frozen featured maze.
//
// The story is guaranteed by construction, not by search (see the scratchpad header):
//   • GUARANTEE — both gates sit at the ends of two IDENTICAL straight necks of equal
//     length, so a scout reaches each after the same distance ⟹ both found on the same
//     tick ⟹ both fighters dispatched at once. A property of the NECKS, seed-independent.
//   • VARIETY — each lobe body is its own perfect maze carved from a DIFFERENT seed, so
//     the two halves differ; under fog they are indistinguishable (two identical gate
//     mouths), so the captain cannot tell which half hides the exit and must open BOTH.
//   • TREE — the whole maze is a tree, so each gate seals its ENTIRE lobe (no way
//     around): clearing both is necessary, not optional.
//
// Pure: no console, no Deno, no ambient RNG — the only entropy is the two seeds the
// caller passes. Same seeds ⟹ same maze, so genSwarmMaze(FROZEN_R, FROZEN_L) reproduces
// the committed seedSwarm() literal exactly (asserted in genmaze_test.ts).

import type { MazeWorld, Pos } from "../maze/types.ts";

// ── dials (match the committed seedSwarm literal) ──────────────────────────────
const HC = 12; // logical columns per lobe side (centre col is index HC)
const RC = 17; // logical rows (full height)
const NECK = 1; // gate sits one logical step out of the start, equal both sides
const TARGET = 75; // grid-cell depth to aim the exit at (tuned for a watchable ~half-lit solve)
const SCOUT_SPEED = 5; // per-dispatch range for the scout unit records

/** The two frozen seeds the committed seedSwarm() literal was carved from. The browser
 *  passes random seeds instead; these are only the default so genSwarmMaze() with no
 *  args reproduces the featured maze. */
export const FROZEN_SEED_R = 0x5eed1234;
export const FROZEN_SEED_L = 0x5eed9abc;

const LCOLS = 2 * HC + 1;
const GW = 2 * LCOLS + 1;
const GH = 2 * RC + 1;
const CENTRE = HC;
const MIDROW = Math.floor(RC / 2);

const gx = (i: number) => 2 * i + 1;
const gy = (j: number) => 2 * j + 1;

const DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
type Edge = string; // canonical "i,j|i2,j2" with the lexicographically-smaller cell first
const edgeKey = (ax: number, ay: number, bx: number, by: number): Edge =>
  ax < bx || (ax === bx && ay <= by) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;

/** A seeded PRNG (mulberry32): fixed seed ⟹ fixed, reproducible stream (byte-identical
 *  replay) — but APERIODIC, so the carve looks organically random, not a tiled
 *  arithmetic pattern. Math.random would look right and break determinism; this gives
 *  both random-LOOKING and reproducible. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Fisher–Yates shuffle of the four directions, drawn from `rng`. */
function shuffle4(rng: () => number): number[] {
  const a = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Recursive backtracker over cols [colLo..colHi] × rows [0..RC-1], rooted at
 *  (rootCol, MIDROW). The neighbour order at each cell is a shuffle drawn from `rng`;
 *  otherwise deterministic, so a fixed-seed rng ⟹ a fixed maze. */
function carveBody(
  colLo: number,
  colHi: number,
  rootCol: number,
  rng: () => number,
  into: Set<Edge>,
): void {
  const inBand = (cx: number, cy: number) => cx >= colLo && cx <= colHi && cy >= 0 && cy < RC;
  const visited = new Set<string>();
  const vk = (cx: number, cy: number) => `${cx},${cy}`;
  const stack: Pos[] = [{ x: rootCol, y: MIDROW }];
  visited.add(vk(rootCol, MIDROW));
  while (stack.length) {
    const { x: cx, y: cy } = stack[stack.length - 1];
    let advanced = false;
    for (const di of shuffle4(rng)) {
      const d = DIRS[di];
      const nx = cx + d.dx, ny = cy + d.dy;
      if (!inBand(nx, ny) || visited.has(vk(nx, ny))) continue;
      into.add(edgeKey(cx, cy, nx, ny));
      visited.add(vk(nx, ny));
      stack.push({ x: nx, y: ny });
      advanced = true;
      break;
    }
    if (!advanced) stack.pop();
  }
}

/** Carve a brand-new swarm maze from two lobe seeds, returning a ready-to-play
 *  MazeWorld (eight units stacked at the centre, five monsters, an exit deep in the
 *  right lobe). Pure and deterministic in (seedR, seedL). */
export function genSwarmMaze(
  seedR: number = FROZEN_SEED_R,
  seedL: number = FROZEN_SEED_L,
): MazeWorld {
  const rngRight = mulberry32(seedR);
  const rngLeft = mulberry32(seedL);

  // ── build the whole maze as one edge set ─────────────────────────────────────
  const edges = new Set<Edge>();
  // Right lobe: straight neck from the centre to the gate col, then a body carve.
  const rGate = CENTRE + NECK;
  for (let i = CENTRE; i < rGate; i++) edges.add(edgeKey(i, MIDROW, i + 1, MIDROW));
  carveBody(rGate, LCOLS - 1, rGate, rngRight, edges);
  // Left lobe: mirror-position neck (equal length ⟹ equal gate depth), independent carve.
  const lGate = CENTRE - NECK;
  for (let i = CENTRE; i > lGate; i--) edges.add(edgeKey(i, MIDROW, i - 1, MIDROW));
  carveBody(0, lGate, lGate, rngLeft, edges);

  // ── render edges → wall grid ─────────────────────────────────────────────────
  const grid: boolean[][] = Array.from({ length: GH }, () => new Array<boolean>(GW).fill(true));
  const openCell = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < GW && y < GH) grid[y][x] = false;
  };
  for (const e of edges) {
    const [a, b] = e.split("|");
    const [ax, ay] = a.split(",").map(Number);
    const [bx, by] = b.split(",").map(Number);
    openCell(gx(ax), gy(ay));
    openCell(gx(bx), gy(by));
    openCell((gx(ax) + gx(bx)) / 2, (gy(ay) + gy(by)) / 2);
  }
  openCell(gx(CENTRE), gy(MIDROW));

  const walls = grid.map((row) => row.map((w) => (w ? "#" : ".")).join(""));

  // ── tree analysis on the rendered grid (exit / orc / goblin placement) ─────────
  const start: Pos = { x: gx(CENTRE), y: gy(MIDROW) };
  const pk = (p: Pos) => `${p.x},${p.y}`;
  const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < GW && y < GH && !grid[y][x];
  const parent = new Map<string, string | null>();
  const dist = new Map<string, number>();
  const bfsOrder: Pos[] = [];
  {
    const q: Pos[] = [start];
    parent.set(pk(start), null);
    dist.set(pk(start), 0);
    while (q.length) {
      const p = q.shift()!;
      bfsOrder.push(p);
      for (const d of DIRS) {
        const n = { x: p.x + d.dx, y: p.y + d.dy };
        if (!isFloor(n.x, n.y) || parent.has(pk(n))) continue;
        parent.set(pk(n), pk(p));
        dist.set(pk(n), dist.get(pk(p))! + 1);
        q.push(n);
      }
    }
  }
  const children = new Map<string, Pos[]>();
  for (const p of bfsOrder) children.set(pk(p), []);
  for (const p of bfsOrder) {
    const par = parent.get(pk(p));
    if (par) children.get(par)!.push(p);
  }
  const subtree = (root: Pos): Pos[] => {
    const out: Pos[] = [];
    const stk = [root];
    while (stk.length) {
      const p = stk.pop()!;
      out.push(p);
      for (const c of children.get(pk(p))!) stk.push(c);
    }
    return out;
  };
  const isLogical = (p: Pos) => p.x % 2 === 1 && p.y % 2 === 1;
  const degree = (p: Pos) => DIRS.filter((d) => isFloor(p.x + d.dx, p.y + d.dy)).length;
  const isLeaf = (p: Pos) => isLogical(p) && degree(p) === 1;

  // the two gates, by construction: the body-root cells
  const gateRight: Pos = { x: gx(rGate), y: gy(MIDROW) };
  const gateLeft: Pos = { x: gx(lGate), y: gy(MIDROW) };

  // EXIT: the cell in the RIGHT lobe whose depth is closest to TARGET — a long winding
  // march across the lobe, so the replay shows real exploration against the dark decoy.
  const rightCells = subtree(gateRight);
  const rightLogical = rightCells.filter(isLogical);
  let exit = rightLogical[0];
  for (const c of rightLogical) {
    if (Math.abs(dist.get(pk(c))! - TARGET) < Math.abs(dist.get(pk(exit))! - TARGET)) exit = c;
  }
  // the start→exit path, and a deeper monster (orc) 70% along it, past the gate
  const exitPath: Pos[] = [];
  {
    let cur: string | null = pk(exit);
    while (cur) {
      const [x, y] = cur.split(",").map(Number);
      exitPath.unshift({ x, y });
      cur = parent.get(cur)!;
    }
  }
  const orc = exitPath[Math.floor(exitPath.length * 0.7)];

  // DECOY monsters: the two deepest dead ends in the LEFT lobe (behind gateLeft)
  const leftCells = subtree(gateLeft);
  const leftLeaves = leftCells.filter(isLeaf).filter((c) => pk(c) !== pk(gateLeft));
  leftLeaves.sort((a, b) => dist.get(pk(b))! - dist.get(pk(a))!);
  const goblins = leftLeaves.slice(0, 2);

  return {
    width: GW,
    height: GH,
    walls,
    units: [
      { id: "scout-1", pos: start, hp: 10, atk: 1, speed: SCOUT_SPEED },
      { id: "scout-2", pos: start, hp: 10, atk: 1, speed: SCOUT_SPEED },
      { id: "scout-3", pos: start, hp: 10, atk: 1, speed: SCOUT_SPEED },
      { id: "scout-4", pos: start, hp: 10, atk: 1, speed: SCOUT_SPEED },
      { id: "scout-5", pos: start, hp: 10, atk: 1, speed: SCOUT_SPEED },
      { id: "fighter-1", pos: start, hp: 20, atk: 3, speed: 1 },
      { id: "fighter-2", pos: start, hp: 20, atk: 3, speed: 1 },
      { id: "captain", pos: start, hp: 10, atk: 0, speed: 1 },
    ],
    monsters: [
      { id: "ogre-1", pos: gateRight, hp: 5, atk: 2 }, // exit-half gate
      { id: "ogre-2", pos: gateLeft, hp: 5, atk: 2 }, // decoy-half gate
      { id: "orc-1", pos: orc, hp: 5, atk: 2 }, // exit route, past ogre-1
      { id: "goblin-1", pos: goblins[0], hp: 3, atk: 1 }, // deep in decoy
      { id: "goblin-2", pos: goblins[1], hp: 3, atk: 1 }, // deep in decoy
    ],
    exit,
  };
}
