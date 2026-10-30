// store.ts — load/save the maze to one JSON file (mirrors src/world/store.ts).
//
// The dungeon CLI is invoked fresh per command, so the world must persist between
// invocations. It lives in one file; the first run seeds it. The in-process demo
// and the agent loop can also hold it in memory — same reducers, no file — which
// is the boundary claim again: the caller cannot tell where the state lives.

import type { MazeWorld } from "./types.ts";
import { seedMaze } from "./seed.ts";

export function loadMaze(path: string): MazeWorld {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as MazeWorld;
  } catch {
    return seedMaze();
  }
}

export function saveMaze(path: string, world: MazeWorld): void {
  Deno.writeTextFileSync(path, JSON.stringify(world, null, 2) + "\n");
}
