// loop.ts — the inner model-call loop: the one harness part starship never had.
//
// Thorsten Ball's Go agent and the toy harness are the same five parts — client,
// conversation slice, outer user loop, inner model-call loop, tool dispatch. The
// star-system bridge already carries four of them; its "officers" were scripted
// stand-ins for the model (src/bridge/officers.ts). This file supplies the missing
// one: a real loop that calls a ModelClient, services the tool calls it asks for
// THROUGH the existing reason-gate (src/bridge/harness.ts), and feeds the results
// back — until the agent reaches the exit, dies, or hits the step budget.
//
// Nothing about permission or logging is new here. A tool call becomes a conRead
// (free) or a runMutation (reason required, write-ahead logged, correlation id
// minted) exactly as an officer's call does. The agent's only hands are the five
// allowlisted capabilities; there is no escape hatch.

import type { Message, ModelClient, ToolCall, ToolResult } from "./model.ts";
import { ADVENTURER_TOOLS } from "./model.ts";
import {
  conRead,
  type HarnessCtx,
  type Registry,
  runMutation,
} from "../bridge/harness.ts";
import { dead, solved } from "../maze/world.ts";
import { loadMaze } from "../maze/store.ts";

/** The adventurer's registry: the allowlist IS the permission grant (no bash, no
 *  generic exec). Reads and the two mutations, and nothing else. */
export function adventurerRegistry(): Registry {
  return {
    agentId: "agent:adventurer",
    allowed: new Set([
      "look",
      "hero",
      "map",
      "move",
      "attack",
      "log recent",
      "log trace",
    ]),
  };
}

export const SYSTEM_PROMPT =
  `You are an adventurer in a small grid maze. Your goal is to reach the EXIT.

The maze has walls you cannot pass and monsters that block the way. North is up
(y decreases), south is down (y increases), east is +x, west is -x.

How to play:
- Call look to perceive what is around you and where the exit lies. Do this first,
  and whenever you are unsure.
- Call move with a direction (N, S, E, or W) to step one cell.
- If a monster blocks the only way forward, call attack with its id (from look) to
  fight through it. It may strike back, so watch your hp.
- Every move and attack REQUIRES a short, specific reason explaining why. A call
  with no reason is refused by the harness before it runs — if that happens, read
  the refusal, add a reason, and try again.
- You have no other abilities. Reach the exit.`;

/** Map a neutral ToolCall to the dungeon CLI argv + whether it mutates. Returns
 *  null for a tool the adventurer cannot name (handled as an error result). */
function planCall(call: ToolCall): {
  argv: string[];
  args: Record<string, unknown>;
  mutates: boolean;
  reason: string;
} | null {
  const reason = typeof call.input.reason === "string" ? call.input.reason : "";
  switch (call.name) {
    case "look":
      return { argv: ["look"], args: {}, mutates: false, reason: "" };
    case "hero":
      return { argv: ["hero"], args: {}, mutates: false, reason: "" };
    case "map":
      return { argv: ["map"], args: {}, mutates: false, reason: "" };
    case "move": {
      const dir = String(call.input.dir ?? "");
      return { argv: ["move", "--dir", dir], args: { dir }, mutates: true, reason };
    }
    case "attack": {
      const target = String(call.input.target ?? "");
      return {
        argv: ["attack", "--target", target],
        args: { target },
        mutates: true,
        reason,
      };
    }
    default:
      return null;
  }
}

/** Dispatch one tool call through the harness gate and return a result for the
 *  model. A read goes through conRead; a mutation through runMutation (which
 *  enforces the reason-gate, writes the write-ahead intent record, and mints the
 *  correlation id). A refusal is reported to the model as an error result — never
 *  thrown — so the agent can read it and retry. */
export function dispatch(ctx: HarnessCtx, reg: Registry, call: ToolCall): ToolResult {
  const plan = planCall(call);
  if (!plan) {
    return { toolUseId: call.id, content: `no such tool: ${call.name}`, isError: true };
  }
  if (!plan.mutates) {
    try {
      const value = conRead(ctx, reg, call.name, plan.argv, plan.args);
      return { toolUseId: call.id, content: JSON.stringify(value), isError: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { toolUseId: call.id, content: msg, isError: true };
    }
  }
  const outcome = runMutation(ctx, reg, call.name, plan.argv, plan.args, plan.reason);
  return outcome.ok
    ? { toolUseId: call.id, content: JSON.stringify(outcome.result), isError: false }
    : {
      toolUseId: call.id,
      content: `refused by harness: ${outcome.reason}`,
      isError: true,
    };
}

// ── events, so a caller (the demo, a test) can watch without the loop printing ──
export type MazeEvent =
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "tool"; readonly call: ToolCall; readonly result: ToolResult };

export type MazeRunResult = {
  readonly solved: boolean;
  readonly dead: boolean;
  readonly steps: number; // mutating actions committed or attempted
  readonly turns: number; // model calls
  readonly heroHp: number;
};

/** Run the agent against the maze. The world is the file the dungeon CLI persists
 *  to (ctx.conRun points there); the loop re-reads it each turn to check the goal,
 *  exactly as the agent perceives it through look. */
export async function runMaze(params: {
  ctx: HarnessCtx;
  reg: Registry;
  client: ModelClient;
  worldPath: string;
  maxSteps?: number;
  onEvent?: (e: MazeEvent) => void;
}): Promise<MazeRunResult> {
  const { ctx, reg, client, worldPath } = params;
  const maxSteps = params.maxSteps ?? 60;
  const maxTurns = maxSteps * 2; // a backstop against a model that only talks
  const emit = params.onEvent ?? (() => {});

  const messages: Message[] = [{
    role: "user",
    text: "You are at the start of the maze. Reach the exit.",
  }];
  let steps = 0;
  let turns = 0;

  while (true) {
    const world = loadMaze(worldPath);
    if (solved(world) || dead(world)) break;
    if (steps >= maxSteps || turns >= maxTurns) break;

    const turn = await client.converse(SYSTEM_PROMPT, messages, ADVENTURER_TOOLS);
    turns++;
    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });
    if (turn.text) emit({ kind: "say", text: turn.text });

    if (turn.toolCalls.length === 0) {
      messages.push({
        role: "user",
        text: "You have not reached the exit yet. Use look, then move or attack.",
      });
      continue;
    }

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      const result = dispatch(ctx, reg, call);
      emit({ kind: "tool", call, result });
      results.push(result);
      if (call.name === "move" || call.name === "attack") steps++;
    }
    messages.push({ role: "tool", results });
  }

  const finalWorld = loadMaze(worldPath);
  return {
    solved: solved(finalWorld),
    dead: dead(finalWorld),
    steps,
    turns,
    heroHp: finalWorld.hero.hp,
  };
}
