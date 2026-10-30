// fleet-maze-demo.ts — three typed agents solve a maze by DELEGATION and
// AMALGAMATION. The scout (eyes) ranges ahead and reports; the captain (blind to
// the true maze) amalgamates each report into a fog-of-war map and decides; the
// fighter (blind, obedient) is sent to clear whatever blocks the way. The captain
// marches to the exit on ground it only ever saw through the scout.
//
// What this adds over the single-agent maze: real orchestration. The round is
// seqC(scout, fighter) — the scout's report chooses the fighter's order — and the
// merge is a semilattice join (maze/fog.ts, law-tested). The two-layer log and
// reconciliation still hold, now with agent:scout / agent:fighter / agent:captain
// as distinct actors.
//
// It also writes a trace (demo-out/fleet/trace.json) and a human moves.txt, and
// from the trace builds a self-contained replay website (demo-out/fleet/index.html)
// that animates the solve — the true maze with the captain's fog lifting over it.
//
// Deterministic: all seams seeded, so two runs are byte-identical (verify.sh).

import { fogMap, mazeMap } from "./cli/format.ts";
import { run as dungeonRun } from "./cli/dungeon.ts";
import { loadMaze, saveMaze } from "./maze/store.ts";
import { seedFleet } from "./maze/seed.ts";
import type { MazeWorld } from "./maze/types.ts";
import { fixedClock, realClock, realIds, seededIds } from "./log/ids.ts";
import { fileIntentLog } from "./log/intentlog.ts";
import { fileShipLog } from "./log/shiplog.ts";
import { reconcile, reconSummary } from "./log/reconcile.ts";
import type { HarnessCtx } from "./bridge/harness.ts";
import { orchestrateFleet } from "./fleet/fleet-captain.ts";
import { modelScoutBrain, scriptedScoutBrain } from "./fleet/scout.ts";
import { groqClient } from "./agent/groq.ts";
import type { FleetAction } from "./fleet/ops.ts";
import type { FogMap } from "./maze/fog.ts";
import { fogGlyph } from "./cli/format.ts";
import { buildFleetSite } from "./fleet/site.ts";

const p = (s = "") => console.log(s);
const rule = (t: string) => p(`\n${"─".repeat(64)}\n${t}\n${"─".repeat(64)}`);

function freshDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch { /* first run */ }
  Deno.mkdirSync(path, { recursive: true });
}

// --live swaps the scout's BRAIN from the deterministic BFS to a free model that
// chooses which branch to explore at each junction. The fighter stays mechanical
// (it only follows the captain's path and strikes) and the captain stays the
// deterministic orchestrator (PLAN decision 4) — the scout is where judgement helps.
// On a live run the id/clock seams are the REAL ones (not seeded): a live run's
// audit must carry true timestamps, never the demo's fixed stand-ins (starship PR #1).
const live = Deno.args.includes("--live");
const scoutBrain = live ? modelScoutBrain(groqClient()) : scriptedScoutBrain();

// ── the rig: the dungeon CLI over files in `dir`, a harness over it ─────────
const dir = "demo-out/fleet";
freshDir(dir);
const wp = `${dir}/maze.json`;
const lp = `${dir}/dungeon-log.jsonl`;
const ip = `${dir}/intent-log.jsonl`;
const world0 = seedFleet();
saveMaze(wp, world0);

const conIds = live ? realIds() : seededIds("dungeon");
const conClock = live ? realClock() : fixedClock();
const ctx: HarnessCtx = {
  ids: live ? realIds() : seededIds("agent"),
  clock: live ? realClock() : fixedClock(),
  intentLog: fileIntentLog(ip),
  sessionId: "FLEET",
  conRun: (argv) => dungeonRun([...argv, "--world", wp, "--log", lp], conIds, conClock),
};

// ── the trace the website replays ───────────────────────────────────────────
type Frame = {
  i: number;
  actor: string;
  action: string;
  detail: string;
  reason: string;
  ok: boolean;
  corr: string;
  units: { id: string; x: number; y: number; hp: number }[];
  monsters: { id: string; x: number; y: number; hp: number }[];
  fog: string[]; // captain's fog, one row per line (' ' unknown, . floor, # wall, X exit)
  unknown: number;
};
const frames: Frame[] = [];
const moves: string[] = []; // the human-readable moves.txt

function fogRows(fog: FogMap): string[] {
  return fog.cells.map((row) => row.map(fogGlyph).join(""));
}
function unknownOf(fog: FogMap): number {
  let n = 0;
  for (const row of fog.cells) for (const k of row) if (k === "unknown") n++;
  return n;
}

