// scout.ts — the scout: a nested worker whose store is its OWN fog, hidden from the
// captain. Registry {look, move}: it perceives and roams, but cannot fight.
//
// One `explore` dispatch runs a mini look/move loop of up to `speed` moves. Each
// step it looks (revealing four neighbours into its private fog), then asks its
// BRAIN which way to go. It stops early when the way forward is a monster (reporting
// `blockedBy` and holding position — "retreat" is handing control back, not walking
// home) or when no frontier is reachable (the region is mapped). It returns the
// sightings it took, so the captain can amalgamate them into ITS fog — the only
// channel by which the captain ever learns anything. This is MacBeth's spawn: a
// worker ∆S ⊗ X → Y whose store S (the fog) is existentially hidden; the captain
// sees only the report, one position up.
//
// The brain is the leaf seam (PLAN §4, decision 4): a scriptedScoutBrain (a BFS to
// the nearest frontier — deterministic, keyless, the default) or a modelScoutBrain
// (a free model chooses at junctions — `--live`). The loop is identical either way,
// exactly as the single-agent maze's loop is identical for scripted vs Groq.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import type { Fib } from "../lib/algebra.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { Dir, Pos } from "../maze/types.ts";
import { step } from "../maze/world.ts";
import type { Look } from "../maze/world.ts";
import { emptyFog, type FogMap, mergeSighting, monsterKnownAt } from "../maze/fog.ts";
import type { Sighting } from "../maze/fog.ts";
import type { ModelClient, ToolSpec } from "../agent/model.ts";
import {
  type FleetEmit,
  lookToSighting,
  nearestFrontierStep,
  progressDirections,
  type ScoutReport,
  scoutRegistry,
  type ScoutShape,
  unitLook,
  unitMove,
} from "./ops.ts";

/** The scout's container: one shape, `explore`; its position is a ScoutReport. */
export type ScoutC = Fib<ScoutShape, ScoutReport>;

// ── the brain seam: how the scout decides each step ─────────────────────────
/** A scout's decision for one step: where to go and why, or null to stop (nothing
 *  productive remains within reach). The reason flows into the move's intent-log. */
export type ScoutDecision = { readonly dir: Dir; readonly reason: string } | null;

export type ScoutBrain = {
  readonly name: string;
  chooseStep(args: { fog: FogMap; pos: Pos; look: Look }): Promise<ScoutDecision>;
};

/** The default brain: a breadth-first step toward the nearest frontier. Keyless,
 *  deterministic — this is what keeps `deno task fleet` byte-identical. */
export function scriptedScoutBrain(): ScoutBrain {
  return {
    name: "scripted-frontier-bfs",
    // deno-lint-ignore require-await
    async chooseStep({ fog, pos }) {
      const dir = nearestFrontierStep(fog, pos);
      return dir ? { dir, reason: `scouting ${dir} toward unmapped ground` } : null;
    },
  };
}

/** The `--live` brain: a free model chooses among the productive directions. At a
 *  corridor there is one productive step (the model is not consulted); at a junction
 *  the model picks which branch to explore — the one decision where judgement helps.
 *  If the only productive step is onto a monster, that direction is returned so the
 *  loop reports `blockedBy`. A malformed or off-menu reply falls back to the BFS
 *  pick, so a weak model can slow the solve but never break it. */
