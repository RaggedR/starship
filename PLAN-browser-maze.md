# PLAN — an in-browser "new random maze" button for the swarm replay

**Goal.** Add a button to the swarm replay website that, on click, generates a
**brand-new random maze**, solves it, and animates the solve — entirely in the
browser, so it still works on GitHub Pages (static hosting, no server).

**Who this is for.** A fresh agent with no prior context. Read this whole file
first, then `README.md` (the "swarm" section) and the files it references. Repo
conventions still apply: commits are authored as `langer.robin@gmail.com`; the
Deno demos must stay deterministic (`./verify.sh` byte-identical); don't commit to
`main` without being asked (branch first).

---

## 1. The one fact that makes this feasible

The current replay is a **pre-recorded trace**. All maze generation and solving
happens in Deno at build time (`deno task swarm`), which writes
`demo-out/swarm/index.html` with a full `trace.json` embedded in a `<script>` tag.
The page only *animates* that trace — there is **no solver in the browser today**.

The reason we can move the solve into the browser: **starship is a single OS
process with a function-call boundary, not separate processes.** Verified — there
is no `Deno.Command`, `Deno.run`, socket, or `Worker` anywhere in `src/`. The
agents are plain objects in a pool; the maze "CLI" is reached through an injected
function:

```ts
// src/bridge/harness.ts
export type ConRun = (argv: string[]) => { value: unknown };
export type HarnessCtx = { …; readonly conRun: ConRun; … };
```

In the Deno demo (`src/swarm-maze-demo.ts`) `conRun` is wired to call the dungeon
CLI's `run()` **in-process**, passing the world through a JSON file:

```ts
conRun: (argv) => dungeonRun([...argv, "--world", wp, "--log", lp], conIds, conClock)
```

The world's only filesystem coupling is `src/maze/store.ts`
(`Deno.readTextFileSync`/`writeTextFileSync`) — and `store.ts` itself documents the
escape hatch: *"the caller cannot tell where the state lives."* So the port is:
**provide an in-memory `conRun` and in-memory logs; everything else (scheduler,
captain, gates, fog, pathfinding, generator) is pure logic that runs unchanged.**

If the agents/maze *had* been separate processes, this would be infeasible on
static Pages — that's the thing to be glad is not the case.

---

## 2. Hard constraints (do not violate)

1. **GitHub Pages is static.** No server, no Deno runtime. Everything the button
   does must be client-side JS. Publishing is a **manual copy** onto the
   `gh-pages` branch (currently `.nojekyll`, `index.html` = fleet replay,
   `swarm/index.html` = swarm replay). There is no deploy workflow.
2. **The LLM captain CANNOT run client-side.** It needs the Groq key, and
   embedding a key in public page JS is a security no-go. **The button therefore
   uses the deterministic scripted greedy captain** (`scriptedCaptainBrain`,
   `src/swarm/captain.ts`). Keep the pre-recorded **live-model** run as the page's
   default/featured trace, so visitors still see "a real model drove this," and the
   button is the "explore the space yourself" toy. Do **not** add a bring-your-own-key
   fetch to Groq for a public page.
3. **Do not break the Deno path.** The existing `deno task swarm` /
   `swarm-maze-demo.ts` and `./verify.sh` byte-identical replay must still pass.
   Prefer adding a new browser entry module over editing the Deno demo driver.
   Determinism (byte-identical) does **not** apply to button runs — they use a
   random seed each click; that's fine and expected.
4. **Keep maze dimensions FIXED across clicks** (currently 51×35, logical 25×17).
   Only the carve seed randomizes. This keeps the board size, difficulty, and the
   "~41% dark / ~2k-frame / ~1.4 MB" feel stable. See the sizing lesson in §6.

---

## 3. The pieces, and what each needs

