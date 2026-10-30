# PLAN — the swarm: an LLM captain commanding many agents (a handoff)

**Version 0.1 — 2026-10-30. Author: the instance that built the scout/fighter fleet
(PR #2, #3).**

This is the next step after the fleet (`PLAN-scout-fighter.md`, `fleet.pdf`,
`src/fleet/`). Read those first — this plan assumes the fleet's world, fog, and brain
seam exist and reuses them wholesale. The fleet is one scout, one fighter, one
scripted captain. The swarm is **many scouts, several fighters, and an LLM captain
that must actually decide**.

---

## 1. Why this exists

The fleet proved delegation + amalgamation under fog of war, but the captain's
choices are *forced*: one scout goes to the nearest frontier, one fighter clears the
one blocking monster, the captain marches when the exit is reachable. There is
nothing to decide, so making the captain a model would be theatre. The swarm removes
that: with five scouts and two fighters over a large branching maze, the captain
faces genuine **allocation under partial information** — which scout to send where,
which fighter to send to which newly-found monster, when to stop exploring and
commit. That is where an LLM in the command seat means something.

The thesis sharpens: starship's whole claim is *the harness is a worker* — control
down, data up, state threaded, every order gated and logged. The swarm puts the
**model at the orchestration layer** instead of the leaf: a language model running a
real delegation hierarchy where it *cannot* cheat, because the registries and the
reason-gate bound everything it can say.

## 2. Robin's design, verbatim

> make it much larger. With say five scout agents and two fighter agents and multiple
> monsters with more branching so the captain has to decide, for example, which fight
> agent to send to a newly discovered monster and which different directions to send
> out the scout objects

> the captain should be an LLM

Hold to this. The two load-bearing phrases are **"the captain has to decide"** (real
contention for scouts and fighters) and **"the captain should be an LLM"** (the
decision-maker is a model, not a heuristic).

## 3. The theory it instantiates (so the code reads as the maths)

- **N-ary amalgamation is where the M1 laws earn their keep.** The captain now folds
  *five* scout reports into its fog each planning step. Because `mergeFog` is a
  commutative, associative, idempotent join (law-tested in `fog_test.ts`), the
  captain's map is the same regardless of the order the reports arrive — folding over
  N is well-defined *because* of those laws. The fleet merged one report at a time
  and never exercised this; the swarm does, every tick.
- **Parallel scouts are a tensor, not a product (the §9 trap).** Five scouts, all
  reports owed, no dependency between them = `tensorC` (nest it, or an n-ary fixed-
  order variant). It is emphatically not `productC` ("answer one"). The dispatch of
  fighters then *depends* on the merged reports, so the planning step is
  `seqC(tensor-of-scouts, captain-plan)` — ask (all scouts), then decide.
- **The LLM captain is an oracle behind a decoder — at the orchestration layer.** A
  model is `String → String`; presenting it as `plan : State → Plan` is a promise
  kept by a validator. An assignment to a non-existent scout, an unknown cell, or a
  dead monster does not decode and is rejected (fall back to the greedy plan for that
  item). "The decoder is the only thing that establishes the contract" now guards the
  captain, not just the leaf.
- **Permission is unchanged and still absolute.** The captain-LLM chooses only among
  `assign_scout` / `dispatch_fighter` / `march` / `hold`; every resulting move or
  attack still passes the registry allowlist and the reason-gate. A hallucinated order
  is a *refused position*, never an escape hatch.
- **Assignment is a new pole.** The fleet sat at the semilattice-join pole (the fog).
  The swarm adds the *matching/assignment* pole (scout→frontier, fighter→monster) —
  the family's `three-dates`/`preshill` axis — on top of the join. Naming the pole:
  **semilattice-join × assignment × model-as-orchestrator.**

## 4. Concrete design

### 4.1 The world grows (trivial — the groundwork is done)

`MazeWorld.units[]` and `--unit <id>` already support any number of units; monsters
are already a list. So this is seed data:

- A larger maze: `scratchpad/genmaze.ts` is parameterised by cell dims `(C, R)`. Bump
  it (see decision 1 for size), regenerate, paste the walls as `seedSwarm()`.
- Units: `scout-1..scout-5` (speed 5), `fighter-1..fighter-2` (speed 1), `captain`
  (speed 1). All stacked at the entrance, as the fleet starts.
- Monsters: several (decision 2), placed on branches — not only the single solution
  corridor, so some are on dead ends the captain can choose to *ignore*.

Keep the fleet's `seedFleet()` and its demo working unchanged.

### 4.2 The scheduler — the core architectural change

The fleet is two-phase and sequential: one scout explores to completion, then one
fighter clears to completion, then the captain marches. **That shape does not survive
contention.** Replace it with a tick-based scheduler over a *pool* of agents.

Give each agent a state: `idle | exploring | travelling | fighting | done`. One
**tick**:

1. advance every *active* agent by its `speed` (scouts explore toward their assigned
   target; fighters step along their assigned path, then attack; the exiting unit
   steps toward the exit);
2. collect what each did/saw (sightings, kills, arrivals);
3. fold all sightings into the captain's fog (the N-ary join);
4. hand the captain the current **state** and let it **re-plan** — assign idle
   scouts to frontiers, idle fighters to known monsters, and decide march/hold.

Determinism rule (critical): process agents in a **fixed id order** within a tick and
execute their CLI calls **serially** — never `Promise.all` over agents that mutate the
shared world file, or the move order (and the audit log) becomes non-reproducible.
`tensorC` means "all replies owed," *not* "executed concurrently"; serialise it.

Re-plan on events, not every tick, to bound LLM calls (decision 6): call the captain
only when an agent goes idle, or a new monster/exit is discovered.

### 4.3 The `CaptainBrain` seam (the key reuse)

Mirror `ScoutBrain` exactly (`src/fleet/scout.ts` is the template):

```ts
export type Plan = {
  scouts: { id: string; toward: Pos }[];       // send these scouts to these frontiers
  fighters: { id: string; target: string }[];  // send these fighters to these monsters
  march?: { unit: string };                     // commit this unit to the exit
};
export type CaptainBrain = {
  readonly name: string;
  plan(state: CaptainState): Promise<Plan>;     // State = the captain's fog + agent pool
};
```

`CaptainState` is what the captain may see — **its fog only**, plus the agent roster
(id, pos, state, hp), known monsters, the frontier set, and the exit if discovered.
Never the true maze.

### 4.4 The scripted captain (the deterministic default)

`scriptedCaptainBrain()` — greedy, keyless, deterministic (keeps `verify.sh` byte-
identical):

- **Scouts → frontiers:** partition `frontier(fog)` among the idle scouts so they fan
  out. Greedy: cluster frontier cells, assign each idle scout its nearest unclaimed
  cluster (a Voronoi/cost partition is the prettier version — decision 7). This is the
  "different directions" Robin wants.
- **Fighters → monsters:** for each known monster blocking a needed route, assign the
  nearest *idle* fighter by path length (`pathOverFog`). If all busy, queue. (Optimal
  Hungarian matching when several monsters surface at once is the prettier version.)
- **March:** once a safe known-floor route to the exit exists for the chosen unit.

### 4.5 The LLM captain (`--live`)

`modelCaptainBrain(client)` — the point of the whole plan:

- **Serialise the state** into the prompt: the ASCII fog (`fogMap()` already renders
  it), then a compact roster — `scout-3: idle @(12,7)`, `fighter-1: fighting goblin-2`,
  `monster orc-1 @(20,9) known, unassigned`, `frontier: (…), (…)`, `exit: not found`.
- **Tools** = the assignment primitives: `assign_scout(scout_id, x, y)`,
  `dispatch_fighter(fighter_id, monster_id)`, `march(unit_id)`, `hold()`. Each tool
  takes a `reason` (the reason-gate discipline, now on orders).
- **Validate every item** (the decoder): scout id idle and exists; `(x,y)` is a known
  frontier (or at least known-floor); fighter id idle; monster id known and alive;
  march unit has a safe route. Invalid items are dropped and the *greedy* plan fills
  that slot — so a weak model can slow or mis-prioritise, but never break or cheat.
- **Reuse** `src/agent/{model,groq}.ts` unchanged (the `ModelClient`, the 429 backoff).
  On `--live`, use `realIds`/`realClock` (PR #1): a live audit must carry true
  timestamps. The model's reasons flow into the intent-log per order.

### 4.6 The scout gains a target

The scout's shape becomes `{ tag: "explore", toward: Pos }`: head toward the assigned
frontier (BFS over known-floor), exploring as it goes, same retreat-on-monster and
report-sightings behaviour. The scout's own hidden fog and the `ScoutBrain` (for
junction choices within its assigned region) are unchanged. The *captain* now says
where; the scout still says how.

### 4.7 Orchestration with the combinators

One planning step reads as `seqC(tensorC(scout₁ … scout₅), dispatch)`: gather all
scout reports (tensor, serialised in fixed order), fold into the fog (the join),
then the captain's plan chooses the fighter dispatches and march (the dependent
`next`). The scheduler iterates these steps. Study `src/fleet/fleet-captain.ts` — the
`seqC` round and the merge-inside-`next` are the working precedent; the new parts are
the n-ary tensor and the plan-as-a-set-of-assignments.

