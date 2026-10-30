// logsite.ts — a self-contained HTML viewer for the TWO-LAYER LOG. The replay site
// (site.ts) shows the maze; this shows the thing the maze is evidence FOR — the audit.
// Layer 1 (the ship's log, WHAT committed) and Layer 2 (the intent-log, WHY) are
// joined by correlation id and laid side by side, so you can see every mutation carry
// a reason, every refusal appear in Layer 2 alone (never Layer 1), and reconciliation
// prove there is no committed change without a logged reason.
//
// The audit MODEL is computed here in TypeScript (reusing reconcile), so the page's JS
// only renders. Deterministic: a pure function of the two (deterministic) logs, so the
// scripted run's logs.html is byte-identical across runs (verify.sh covers it).

import { fileShipLog, type ShipLogEntry } from "../log/shiplog.ts";
import { fileIntentLog } from "../log/intentlog.ts";
import { reconcile } from "../log/reconcile.ts";

type AuditEvent = {
  seq: number;
  kind: "matched" | "blocked" | "alarm" | "read";
  agent: string; // the bare agent id, e.g. scout-3 (registry prefix stripped)
  tool: string; // move | attack | look
  arg: string; // compact argument, e.g. "E" or "orc-1"
  corr: string; // correlation id ("" for reads / alarms as noted)
  what: string; // Layer 1 effect summary ("" if never committed)
  why: string; // Layer 2 reason ("" for reads; "NO REASON" for an alarm)
  status: string; // ok | refused | committed-no-reason | read
};

const bare = (agentId: string) => agentId.replace(/^agent:/, "");

function argOf(tool: string, args: Record<string, unknown>): string {
  if (tool === "move") return String(args.dir ?? "");
  if (tool === "attack") return String(args.target ?? "");
  return "";
}

function effectSummary(e: ShipLogEntry): string {
  const ef = e.effect as Record<string, unknown>;
  if (ef.tag === "move") {
    const to = ef.to as { x: number; y: number };
    return `moved ${String(ef.dir)} → (${to.x},${to.y})`;
  }
  if (ef.tag === "attack") {
    const hp = ef.monsterHpAfter as number;
    return `struck ${String(ef.targetId)} → hp ${hp}${ef.lethal ? " (killed)" : ""}`;
  }
  return e.command;
}

/** Build the deterministic audit model from the two logs. */
function model(shipPath: string, intentPath: string) {
  const shipLog = fileShipLog(shipPath);
  const intentLog = fileIntentLog(intentPath);
  const rec = reconcile(shipLog, intentLog);

  const shipByCorr = new Map<string, ShipLogEntry>();
  for (const e of shipLog.all()) shipByCorr.set(e.correlation_id, e);

  // the final record per call, in append (chronological) order
  const finals = [...intentLog.latestByCall().values()];
  const events: AuditEvent[] = [];
  let seq = 0;

  for (const r of finals) {
    const agent = bare(r.agent_id);
    const tool = r.tool;
    const arg = argOf(tool, r.args);
    if (!r.mutates) {
      events.push({ seq: seq++, kind: "read", agent, tool, arg, corr: "", what: "", why: "", status: "read" });
      continue;
    }
    if (r.status === "ok") {
      const ship = shipByCorr.get(r.correlation_id);
      events.push({
        seq: seq++, kind: "matched", agent, tool, arg,
        corr: r.correlation_id,
        what: ship ? effectSummary(ship) : "(ok intent, but no ship-log entry!)",
        why: r.reason,
        status: ship ? "ok" : "alarm",
      });
    } else if (r.status === "refused") {
      events.push({
        seq: seq++, kind: "blocked", agent, tool, arg,
        corr: r.correlation_id,
        what: "", // never committed — Layer 1 has nothing
        why: r.reason || "(refused before the reason-gate)",
        status: "refused",
      });
    }
    // "attempted" with no outcome is dropped (latestByCall keeps the outcome)
  }

  // alarms from the ship side: a committed effect with NO logged reason
  for (const a of rec.alarms) {
    if (a.kind === "write-without-reason") {
      events.push({
        seq: seq++, kind: "alarm", agent: bare(a.entry.ship), tool: a.entry.command, arg: "",
        corr: a.entry.correlation_id, what: effectSummary(a.entry), why: "NO REASON", status: "committed-no-reason",
      });
    }
  }

  const agents = [...new Set(events.map((e) => e.agent))].sort();
  return {
    summary: {
      matched: rec.matched.length,
      blocked: rec.blocked.length,
      alarms: rec.alarms.length,
      ok: rec.ok,
      reads: events.filter((e) => e.kind === "read").length,
      mutations: events.filter((e) => e.kind !== "read").length,
    },
    agents,
    events,
  };
}

