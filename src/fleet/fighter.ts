// fighter.ts — the fighter: moves and kills, but is BLIND. Registry {move, attack},
// no `look`. It knows only where it started and the orders it has been given, so it
// DEAD-RECKONS its own position: it cannot see the maze, only count its steps. That
// is the purest division of labour — perception belongs to the scout alone.
//
// An `engage` order carries a target monster and a path (computed by the captain on
// the captain's fog). The fighter walks the path, then strikes the target until it
// dies — reading its own hp back from each attack's committed effect (the one thing
// a blind unit can still learn: what its own blow did). A `standby` order is the
// no-op the captain sends when the scout found nothing blocking: the second half of
// the round's dependent pair still exists, it just does nothing.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import type { Fib } from "../lib/algebra.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { Pos } from "../maze/types.ts";
import { step } from "../maze/world.ts";
import {
  type FighterReport,
  type FighterShape,
  fighterRegistry,
  type FleetEmit,
  unitAttack,
  unitMove,
} from "./ops.ts";

/** One fibre with a UNION shape (engage | standby), not a union of two fibres —
 *  so seqC(scout, fighter) stays a single dependent pair rather than distributing
 *  into (scout◁engage)+(scout◁standby) (the skill's §8 soundness trap). */
export type FighterC = Fib<FighterShape, FighterReport>;

function isPos(u: unknown): u is Pos {
  return typeof u === "object" && u !== null &&
    typeof (u as Pos).x === "number" && typeof (u as Pos).y === "number";
}

function decodeReport(u: unknown): FighterReport | null {
  if (typeof u !== "object" || u === null) return null;
  const r = u as Record<string, unknown>;
  if (typeof r.engaged !== "boolean") return null;
  if (typeof r.killed !== "boolean") return null;
  if (!isPos(r.fighterPos)) return null;
  if (typeof r.hp !== "number") return null;
  if (r.target !== null && typeof r.target !== "string") return null;
  return r as unknown as FighterReport;
}

/** Build the fighter leaf. It tracks its own `pos` and `hp` across dispatches by
 *  dead reckoning — blind, it has no other way to know them. */
export function makeFighter(
  ctx: HarnessCtx,
  emit: FleetEmit,
  start: { pos: Pos; hp: number },
): Runner<FighterC> {
  const reg = fighterRegistry();
  let pos: Pos = start.pos;
  let hp = start.hp;

  const act = (shape: FighterShape): FighterReport => {
    if (shape.tag === "standby") {
      return { engaged: false, target: null, killed: false, fighterPos: pos, hp };
    }
    // Walk the ordered path toward the target.
    for (const dir of shape.path) {
      const out = unitMove(
        ctx,
        reg,
        "fighter",
        dir,
        `advancing ${dir} to engage ${shape.target}`,
        emit,
      );
      if (!out.ok) break; // blocked unexpectedly; stop and report where we got to
      pos = step(pos, dir);
    }
    // Strike until the target dies or we fall.
    let killed = false;
    while (true) {
      const out = unitAttack(
        ctx,
        reg,
        "fighter",
        shape.target,
        `attacking ${shape.target} to clear the route`,
        emit,
      );
      if (!out.ok || !out.effect) break; // not adjacent / already gone / refused
      hp = out.effect.unitHpAfter;
      if (out.effect.lethal) {
        killed = true;
        break;
      }
      if (hp <= 0) break; // the fighter fell
    }
    return { engaged: true, target: shape.target, killed, fighterPos: pos, hp };
  };

  return leafLocal<FighterC>(
    "fighter",
    // deno-lint-ignore require-await
    async (shape) => act(shape as FighterShape),
    {
      engage: decodeReport,
      standby: decodeReport,
    },
  );
}