### 4.8 The demo + website

`src/swarm-demo.ts` + `deno task swarm`. The trace format is already unit-generic
(`site.ts` reads `world.units` and draws by glyph), so most of it carries over.
Needs: distinct glyphs/colours for `scout-1..5` and `fighter-1..2`; a per-agent status
panel; and the captain's current **plan + reasoning** shown each planning step (this
is the star of the LLM version). Watch the trace size — a larger grid × many frames ×
a full fog per frame gets big; store the fog as deltas or only on change, or thin
frames (decision 8). Print the true maze only at the end, as the fleet does.

## 5. Open decisions — ASK ROBIN before building

1. **Maze size.** Proposed ~20×14 cells (41×29 grid): big enough for five scouts to
   fan out and a dozen dead ends. Bigger is more impressive but means longer runs,
   larger traces/sites, and more LLM calls. Confirm the size.
2. **Monster count & placement.** Proposed ~6–8, some on *dead-end* branches (not just
   the exit route) so the captain can choose to ignore them — real prioritisation.
3. **Are the scouts/fighters also LLMs?** Proposed: **no** — scripted executors under
   an LLM captain. The interesting decisions are at the captain; LLM sub-agents
   multiply cost, latency, and non-determinism for little gain. (The `ScoutBrain`
   seam still allows `--live` scouts if wanted.) Confirm.