const sink = (a: FleetAction, fog: FogMap) => {
  const w = loadMaze(wp);
  const frame: Frame = {
    i: frames.length,
    actor: a.actor,
    action: a.action,
    detail: a.detail ?? "",
    reason: a.reason ?? "",
    ok: a.ok ?? true,
    corr: a.corr ?? "",
    units: w.units.map((u) => ({ id: u.id, x: u.pos.x, y: u.pos.y, hp: u.hp })),
    monsters: w.monsters.map((m) => ({ id: m.id, x: m.pos.x, y: m.pos.y, hp: m.hp })),
    fog: fogRows(fog),
    unknown: unknownOf(fog),
  };
  frames.push(frame);

  // console: one line per committed action or structural note
  const detail = a.detail ?? "";
  const reason = a.reason ?? "";
  if (a.action === "move" || a.action === "attack") {
    const mark = a.ok ? "·" : "✗";
    p(`  ${mark} ${a.actor.padEnd(8)} ${a.action.padEnd(6)} ${detail.padEnd(9)} — ${reason}`);
    moves.push(`${a.actor} ${a.action} ${detail}${a.ok ? "" : " (refused)"} :: ${reason}`);
  } else if (a.action === "merge") {
    p(`    ⊕ captain ${detail}`);
    moves.push(`captain merge ${detail}`);
  } else if (a.action === "phase") {
    rule(`PHASE: ${detail} — ${reason}`);
    moves.push(`--- phase: ${detail} ---`);
  } else if (a.action === "note" || a.action === "done") {
    p(`    » ${detail}`);
    moves.push(`# ${detail}`);
  }
};

// ══ 1. The captain's blank map ════════════════════════════════════════════
rule("THE FLEET — a scout, a fighter, and a blind captain");
p(`  scout brain: ${scoutBrain.name}${live ? " (live model)" : " (scripted, deterministic)"}`);
p("The captain cannot see the maze. Its whole knowledge starts empty:");
p("");
// an all-unknown fog, the same size as the world, with the three units stacked
p(fogMap(
  { width: world0.width, height: world0.height, cells: world0.walls.map((r) => r.split("").map(() => "unknown" as const)), monsters: {}, exitSeen: false },
  world0.units,
));

// ══ 2. The solve ════════════════════════════════════════════════════════════
const result = await orchestrateFleet({
  ctx,
  width: world0.width,
  height: world0.height,
  captainStart: world0.units.find((u) => u.id === "captain")!.pos,
  scout: { speed: world0.units.find((u) => u.id === "scout")!.speed },
  fighter: {
    start: world0.units.find((u) => u.id === "fighter")!.pos,
    hp: world0.units.find((u) => u.id === "fighter")!.hp,
  },
  scoutBrain,
  sink,
});

// ══ 3. What the captain ended up knowing (still partial) ════════════════════
rule("The captain's final map — note how much is STILL DARK");
p(fogMap(result.finalFog, [{ id: "captain", pos: result.captainPos }]));
p("");
p(
  `  result: ${result.solved ? "CAPTAIN REACHED THE EXIT" : "did not finish"} in ${result.rounds} rounds` +
    ` — scout ${result.scoutMoves} moves, fighter ${result.fighterMoves} moves + ${result.kills} kills,` +
    ` captain ${result.captainMoves} moves.`,
);
p(`  ${result.unknownAtEnd} of ${world0.width * world0.height} cells were NEVER revealed to the captain.`);

// ══ 4. The true maze — what the captain never saw ═══════════════════════════
rule("The TRUE maze (shown only now — the captain never had this)");
p(mazeMap(loadMaze(wp)));

// ══ 5. The two logs + reconciliation ════════════════════════════════════════
rule("Reconciliation — the two logs audit each other, across three agents");
const rec = reconcile(fileShipLog(lp), ctx.intentLog);
p(`  ${reconSummary(rec)}`);
for (const a of rec.alarms) {
  if (a.kind === "write-without-reason") {
    p(`    ALARM: ${a.entry.command} committed (corr ${a.entry.correlation_id}) with NO logged reason`);
  }
}
p("");
p("  Every move and attack by scout, fighter, and captain carries a reason in");
p("  Layer 2 and a committed effect in Layer 1 — joined by correlation id. The");
p("  captain moved the world only through reasoned, logged orders, and only ever");
p("  on ground a scout had revealed.");

// ══ 6. Write the trace + the replay website ═════════════════════════════════
const trace = {
  maze: {
    width: world0.width,
    height: world0.height,
    walls: world0.walls,
    exit: world0.exit,
    start: world0.units.find((u) => u.id === "captain")!.pos,
  },
  frames,
  summary: {
    solved: result.solved,
    rounds: result.rounds,
    scoutMoves: result.scoutMoves,
    fighterMoves: result.fighterMoves,
    captainMoves: result.captainMoves,
    kills: result.kills,
    unknownAtEnd: result.unknownAtEnd,
  },
};
Deno.writeTextFileSync(`${dir}/trace.json`, JSON.stringify(trace, null, 2) + "\n");
Deno.writeTextFileSync(`${dir}/moves.txt`, moves.join("\n") + "\n");
buildFleetSite(trace, `${dir}/index.html`);

rule("Artifacts");
p(`  ${dir}/moves.txt     — the moves, as plain text`);
p(`  ${dir}/trace.json    — the full trace (truth + the captain's fog per frame)`);
p(`  ${dir}/index.html    — a self-contained replay website; open it in a browser`);
p("");
