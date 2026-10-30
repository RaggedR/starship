// gates.ts — the smart constructors for the maze. The point of the showpiece,
// re-themed from src/world/gates.ts.
//
// MacBeth Note 5 §5: "the gate is a smart constructor ... a denied command and a
// broken tool look the same from inside." A move into a wall and a move the
// harness refuses are the same kind of thing from a unit's seat — a Refused
// position, not an exception. An effect, once returned Ok, is guaranteed legal:
// world.ts applies it without re-checking. You cannot hold an illegal MazeEffect,
// because the only way to make one is through a gate.
//
// Multi-unit: move/attack are keyed by the acting unit's id. A unit cannot step
// into a wall, off the edge, onto a monster, OR onto another unit's cell.

import type { MazeWorld } from "./types.ts";
import { isWall, manhattan, monsterAt, requireUnit, step } from "./world.ts";
import type { Dir } from "./types.ts";
import type { MazeEffect } from "./world.ts";

export type GateResult =
  | { readonly ok: true; readonly effect: MazeEffect }
  | { readonly ok: false; readonly reason: string };

const ok = (effect: MazeEffect): GateResult => ({ ok: true, effect });
const refused = (reason: string): GateResult => ({ ok: false, reason });

function isDir(s: string): s is Dir {
  return s === "N" || s === "S" || s === "E" || s === "W";
}

// ── move ────────────────────────────────────────────────────────────────
/** Step one cell. Refused off the edge, into a wall, or onto a monster (with the
 *  id, so the agent knows what to attack or route around).
 *
 *  Friendly units may SHARE a cell: the fleet starts all three stacked on the
 *  entrance, and in the 1-wide corridors of a perfect maze a backtracking scout
 *  must be able to pass the captain holding position behind it. Collision with a
 *  unit would deadlock exactly the backtracking the fleet demo is built to show,
 *  so only walls and monsters block — monsters you must still fight through. */
export function moveGate(world: MazeWorld, unitId: string, dir: string): GateResult {
  if (!isDir(dir)) return refused(`bad --dir ${JSON.stringify(dir)} (want N|S|E|W)`);
  const u = requireUnit(world, unitId);
  const to = step(u.pos, dir);
  if (to.x < 0 || to.y < 0 || to.x >= world.width || to.y >= world.height) {
    return refused(`the edge of the maze is to the ${dir}`);
  }
  if (isWall(world, to)) return refused(`a wall blocks the way ${dir}`);
  const m = monsterAt(world, to);
  if (m) return refused(`${m.id} blocks the way ${dir} — attack it or go around`);
  return ok({ tag: "move", unitId, to, dir });
}

// ── attack ────────────────────────────────────────────────────────────────
/** Attack an adjacent monster. The unit hits for unit.atk; if the monster
 *  survives, it hits back for monster.atk (resolved here so applyEffect stays a
 *  pure writeback). Refused if the target is not here or not adjacent. */
export function attackGate(world: MazeWorld, unitId: string, targetId: string): GateResult {
  const u = requireUnit(world, unitId);
  const m = world.monsters.find((mm) => mm.id === targetId);
  if (!m) return refused(`no such monster: ${targetId}`);
  if (manhattan(m.pos, u.pos) !== 1) {
    return refused(`${targetId} is not adjacent — move next to it first`);
  }
  const monsterHpAfter = m.hp - u.atk;
  const lethal = monsterHpAfter <= 0;
  // A lethal blow lands before the monster can strike back; a survivor counters.
  const unitHpAfter = lethal ? u.hp : u.hp - m.atk;
  return ok({ tag: "attack", unitId, targetId, monsterHpAfter, unitHpAfter, lethal });
}
