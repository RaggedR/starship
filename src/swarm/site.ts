// site.ts — turn a swarm trace into a self-contained HTML replay. Adapted from the
// fleet's site: same lifting-veil idea (the true maze with the captain's fog laid
// over it), scaled to eight agents and given the thing the swarm adds — the CAPTAIN'S
// PLAN and reasoning, shown per step. On a --live run that strip is the star: you
// watch the model fan the scouts, pick which fighter clears which monster, and commit
// to the march, each with its stated reason.
//
// Deterministic: the HTML is a pure function of the (deterministic) trace, so two
// scripted runs produce byte-identical sites (verify.sh covers it).

export type SwarmTrace = {
  maze: {
    width: number;
    height: number;
    walls: readonly string[];
    exit: { x: number; y: number };
    start: { x: number; y: number };
  };
  frames: ReadonlyArray<{
    i: number;
    actor: string;
    action: string;
    detail: string;
    reason: string;
    ok: boolean;
    corr: string;
    units: ReadonlyArray<{ id: string; x: number; y: number; hp: number }>;
    monsters: ReadonlyArray<{ id: string; x: number; y: number; hp: number }>;
    fog: readonly string[] | null; // carry-forward delta: null means "same as previous"
    unknown: number;
  }>;
  summary: {
    solved: boolean;
    ticks: number;
    scoutMoves: number;
    fighterMoves: number;
    captainMoves: number;
    kills: number;
    unknownAtEnd: number;
    captain: string; // the brain name (scripted-greedy or a model id)
  };
};

export function buildSwarmSite(trace: SwarmTrace, outPath: string): void {
  Deno.writeTextFileSync(outPath, page(JSON.stringify(trace), loadAppBundle(), loadLlmConfig()));
}

/** The embedded LLM config for the in-browser live captain. Read from the environment
 *  at BUILD time and inlined into the generated page only — never written to any source
 *  file or committed, so the key stays out of git history (it becomes public only when
 *  the page is deployed, which is the owner's explicit choice). If GROQ_API_KEY is not
 *  in the environment at generation time (e.g. a scripted `deno task swarm` with no key,
 *  as verify.sh runs), nothing is injected and the live button disables itself. */
function loadLlmConfig(): string {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) return "";
  const cfg = {
    key,
    model: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
    baseUrl: Deno.env.get("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1",
  };
  return `window.__SWARM_LLM__ = ${JSON.stringify(cfg)};`;
}

/** The browser bundle for the "🎲 New random maze" button (web/app.js, built by
 *  `deno bundle --platform browser --format iife web/app.ts -o web/app.js`), inlined so
 *  the page stays a SELF-CONTAINED single file — works over file://, on GitHub Pages,
 *  or as an artifact, with no sibling script and no network. Best-effort: if the bundle
 *  has not been built yet the page still renders the featured replay and the button
 *  disables itself (the renderer checks for runNewMaze). Deterministic for verify.sh:
 *  two runs read the same committed bytes. */
function loadAppBundle(): string {
  try {
    const js = Deno.readTextFileSync(new URL("../../web/app.js", import.meta.url));
    // Guard the one HTML hazard of inlining a script: a literal </script> would close
    // the tag early. The bundle never emits that token, but escape it defensively.
    return js.replaceAll("</script>", "<\\/script>");
  } catch {
    return "";
  }
}

