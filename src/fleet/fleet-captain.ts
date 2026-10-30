// fleet-captain.ts — the captain: it holds a FogMap and NOTHING else of the world.
// It never sees the true maze (the demo deliberately never hands it the world
// object). Each round it composes the scout and the fighter with seqC — the
// dependent pair ◁ — and the amalgamation happens inside the pair's `next`:
//
//     seqC(scout, fighter).step(
//       {tag:"explore"},                    // control DOWN: send the scout
//       (scoutReport) => {                  // the scout's position chooses the next prompt
//         merge scoutReport.sightings into the fog     // data UP: amalgamate (the M1 join)
//         return blocked ? {engage, target, path} : {standby}   // control DOWN again
//       })
//
// Contrast src/bridge/captain.ts, which gathers Science ⊗ Engineering with tensorC
// (both owed, independent). Here the fighter's order cannot be built until the
// scout's report exists — that dependency is why it must be ◁, not ⊠.
//
// Two phases: EXPLORE (repeat the round until a safe route to the exit is KNOWN)
// then MARCH (walk that route). The captain plans only on the fog; if the exit is
// not yet on its map, it cannot route to it — it must keep exploring.

import { seqC } from "../lib/algebra.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { Pos } from "../maze/types.ts";
import { eq, step } from "../maze/world.ts";
import {
  clearMonster,
  emptyFog,
  exitCell,
  type FogMap,
  mergeSighting,
  unknownCount,
} from "../maze/fog.ts";
import {
  adjacentFreeCell,
  captainRegistry,
  type FighterShape,
  type FleetAction,
  type FleetEmit,
  pathOverFog,
  type ScoutReport,
  unitMove,
} from "./ops.ts";
import { makeScout, type ScoutBrain, scriptedScoutBrain } from "./scout.ts";
import { makeFighter } from "./fighter.ts";

export type FleetResult = {
  readonly solved: boolean;
  readonly rounds: number;
  readonly scoutMoves: number;
  readonly fighterMoves: number;
  readonly captainMoves: number;
  readonly kills: number;
  readonly unknownAtEnd: number;
  readonly finalFog: FogMap;
  readonly captainPos: Pos;
};

export function orchestrateFleet(params: {
  ctx: HarnessCtx;
  width: number;
  height: number;
  captainStart: Pos;
  scout: { speed: number };
  fighter: { start: Pos; hp: number };
  scoutBrain?: ScoutBrain;
  maxRounds?: number;
  sink?: (a: FleetAction, fog: FogMap) => void;
}): Promise<FleetResult> {
  const { ctx, width, height } = params;
  const captainReg = captainRegistry();
  const maxRounds = params.maxRounds ?? 400;
  const rawSink = params.sink ?? (() => {});

  // The captain's whole state. `let`, so the emit closure below sees each reassign.
  let captainFog: FogMap = emptyFog(width, height);
  let captainPos: Pos = params.captainStart;
  let fighterPos: Pos = params.fighter.start;

  const counts = { scout: 0, fighter: 0, captain: 0, kills: 0 };
  // Every emitted action is stamped with the captain's CURRENT fog — so the website
  // shows what the captain knew at that instant (stale during a scout sortie, then
  // snapping brighter at each merge).
  const emit: FleetEmit = (a) => {
    if (a.action === "move" && a.ok) {
      if (a.actor === "scout") counts.scout++;
      else if (a.actor === "fighter") counts.fighter++;
      else if (a.actor === "captain") counts.captain++;
    }
    rawSink(a, captainFog);
  };

  const brain = params.scoutBrain ?? scriptedScoutBrain();
  const scout = makeScout(ctx, emit, { width, height, speed: params.scout.speed }, brain);
  const fighter = makeFighter(ctx, emit, { pos: params.fighter.start, hp: params.fighter.hp });
  const round = seqC(scout, fighter);

  async function solve(): Promise<FleetResult> {
    emit({
      actor: "-",
      action: "phase",
      detail: "explore",
      reason: "map the maze through the scout and clear whatever blocks the way",
    });

    let rounds = 0;
    while (rounds < maxRounds) {
      rounds++;

      const pair = await round.run(
        round.step({ tag: "explore" }, (report: ScoutReport): FighterShape => {
          // ── amalgamate: the scout's data flows UP into the captain's fog ──
          for (const s of report.sightings) captainFog = mergeSighting(captainFog, s);
          emit({
            actor: "captain",
            action: "merge",
            detail: `+${report.sightings.length} sightings · ${
              unknownCount(captainFog)
            } cells still dark`,
            reason: "amalgamate the scout's report into the fog-of-war map",
          });
          // ── decide: a monster holding the way forward gets the fighter ──
          if (report.blockedBy) {
            const adj = adjacentFreeCell(captainFog, report.blockedBy.at);
            const path = adj
              ? pathOverFog(captainFog, fighterPos, adj, { avoidMonsters: true })
              : null;
            if (path !== null) {
              return { tag: "engage", target: report.blockedBy.monsterId, path };
            }
          }
          return { tag: "standby" };
        }),
        0,
      );

      const scoutReport = pair.first;
      const fighterReport = pair.second;
      fighterPos = fighterReport.fighterPos;

      if (fighterReport.killed && fighterReport.target) {
        captainFog = clearMonster(captainFog, fighterReport.target);
        counts.kills++;
        emit({
          actor: "captain",
          action: "note",
          detail: `${fighterReport.target} cleared`,
          reason: "the way is open where the scout was blocked",
        });
      }

      // Can the captain now reach the exit on known, monster-free floor?
      const exit = exitCell(captainFog);
      if (exit) {
        const marchPath = pathOverFog(captainFog, captainPos, exit, { avoidMonsters: true });
        if (marchPath !== null) {
          emit({
            actor: "-",
            action: "phase",
            detail: "march",
            reason: "a safe route to the exit is known; the captain advances on it",
          });
          for (const dir of marchPath) {
            const out = unitMove(
              ctx,
              captainReg,
              "captain",
              dir,
              `advancing ${dir} along the mapped safe route to the exit`,
              emit,
            );
            if (!out.ok) break;
            captainPos = step(captainPos, dir);
          }
          return finish(rounds, true);
        }
      }

      // Stuck guard: a round that mapped nothing new and cleared nothing, with the
      // exit still unreachable, cannot make progress — stop rather than spin.
      if (
        scoutReport.movesMade === 0 && !fighterReport.killed &&
        (!exit || pathOverFog(captainFog, captainPos, exit, { avoidMonsters: true }) === null)
      ) {
        emit({
          actor: "-",
          action: "note",
          detail: "no progress this round",
          reason: "the reachable map is exhausted and the exit is not yet routable",
        });
        break;
      }
    }

    return finish(rounds, eq(captainPos, exitCell(captainFog) ?? { x: -1, y: -1 }));
  }

  function finish(rounds: number, solved: boolean): FleetResult {
    emit({
      actor: "-",
      action: "done",
      detail: solved ? "the captain reached the exit" : "the captain did not reach the exit",
      reason: "",
    });
    return {
      solved,
      rounds,
      scoutMoves: counts.scout,
      fighterMoves: counts.fighter,
      captainMoves: counts.captain,
      kills: counts.kills,
      unknownAtEnd: unknownCount(captainFog),
      finalFog: captainFog,
      captainPos,
    };
  }

  return solve();
}
