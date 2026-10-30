// scripted.ts — a deterministic ModelClient that SOLVES the maze, standing in for
// a real model so the demo and tests run with no API key and replay byte-identically.
//
// It plays the part the comment in src/bridge/officers.ts describes for the star
// system ("the reasoning is scripted/deterministic ... swapping in a real model
// later means replacing only the answer function") — here the "answer function" is
// a breadth-first search. Each turn it reads the live world (its only perception,
// exactly as the real agent reads `look`), finds the shortest route to the exit
// treating monsters as passable obstacles, and emits ONE tool call toward it:
// `attack` if a monster stands in the next cell, otherwise `move`.
//
// BFS explores neighbours in a fixed order (N, E, S, W) and reconstructs the path
// deterministically, so the sequence of tool calls is identical every run.

import type { ModelClient, Turn } from "./model.ts";
import type { Dir, Pos } from "../maze/types.ts";
import { DIRS, eq, isWall, monsterAt, solved, step } from "../maze/world.ts";
import { loadMaze } from "../maze/store.ts";

/** Breadth-first search from the hero to the exit, walls impassable, monsters
 *  passable (you fight through them). Returns the direction of the first step on a
 *  shortest path, or null if the hero is already there or no path exists. */
function firstStep(worldPath: string): { dir: Dir; to: Pos } | null {
  const world = loadMaze(worldPath);
  const start = world.hero.pos;
  if (eq(start, world.exit)) return null;

  const key = (p: Pos) => `${p.x},${p.y}`;
  const prev = new Map<string, { from: Pos; dir: Dir }>();
  const seen = new Set<string>([key(start)]);
  let frontier: Pos[] = [start];

  while (frontier.length > 0) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const dir of DIRS) {
        const q = step(p, dir);
        if (isWall(world, q)) continue; // off-grid counts as wall
        const k = key(q);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, { from: p, dir });
        if (eq(q, world.exit)) {
          // Walk the chain back to the hero; the dir out of `start` is the answer.
          let cur = q;
          let firstDir = dir;
          while (!eq(prev.get(key(cur))!.from, start)) {
            const e = prev.get(key(cur))!;
            cur = e.from;
            firstDir = prev.get(key(cur))!.dir;
          }
          return { dir: firstDir, to: step(start, firstDir) };
        }
        next.push(q);
      }
    }
    frontier = next;
  }
  return null;
}

/** A ModelClient backed by the BFS above. It ignores the conversation and the tool
 *  specs (it already knows the rules) and reads the world file each turn. The
 *  tool-call id counter is per-client, so two runs in one process do not share it. */
export function scriptedClient(worldPath: string): ModelClient {
  let counter = 0;
  const nextId = () => `call-${String(counter++).padStart(4, "0")}`;
  return {
    name: "scripted-bfs",
    // deno-lint-ignore require-await
    async converse(): Promise<Turn> {
      const world = loadMaze(worldPath);
      if (solved(world)) return { text: "Reached the exit.", toolCalls: [] };

      const next = firstStep(worldPath);
      if (!next) return { text: "No path to the exit.", toolCalls: [] };

      const blocker = monsterAt(world, next.to);
      if (blocker) {
        return {
          text: `${blocker.id} blocks the way ${next.dir}; attacking it.`,
          toolCalls: [{
            id: nextId(),
            name: "attack",
            input: {
              target: blocker.id,
              reason:
                `${blocker.id} stands in the only path ${next.dir} to the exit at ` +
                `(${world.exit.x},${world.exit.y}); clearing it`,
            },
          }],
        };
      }
      return {
        text: `Moving ${next.dir} toward the exit.`,
        toolCalls: [{
          id: nextId(),
          name: "move",
          input: {
            dir: next.dir,
            reason: `step ${next.dir} along the shortest route to the exit at ` +
              `(${world.exit.x},${world.exit.y})`,
          },
        }],
      };
    },
  };
}