function page(traceJson: string, appJs: string, llmCfg: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Swarm maze — an LLM captain commands the fog</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #141925; --ink: #e6e9ef; --muted: #8b93a7;
    --floor: #28324a; --wall: #0d1017;
    --scout: #4cc9f0; --fighter: #f0526b; --captain: #ffd166; --monster: #b36bff;
    --exit: #39d98a; --veil: rgba(7,9,14,0.86); --accent: #4cc9f0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    display: flex; flex-direction: column; align-items: center; padding: 20px;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 2px; letter-spacing: .3px; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  .wrap { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; align-items: flex-start; }
  .board { background: var(--panel); padding: 12px; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
  canvas { display: block; image-rendering: pixelated; border-radius: 4px; max-width: 100%; height: auto; }
  .side { width: 360px; background: var(--panel); padding: 16px; border-radius: 10px; }
  .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  button {
    background: #1d2433; color: var(--ink); border: 1px solid #2b3447; border-radius: 6px;
    padding: 6px 10px; cursor: pointer; font: inherit;
  }
  button:hover { border-color: var(--accent); }
  button.play { background: var(--accent); color: #06121a; border: none; font-weight: 600; min-width: 64px; }
  input[type=range] { width: 100%; accent-color: var(--accent); }
  .k { color: var(--muted); }
  .big { font-size: 15px; font-weight: 600; }
  .actor { display: inline-block; padding: 1px 7px; border-radius: 4px; font-weight: 600; color: #06121a; }
  .a-scout { background: var(--scout); } .a-fighter { background: var(--fighter); }
  .a-captain { background: var(--captain); } .a-- { background: #50607a; color: var(--ink); }
  .reason { color: var(--ink); min-height: 34px; background: #0e1320; border-radius: 6px; padding: 8px 10px; margin-top: 4px; }
  .plan { border: 1px solid #2b3447; border-left: 3px solid var(--captain); background: #0e1320;
          border-radius: 6px; padding: 8px 10px; margin-top: 8px; font-size: 12px; }
  .plan .ord { color: var(--captain); font-weight: 600; }
  .plan .why { color: var(--muted); display: block; margin-top: 3px; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-top: 12px; font-size: 12px; }
  .stats div span { color: var(--accent); font-weight: 600; }
  .roster { margin-top: 12px; font-size: 11px; display: grid; grid-template-columns: repeat(2,1fr); gap: 2px 10px; }
  .roster .u { display: flex; align-items: center; gap: 5px; }
  .chip { display: inline-block; width: 16px; height: 16px; border-radius: 3px; color: #06121a;
          text-align: center; font-weight: 700; font-size: 11px; line-height: 16px; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; font-size: 11px; color: var(--muted); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 3px; }
  .phase { font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: .12em; }
</style>
</head>
<body>
  <h1>Swarm maze — an LLM captain commands the fog</h1>
  <div class="sub">Five scouts map · the captain decides who goes where and which monster to clear · two fighters obey · the captain marches out on what it was told</div>
  <div class="sub"><a href="../" style="color:var(--accent);font-weight:600;text-decoration:none">← back to the fleet</a></div>
  <div class="wrap">
    <div class="board"><canvas id="c"></canvas></div>
    <div class="side">
      <div class="phase" id="phase">—</div>
      <div class="row"><span class="big" id="counter">0 / 0</span><span class="k" id="brain"></span></div>
      <div class="row">
        <button class="play" id="play">Play</button>
        <button id="prev">‹ step</button>
        <button id="next">step ›</button>
        <button id="restart">⟲</button>
      </div>
      <div class="row">
        <button id="newmaze" title="Generate a brand-new random maze and solve it with the scripted captain, entirely in your browser">🎲 New random maze</button>
        <button id="newmazelive" title="Generate a random maze and watch the real LLM captain solve it live — calls Groq from your browser">🧠 Live LLM run</button>
      </div>
      <div class="row"><span class="k" id="genstatus">&nbsp;</span></div>
      <div class="row"><input type="range" id="scrub" min="0" value="0" /></div>
      <div class="row"><span class="k">speed</span><input type="range" id="speed" min="1" max="160" value="70" /></div>
      <div class="row"><span class="actor a--" id="actor">—</span><span id="what" class="k"></span></div>
      <div class="reason" id="reason">&nbsp;</div>
      <div class="plan" id="plan"><span class="ord">captain's plan</span><span class="why">—</span></div>
      <div class="stats">
        <div><span id="s-tick">0</span> <span class="k">merges</span></div>
        <div><span id="s-unknown">0</span> <span class="k">cells dark</span></div>
        <div><span id="s-kills">0</span> <span class="k">monsters cleared</span></div>
        <div><span id="s-result">—</span></div>
      </div>
      <div class="roster" id="roster"></div>
      <div class="legend">
        <span><span class="dot" style="background:var(--scout)"></span>scout 1–5</span>
        <span><span class="dot" style="background:var(--fighter)"></span>fighter a,b</span>
        <span><span class="dot" style="background:var(--captain)"></span>captain C</span>
        <span><span class="dot" style="background:var(--monster)"></span>monster</span>
        <span><span class="dot" style="background:var(--exit)"></span>exit</span>
        <span><span class="dot" style="background:var(--veil)"></span>fog</span>
      </div>
    </div>
  </div>

<script id="trace" type="application/json">${traceJson}</script>
<script>${llmCfg}</script>
<script>${appJs}</script>
<script>
// Trace state is MUTABLE: the featured pre-recorded run loads first, and the
// "🎲 New random maze" button swaps in a freshly-solved trace via init(trace).
let TRACE, M, F, S, FOG, W, H;
const CELL = 16;
const cv = document.getElementById('c');
const g = cv.getContext('2d');

const COL = { scout:'#4cc9f0', fighter:'#f0526b', captain:'#ffd166', monster:'#b36bff',
  exit:'#39d98a', wall:'#0d1017', floor:'#28324a', veil:'rgba(7,9,14,0.86)' };
function kindOf(id){ return id[0]==='s'?'scout':id[0]==='f'?'fighter':'captain'; }
function glyph(id){
  if (id==='captain') return 'C';
  if (id.startsWith('scout-')) return id.slice(6);          // 1..5
  if (id==='fighter-1') return 'a'; if (id==='fighter-2') return 'b';
  return id[0].toUpperCase();
}

function draw(idx){
  const f = F[idx];
  const fog = FOG[idx];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const wall = M.walls[y][x] === '#';
    g.fillStyle = wall ? COL.wall : COL.floor;
    g.fillRect(x*CELL, y*CELL, CELL, CELL);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(x*CELL+0.5, y*CELL+0.5, CELL-1, CELL-1);
  }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const k = fog[y][x];
    if (k === '.' || k === 'X'){ g.fillStyle = 'rgba(90,120,180,0.18)'; g.fillRect(x*CELL,y*CELL,CELL,CELL); }
  }
  g.fillStyle = COL.exit;
  g.globalAlpha = (fog[M.exit.y][M.exit.x] === ' ') ? 0.25 : 1;
  g.fillRect(M.exit.x*CELL+CELL*0.26, M.exit.y*CELL+CELL*0.26, CELL*0.48, CELL*0.48);
  g.globalAlpha = 1;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    if (fog[y][x] === ' '){ g.fillStyle = COL.veil; g.fillRect(x*CELL,y*CELL,CELL,CELL); }
  }
  for (const m of f.monsters){
    g.fillStyle = COL.monster;
    g.beginPath(); g.arc(m.x*CELL+CELL/2, m.y*CELL+CELL/2, CELL*0.32, 0, 7); g.fill();
    g.fillStyle = '#1a1030'; g.font = 'bold '+(CELL*0.5)+'px monospace';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(m.id[0].toUpperCase(), m.x*CELL+CELL/2, m.y*CELL+CELL/2+1);
  }
  const seen = {};
  for (const u of f.units){
    const key = u.x+','+u.y; const n = seen[key]||0; seen[key]=n+1;
    const ox = (n%3-1)*5, oy = (Math.floor(n/3))*5 - 2;
    g.fillStyle = COL[kindOf(u.id)] || '#fff';
    const cx = u.x*CELL+CELL/2+ox, cy = u.y*CELL+CELL/2+oy;
    g.beginPath(); g.arc(cx, cy, CELL*0.34, 0, 7); g.fill();
    g.fillStyle = '#06121a'; g.font = 'bold '+(CELL*0.52)+'px monospace';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(glyph(u.id), cx, cy+1);
  }
  // panel
  document.getElementById('counter').textContent = (idx+1)+' / '+F.length;
  document.getElementById('scrub').value = idx;
  const ac = document.getElementById('actor');
  const akind = f.actor==='-' ? '-' : kindOf(f.actor);
  ac.textContent = f.actor; ac.className = 'actor a-'+akind;
  document.getElementById('what').textContent = f.action + (f.detail? ' '+f.detail : '') + (f.ok?'':' ✗refused');
  document.getElementById('reason').textContent = f.reason || '\\u00a0';
  document.getElementById('s-unknown').textContent = f.unknown;
  // latest plan at or before idx
  let planFrame=null, ph='—', merges=0;
  for (let j=0;j<=idx;j++){
    if (F[j].action==='phase') ph=F[j].detail;
    if (F[j].action==='merge') merges++;
    if (F[j].action==='plan') planFrame=F[j];
  }
  const plan = document.getElementById('plan');
  plan.querySelector('.ord').textContent = planFrame ? ('captain\\u2019s plan: '+planFrame.detail) : 'captain\\u2019s plan';
  plan.querySelector('.why').textContent = planFrame ? (planFrame.reason||'(greedy)') : '—';
  document.getElementById('phase').textContent = ph;
  document.getElementById('s-tick').textContent = merges;
  document.getElementById('s-kills').textContent = F[0].monsters.length - f.monsters.length;
  document.getElementById('s-result').textContent = (idx===F.length-1)? (S.solved?'solved ✓':'—') : '';
  // roster from this frame's units
  const roster = document.getElementById('roster');
  roster.innerHTML = f.units.map(u => {
    const c = COL[kindOf(u.id)];
    return '<div class="u"><span class="chip" style="background:'+c+'">'+glyph(u.id)+'</span>'
      + '<span class="k">'+u.id+' ('+u.x+','+u.y+') hp'+u.hp+'</span></div>';
  }).join('');
}

let idx = 0, playing = false, timer = null;
const scrub = document.getElementById('scrub');
const speed = document.getElementById('speed');
const playBtn = document.getElementById('play');
const newBtn = document.getElementById('newmaze');
const liveBtn = document.getElementById('newmazelive');
const genStatus = document.getElementById('genstatus');
function show(i){ idx = Math.max(0, Math.min(F.length-1, i)); draw(idx); }
function tick(){ if(!playing) return; if(idx>=F.length-1){ stop(); return; } show(idx+1); timer = setTimeout(tick, 1000/ +speed.value); }
function play(){ if(idx>=F.length-1) idx=0; playing=true; playBtn.textContent='Pause'; tick(); }
function stop(){ playing=false; playBtn.textContent='Play'; if(timer) clearTimeout(timer); }

// (Re)bind the renderer to a trace — the featured run at load, or a freshly-solved
// random maze when the button is clicked. Maze size is fixed, but we re-set the canvas
// anyway so a future variable size would still work.
function init(trace){
  stop();
  TRACE = trace; M = trace.maze; F = trace.frames; S = trace.summary;
  W = M.width; H = M.height;
  cv.width = W*CELL; cv.height = H*CELL;
  document.getElementById('brain').textContent = 'captain: ' + S.captain;
  // resolve the carry-forward fog deltas once: a frame with fog===null reuses the last.
  FOG = []; { let cur = null; for (const f of F){ if (f.fog) cur = f.fog; FOG.push(cur); } }
  scrub.max = F.length-1; scrub.value = 0;
  idx = 0; show(0);
}

playBtn.onclick = ()=> playing?stop():play();
document.getElementById('next').onclick = ()=>{ stop(); show(idx+1); };
document.getElementById('prev').onclick = ()=>{ stop(); show(idx-1); };
document.getElementById('restart').onclick = ()=>{ stop(); show(0); };
scrub.oninput = ()=>{ stop(); show(+scrub.value); };

// The button needs the inlined solver (globalThis.runNewMaze). If the bundle wasn't
// built/inlined, degrade gracefully: disable it rather than throwing on click.
if (typeof globalThis.runNewMaze !== 'function'){
  newBtn.disabled = true;
  newBtn.title = 'the in-browser solver bundle (web/app.js) is not present on this page';
} else {
  newBtn.onclick = async ()=>{
    stop();
    newBtn.disabled = true;
    const label = newBtn.textContent; newBtn.textContent = 'solving…'; genStatus.textContent = '';
    // a fresh 32-bit seed per click; one click-seed drives both lobes (app.ts).
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    try {
      const t0 = performance.now();
      const trace = await globalThis.runNewMaze(seed);
      const ms = Math.round(performance.now()-t0);
      init(trace);
      genStatus.textContent = 'seed '+seed+' · '+trace.summary.ticks+' ticks · '+trace.summary.unknownAtEnd+' cells dark · '+ms+'ms';
      play();
    } catch (e){
      console.error(e);
      genStatus.textContent = 'generation failed — see console';
    } finally {
      newBtn.disabled = false; newBtn.textContent = label;
    }
  };
}

// The live button runs the REAL LLM captain in your browser (calls Groq with the
// embedded key). Only enabled if a key was embedded (liveAvailable). A live run is a
// dozen+ sequential model calls, so it can take ~10s on a fresh token bucket or longer
// with rate-limit backoff — we disable the controls and show per-step progress.
if (typeof globalThis.liveAvailable !== 'function' || !globalThis.liveAvailable()){
  liveBtn.disabled = true;
  liveBtn.title = 'no Groq key is embedded on this page, so the live LLM run is unavailable';
} else {
  liveBtn.onclick = async ()=>{
    stop();
    newBtn.disabled = true; liveBtn.disabled = true;
    const label = liveBtn.textContent; liveBtn.textContent = 'thinking…';
    genStatus.textContent = 'the LLM captain is planning…';
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    try {
      const t0 = performance.now();
      const trace = await globalThis.runNewMazeLive(seed, (step)=>{
        genStatus.textContent = 'the LLM captain is planning… (step '+step+')';
      });
      const s = Math.round((performance.now()-t0)/100)/10;
      init(trace);
      genStatus.textContent = trace.summary.captain+' · seed '+seed+' · '+trace.summary.ticks+' ticks · '+trace.summary.unknownAtEnd+' cells dark · '+s+'s';
      play();
    } catch (e){
      console.error(e);
      genStatus.textContent = 'live run failed — '+(e && e.message ? e.message : 'see console')+' (the free tier may be rate-limited; try again shortly)';
    } finally {
      newBtn.disabled = false; liveBtn.disabled = false; liveBtn.textContent = label;
    }
  };
}

// first load: the featured pre-recorded run embedded in the page (the --live model run).
init(JSON.parse(document.getElementById('trace').textContent));
</script>
</body>
</html>
`;
}
