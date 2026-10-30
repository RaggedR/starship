# starship

**Typed agents with custom harnesses, operating a clean CLI surface with logged
reasoned actions, orchestrated by delegation and amalgamation.** A small fleet run
from the bridge: typed officers (Science is read-only, Helm cannot fire, Weapons
cannot steer) report up to a captain who decides and acts. The audit is the
*ship's log*.

See [`PLAN.md`](PLAN.md) for the full design and [`english.txt`](english.txt) for
the plain-English picture. The structural idea — a worker as a container morphism
`∆S ⊗ X → Y`, the gate as a smart constructor, nesting as existential hiding — is
MacBeth's Note 5, *The toy harness is a worker*
(`~/git/harness/toy-harness-is-a-worker.pdf`), sent in
`~/git/harness/2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`.

## Run it

Requires [Deno](https://deno.com) (2.x).

```bash
deno task demo     # the star-system showpiece in one run (~1 min to read)
deno task maze     # a real agent navigating a maze and fighting monsters
deno task test     # 41 unit/contract tests
deno task check    # type-check — the typed gold plug compiling is the point
./verify.sh        # check + test + prove both demos replay byte-identically
```

Drive the CLI directly:

```bash
deno task con -- scan
deno task con -- status --ship NCC-1 --format table
deno task con -- helm burn --vector 2000,0 --reason "evading the minefield"
deno task con -- weapons fire --target minefield-A --reason "clear it"   # refused: no authorization
```

(State persists to `starship-state.json` and `ships-log.jsonl` in the working
directory; delete them to reset.)

## The maze — a real agent solving a problem, on a free model

The bridge above is driven by *scripted* officers (deterministic stand-ins for a
model). The maze is the other half: a genuine agent in the five-part harness loop
(client · conversation · outer loop · **inner model-call loop** · tool dispatch)
*solving* something — navigate a grid, fight the monsters blocking the way, reach
the exit.

```bash
deno task maze                       # scripted BFS solver — no API key, deterministic
GROQ_API_KEY=... deno task maze -- --live   # a real, FREE model (Groq) drives the loop
deno task dungeon -- look            # drive the maze CLI directly
deno task dungeon -- move --dir E --reason "head east toward the exit"
```

- **Free model instead of Anthropic.** The whole model surface is one interface,
  `ModelClient` (`src/agent/model.ts`) — a neutral `ToolCall`/`ToolResult`
  boundary that keeps the dispatch independent of any model SDK. `src/agent/groq.ts`
  is the *only* file that knows a wire format: a `fetch` to Groq's free,
  OpenAI-compatible endpoint (point `GROQ_BASE_URL` at Cerebras, OpenRouter, or a
  local Ollama to switch, no code change). `src/agent/scripted.ts` is a
  deterministic BFS solver so the demo and tests run with no key and replay
  byte-identically.
- **The agent's only hands are five allowlisted capabilities** — `look`, `hero`,
  `map`, `move`, `attack`. The allowlist *is* the permission grant; there is no
  `bash`. `move`/`attack` require a reason, enforced by the same reason-gate as the
  bridge.
- **The log is the solution trace.** Every move and attack lands in the ship's log
  with its reason in the intent-log; reconciliation proves the agent never moved
  the maze except through a reasoned, logged order. An illegal step (into a wall)
  is refused and visible only in Layer 2 — a refused move and a wall feel the same
  from inside.

## What the demo shows

1. A **star map** of the system — one ship, a minefield off the port bow.
2. The **captain delegates**: asks Science to assess (⊗ Engineering for power),
   amalgamates their reports, asks Helm to propose an escape burn, decides, and
   **issues the order with a reason** — which commits and lands in the ship's log.
3. An **illegal order** (a burn costing more fuel than remains) is **refused** —
   and from the bridge a refused order and a jammed engine look identical.
4. The **two logs**: Layer 1 (ship's log — *what* committed, no reason) and Layer 2
   (intent-log — *why*, and what was only attempted or refused).
5. **Reconciliation** cross-checks them, then catches a mutation made *outside* the
   bridge — a change to the world with no logged reason — which the ship's log alone
   could never reveal.

## Layout

| Path | What |
|---|---|
| `src/world/` | the deterministic world: `types`, `world` (reducers), `gates` (smart constructors), `seed`, `store` |
| `src/log/` | `ids` (seeded/real seams), `shiplog` (Layer 1), `intentlog` (Layer 2), `reconcile` |
| `src/lib/algebra.ts` | the gold container combinators (`sumC/tensorC/productC/seqC`, `Runner`), vendored in-process |
| `src/cli/` | `con` (the star-system executable), `dungeon` (the maze executable), and `format` (json/table + star map + maze map) |
| `src/bridge/` | `containers` (each officer's typed surface), `officers`, `harness` (registry + reason-gate + intent-log), `captain` |
| `src/maze/` | the maze world: `types`, `world` (reducers + `look`), `gates` (move/attack smart constructors), `seed`, `store` |
| `src/agent/` | the agent: `model` (the `ModelClient` seam + tool specs), `groq` (free OpenAI-compatible backend), `scripted` (deterministic BFS), `loop` (the five-part model loop) |
| `src/fleet/flagship.ts` | nesting — a flagship delegating to ship-captains |
| `src/demo.ts`, `src/maze-demo.ts`, `verify.sh` | the two end-to-end demos and their determinism checks |

## Design anchors

- **Gates in `src/world/gates.ts`** — fuel, power conservation, weapons
  authorization, dock range/alignment, cargo ownership. Each returns
  `Ok(effect) | Refused(reason)`; a refusal is a *position*, not an exception.
- **The registry is the permission grant** (`src/bridge/harness.ts`) — each officer
  carries an allowlist of `con` commands; a command not in it cannot be invoked, and
  the container type stops an out-of-surface shape from even being asked.
- **The reason-gate** — a mutating order with no reason is refused before `con`, and
  the refusal is recorded in Layer 2.
- **Determinism** — ids and the clock are injectable seams (`seededIds`/`fixedClock`
  for the demo, `realIds`/`realClock` for real use), so the demo replays byte-identically.