export function modelScoutBrain(client: ModelClient): ScoutBrain {
  const SYSTEM =
    `You are the SCOUT of a fleet exploring a grid maze. You are its only eyes. Your ` +
    `job is to MAP the maze and find a route to the exit, reporting back. You cannot ` +
    `fight. Choose a direction that reveals new ground, heading toward the exit when ` +
    `you can. Prefer directions that open unexplored territory over ones you have seen.`;

  const goTool = (dirs: Dir[]): ToolSpec => ({
    name: "go",
    description: "Step one cell to explore.",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", enum: dirs, description: "Direction to explore." },
        reason: { type: "string", description: "Why this direction (one short clause)." },
      },
      required: ["dir", "reason"],
      additionalProperties: false,
    },
  });

  return {
    name: client.name,
    async chooseStep({ fog, pos, look }) {
      const prog = progressDirections(fog, pos);
      if (prog.length === 0) return null; // nothing productive reachable
      const free = prog.filter((d) => !monsterKnownAt(fog, step(pos, d)));
      if (free.length === 0) {
        // every productive step is blocked by a monster — hand the loop a blocked dir
        return { dir: prog[0], reason: `heading ${prog[0]}, but a monster holds the way` };
      }
      if (free.length === 1) {
        return { dir: free[0], reason: `scouting ${free[0]} (the only productive way)` };
      }
      // a real junction: let the model choose which branch to open
      const nb = look.neighbours
        .map((n) => `${n.dir}=${n.cell}${n.monster ? `(${n.monster})` : ""}`)
        .join(" ");
      const user =
        `At (${pos.x},${pos.y}). Neighbours: ${nb}. Exit lies ${look.exitBearing} ` +
        `(~${look.exitDistance} away). Productive directions: ${free.join(", ")}. ` +
        `Pick one to explore.`;
      try {
        const turn = await client.converse(SYSTEM, [{ role: "user", text: user }], [goTool(free)]);
        const call = turn.toolCalls.find((c) => c.name === "go");
        const dir = call?.input.dir;
        if (typeof dir === "string" && (free as string[]).includes(dir)) {
          const r = call!.input.reason;
          const reason = typeof r === "string" && r.trim() ? r.trim() : `scouting ${dir}`;
          return { dir: dir as Dir, reason };
        }
      } catch (err) {
        console.error(`  [scout model error: ${err instanceof Error ? err.message : err}]`);
      }
      // fallback: the BFS pick (guaranteed productive), so the solve still completes
      const dir = nearestFrontierStep(fog, pos) ?? free[0];
      return { dir, reason: `scouting ${dir} toward unmapped ground` };
    },
  };
}

function isPos(u: unknown): u is Pos {
  return typeof u === "object" && u !== null &&
    typeof (u as Pos).x === "number" && typeof (u as Pos).y === "number";
}

/** Validate a raw reply into a ScoutReport, or null (the leaf then throws — the
 *  decoder forgives nothing, so a malformed report never passes as typed). */
function decodeReport(u: unknown): ScoutReport | null {
  if (typeof u !== "object" || u === null) return null;
  const r = u as Record<string, unknown>;
  if (!Array.isArray(r.sightings)) return null;
  if (!isPos(r.scoutPos)) return null;
  if (typeof r.exhausted !== "boolean") return null;
  if (typeof r.movesMade !== "number") return null;
  if (r.blockedBy !== null) {
    const b = r.blockedBy as Record<string, unknown>;
    if (typeof b?.monsterId !== "string" || !isPos(b?.at)) return null;
  }
  return r as unknown as ScoutReport;
}

/** Build the scout leaf. `width`/`height` size its private fog; `speed` is how far
 *  it ranges per dispatch (5 for the fleet). `brain` decides each step. The leaf is
 *  a Runner<ScoutC>, composable with seqC. */
export function makeScout(
  ctx: HarnessCtx,
  emit: FleetEmit,
  dims: { width: number; height: number; speed: number },
  brain: ScoutBrain,
): Runner<ScoutC> {
  const reg = scoutRegistry();
  let fog: FogMap = emptyFog(dims.width, dims.height); // the hidden store

  const explore = async (): Promise<ScoutReport> => {
    const sightings: Sighting[] = [];
    let blockedBy: ScoutReport["blockedBy"] = null;
    let exhausted = false;
    let movesMade = 0;

    let look = unitLook(ctx, reg, "scout");
    let pos: Pos = { x: look.unit.x, y: look.unit.y };

    while (true) {
      const sighting = lookToSighting(look);
      fog = mergeSighting(fog, sighting);
      sightings.push(sighting);

      if (movesMade >= dims.speed) break; // spent this dispatch's range

      const decision = await brain.chooseStep({ fog, pos, look });
      if (decision === null) {
        exhausted = true; // nothing left to map from here
        break;
      }
      const target = step(pos, decision.dir);
      const blocker = monsterKnownAt(fog, target);
      if (blocker) {
        blockedBy = { monsterId: blocker, at: target }; // the way forward is held
        break; // retreat = stop advancing, hand control back
      }

      const out = unitMove(ctx, reg, "scout", decision.dir, decision.reason, emit);
      if (!out.ok) {
        exhausted = true; // we routed over known floor; a refusal means a dead end
        break;
      }
      movesMade++;
      pos = target;
      look = unitLook(ctx, reg, "scout");
    }

    return { sightings, scoutPos: pos, blockedBy, exhausted, movesMade };
  };

  return leafLocal<ScoutC>(
    "scout",
    async () => await explore(),
    { explore: decodeReport },
  );
}
