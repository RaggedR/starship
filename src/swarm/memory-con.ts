// memory-con.ts — an in-memory `conRun` for the browser (and headless tests).
//
// The Deno demo wires the harness's conRun to the dungeon CLI's run() over a JSON
// FILE (src/swarm-maze-demo.ts). A browser has no filesystem, so this provides the
// same ConRun contract backed by a mutable MazeWorld in a closure — the store.ts
// boundary claim made literal: "the caller cannot tell where the state lives."
//
// It mirrors EXACTLY what dungeon.run() returns for the three verbs the scheduler
// uses (look / move / attack), because that is all harness.ts ever reads:
//   • conRead returns conRun(argv).value verbatim (the Look, for the scout).
//   • runMutation returns conRun(fullArgv).value as `result`; ops.ts reads only
//     result.effect (the AttackEffect, for a blind fighter). move's result is unused
//     (harness mints its own correlation id), but we return the same shape anyway.
// And it THROWS on a gate refusal, exactly as dungeon's commit() does — runMutation
// CATCHES that throw to log the refusal. A refused order and a jammed tool look the
// same from inside (MacBeth Note 5 §5); preserving the throw preserves the gate.
//
// Out of scope (PLAN-browser-maze.md §4): the Layer-1 ship's log and reconciliation.
// The browser toy shows the solve, not the two-log audit (that is logs.html). So this
// writes no ship's log; the harness's Layer-2 intent-log is an in-memory memIntentLog.

import type { MazeWorld } from "../maze/types.ts";
import { applyEffect, look } from "../maze/world.ts";
import { attackGate, moveGate } from "../maze/gates.ts";
import type { ConRun } from "../bridge/harness.ts";

/** A gate refusal raised as a throw, to mirror dungeon.run()'s commit() path: an
 *  illegal move/attack never commits and the harness records it as `refused`. */
class Refusal extends Error {}

export type MemoryCon = {
  readonly conRun: ConRun;
  /** The live world — the trace-building sink reads unit/monster positions from here
   *  each frame (the Deno sink reloads the JSON file; the browser reads this instead). */
  current(): MazeWorld;
};

/** Build an in-memory conRun over a mutable copy of `initial`. The harness drives it
 *  with a tiny fixed argv vocabulary (see src/fleet/ops.ts):
 *    ["look","--unit",id]
 *    ["move","--dir",D,"--unit",id,"--reason",r,"--corr",c]
 *    ["attack","--target",m,"--unit",id,"--reason",r,"--corr",c]  */
export function memoryCon(initial: MazeWorld): MemoryCon {
  let world = initial;

  const flag = (argv: string[], k: string): string | undefined => {
    const i = argv.indexOf("--" + k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // Mirror dungeon.run()'s reqReason: a mutating verb with an empty reason is refused
  // before anything commits. (The harness already gates reasons, so this is the same
  // defence in depth the CLI gives — and keeps the two paths behaviourally identical.)
  const reqReason = (argv: string[], cmd: string): void => {
    const r = flag(argv, "reason");
    if (!r || r.trim() === "") throw new Refusal(`${cmd} requires a non-empty --reason`);
  };

  const conRun: ConRun = (argv) => {
    const cmd = argv[0];
    const unit = flag(argv, "unit") ?? "hero";

    switch (cmd) {
      case "look":
        return { value: look(world, unit) };

      case "move": {
        reqReason(argv, "move");
        const gate = moveGate(world, unit, flag(argv, "dir") ?? "");
        if (!gate.ok) throw new Refusal(gate.reason);
        world = applyEffect(world, gate.effect);
        return {
          value: {
            committed: true,
            command: "move",
            correlation_id: flag(argv, "corr") ?? "",
            effect: gate.effect,
          },
        };
      }

      case "attack": {
        reqReason(argv, "attack");
        const gate = attackGate(world, unit, flag(argv, "target") ?? "");
        if (!gate.ok) throw new Refusal(gate.reason);
        world = applyEffect(world, gate.effect);
        return {
          value: {
            committed: true,
            command: "attack",
            correlation_id: flag(argv, "corr") ?? "",
            effect: gate.effect,
          },
        };
      }

      default:
        throw new Refusal(`unknown command: ${cmd ?? "(none)"}`);
    }
  };

  return { conRun, current: () => world };
}