4. **Win condition.** Proposed: the captain decides which unit reaches the exit and
   when to commit (the LLM's call). Alternatives: captain itself exits (as the fleet);
   clear-all-monsters; any-unit-exits. Confirm — this shapes the LLM's goal.
5. **Does the captain march itself, or command a unit to the exit?** With a swarm,
   "dispatch a scout/fighter to the exit" is a cleaner LLM decision than the captain
   walking. Confirm.
6. **Planning cadence.** Proposed: re-plan on events (an agent goes idle / a monster
   or the exit is discovered), not every tick — bounds LLM calls to a few dozen.
7. **Assignment quality.** Greedy (nearest) first; optimal (Voronoi frontier
   partition, Hungarian fighter matching) as a later pass. Confirm greedy-first.
8. **Trace/site size.** Store the fog as deltas or thin frames for the larger grid?
   Proposed yes. Confirm, or accept a bigger self-contained HTML.
9. **Monsters static or moving?** Proposed static first (as the fleet), so the fog
   stays a monotone join. Moving monsters are a later, harder phase.

## 6. Milestones

Get each green (`check` + `test` + `verify.sh`) before the next. Do **not** build the
LLM captain before the scripted scheduler solves deterministically.

1. **Bigger maze + N-unit `seedSwarm()`** — regenerate the maze, place 5+2+1 units and
   the monsters. The fleet demo must still pass byte-identical.
2. **Agent-state model + the fog fold over N reports** (the join is already law-tested;
   add the N-ary fold and a test that report order doesn't matter).
3. **The scheduler + scripted greedy captain** — tick loop, fixed-order execution,
   scout→frontier partition, fighter→nearest-monster, march. Solve deterministically.
4. **The `CaptainBrain` seam** — refactor the scripted captain behind it; the scheduler
   calls `brain.plan(state)`. `verify.sh` byte-identical.
5. **The LLM captain** — serialise state, the assignment tools, parse/validate/fallback,
   `--live`. A stub-model test (no key) proving the plumbing solves, mirroring
   `fleet_test.ts`.
6. **The website** — per-agent glyphs/colours, status panel, the captain's plan +
   reasoning per step; trace deltas for size.
7. **Determinism + reconcile + `swarm.tex`**; extend `verify.sh`; validate `--live`
   against Groq and record the result (as the fleet did).

## 7. Reuse unchanged

`src/maze/fog.ts` (the join, `frontier`, `frontierField`, `progressDirections`,
`exitCell`, `unknownCount` — all already N-ready), `src/fleet/ops.ts` (per-unit
dispatch, `pathOverFog`), `src/fleet/scout.ts` (the `ScoutBrain` pattern is the
template for `CaptainBrain`; the scout leaf needs only the `toward` target),
`src/agent/{model,groq}.ts` (the `ModelClient` seam + 429 backoff, reused verbatim),
`src/log/*` (two logs + reconcile + the `ids` seams — remember PR #1: `--live` uses
`realIds`/`realClock`), `src/fleet/site.ts` (extend; the trace is already unit-generic),
and `src/lib/algebra.ts` (the combinators). Do **not** re-solve any of these.

## 8. Verification

`deno task check`; `deno task test` (add: the N-ary fog fold is order-independent; the
scheduler solves with the scripted captain; the fog stays partial; the logs reconcile
across all agents; a stub-model captain solves and an off-menu plan falls back to
greedy — mirror `fleet_test.ts`); `deno task swarm` twice byte-identical with the
scripted captain; `./verify.sh` extended; then validate `--live` against Groq and
record the numbers.

## 9. Confidence and risks

- World/seed/bigger maze/N-ary fold: **high (~90%)** — mechanical over proven code.
- Scheduler + determinism: **medium (~70%)** — the main risk. Fixed-order serial
  execution within a tick is the key; get it wrong and replay diverges. Build and
  `verify.sh` after *every* scheduler change, not at the end.
- Scripted greedy assignment: **medium-high** — standard multi-robot frontier
  exploration; greedy is simple.
- `CaptainBrain` seam: **high** — the `ScoutBrain` pattern is proven; this is the same
  move one level up.
- LLM captain **plumbing**: **medium-high** — reuses the whole model stack. LLM
  **decision quality** over a serialised fog: **unknown, model-dependent** — the
  guardrails guarantee it never breaks or cheats (invalid → greedy fallback), but
  "the model commands *better* than greedy" is unprovable until run. Same honesty as
  the scout `--live`, higher stakes.
- Scope: this is ~6–7 files plus a scheduler that replaces the fleet's two-phase loop.
  Milestones 1–3 (scripted, deterministic) are the real foundation; land them before
  the model. Estimated **~4–6 focused days** total.

## 10. Read these first

- `PLAN-scout-fighter.md` + `fleet.pdf` — the fleet this extends; the brain seam,
  the fog, existential hiding.
- `src/fleet/fleet-captain.ts` — the `seqC` round and merge-inside-`next`; the
  precedent for the planning step.
- `src/fleet/scout.ts` — the `ScoutBrain` seam (scripted + model); the exact template
  for `CaptainBrain`, and where the scout's `toward` target lands.
- `src/fleet/ops.ts`, `src/maze/fog.ts` — the pathing and the join the scheduler and
  the greedy captain plan on.
- `~/git/harness/toy-harness-is-a-worker.pdf` and `go-versus-typescript.md §3` — the
  nested-worker / `spawn_agent` framing; the LLM captain is a worker whose sub-agents
  are workers.
- `~/git/gold/from-neil/neil-containers.md §9` — the ⊗-vs-× and ◁-over-+ traps, which
  bite when wiring the n-ary tensor of scouts and the dependent dispatch.
- External: "multi-robot frontier-based exploration" (the scout-assignment problem)
  and the Hungarian algorithm (the optimal fighter-matching), for milestone 3's
  assignment policies.
