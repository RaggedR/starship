# starship — PLAN

**Version 0.1 — 2026-10-29**

A portfolio showpiece for **typed agents with custom harnesses, operating a clean
CLI surface with logged reasoned actions, orchestrated by delegation and
amalgamation.** The legible-and-fun pole. A small fleet run from the bridge.

> Orientation for a future instance — this rests on the harness theory in
> `~/git/harness/` and the container framework in `~/git/gold/`; the
> Cross-references at the foot of this file name the specific documents.

---

## 1. Why this domain

- **Self-contained and deterministic.** A toy star system is a simulation with no
  database, no network, no PII. It runs in seconds and gives the same answer
  twice, which makes it both unit-testable and demo-able.
- **The logging is thematic, not bolted on.** The audit is the *ship's log* — "a
  record of every action and why it was taken" is the oldest trope in the genre.
  The intent-log requirement explains itself.
- **The permission model states itself in one breath.** "Helm cannot fire,
  Weapons cannot steer" is per-agent allowlists that a viewer believes before you
  mention containers.
- **Finishable.** Unlike a real production system, a toy fleet has an end.

## 2. The CLI surface

One executable, working name `con` (the conn). A single-command CLI surface in
the style of a production admin CLI: one executable, every capability a subcommand.

- Global flags — `--format json|table` (JSON is machine-readable, the default for
  agents), `--ship ID`, `--reason TEXT` on every mutation.
- Exit codes — `0` success, `1` refusal/failure to stderr.
- An append-only **ship's log** (the audit), one JSONL line per committed
  mutation, each with a correlation id. This is the CLI's own tamper-evident
  record — the analogue of a production system's append-only audit table.

**Read (free, no reason):**

| Command | Returns |
|---|---|
| `scan` | sensor sweep — nearby objects, hazards, bearings |
| `status --ship X` | hull, power budget, fuel, position, heading |
| `manifest --ship X` | cargo and crew |
| `log recent [--n N]` | recent ship's-log entries |
| `log trace <corr-id>` | one entry by correlation id |

**Mutate (audited, reason required):**

| Command | Effect | Gate (smart constructor) |
|---|---|---|
| `helm burn --vector V` | spend fuel, change trajectory | burn exceeding fuel is refused arithmetically |
| `power route --to shields\|weapons\|engines` | reallocate the power budget | total routed power cannot exceed 100% |
| `weapons fire --target T` | fire | requires a captain's authorization token (propose → authorize → fire) |
| `dock --station S` | dock | must be in range and aligned |
| `transfer --cargo C --to X` | move cargo between ships | capacity and ownership checked |

The gates are the point. A refused `weapons fire` and a jammed weapon look
identical from the bridge — MacBeth's "a denied command and a broken tool look
the same from inside" (`~/git/harness/toy-harness-is-a-worker.pdf`, §5; sent in
`~/git/harness/2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`).

## 3. The agents — typed, with disjoint sub-surfaces

Each officer is a custom harness whose **registry is a different sub-container of
the CLI** (the permission-as-allowlist model).

| Agent | Allowed commands | Role |
|---|---|---|
| **Science** | `scan`, `status`, `manifest`, `log *` | read-only. Returns a threat-and-opportunity assessment. A pure answerer — a thin leaf. |
| **Helm** | `helm burn`, `dock` | navigation only. Proposes and executes burns. Cannot fire. |
| **Weapons** | `weapons fire` (behind the gate) | cannot steer. Fires only on an authorized target. |
| **Engineering** | `power route`, `transfer` | resource allocation. |
| **Captain** | holds the authorization token, issues reasoned orders | delegates to the four, amalgamates their reports, decides. |

## 4. The orchestration — gold delegation and amalgamation

This is the layer that plugs into `~/git/gold/dungeon/lib/algebra.ts`.

- **Control flows down.** The captain delegates "assess the situation" to Science
  and "plot an escape burn" to Helm. Each officer is a worker `∆S ⊗ X → Y`
  (MacBeth's Note 5, *The toy harness is a worker* —
  `~/git/harness/toy-harness-is-a-worker.pdf`, sent in
  `~/git/harness/2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`).
