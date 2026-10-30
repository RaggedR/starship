// app.ts — the browser entry for the "🎲 New random maze" button (PLAN-browser-maze.md
// steps 3/5). Bundled to web/app.js and loaded as a sibling script by the swarm replay
// page; it attaches one function to the window:
//
//   runNewMaze(seed) : Promise<SwarmTrace>
//
// which mints a brand-new random maze, solves it with the DETERMINISTIC scripted greedy
// captain, and returns the same SwarmTrace shape the page already animates. The LLM
// captain cannot run client-side (it needs the Groq key), so the button is the keyless
// "explore the space yourself" toy; the page's featured default trace stays the
// pre-recorded live-model run (PLAN §2).
//
// Everything here is PURE browser-safe logic: the pure maze generator, the in-memory
// conRun (no filesystem), an in-memory intent-log, and the real scheduler. No Deno.*,
// no network — verified by `grep -c 'Deno\.' web/app.js` → 0 and a zero-request click.

import { genSwarmMaze } from "../src/swarm/genmaze.ts";
import { memoryCon } from "../src/swarm/memory-con.ts";
import { memIntentLog } from "../src/log/intentlog.ts";
import { fixedClock, seededIds } from "../src/log/ids.ts";
import { orchestrateSwarm } from "../src/swarm/scheduler.ts";
import { type CaptainBrain, scriptedCaptainBrain } from "../src/swarm/captain.ts";
import { modelCaptainBrain } from "../src/swarm/model-captain.ts";
import { makeGroqClient } from "../src/agent/groq.ts";
import { fogGlyph } from "../src/cli/format.ts";
import type { HarnessCtx } from "../src/bridge/harness.ts";
import type { FleetAction } from "../src/fleet/ops.ts";
import type { FogMap } from "../src/maze/fog.ts";
import type { MazeWorld } from "../src/maze/types.ts";
import type { SwarmTrace } from "../src/swarm/site.ts";

// Keep button runs near the watchable sweet spot. Every seed SOLVES (the construction
// guarantees it) but unlucky carves run long — ~2.5 MB / 20k-frame instead of the good
// ~1.3 MB / ~2k. So we reject-and-reseed past this tick budget, keeping the best solve
// seen if none comes in under it. Maze SIZE stays fixed (PLAN §6); only the seed varies.
const TICK_BUDGET = 110;
const MAX_ATTEMPTS = 8;

/** Solve one concrete world with the scripted captain, building the exact SwarmTrace the
 *  page animates — reading unit/monster positions from the in-memory world each frame
 *  (the Deno demo reloads a JSON file here; the browser has none). */
async function solveToTrace(world0: MazeWorld, brain: CaptainBrain): Promise<SwarmTrace> {
  const mc = memoryCon(world0);
  const ctx: HarnessCtx = {
    ids: seededIds("agent"),
    clock: fixedClock(),
    intentLog: memIntentLog(),
    sessionId: "BROWSER",
    conRun: mc.conRun,
  };

  type Frame = SwarmTrace["frames"][number];
  const frames: Frame[] = [];
  let lastFogStr = " ";
  const fogRows = (fog: FogMap): string[] => fog.cells.map((row) => row.map(fogGlyph).join(""));
  const unknownOf = (fog: FogMap): number => {
    let n = 0;
    for (const row of fog.cells) for (const k of row) if (k === "unknown") n++;
    return n;
  };
  const sink = (a: FleetAction, fog: FogMap) => {
    const w = mc.current();
    const rows = fogRows(fog);
    const fogStr = rows.join("\n");
    const changed = fogStr !== lastFogStr;
    if (changed) lastFogStr = fogStr;
    frames.push({
      i: frames.length,
      actor: a.actor,
      action: a.action,
      detail: a.detail ?? "",
      reason: a.reason ?? "",
      ok: a.ok ?? true,
      corr: a.corr ?? "",
      units: w.units.map((u) => ({ id: u.id, x: u.pos.x, y: u.pos.y, hp: u.hp })),
      monsters: w.monsters.map((m) => ({ id: m.id, x: m.pos.x, y: m.pos.y, hp: m.hp })),
      fog: changed ? rows : null,
      unknown: unknownOf(fog),
    });
  };

  const result = await orchestrateSwarm({
    ctx,
    width: world0.width,
    height: world0.height,
    units: world0.units.map((u) => ({ id: u.id, pos: u.pos, hp: u.hp, speed: u.speed })),
    brain,
    sink,
  });

  return {
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
      ticks: result.ticks,
      scoutMoves: result.scoutMoves,
      fighterMoves: result.fighterMoves,
      captainMoves: result.captainMoves,
      kills: result.kills,
      unknownAtEnd: result.unknownAtEnd,
      captain: brain.name,
    },
  };
}

