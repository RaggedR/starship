// store.ts — load/save the world to one JSON file.
//
// `con` is invoked fresh per command (like a typical CLI), so the world must persist
// between invocations. It lives in one file; the first run seeds it. The in-process
// demo (demo.ts) bypasses this and holds the world in memory — same reducers, no
// file — which is the boundary claim again: the level cannot tell where state lives.

import type { World } from "./types.ts";
import { seedWorld } from "./seed.ts";

export function loadWorld(path: string): World {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as World;
  } catch {
    return seedWorld();
  }
}

export function saveWorld(path: string, world: World): void {
  Deno.writeTextFileSync(path, JSON.stringify(world, null, 2) + "\n");
}