export function buildLogSite(
  shipPath: string,
  intentPath: string,
  outPath: string,
  meta: { captain: string; session: string },
): void {
  const m = model(shipPath, intentPath);
  Deno.writeTextFileSync(outPath, page(JSON.stringify({ ...m, meta })));
}

function page(dataJson: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Swarm audit — the two-layer log</title>
<style>
  :root {
    --bg:#0b0e14; --panel:#141925; --ink:#e6e9ef; --muted:#8b93a7; --line:#232b3d;
    --ok:#39d98a; --block:#f0a202; --alarm:#f0526b; --read:#5a6a84; --accent:#4cc9f0;
    --l1:#1a2740; --l2:#1a2033;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; padding:22px; }
  h1 { font-size:19px; margin:0 0 2px; }
  .sub { color:var(--muted); font-size:12px; margin-bottom:16px; max-width:900px; }
  .tiles { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
  .tile { background:var(--panel); border:1px solid var(--line); border-radius:10px;
    padding:12px 16px; min-width:120px; }
  .tile .n { font-size:26px; font-weight:700; }
  .tile .k { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; }
  .tile.ok .n{color:var(--ok);} .tile.block .n{color:var(--block);} .tile.alarm .n{color:var(--alarm);}
  .banner { display:inline-block; padding:4px 12px; border-radius:6px; font-weight:700; margin-left:8px; font-size:13px;}
  .banner.good{ background:rgba(57,217,138,.15); color:var(--ok); border:1px solid var(--ok);}
  .banner.bad{ background:rgba(240,82,107,.15); color:var(--alarm); border:1px solid var(--alarm);}
  .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
  .chip { background:#1d2433; color:var(--ink); border:1px solid var(--line); border-radius:999px;
    padding:4px 11px; cursor:pointer; font:inherit; font-size:12px; }
  .chip.active { background:var(--accent); color:#06121a; border-color:var(--accent); font-weight:700; }
  .chip.small { padding:3px 9px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; font-size:12.5px; }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.08em; position:sticky; top:0; background:var(--panel); }
  td.l1 { background:var(--l1); } td.l2 { background:var(--l2); }
  tr.read td { color:var(--read); }
  tr.highlight td { outline:1px solid var(--accent); }
  .agent { font-weight:700; }
  .corr { color:var(--muted); font-size:11px; cursor:default; }
  .badge { display:inline-block; padding:1px 7px; border-radius:4px; font-size:11px; font-weight:700; }
  .b-ok{ background:rgba(57,217,138,.15); color:var(--ok);}
  .b-refused{ background:rgba(240,162,2,.15); color:var(--block);}
  .b-alarm{ background:rgba(240,82,107,.2); color:var(--alarm);}
  .b-read{ background:#1d2433; color:var(--read);}
  .dash { color:var(--read); }
  .legend { color:var(--muted); font-size:11.5px; margin:14px 0 4px; max-width:900px; line-height:1.7;}
  .legend b{ color:var(--ink);}
  .count { color:var(--muted); font-size:12px; margin:8px 2px; }
</style>
</head>
<body>
  <h1>Swarm audit — the two-layer log <span id="banner" class="banner"></span></h1>
  <div class="sub">Every mutation the eight agents committed, joined by correlation id to the reason it was given.
    <b>Layer 1</b> (the ship's log) records <b>what</b> changed; <b>Layer 2</b> (the intent-log) records <b>why</b>.
    A refusal appears in Layer 2 alone — it never reached Layer 1. Reconciliation proves there is no committed change without a logged reason.</div>

  <div class="tiles" id="tiles"></div>

  <div class="controls" id="agents"></div>
  <div class="controls">
    <span class="chip small" id="toggleReads">show reads (look)</span>
    <span class="count" id="count"></span>
  </div>

  <table>
    <thead><tr>
      <th style="width:38px">#</th><th style="width:90px">agent</th>
      <th style="width:150px">order</th>
      <th class="l1">Layer 1 — what committed</th>
      <th style="width:90px">corr</th>
      <th class="l2">Layer 2 — why</th>
      <th style="width:70px">status</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <div class="legend">
    <b>matched</b> — a committed mutation with a logged reason (the healthy case). &nbsp;·&nbsp;
    <b>blocked</b> — an order the gate/registry/reason-gate refused: visible <i>only</i> in Layer 2, because it never committed. &nbsp;·&nbsp;
    <b>alarm</b> — a committed change with no logged reason: must never exist; it is the one thing the whole two-log design exists to catch.
  </div>

<script id="data" type="application/json">${dataJson}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const S = D.summary;
document.getElementById('banner').textContent = S.ok ? 'reconciled ✓' : (S.alarms+' ALARM(S)');
document.getElementById('banner').className = 'banner ' + (S.ok?'good':'bad');

const tiles = [
  ['ok','matched', S.matched, 'committed, with a reason'],
  ['block','blocked', S.blocked, 'refused — Layer 2 only'],
  ['alarm','alarms', S.alarms, 'committed without a reason'],
  ['','mutations', S.mutations, 'total committed/refused'],
  ['','reads', S.reads, 'free look calls (no reason)'],
];
document.getElementById('tiles').innerHTML = tiles.map(([cls,k,n,d])=>
  '<div class="tile '+cls+'"><div class="n">'+n+'</div><div class="k">'+k+'</div><div class="k" style="text-transform:none;letter-spacing:0">'+d+'</div></div>').join('');

const sub = D.meta.captain + '  ·  session ' + D.meta.session;
document.querySelector('.sub').insertAdjacentHTML('beforeend', '<div style="margin-top:6px;color:var(--accent)">captain: '+sub+'</div>');

let agentFilter = 'all';
let showReads = false;

const agentChips = ['all', ...D.agents];
document.getElementById('agents').innerHTML = agentChips.map(a=>
  '<span class="chip'+(a==='all'?' active':'')+'" data-a="'+a+'">'+a+'</span>').join('');
document.querySelectorAll('#agents .chip').forEach(c=> c.onclick=()=>{
  agentFilter=c.dataset.a;
  document.querySelectorAll('#agents .chip').forEach(x=>x.classList.toggle('active', x.dataset.a===agentFilter));
  render();
});
document.getElementById('toggleReads').onclick = (e)=>{ showReads=!showReads; e.target.classList.toggle('active', showReads); render(); };

function badge(status){
  const map={ok:'b-ok',refused:'b-refused',alarm:'b-alarm','committed-no-reason':'b-alarm',read:'b-read'};
  const label={ok:'ok',refused:'refused',alarm:'ALARM','committed-no-reason':'ALARM',read:'read'};
  return '<span class="badge '+map[status]+'">'+label[status]+'</span>';
}

function render(){
  const rows = D.events.filter(e=>{
    if (e.kind==='read' && !showReads) return false;
    if (agentFilter!=='all' && e.agent!==agentFilter) return false;
    return true;
  });
  document.getElementById('count').textContent = rows.length + ' rows shown';
  document.getElementById('rows').innerHTML = rows.map(e=>{
    const l1 = e.what ? e.what : '<span class="dash">—  (never committed)</span>';
    const why = e.kind==='read' ? '<span class="dash">(read — no reason required)</span>'
              : (e.why==='NO REASON' ? '<span class="dash" style="color:var(--alarm)">NO REASON</span>' : e.why);
    const order = e.tool + (e.arg? ' '+e.arg : '');
    return '<tr class="'+(e.kind==='read'?'read':'')+'" data-corr="'+e.corr+'">'
      + '<td>'+(e.seq+1)+'</td>'
      + '<td class="agent">'+e.agent+'</td>'
      + '<td>'+order+'</td>'
      + '<td class="l1">'+l1+'</td>'
      + '<td class="corr">'+(e.corr? e.corr.slice(0,8) : '')+'</td>'
      + '<td class="l2">'+why+'</td>'
      + '<td>'+badge(e.status)+'</td></tr>';
  }).join('');
  // hover highlights the same correlation id across rows
  document.querySelectorAll('#rows tr').forEach(tr=>{
    tr.onmouseenter=()=>{ const c=tr.dataset.corr; if(!c) return;
      document.querySelectorAll('#rows tr').forEach(x=>x.classList.toggle('highlight', x.dataset.corr===c)); };
    tr.onmouseleave=()=>document.querySelectorAll('#rows tr').forEach(x=>x.classList.remove('highlight'));
  });
}
render();
</script>
</body>
</html>
`;
}