/** Mint a new random maze from `seed` and solve it, rejecting-and-reseeding past the
 *  tick budget so the animation stays watchable. One click-seed drives both lobes
 *  (`seedL = seedR ^ 0x9e3779b9`), and each retry derives a fresh pair, so the result
 *  is still a genuinely different maze — just a well-proportioned one. */
export async function runNewMaze(seed: number): Promise<SwarmTrace> {
  const scripted = scriptedCaptainBrain();
  let best: SwarmTrace | null = null;
  let s = seed >>> 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const world = genSwarmMaze(s, s ^ 0x9e3779b9);
    const trace = await solveToTrace(world, scripted);
    if (trace.summary.solved) {
      if (trace.summary.ticks <= TICK_BUDGET) return trace;
      if (!best || trace.summary.ticks < best.summary.ticks) best = trace;
    }
    s = (s + 0x9e3779b9) >>> 0; // a fresh, well-spread seed for the next try
  }
  // Every seed solves by construction, so `best` is set; fall back to it if the budget
  // was never met (a run of unlucky carves — rare).
  return best ?? await solveToTrace(genSwarmMaze(seed, seed ^ 0x9e3779b9), scripted);
}

// ── the LIVE path — the real LLM captain, driven client-side ────────────────────
// The key is embedded in the page (window.__SWARM_LLM_KEY__, injected at build time
// from the environment — never committed to source). A live run is ONE solve (no
// reseed cap — each solve is a dozen+ real model calls, so we take the maze as carved).
// It is subject to Groq's free-tier token-per-minute limit, which is SHARED across all
// viewers of this one key, so a live click can be quick (~10s) or slow (a minute-plus
// with backoff) depending on the bucket. onProgress reports each planning step so the
// UI can show the model is working.
type LlmConfig = { key?: string; model?: string; baseUrl?: string };

function llmConfig(): LlmConfig {
  return (globalThis as unknown as { __SWARM_LLM__?: LlmConfig }).__SWARM_LLM__ ?? {};
}

/** Is a live run possible on this page (was a key embedded)? The UI uses this to
 *  enable/disable the live button. */
export function liveAvailable(): boolean {
  return !!llmConfig().key;
}

export async function runNewMazeLive(
  seed: number,
  onProgress?: (step: number) => void,
): Promise<SwarmTrace> {
  const cfg = llmConfig();
  if (!cfg.key) throw new Error("no embedded Groq key on this page");
  const client = makeGroqClient({ apiKey: cfg.key, model: cfg.model, baseUrl: cfg.baseUrl });
  const base = modelCaptainBrain(client);
  // wrap the brain so the UI can show "the model is planning — step N"
  let step = 0;
  const brain: CaptainBrain = {
    name: base.name,
    get lastReasoning() {
      return base.lastReasoning;
    },
    plan(state) {
      step++;
      onProgress?.(step);
      return base.plan(state);
    },
  };
  const world = genSwarmMaze(seed, seed ^ 0x9e3779b9);
  return await solveToTrace(world, brain);
}

// expose to the page's inline renderer
Object.assign(globalThis as unknown as Record<string, unknown>, {
  runNewMaze,
  runNewMazeLive,
  liveAvailable,
});