| Piece | File today | Browser need |
|---|---|---|
| Maze generator | `scratchpad/genmaze-swarm-lobes.ts` | Refactor into a **pure function** `genSwarmMaze(seedR, seedL): MazeWorld` (no `console.log`, no Deno). It already is pure computation (mulberry32 PRNG, recursive-backtracker carve, BFS placement of exit/orc/goblins); today it only *prints* a seed literal. Split: keep a thin CLI wrapper that calls the function and prints (for build-time seed freezing), export the function for the browser. |
| World store | `src/maze/store.ts` | File I/O. Browser must not touch it — use an in-memory world instead (see §4). |
| Dungeon command dispatch | `src/cli/dungeon.ts` `run(argv, ids, clock)` | Pure except `loadMaze`/`saveMaze` and `fileShipLog`. Reused *in spirit* by the in-memory `conRun`. |
| World reducers / gates | `src/maze/world.ts`, `src/maze/gates.ts` | **Pure — import unchanged.** `look`, `applyEffect`, `moveGate`, `attackGate`. |
| Fog / amalgamation | `src/maze/fog.ts`, `src/swarm/amalgamate.ts` | **Pure — unchanged.** |
| Scheduler (the solve) | `src/swarm/scheduler.ts` `orchestrateSwarm(params)` | **Pure logic + a `sink` callback.** Unchanged; it takes `ctx` (with `conRun`), `units`, `brain`, `sink`. |
| Scripted captain | `src/swarm/captain.ts` `scriptedCaptainBrain()` | **Pure — unchanged.** |
| Per-unit ops / pathing | `src/fleet/ops.ts` | Pure; these build argv and call `ctx.conRun`. Unchanged. |
| Renderer | `src/swarm/site.ts` `page()` → inline `<script>` | Refactor so the trace is **reassignable** and the animation can **reset** (today it reads a `const TRACE` once at load). Add the button. See §5. |
| Trace shape | built by the `sink` in `src/swarm-maze-demo.ts` | The browser must build the **same `SwarmTrace`** (see `SwarmTrace` type in `site.ts`): `{maze:{width,height,walls,exit,start}, frames:[…], summary:{…}}`, with the carry-forward fog delta (`fog: string[] | null`). Copy the frame-building logic from `swarm-maze-demo.ts` (the `sink` closure + `fogRows`/`unknownOf`). |

---

## 4. The in-memory `conRun` (the heart of the port — do this first)

This is the riskiest ~80 lines; prototype it before anything else. Two options:

**Option A (recommended — bypass the CLI, reuse the pure core).** Write a browser
`conRun` that holds a mutable `MazeWorld` in a closure and dispatches the small
argv vocabulary directly against the pure reducers/gates:

```ts
// vocabulary the scheduler uses (see src/fleet/ops.ts):
//   ["look","--unit",id]
//   ["move","--dir",D,"--unit",id,"--reason",r,"--corr",c]
//   ["attack","--target",mId,"--unit",id,"--reason",r,"--corr",c]
function memoryConRun(initial: MazeWorld): ConRun {
  let world = initial;
  return (argv) => {
    const cmd = argv[0];
    const flag = (k: string) => argv[argv.indexOf("--"+k)+1];
    if (cmd === "look") return { value: look(world, flag("unit")) };
    if (cmd === "move") {
      const res = moveGate(world, flag("unit"), flag("dir") as Dir); // Ok|Refused
      if (res.ok) world = applyEffect(world, res.effect);
      return { value: /* mirror what dungeon.run returns for move */ };
    }
    // attack similarly via attackGate + applyEffect
  };
}
```

Mirror exactly what `dungeon.run()` returns for each command (read
`src/cli/dungeon.ts` carefully — the `{value}` shapes must match what `ops.ts`
decodes). This touches **no existing file**.

**Option B (cleaner long-term — injectable store).** Refactor `store.ts` into a
`MazeStore` interface with `file` and `memory` implementations, and thread it
through `dungeon.run()`. Reuses `run()` verbatim but changes its signature and
every caller. More invasive; only do this if Option A's return-shape mirroring
proves fiddly.

