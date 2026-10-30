// genmaze-swarm2.ts — a maze designed so BOTH fighters must work, in parallel.
//
// The first maze's monsters sat on one linear corridor, so they surfaced one at a
// time and a single fighter cleared them all. This generator instead finds an early
// FORK into two large regions and gates each with a monster, hiding the exit deep
// behind one. Because the captain cannot tell from fog which region holds the exit,
// it must clear BOTH gates — one fighter each, concurrently — which is the "which
// fighter to which monster" decision the swarm exists to show. Deterministic: fixed
// carve order and fixed placement, no RNG.

const C = 16, R = 11, GW = 2 * C + 1, GH = 2 * R + 1;
const DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
const gx = (cx: number) => 2 * cx + 1, gy = (cy: number) => 2 * cy + 1;

// ---- carve a perfect maze (recursive backtracker, deterministic) -----------
const grid: boolean[][] = Array.from({ length: GH }, () => new Array(GW).fill(true));
const order = (cx: number, cy: number) => {
  const base = (cx * 23 + cy * 19 + 0) % 4;
  return [0, 1, 2, 3].map((i) => (i + base) % 4);
};
{
  const visited = new Set<string>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const stack = [{ cx: 0, cy: 0 }];
  visited.add(key(0, 0));
  grid[gy(0)][gx(0)] = false;
  while (stack.length) {
    const { cx, cy } = stack[stack.length - 1];
    let adv = false;
    for (const di of order(cx, cy)) {
      const d = DIRS[di];
      const nx = cx + d.dx, ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= C || ny >= R || visited.has(key(nx, ny))) continue;
      grid[gy(cy) + d.dy][gx(cx) + d.dx] = false;
      grid[gy(ny)][gx(nx)] = false;
      visited.add(key(nx, ny));
      stack.push({ cx: nx, cy: ny });
      adv = true;
      break;
    }
    if (!adv) stack.pop();
  }
}
const walls = grid.map((row) => row.map((w) => (w ? "#" : ".")).join(""));

// ---- tree analysis over the floor graph, rooted at the start --------------
type Pos = { x: number; y: number };
const pk = (p: Pos) => `${p.x},${p.y}`;
const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < GW && y < GH && !grid[y][x];
// Start the agents in the CENTRE: a central cell has up to four tree-children, so the
// swarm fans out in several directions at once and the start itself is the fork.
const start: Pos = { x: gx(Math.floor(C / 2)), y: gy(Math.floor(R / 2)) };

