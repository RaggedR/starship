// model-captain_test.ts — the LLM-captain plumbing works and cannot cheat, proven
// with STUB models (no key, no network). Two properties beyond the bytes:
//   1. the model brain is wired into the scheduler and solves (a lazy/off-menu model
//      falls back to greedy — anti-stall — so the swarm never deadlocks);
//   2. the decoder forgives nothing: a valid order is honoured, an invalid one is a
//      refused position (dropped), never an escape hatch.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { run as dungeonRun } from "../cli/dungeon.ts";
import { saveMaze } from "../maze/store.ts";
import { seedSwarm } from "../maze/seed.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { fileIntentLog } from "../log/intentlog.ts";
import type { HarnessCtx } from "../bridge/harness.ts";
import type { MazeWorld, Pos } from "../maze/types.ts";
import type { Known } from "../maze/fog.ts";
import type { ModelClient, Turn } from "../agent/model.ts";
import { orchestrateSwarm } from "./scheduler.ts";
import { modelCaptainBrain } from "./model-captain.ts";
import type { AgentView, CaptainState } from "./captain.ts";

function rig() {
  const dir = Deno.makeTempDirSync();
  const wp = `${dir}/m.json`, lp = `${dir}/d.jsonl`, ip = `${dir}/i.jsonl`;
  const world: MazeWorld = seedSwarm();
  saveMaze(wp, world);
  const conIds = seededIds("dungeon"), conClock = fixedClock();
  const ctx: HarnessCtx = {
    ids: seededIds("agent"),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "TEST",
    conRun: (argv) => dungeonRun([...argv, "--world", wp, "--log", lp], conIds, conClock),
  };
  return { ctx, world };
}

function paramsOf(ctx: HarnessCtx, world: MazeWorld) {
  return {
    ctx,
    width: world.width,
    height: world.height,
    units: world.units.map((u) => ({ id: u.id, pos: u.pos, hp: u.hp, speed: u.speed })),
  };
}

/** A model that always holds — it issues one valid `hold`, nothing productive. The
 *  anti-stall fallback must carry the solve on greedy. */
const lazyModel: ModelClient = {
  name: "lazy-stub",
  // deno-lint-ignore require-await
  async converse(): Promise<Turn> {
    return { text: "holding", toolCalls: [{ id: "c0", name: "hold", input: { reason: "wait" } }] };
  },
};

/** A model that always issues an impossible order (a scout that does not exist, a
 *  dead monster). Every item is dropped; greedy fills in. Must still solve. */
const bogusModel: ModelClient = {
  name: "bogus-stub",
  // deno-lint-ignore require-await
  async converse(): Promise<Turn> {
    return {
      text: "commanding ghosts",
      toolCalls: [
        { id: "c0", name: "assign_scout", input: { scout_id: "scout-99", x: 3, y: 3, reason: "x" } },
        { id: "c1", name: "dispatch_fighter", input: { fighter_id: "fighter-9", monster_id: "ghost", reason: "x" } },
      ],
    };
  },
};

Deno.test("swarm --live plumbing: a lazy model still solves (greedy anti-stall)", async () => {
  const { ctx, world } = rig();
  const result = await orchestrateSwarm({ ...paramsOf(ctx, world), brain: modelCaptainBrain(lazyModel) });
  assertEquals(result.solved, true);
  assert(result.unknownAtEnd > 0, "fog still partial under the lazy model");
});

Deno.test("swarm --live plumbing: an off-menu model is refused, greedy carries it", async () => {
  const { ctx, world } = rig();
  const result = await orchestrateSwarm({ ...paramsOf(ctx, world), brain: modelCaptainBrain(bogusModel) });
  assertEquals(result.solved, true);
});

// ── the decoder forgives nothing (unit test on a hand-built state) ──────────
function tinyState(): CaptainState {
  // a 3-wide, 2-tall known strip: row 0 floor, row 1 unknown; captain at (0,0)
  const F: Known = "floor", U: Known = "unknown";
  const cells: Known[][] = [[F, F, F], [U, U, U]];
  const fog = { width: 3, height: 2, cells, monsters: { "orc-1": { x: 2, y: 0 } }, exitSeen: false };
  const agent = (
    id: string, kind: "scout" | "fighter" | "captain", state: AgentView["state"], pos: Pos,
  ): AgentView => ({ id, kind, state, pos, hp: 10, toward: null, guarding: null, targetMonster: null });
  return {
    fog,
    captainPos: { x: 0, y: 0 },
    agents: [
      agent("scout-1", "scout", "idle", { x: 0, y: 0 }),
      agent("scout-2", "scout", "exploring", { x: 1, y: 0 }),
      agent("fighter-1", "fighter", "idle", { x: 0, y: 0 }),
      agent("captain", "captain", "idle", { x: 0, y: 0 }),
    ],
    monsters: [{ id: "orc-1", pos: { x: 2, y: 0 } }],
    frontier: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    exit: null,
  };
}

Deno.test("decoder: a valid order is honoured; invalid ones are dropped", async () => {
  const st = tinyState();
  // A model that: assigns an IDLE scout to a reachable known cell (valid); assigns a
  // BUSY scout (dropped); dispatches an idle fighter to a known monster (valid);
  // marches with no route (dropped); and an order with no reason (dropped).
  const model: ModelClient = {
    name: "mixed",
    // deno-lint-ignore require-await
    async converse(): Promise<Turn> {
      return {
        text: "",
        toolCalls: [
          { id: "a", name: "assign_scout", input: { scout_id: "scout-1", x: 1, y: 0, reason: "explore east" } },
          { id: "b", name: "assign_scout", input: { scout_id: "scout-2", x: 1, y: 0, reason: "busy" } },
          { id: "c", name: "dispatch_fighter", input: { fighter_id: "fighter-1", monster_id: "orc-1", reason: "clear" } },
          { id: "d", name: "march", input: { reason: "no route exists" } },
          { id: "e", name: "assign_scout", input: { scout_id: "scout-1", x: 1, y: 0, reason: "" } },
        ],
      };
    },
  };
  const plan = await modelCaptainBrain(model).plan(st);
  assertEquals(plan.scouts.length, 1, "only the idle scout's valid assignment survives");
  assertEquals(plan.scouts[0].id, "scout-1");
  assertEquals(plan.fighters.length, 1, "the fighter dispatch to a known monster survives");
  assertEquals(plan.fighters[0].target, "orc-1");
  assertEquals(plan.march, false, "march without a known route is refused");
});

Deno.test("decoder: a cell off known floor is refused", async () => {
  const st = tinyState();
  const model: ModelClient = {
    name: "offmap",
    // deno-lint-ignore require-await
    async converse(): Promise<Turn> {
      return {
        text: "",
        toolCalls: [
          { id: "a", name: "assign_scout", input: { scout_id: "scout-1", x: 0, y: 1, reason: "into the dark" } },
        ],
      };
    },
  };
  // (0,1) is unknown — not reachable known floor — so the order is dropped. The plan
  // is then unproductive, so greedy fills in (scout-1 to a real frontier).
  const plan = await modelCaptainBrain(model).plan(st);
  for (const s of plan.scouts) {
    assert(!(s.toward.x === 0 && s.toward.y === 1), "must not send a scout into the unknown");
  }
});