**Logs:** the scheduler/harness also write Layer-1/Layer-2 logs (`fileShipLog`,
`fileIntentLog`). For the browser toy, either provide trivial in-memory array
sinks or a no-op — **reconciliation is not shown in the button replay** (it lives
in `logs.html`, out of scope here). Confirm the harness doesn't *require* a log to
function; if it does, an in-memory array log is ~10 lines.

---

## 5. The browser entry + renderer changes

Create a browser entry module, e.g. `web/app.ts`:

```ts
import { genSwarmMaze } from "../scratchpad/genmaze-swarm-lobes.ts"; // (moved/exported)
import { orchestrateSwarm } from "../src/swarm/scheduler.ts";
import { scriptedCaptainBrain } from "../src/swarm/captain.ts";
// + memoryConRun, in-memory logs, and the trace-building sink copied from swarm-maze-demo.ts

export async function runNewMaze(seed: number): Promise<SwarmTrace> {
  const world = genSwarmMaze(seed, seed ^ 0x9e3779b9); // two lobe seeds from one click-seed
  const frames = []; /* …build via sink exactly as swarm-maze-demo.ts does… */
  const result = await orchestrateSwarm({ ctx: /* memory ctx */, …, brain: scriptedCaptainBrain(), sink });
  return { maze: {…}, frames, summary: {…} };
}
(globalThis as any).runNewMaze = runNewMaze;
```

Renderer (`src/swarm/site.ts` inline script) changes:
- Make `TRACE` a **mutable** module-level `let`, not `const`.
- Extract the `FOG` delta-resolution, `draw`, `show`, play/scrub wiring into an
  `init(trace)` function that (re)binds everything and resets `idx=0`.
- Add a **"🎲 New random maze"** button. On click: pick a seed
  (`crypto.getRandomValues` or `Math.random()*2**32`), `await runNewMaze(seed)`,
  then `init(newTrace)` and auto-play. Show a brief "solving…" state (the solve is
  tens of ms, so this is mostly instantaneous).
- Keep the **pre-recorded featured trace** (the live-model run) as the initial
  `TRACE`, so the page is meaningful before any click and still showcases the LLM.
- Canvas: dimensions are fixed (51×35 × CELL 16), so no resize needed; but if you
  ever let size vary, re-set `cv.width/height` in `init`.

Load the bundled JS: on Pages a **sibling file** (`<script src="app.js">`) is fine
(unlike the Artifact sandbox, Pages has no strict CSP). Inlining also works and
keeps it single-file; your call.

---

## 6. Bundling

The code is TypeScript importing across `src/`. Produce one browser JS file:

- First try `deno bundle web/app.ts -o web/app.js` (Deno 2.7 — check
  `deno bundle --help`; the subcommand was removed in early Deno 2 and later
  restored via esbuild).
- If unavailable, use esbuild: `deno run -A npm:esbuild web/app.ts --bundle
  --format=esm --outfile=web/app.js` (with `jsr:@luca/esbuild-deno-loader` if
  import resolution needs it).
- **Verify no `Deno.*` survives in the bundle** (`grep -c 'Deno\\.' web/app.js`
  should be 0). If any remains, it came from `store.ts`/`shiplog.ts`/`intentlog.ts`
  or the CLI entrypoint — make sure the browser path imports none of those.

---

## 7. Deploy to GitHub Pages (manual)

There is no CI for Pages. To publish:
1. Build the self-contained page(s) into `demo-out/swarm/` as today (or a `web/`
   output), including `app.js` if not inlined.
2. Check out `gh-pages`, copy the new `swarm/index.html` (+ `app.js`) over, commit,
   push. Keep `.nojekyll`.
3. Confirm at `https://raggedr.github.io/starship/swarm/` that the button works
   with no network calls (DevTools → Network should show nothing on click).