const parent = new Map<string, string | null>();
const dist = new Map<string, number>();
const orderCells: Pos[] = []; // BFS order
{
  const q: Pos[] = [start];
  parent.set(pk(start), null);
  dist.set(pk(start), 0);
  while (q.length) {
    const p = q.shift()!;
    orderCells.push(p);
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
for (const p of orderCells) children.set(pk(p), []);
for (const p of orderCells) {
  const par = parent.get(pk(p));
  if (par) children.get(par)!.push(p);
}
// subtree sizes: process in reverse BFS (leaves first)
const size = new Map<string, number>();
for (let i = orderCells.length - 1; i >= 0; i--) {
  const p = orderCells[i];
  let s = 1;
  for (const c of children.get(pk(p))!) s += size.get(pk(c))!;
  size.set(pk(p), s);
}
const subtreeCells = (rootCell: Pos): Pos[] => {
  const out: Pos[] = [];
  const stk = [rootCell];
  while (stk.length) {
    const p = stk.pop()!;
    out.push(p);
    for (const c of children.get(pk(p))!) stk.push(c);
  }
  return out;
};

// ---- find the earliest fork into two large regions ------------------------
let fork: Pos | null = null;
let gateChildren: Pos[] = [];
for (const S of [40, 32, 24, 18, 12]) { // relax the "large region" bar until a fork is found
  for (const p of orderCells) { // BFS order = nearest-first
    const big = children.get(pk(p))!.filter((c) => size.get(pk(c))! >= S);
    if (big.length >= 2) {
      big.sort((a, b) => size.get(pk(b))! - size.get(pk(a))!);
      fork = p;
      gateChildren = big.slice(0, 2);
      break;
    }
  }
  if (fork) break;
}
if (!fork) throw new Error("no fork with two large regions — try another carve order");

// The maze splits into two halves at the fork: one holds the exit, one is a decoy.
const exitSide = gateChildren[0]; // larger half — the exit lives in here
const decoySide = gateChildren[1]; // the other large half — a dead end, but the captain can't know that

// Exit: a leaf in the exit-side half at a MODERATE depth (a far-corner exit makes
// the march tediously long), so pick the leaf whose depth is closest to the target.
const TARGET = 44; // grid cells deep (~22 cell-moves) — shallow enough that the exit is
// found before the captain must reveal most of both halves, keeping the fog partial.
const exitLeaves = subtreeCells(exitSide).filter((c) => children.get(pk(c))!.length === 0);
let exit = exitLeaves[0];
for (const c of exitLeaves) {
  if (Math.abs(dist.get(pk(c))! - TARGET) < Math.abs(dist.get(pk(exit))! - TARGET)) exit = c;
}

// the start→exit path
const exitPath: Pos[] = [];
{
  let cur: string | null = pk(exit);
  while (cur) {
    const [x, y] = cur.split(",").map(Number);
    exitPath.unshift({ x, y });
    cur = parent.get(cur)!;
  }
}

// Place the gates a few cells INTO each half (not on the start's doorstep), at a
// similar depth so both are discovered around the same time and both fighters are
// dispatched together. Gate A sits on the exit route; gate B gates the decoy half.
const GATE_DEPTH = 6;
const gateA = exitPath.find((c) => dist.get(pk(c))! >= GATE_DEPTH) ?? exitSide;
let gbCur = decoySide;
while (dist.get(pk(gbCur))! < GATE_DEPTH) {
  const ch = [...children.get(pk(gbCur))!].sort((a, b) => size.get(pk(b))! - size.get(pk(a))!);
  if (ch.length === 0) break;
  gbCur = ch[0]; // follow the largest child, so a big region stays behind the gate
}
const gateB = gbCur;

// a deeper monster on the exit route, past gate A (sequential work after the gates)
const deeper = exitPath[Math.floor(exitPath.length * 0.75)];

// dead-end monsters: deep leaves in the DECOY half (ignorable once the exit is found)
const deadEndPool = subtreeCells(decoySide).filter((c) =>
  children.get(pk(c))!.length === 0 && pk(c) !== pk(gateB) && dist.get(pk(c))! >= GATE_DEPTH + 4
);
deadEndPool.sort((a, b) => dist.get(pk(b))! - dist.get(pk(a))!);
const deadEnds = deadEndPool.slice(0, 2);

// aliases for the report below
const exitGate = gateA, decoyGate = gateB;

// ---- report ----------------------------------------------------------------
const d = (p: Pos) => dist.get(pk(p))!;
console.log(`fork @${pk(fork)} (d=${d(fork)})  gateA(exit) @${pk(exitGate)} size=${size.get(pk(exitGate))}  gateB(decoy) @${pk(decoyGate)} size=${size.get(pk(decoyGate))}`);
console.log(`exit @${pk(exit)} (d=${d(exit)})  deeper @${pk(deeper)} (d=${d(deeper)})`);
console.log(`gate distances: A=${d(exitGate)} B=${d(decoyGate)}  dead-ends: ${deadEnds.map(d).join(",")}  (gates should be NEARER than dead-ends)`);
console.log("walls: [");
for (const row of walls) console.log(`  ${JSON.stringify(row)},`);
console.log("]");
console.log("start:", JSON.stringify(start), "exit:", JSON.stringify(exit));
console.log("GATE monsters (both must be cleared to find the exit):", JSON.stringify(exitGate), JSON.stringify(decoyGate));
console.log("DEEPER monster (exit route):", JSON.stringify(deeper));
console.log("DEAD-END monsters (ignorable):", deadEnds.map((p) => JSON.stringify(p)).join(" "));

const vis = walls.map((r) => r.split(""));
vis[start.y][start.x] = "@";
vis[exit.y][exit.x] = "X";
vis[fork.y][fork.x] = "+";
vis[exitGate.y][exitGate.x] = "A";
vis[decoyGate.y][decoyGate.x] = "B";
vis[deeper.y][deeper.x] = "3";
deadEnds.forEach((p) => (vis[p.y][p.x] = "d"));
console.log(vis.map((r) => r.join("")).join("\n"));
