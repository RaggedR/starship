# PLAN — the scout/fighter fleet (a handoff for the next instance)

**Version 0.1 — 2026-10-30. Author: the instance that built the single-agent maze.**

---

## STATUS: BUILT (2026-10-30) — `deno task fleet`

Milestones 1–6 are done and green (63 tests, `verify.sh` byte-identical on all
three demos). Robin revised the design verbatim while building; the code follows
his revisions, not this plan's original §5 defaults:

1. **The captain MOVES to the exit** (plan §2 said "moves nothing itself"). It is a
   blind piece with registry `{move}`, advancing only on revealed-safe ground. "The
   captain reaches the exit" is the win condition.
2. **The scout gets 5 moves per dispatch** (not 2) and ranges autonomously; the
   round is `seqC(scout, fighter)` precisely because the scout is faster — it goes
   ahead, retreats, reports, and only then is the fighter sent (decision 3: blind
   fighter; decision 4: scripted captain; decision 5: static monsters — all taken).
3. **All three units start stacked** on the entrance, which retired the M2
   unit-unit collision rule (it would deadlock backtracking in 1-wide corridors);
   only walls and monsters block now.
4. **Terrain/occupancy split in the fog** (`src/maze/fog.ts`): terrain is a monotone
   join (`unknown ⊑ {floor,wall,exit} ⊑ conflict`); monsters live in a separate,
   revisable dict so a kill doesn't violate monotonicity. `mergeSighting` retracts a
   monster seen gone.
5. **Big maze + website**: a 21×15 deterministic perfect maze (path 71, 10 dead
   ends; `scratchpad/genmaze.ts` generated it, pasted as `seedFleet()` data). The
   demo writes `moves.txt`, `trace.json`, and a self-contained `index.html` replay
   (`src/fleet/site.ts`) animating the solve with the captain's fog lifting over the
   true maze. The captain reaches the exit with 136/315 cells still `unknown`.

Milestone 7 done too: `fleet.tex`/`fleet.pdf` (parallels `maze.tex`), and `--live`
— the scout's per-step choice is a `ScoutBrain` seam (scripted BFS default, a Groq
model on `--live` that chooses which branch to explore at junctions). The fighter
(mechanical) and captain (deterministic orchestrator, decision 4) stay scripted by
design — the scout is the only agent whose choices a model meaningfully makes. The
`--live` plumbing is covered by stub-model tests (no key needed); `verify.sh` stays
byte-identical on the scripted default. **Validated live** on Groq
`openai/gpt-oss-120b`: captain solved in 16 rounds, 136/315 unknown, reconciliation
clean, the model's own reasons recorded at junctions. The scripted replay is deployed
to GitHub Pages: <https://raggedr.github.io/starship/>.

---

