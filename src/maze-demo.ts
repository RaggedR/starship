// maze-demo.ts — a real agent SOLVING a problem: navigate a maze, fight the
// monsters on the way, reach the exit. The whole showpiece in one run.
//
// By default the agent is a deterministic BFS solver (scripted.ts) — no API key,
// and two runs produce byte-identical output (verify.sh checks this). With
// `--live` and a GROQ_API_KEY it is a real, FREE model (Groq) driving the exact
// same loop through the exact same reason-gate. Either way:
//
//   - every move and attack lands in the ship's log WITH a reason in the intent-log,
//     so the two logs together ARE the solution trace (what was done, and why);
//   - an illegal order (a step into a wall) is refused and visible only in Layer 2;
//   - reconciliation proves no change to the maze happened without a logged reason.

import { mazeMap } from "./cli/format.ts";
import { run as dungeonRun } from "./cli/dungeon.ts";
import { loadMaze, saveMaze } from "./maze/store.ts";
import { seedMaze } from "./maze/seed.ts";
import { fixedClock, seededIds } from "./log/ids.ts";
import { fileIntentLog } from "./log/intentlog.ts";
import { fileShipLog } from "./log/shiplog.ts";
import { reconcile, reconSummary } from "./log/reconcile.ts";
import { type HarnessCtx, runMutation } from "./bridge/harness.ts";
import { adventurerRegistry, runMaze } from "./agent/loop.ts";
import { scriptedClient } from "./agent/scripted.ts";
import { groqClient } from "./agent/groq.ts";

const p = (s = "") => console.log(s);
const rule = (t: string) => p(`\n${"─".repeat(64)}\n${t}\n${"─".repeat(64)}`);

function freshDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch { /* first run */ }
  Deno.mkdirSync(path, { recursive: true });
}

/** A rig: the dungeon CLI over files in `dir`, a harness over it, all seams seeded
 *  so the scripted run replays byte-identically (mirrors rig() in demo.ts). */
function rig(dir: string) {
  freshDir(dir);
  const wp = `${dir}/maze.json`;
  const lp = `${dir}/dungeon-log.jsonl`;
  const ip = `${dir}/intent-log.jsonl`;
  saveMaze(wp, seedMaze());
  const conIds = seededIds("dungeon");
  const conClock = fixedClock();
  const conRun = (argv: string[]) =>
    dungeonRun([...argv, "--world", wp, "--log", lp], conIds, conClock);
  const ctx: HarnessCtx = {
    ids: seededIds("agent"),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "MAZE",
    conRun,
  };
  return { ctx, wp, lp, ip, conRun };
}

const live = Deno.args.includes("--live");

// ══ 1. The maze ═══════════════════════════════════════════════════════
rule("MAZE — an adventurer, two monsters, one exit");
const { ctx, wp, lp } = rig("maze-out/run");
p(mazeMap(loadMaze(wp)));

// ══ 2. The agent solves it (perceive → reason → act, in a real loop) ═══
const client = live ? groqClient() : scriptedClient(wp);
rule(`The agent solves the maze — model: ${client.name}`);

const reg = adventurerRegistry();
let n = 0;
const result = await runMaze({
  ctx,
  reg,
  client,
  worldPath: wp,
  onEvent: (e) => {
    if (e.kind === "say") {
      if (live && e.text) p(`  adventurer> ${e.text}`);
      return;
    }
    const c = e.call;
    const detail = c.name === "move"
      ? `${c.input.dir}`
      : c.name === "attack"
      ? `${c.input.target}`
      : "";
    const reason = typeof c.input.reason === "string" ? c.input.reason : "";
    if (c.name === "move" || c.name === "attack") {
      n++;
      let corr = "";
      if (!e.result.isError) {
        try {
          corr = ` (corr ${JSON.parse(e.result.content).correlation_id})`;
        } catch { /* leave blank */ }
      }
      const outcome = e.result.isError
        ? `refused: ${e.result.content}`
        : `committed${corr}`;
      p(`  ${String(n).padStart(2)}. ${c.name.padEnd(6)} ${
        detail.padEnd(9)
      } — "${reason}"`);
      p(`      → ${outcome}`);
    } else {
      p(`  —   ${c.name} (read) → ${e.result.isError ? "error" : "ok"}`);
    }
  },
});

p("");
p(
  `  result: ${
    result.solved ? "REACHED THE EXIT" : result.dead ? "died" : "did not finish"
  }` +
    ` — ${result.steps} actions over ${result.turns} model turns, hero hp ${result.heroHp}`,
);

rule("The maze after the run");
p(mazeMap(loadMaze(wp)));

// ══ 3. An illegal order — refused, and indistinguishable from a wall ═══
rule("An illegal order: a step with a reason, but into a wall");
const bad = runMutation(
  ctx,
  reg,
  "move",
  ["move", "--dir", "N"],
  { dir: "N" },
  "try to leave through the north wall",
);
p(`  Order → move N (a wall is there):`);
p(`    ${bad.ok ? "committed" : `refused: ${bad.reason}`}`);
p(`  A refused move and a wall feel the same from inside (MacBeth §5) — and this`);
p(`  attempt is recorded in Layer 2 only; it never touched the ship's log.`);

// ══ 4. The two logs ═══════════════════════════════════════════════════
rule("Layer 1 — the ship's log (WHAT committed, no reason)");
const slog = fileShipLog(lp);
for (const e of slog.all()) {
  const eff = e.effect as { tag: string; dir?: string; targetId?: string };
  const what = eff.tag === "move" ? `move ${eff.dir}` : `attack ${eff.targetId}`;
  p(`  ${e.ts}  ${what.padEnd(16)}  corr ${e.correlation_id}`);
}
rule("Layer 2 — the intent-log (WHY, and what was only attempted/refused)");
for (const r of ctx.intentLog.all()) {
  const why = r.mutates ? `"${r.reason}"` : "(read)";
  p(`  ${r.ts}  ${r.agent_id.padEnd(16)} ${r.tool.padEnd(7)} ${
    r.status.padEnd(9)
  } ${why}`);
}

// ══ 5. Reconciliation ═════════════════════════════════════════════════
rule("Reconciliation — the two logs audit each other");
const rec = reconcile(slog, ctx.intentLog);
p(`  ${reconSummary(rec)}`);
for (const b of rec.blocked) {
  p(`    blocked:  ${b.tool} — "${b.reason}" (refused; visible only in Layer 2)`);
}
for (const a of rec.alarms) {
  if (a.kind === "write-without-reason") {
    p(`    ALARM: ${a.entry.command} committed (corr ${a.entry.correlation_id}) with NO logged reason`);
  }
}
p("");
p(`  The ship's log is the trace of WHAT the agent did; the intent-log is WHY.`);
p(`  Together they are the solution — and reconciliation proves the agent never`);
p(`  moved the maze except through a reasoned, logged order.`);
p("");
