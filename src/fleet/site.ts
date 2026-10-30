// site.ts — turn a fleet trace into a self-contained HTML/CSS/JS replay website.
//
// The demo writes the trace (truth positions + the captain's fog, per frame); this
// bakes it into one index.html with no external anything — it opens straight from
// the file system. The page draws the TRUE maze and lays the captain's FOG over it
// as a lifting veil: you watch the scout range into the dark, the veil retreat at
// each merge, the fighter clear a monster, and the captain march out at the end.
//
// Deterministic: the HTML is a pure function of the (deterministic) trace, so two
// demo runs produce byte-identical sites (verify.sh covers it).

export type FleetTrace = {
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
    fog: readonly string[];
    unknown: number;
  }>;
  summary: {
    solved: boolean;
    rounds: number;
    scoutMoves: number;
    fighterMoves: number;
    captainMoves: number;
    kills: number;
    unknownAtEnd: number;
  };
};

export function buildFleetSite(trace: FleetTrace, outPath: string): void {
  const json = JSON.stringify(trace);
  Deno.writeTextFileSync(outPath, page(json));
}

function page(traceJson: string): string {
  // NOTE: kept as one string so the demo writes a single self-contained file.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fleet maze — fog-of-war replay</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #141925; --ink: #e6e9ef; --muted: #8b93a7;
    --floor: #28324a; --floor-known: #3a4a6a; --wall: #0d1017;
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
  canvas { display: block; image-rendering: pixelated; border-radius: 4px; }
  .side { width: 320px; background: var(--panel); padding: 16px; border-radius: 10px; }
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
  .reason { color: var(--ink); min-height: 40px; background: #0e1320; border-radius: 6px; padding: 8px 10px; margin-top: 4px; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-top: 12px; font-size: 12px; }
  .stats div span { color: var(--accent); font-weight: 600; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; font-size: 11px; color: var(--muted); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 3px; }
  .phase { font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: .12em; }
</style>
</head>
<body>
  <h1>Fleet maze — fog-of-war replay</h1>
  <div class="sub">A scout maps · a captain decides on what it is told · a fighter clears the way</div>
  <div class="wrap">
    <div class="board"><canvas id="c"></canvas></div>
    <div class="side">
      <div class="phase" id="phase">—</div>
      <div class="row"><span class="big" id="counter">0 / 0</span></div>
      <div class="row">
        <button class="play" id="play">Play</button>
        <button id="prev">‹ step</button>
        <button id="next">step ›</button>
        <button id="restart">⟲</button>
      </div>
      <div class="row"><input type="range" id="scrub" min="0" value="0" /></div>
      <div class="row"><span class="k">speed</span><input type="range" id="speed" min="1" max="60" value="18" /></div>
      <div class="row"><span class="actor a--" id="actor">—</span><span id="what" class="k"></span></div>
      <div class="reason" id="reason">&nbsp;</div>
      <div class="stats">
        <div><span id="s-round">0</span> <span class="k">rounds</span></div>
        <div><span id="s-unknown">0</span> <span class="k">cells dark</span></div>
        <div><span id="s-kills">0</span> <span class="k">kills</span></div>
        <div><span id="s-result">—</span></div>
      </div>
      <div class="legend">
        <span><span class="dot" style="background:var(--scout)"></span>scout</span>
        <span><span class="dot" style="background:var(--fighter)"></span>fighter</span>
        <span><span class="dot" style="background:var(--captain)"></span>captain</span>
        <span><span class="dot" style="background:var(--monster)"></span>monster</span>
        <span><span class="dot" style="background:var(--exit)"></span>exit</span>
        <span><span class="dot" style="background:var(--veil)"></span>fog (unknown to captain)</span>
      </div>
    </div>
  </div>

<script id="trace" type="application/json">${traceJson}</script>
<script>
const TRACE = JSON.parse(document.getElementById('trace').textContent);
const M = TRACE.maze, F = TRACE.frames, S = TRACE.summary;
const CELL = 30, W = M.width, H = M.height;
const cv = document.getElementById('c'); cv.width = W*CELL; cv.height = H*CELL;
const g = cv.getContext('2d');

const COL = {
  scout: '#4cc9f0', fighter: '#f0526b', captain: '#ffd166',
  monster: '#b36bff', exit: '#39d98a',
  wall: '#0d1017', floor: '#28324a', floorKnown: '#3a4a6a',
  veil: 'rgba(7,9,14,0.86)',
};
function glyph(id){ return id==='hero'?'@':id[0].toUpperCase(); }

function draw(idx){
  const f = F[idx];
  // base: the TRUE maze
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const wall = M.walls[y][x] === '#';
    g.fillStyle = wall ? COL.wall : COL.floor;
    g.fillRect(x*CELL, y*CELL, CELL, CELL);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(x*CELL+0.5, y*CELL+0.5, CELL-1, CELL-1);
  }
  // known floor gets a subtle lift so the explored region reads brighter
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const k = f.fog[y][x];
    if (k === '.' || k === 'X'){ g.fillStyle = 'rgba(90,120,180,0.18)'; g.fillRect(x*CELL,y*CELL,CELL,CELL); }
  }
  // exit
  g.fillStyle = COL.exit;
  g.globalAlpha = (f.fog[M.exit.y][M.exit.x] === ' ') ? 0.25 : 1;
  g.fillRect(M.exit.x*CELL+CELL*0.28, M.exit.y*CELL+CELL*0.28, CELL*0.44, CELL*0.44);
  g.globalAlpha = 1;
  // the veil: cells the captain does not know
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    if (f.fog[y][x] === ' '){ g.fillStyle = COL.veil; g.fillRect(x*CELL,y*CELL,CELL,CELL); }
  }
  // monsters (truth)
  for (const m of f.monsters){
    g.fillStyle = COL.monster;
    g.beginPath(); g.arc(m.x*CELL+CELL/2, m.y*CELL+CELL/2, CELL*0.30, 0, 7); g.fill();
    g.fillStyle = '#1a1030'; g.font = 'bold '+(CELL*0.5)+'px monospace';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(m.id[0].toUpperCase(), m.x*CELL+CELL/2, m.y*CELL+CELL/2+1);
  }
  // units (truth), offset a little when stacked so all are visible
  const seen = {};
  for (const u of f.units){
    const key = u.x+','+u.y; const n = seen[key]||0; seen[key]=n+1;
    const ox = (n%2)*6 - 3, oy = (n>1?6:-0);
    g.fillStyle = COL[u.id] || '#fff';
    const cx = u.x*CELL+CELL/2+ox, cy = u.y*CELL+CELL/2+oy;
    g.beginPath(); g.arc(cx, cy, CELL*0.32, 0, 7); g.fill();
    g.fillStyle = '#06121a'; g.font = 'bold '+(CELL*0.5)+'px monospace';
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(glyph(u.id), cx, cy+1);
  }
  // panel
  document.getElementById('counter').textContent = (idx+1)+' / '+F.length;
  document.getElementById('scrub').value = idx;
  const ac = document.getElementById('actor');
  ac.textContent = f.actor; ac.className = 'actor a-'+(f.actor==='-'?'-':f.actor);
  document.getElementById('what').textContent = f.action + (f.detail? ' '+f.detail : '') + (f.ok?'':' ✗refused');
  document.getElementById('reason').textContent = f.reason || '\\u00a0';
  document.getElementById('s-unknown').textContent = f.unknown;
  // phase = last phase label at or before this frame; round = merges so far
  let ph='—', round=0;
  for (let j=0;j<=idx;j++){ if(F[j].action==='phase') ph=F[j].detail; if(F[j].action==='merge') round++; }
  document.getElementById('phase').textContent = ph;
  document.getElementById('s-round').textContent = round;
  // kills so far = monsters gone versus the initial count
  document.getElementById('s-kills').textContent = F[0].monsters.length - f.monsters.length;
  document.getElementById('s-result').textContent = (idx===F.length-1)? (S.solved?'solved ✓':'—') : '';
}

let idx = 0, playing = false, timer = null;
const scrub = document.getElementById('scrub'); scrub.max = F.length-1;
const speed = document.getElementById('speed');
function show(i){ idx = Math.max(0, Math.min(F.length-1, i)); draw(idx); }
function tick(){ if(!playing) return; if(idx>=F.length-1){ stop(); return; } show(idx+1); timer = setTimeout(tick, 1000/ +speed.value); }
function play(){ if(idx>=F.length-1) idx=0; playing=true; document.getElementById('play').textContent='Pause'; tick(); }
function stop(){ playing=false; document.getElementById('play').textContent='Play'; if(timer) clearTimeout(timer); }
document.getElementById('play').onclick = ()=> playing?stop():play();
document.getElementById('next').onclick = ()=>{ stop(); show(idx+1); };
document.getElementById('prev').onclick = ()=>{ stop(); show(idx-1); };
document.getElementById('restart').onclick = ()=>{ stop(); show(0); };
scrub.oninput = ()=>{ stop(); show(+scrub.value); };
show(0);
</script>
</body>
</html>
`;
}
