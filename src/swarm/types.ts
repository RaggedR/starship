// types.ts — the swarm's own vocabulary, layered over the fleet's world and fog.
//
// The fleet had three fixed roles in a two-phase loop; the swarm has a POOL of
// agents advanced by a tick scheduler, so each agent needs a runtime STATE (what
// it is doing right now) and, for scouts and fighters, an ASSIGNMENT (what the
// captain last ordered it to do). This file is just that bookkeeping as data —
// pure, serialisable, no behaviour — in the same spirit as maze/types.ts.

import type { Dir, Pos } from "../maze/types.ts";

/** What an agent is doing this instant. The scheduler advances only ACTIVE agents
 *  (exploring | travelling | fighting); an `idle` agent awaits the captain's next
 *  order; a `done` agent has finished (a scout whose region is mapped, or the
 *  captain once it stands on the exit). The captain is `travelling` while it marches.
 *
 *    idle        — awaiting assignment. A scout awaits a frontier; a fighter in this
 *                  state is a forward RESERVE — it trails the search front so it is
 *                  near the next monster, rather than waiting at the start.
 *    exploring   — a scout ranging toward its assigned frontier
 *    guarding    — a scout holding position at a monster it discovered, keeping the
 *                  find in view until a fighter clears it (then it explores beyond at
 *                  once, with no travel back)
 *    travelling  — a fighter walking to its target monster, or the captain marching
 *    fighting    — a fighter standing adjacent to its target, trading blows
 *    done        — finished; never advanced again
 */
export type AgentState = "idle" | "exploring" | "guarding" | "travelling" | "fighting" | "done";

export type AgentKind = "scout" | "fighter" | "captain";

/** One agent in the pool, as the SCHEDULER sees it — the captain's belief about a
 *  unit plus the standing order it is executing. `pos`/`hp` are refreshed from each
 *  unit's own `look` as it acts (the captain never reads the true world directly).
 *
 *  The assignment fields are a tagged-ish union by kind, kept flat for serialisation:
 *   - a scout carries `toward` (the frontier cell it was sent to explore);
 *   - a fighter carries `targetMonster` (the id it was dispatched to clear) and the
 *     `path` of directions still to walk to reach it;
 *   - the captain carries `path` (the mapped safe route it is marching to the exit).
 *  A null assignment means "no standing order" — consistent with `state === idle`. */
export type SwarmAgent = {
  readonly id: string;
  readonly kind: AgentKind;
  state: AgentState;
  pos: Pos;
  hp: number;
  // scout assignment
  toward: Pos | null;
  // scout guard: the monster id this scout is holding position at (state "guarding")
  guarding: string | null;
  // fighter assignment
  targetMonster: string | null;
  // fighter travel / captain march
  path: Dir[] | null;
};

/** Build the initial pool from the seed's units: every agent idle at the entrance,
 *  with no standing order. Kinds are read from the id prefix (scout-*, fighter-*,
 *  captain), the one place the swarm leans on the naming convention. */
export function makePool(
  units: readonly { id: string; pos: Pos; hp: number }[],
): SwarmAgent[] {
  return units.map((u) => ({
    id: u.id,
    kind: kindOf(u.id),
    state: "idle" as AgentState,
    pos: u.pos,
    hp: u.hp,
    toward: null,
    guarding: null,
    targetMonster: null,
    path: null,
  }));
}

export function kindOf(id: string): AgentKind {
  if (id.startsWith("scout")) return "scout";
  if (id.startsWith("fighter")) return "fighter";
  if (id === "captain") return "captain";
  throw new Error(`cannot classify agent id: ${id}`);
}

/** The agents of one kind, in id order (the scheduler's fixed processing order). */
export function byKind(pool: readonly SwarmAgent[], kind: AgentKind): SwarmAgent[] {
  return pool.filter((a) => a.kind === kind);
}