Do the push only when asked — it's an outward-facing publish.

---

## 8. Acceptance checklist

- [ ] Clicking the button shows a **visibly different** maze each time, solved and
      animated, with the scripted captain (panel reads `captain: scripted-greedy`).
- [ ] Both gate monsters are still dispatched together, exit reached, 3/5 cleared —
      the construction guarantees hold for every seed (gates at equal depth; tree
      property seals each lobe). If some seed breaks the story, see §9.
- [ ] Works from a plain `file://` open AND on `gh-pages` with **zero network
      requests** on click.
- [ ] `grep -c 'Deno\\.' web/app.js` → `0`.
- [ ] `./verify.sh` still passes (Deno path untouched; byte-identical demos).
- [ ] `deno task swarm` still regenerates the featured trace unchanged.
- [ ] The featured (default) trace on load is still the pre-recorded **live-model**
      run.

---

## 9. Risks & gotchas

- **Return-shape mirroring (§4).** The scheduler decodes `conRun(...).value` in
  `src/fleet/ops.ts`; the in-memory `conRun` must return the *exact* shapes
  `dungeon.run()` returns for look/move/attack. This is the most likely source of
  bugs — diff against `dungeon.ts` command-by-command.
- **Generator must stay pure.** When extracting `genSwarmMaze`, remove all
  `console.log` and Deno calls from the function body; keep them only in the CLI
  wrapper used at build time. The exit/orc/goblin placement (BFS on the rendered
  grid) must run inside the function so every random maze gets valid placements.
- **Keep size fixed.** We learned the hard way: with one animation frame per scout
  footstep, frames ≈ ~4 × cells-revealed, so a 10× maze is either a near-empty
  black void or a ~17 MB / 20k-frame page. 51×35 with exit `TARGET≈75` gives ~41%
  dark / ~2k frames / ~1.4 MB — the sweet spot. Do **not** enlarge the maze for the
  button; randomize the seed only.
- **Seed → both lobes.** Derive both lobe seeds from one click-seed
  (`seedL = seedR ^ 0x9e3779b9`) so one random number drives the whole maze.
- **Solve could, in theory, not finish** for a pathological seed. `orchestrateSwarm`
  has a `maxTicks` guard and the greedy anti-stall fallback, so it won't hang; but
  add a guard that if `result.solved` is false it retries with a new seed (should
  be rare-to-never given the construction).
- **Bundling Deno version drift** (§6) — check `deno bundle` support first.

---

## 10. Out of scope (don't let it creep in)

- Running the **LLM captain** client-side (needs a key/server; keep it as the
  pre-recorded featured run).
- The two-layer **reconciliation / `logs.html`** in the button replay.
- Porting the **fleet** or single-agent **maze** replays (same technique would
  apply later; this plan is swarm-only).
- Changing maze **size/difficulty** or the solver logic.

---

## 11. Suggested order of work

1. Extract `genSwarmMaze(seedR, seedL): MazeWorld` from
   `scratchpad/genmaze-swarm-lobes.ts` (pure; keep CLI wrapper). Unit-test it
   returns a valid, solvable `MazeWorld` (reuse the assertions in
   `src/maze/seed_test.ts`).
2. Prototype `memoryConRun` (§4 Option A) + in-memory logs. Verify a tiny solve
   runs headless under Deno **without touching the filesystem** (temporarily point
   the swarm demo at it) — this de-risks the return-shape mirroring before any
   browser work.
3. Browser entry `web/app.ts` exposing `runNewMaze(seed)` building the `SwarmTrace`.
4. Bundle → `web/app.js`; confirm no `Deno.*`.
5. Refactor `site.ts` renderer to `init(trace)` + button; wire to `runNewMaze`.
6. Test `file://`; then publish to `gh-pages` (when asked).

Prototype step 2 first and report back — if the in-memory `conRun` comes across
clean, the rest is mechanical.