- **Data flows up and amalgamates.** Each officer returns a typed *position* — an
  assessment, a proposed burn with a fuel estimate — that the captain amalgamates
  into one situation picture. Here amalgamation is a gather (contrast the
  treasury, where it is algebraic summation).
- **It nests.** A flagship captain delegates to each ship's captain, who delegates
  to their own officers. A ship's internal state is existentially hidden from the
  flagship, which sees only the status report one position up. This is
  `~/git/gold/dungeon/harness.ts`'s descend, re-themed.
- **The gate is a smart constructor.** Weapons authorization and the fuel budget
  restrict the delegated shapes, exactly as `check_permission` does in the toy
  harness.

## 5. The two-layer log

- **Layer 1 — the ship's log (the CLI's audit).** Append-only, written by `con`
  when a mutation commits. Records *what happened* with a correlation id.
- **Layer 2 — the harness intent-log.** Written by each officer's harness,
  write-ahead, before the command runs. Records *why* — the officer's reason,
  required on every mutation and refused without. Joined to the ship's log by the
  correlation id.
- **Reconciliation.** Cross-check the two. The alarm condition is a committed
  mutation in the ship's log with no matching intent record — an action with no
  logged reason. A proposed-but-refused action appears only in the intent-log,
  which is information the audit alone could never show.

## 6. Language plan

- **The orchestration and the leaf plugs — TypeScript.** The `Runner<C>` and its
  decoder carry the dependent typing that `~/git/gold/dungeon/lib/algebra.ts`
  needs, which Go cannot express.
- **`con` and each officer's harness — either.** Simplest first build is a thin
  TypeScript leaf, where the engine licenses effects and the officers are mostly
  model calls behind decoders. A thick Go leaf is the alternative if you want
  each officer to be a sealed, deployable binary.
- **Recommended first cut — all TypeScript**, to get the orchestration standing
  against `gold` fast. Port the Weapons officer to a thick Go leaf later as the
  worked example of a cross-language plug.

## 7. Milestones

1. **`con` with a fake world.** The CLI, read commands, the append-only ship's
   log, `--format json`, exit codes. No agents yet. Driven by a scripted move
   list (mirror `scripted()` in `~/git/gold/dungeon/harness.ts`).
2. **The mutating commands and their gates.** Fuel budget, power conservation,
   weapons authorization. Each refusal is a genuine position, logged.
3. **One officer as a leaf.** Science (read-only) as a `Runner` behind a decoder,
   returning a typed assessment. Proves the plug against `gold`.
4. **The full bridge.** Four officers, disjoint registries, the captain
   amalgamating their reports and issuing reasoned orders. The reason-gate
   enforced on every mutation.
5. **Nesting — a fleet.** A flagship captain delegating to ship captains. The
   existential hiding of each ship's state.
6. **Reconciliation + an ASCII star map.** The two-log cross-check, and a printed
   map so a stranger watches the agents reason and act on something visible.

## 8. Definition of done (as a showpiece)

A stranger runs one command, watches a captain delegate to officers, sees each
reasoned order land in the ship's log, sees an illegal order refused, and reads
the reconciliation report — all in under a minute, with the same result twice.

---

## Cross-references

- Theory and SDK — `~/git/harness/` (start at `harness-engineering/start-here.tex`;
  the worker note is MacBeth's Note 5, *The toy harness is a worker* —
  `toy-harness-is-a-worker.pdf`, sent in
  `2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`).
- Container framework — `~/git/gold/` (plug-in contract in
  `dungeon/lib/algebra.ts`, the boundary claim in `dungeon/harness.ts`, the agent
  precedent in `dungeon/leaf-claude.ts`).
- The implementation — this repo's [`src/`](src/), with the two-layer log in
  `src/log/`, the registry and reason-gate in `src/bridge/harness.ts`, and the
  vendored container combinators in `src/lib/algebra.ts`.
- The sibling showpiece — [treasury](https://github.com/RaggedR/treasury).