This plan is the next step after the maze agent (merged in PR #1). Read it with
[`maze.pdf`](maze.pdf) open, and [`PLAN.md`](PLAN.md) §9 for where the maze stands.

---

## 1. Why this exists

The maze today runs **one** agent (the adventurer) through the five-part loop. The
showpiece's tagline — "orchestrated by delegation and amalgamation" — is proven by
the star-system *bridge*, not the maze. This plan makes the maze demonstrate real
delegation and amalgamation, and does it on the sharpest possible example:
**partial observability**. The captain acts on a map it cannot see directly, only
on what scouts report. That is existential hiding made visible.

## 2. Robin's design, verbatim

> only the "scout agents" can generate the map. The captain can't see the whole
> map, only where the scout agent has explored and reported back. Only the fight
> agent can move, it receives move instructions from the captain. the scout agent
> moves independently and has the map. So the scout agent explores, sees a monster
> and retreats. Reports back to the captain with the updated map and the captain
> sends out a fight agent to fight the monster.

Hold to this. The three roles and their asymmetry are the point:

- **Scout** — moves on its own, perceives, builds the map, retreats on contact,
  reports. **Cannot fight.**
- **Captain** — sees only the merged reports (a fog-of-war map), never the true
  maze. Decides. Issues orders. **Moves nothing itself.**
- **Fighter** — moves and attacks **on the captain's orders**. The captain's
  control of the board is exercised only through the fighter.

## 3. The theory it instantiates (so the code reads as the maths)

- **Existential hiding is real here, not decorative.** The captain's state `S` is
  the partial map. The true `MazeWorld` is hidden behind the scout's reports.
  This is MacBeth's nested worker whose store is existentially hidden
  (`~/git/harness/toy-harness-is-a-worker.pdf`), not a re-theme of it.
- **Amalgamation becomes a join, not a gather.** The star-system captain gathers
  two reports into a tuple (`tensorC`). Here the captain merges each scout report
  into its map. A cell is a point on a small semilattice
  `unknown ⊑ {floor, wall, exit, monster}`, and the merge is the join. This is
  closer to the treasury's "real algebra" pole and to `~/git/gold/org-chart`'s
  semilattice roll-up than to the star system's gather. Make the merge a law-tested
  function (idempotent, commutative, associative) — that is the amalgamation.
- **Permission is disjoint registries.** Scout = `{look, move}` (no attack).
  Fighter = `{move, attack}`. Captain holds neither; it holds the authority to
  delegate. This is "Science is read-only, Weapons cannot steer" re-themed, and it
  is enforced by `runMutation`'s registry gate exactly as today.
- **Each sub-agent is a nested worker.** A scout, given "explore from here", runs
  its OWN look/move loop until it retreats, then returns a typed report. That is a
  worker `∆S ⊗ X → Y`. The captain composes workers. This is the thick-leaf /
  `spawn_agent` shape from `go-versus-typescript.md` §3.

## 4. Concrete design

### 4.1 The world gains units

The maze today has one `hero`. Give it named **units**, each with its own position
and hp:

```ts
export type Unit = { readonly id: string; readonly pos: Pos; readonly hp: number; readonly atk: number };
export type MazeWorld = {
  readonly width; readonly height; readonly walls;
  readonly units: readonly Unit[];   // e.g. "scout", "fighter"
  readonly monsters; readonly exit;
};
```

`look`/`move`/`attack` become **per-unit** (`--unit scout`). A unit cannot enter a
wall, the edge, a monster, **or another unit's cell**. Monsters stay static for the
first cut (document it; fog merge is simpler when sightings do not expire).

### 4.2 The fog-of-war map (the captain's state)

A new pure module `src/maze/fog.ts`:

```ts
export type Known = "unknown" | "floor" | "wall" | "exit" | "monster";
export type FogMap = { width; height; cells: Known[][]; monsters: Record<string, Pos>; exitSeen: boolean };
export function emptyFog(w, h): FogMap;           // all unknown
export function mergeSighting(fog, look): FogMap; // join a scout's look into the map
export function mergeFog(a, b): FogMap;           // join two maps (law-tested)
export function frontier(fog): Pos[];             // known-floor cells adjacent to unknown
```

`mergeFog` is the amalgamation. Test it: idempotent, commutative, associative, and
monotone (knowledge never decreases).

### 4.3 The three agents

Reuse the whole harness: `runMutation`/`conRead` (`src/bridge/harness.ts`), the two
logs, reconcile, and the `ModelClient` seam. Each agent is a `Runner` leaf whose
answer function runs a mini-loop, or a thin leaf that answers one shape — decide per
§5 decision 4.

- **Scout** (`agent:scout`, registry `{look, move}`). Shape: `{explore, from}`.
  Behaviour: step toward the nearest `frontier` cell, `look` each step, and when a
  `look` reveals a monster adjacent-or-ahead, **stop and return** a report
  `{ fogDelta, sightings, scoutPos }`. Never attacks. The retreat is just "stop
  advancing and hand control back"; an explicit walk-back is optional polish.
- **Fighter** (`agent:fighter`, registry `{move, attack}`). Shape:
  `{ engage, target, path }` or `{ goto, path }`. Behaviour: follow the captain's
  path; when adjacent to `target`, `attack` until it dies; report
  `{ fighterPos, killed }`. Never calls `look` (it is told where to go — or give it
  `look` too and let the captain decide; a decision below).
- **Captain** (`agent:captain`). State: a `FogMap`. Loop: dispatch the scout to
  explore → `mergeSighting`/`mergeFog` the report → if a monster blocks the route to
  the exit, compute a path on the KNOWN map and dispatch the fighter to clear it →
  repeat until a unit can reach the exit on known-floor. The captain plans only on
  `fog`, never on the real world — enforce this by not giving the captain the world
  object at all.

### 4.4 Orchestration with the container combinators

Wire the captain to the scout and fighter through `src/lib/algebra.ts`
(`Runner`, `leafLocal`, `seqC`, `tensorC`), the same library the star-system captain
uses in `src/bridge/captain.ts`. Model the round as `seqC(scout, fighter)` when a
monster is found, or scout-only when the way is clear. The captain's `fog` threads
through as its state. Study `src/bridge/captain.ts` first; it is the working
precedent for amalgamation via these combinators.

### 4.5 The demo

`src/fleet-maze-demo.ts` + a `deno task fleet`. Show, each round: the captain's
**fog map growing** (print `FogMap`, not the true maze), a scout report, a monster
discovered, a fighter dispatched and the kill, and finally a unit reaching the exit.
Print the true maze only at the very end, to make the point that the captain never
had it. The two-log + reconcile still hold, now with `agent:scout` and
`agent:fighter` as distinct actors in the intent-log.

## 5. Open decisions — ASK ROBIN before building

1. **Units vs party.** This plan gives the scout and fighter **separate positions**
   (two pieces on the board), matching "the scout retreats, the captain sends the
   fighter". Confirm — the alternative (one party, scout/fighter as roles) loses the
   "retreats" behaviour.
2. **Win condition.** Proposed: get a unit (the fighter) to the exit, fighting only
   monsters that block the known route. Confirm vs "clear all monsters" or "any unit
   reaches the exit".
3. **Does the fighter `look`?** Proposed: the fighter is blind and follows the
   captain's path (purest division of labour — only the scout perceives). The
   alternative gives the fighter `look` for safety. Robin's "only scouts can
   generate the map" argues for a blind fighter.
4. **Captain: scripted or model?** Proposed first cut: **scripted captain**
   (deterministic orchestration), with scout and fighter each a `ModelClient`
   (scripted by default, `--live` optional). Then promote the captain to a model.
   This keeps `verify.sh` byte-identical while the hard part (fog + delegation) is
   proven.
5. **Do monsters move?** Proposed: **static** first (fog sightings never go stale).
   Moving monsters make the fog merge a harder (expiring) join — a later phase.

## 6. Milestones

1. **Fog module** (`src/maze/fog.ts`) + law tests for `mergeFog`. Pure, no agents.
2. **Multi-unit world**: `Unit[]`, per-unit `look/move/attack`, unit-unit collision;
   update `src/maze/{types,world,gates}.ts`, `src/cli/dungeon.ts` (a `--unit` flag),
   and `mazeMap`. Keep the single-agent demo working (one unit named `hero`).
3. **Scout leaf**: explore-and-retreat worker returning a report; registry `{look, move}`.
4. **Fighter leaf**: path-follow-and-attack worker; registry `{move, attack}`.
5. **Captain**: fog state, delegate→merge→dispatch loop via `src/lib/algebra.ts`.
6. **Demo + determinism + reconcile + tests**; `deno task fleet`; extend `verify.sh`.
7. **`--live`** per agent; extend `maze.tex` (or a new `fleet.tex`) with the
   fog-of-war / existential-hiding story.

## 7. Reuse unchanged

`src/bridge/harness.ts` (registry + reason-gate + intent-log), `src/log/*` (two
logs + reconcile), `src/log/ids.ts` (seeded vs real seams — remember PR #1's fix:
`--live` must use `realIds`/`realClock`), `src/agent/{model,groq,scripted,loop}.ts`
(the `ModelClient` seam and the loop; scout/fighter mini-loops can reuse `dispatch`),
and `src/lib/algebra.ts` (the combinators). Do **not** re-solve any of these.

## 8. Verification

`deno task check`; `deno task test` (add fog laws, multi-unit gates, a scout
explore-and-retreat test, a captain-solves-with-fog test asserting the captain's
final `fog` is still partial — it must NOT equal the true maze); `deno task fleet`
twice must be byte-identical with the scripted captain; `./verify.sh` extended.

## 9. Confidence and risks

- Fog module, multi-unit world, gates, tests: **high (~90%)** — mechanical over the
  proven spine.
- Captain orchestration via the combinators: **medium-high** — the `tensorC`
  precedent exists in `src/bridge/captain.ts`; `seqC` threading of the fog state is
  the new part. Read that file first.
- Risk: scope. This is 5–7 files and a new demo. Build milestone 1–2 and get them
  green before the agents. Do not build the captain before the fog laws pass.
- Risk: determinism. Multiple agents interleave; keep every seam seeded in the
  scripted path and confirm `verify.sh` after every milestone, not just at the end.

## 10. Read these first

- [`maze.pdf`](maze.pdf) — the single-agent maze this extends.
- `src/bridge/captain.ts` — the working delegation/amalgamation precedent (`tensorC`).
- `src/lib/algebra.ts` — the combinators the captain composes with.
- `src/agent/loop.ts` — the loop and `dispatch`; scout/fighter reuse this shape.
- `~/git/harness/toy-harness-is-a-worker.pdf` — the worker / `spawn_agent` note,
  and the thick-leaf (nested worker, existentially hidden store) framing the
  captain-over-scout-and-fighter design rests on.
