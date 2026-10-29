// demo.ts — the whole showpiece in one run (PLAN §8 "Definition of done").
//
// A stranger runs `deno task demo` and, in well under a minute, watches a captain
// delegate to officers, sees each reasoned order land in the ship's log, sees an
// illegal order refused, and reads the reconciliation report — then sees what
// reconciliation catches. Everything is driven by seeded ids and a fixed clock, so
// two runs produce byte-identical logs (verify.sh checks exactly that).

import { run } from "./cli/con.ts";
import { starMap } from "./cli/format.ts";
import { loadWorld, saveWorld } from "./world/store.ts";
import { seedWorld } from "./world/seed.ts";
import { fixedClock, seededIds } from "./log/ids.ts";
import { fileIntentLog } from "./log/intentlog.ts";
import { fileShipLog } from "./log/shiplog.ts";
import { reconcile, reconSummary } from "./log/reconcile.ts";
import { type HarnessCtx } from "./bridge/harness.ts";
import { handleHazard, mkBridge } from "./bridge/captain.ts";

const p = (s = "") => console.log(s);
const rule = (t: string) => p(`\n${"─".repeat(64)}\n${t}\n${"─".repeat(64)}`);

function freshDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch { /* first run */ }
  Deno.mkdirSync(path, { recursive: true });
}

/** A rig: con over files in `dir`, a harness over it, all seams seeded. */
function rig(dir: string) {
  freshDir(dir);
  const wp = `${dir}/world.json`;
  const lp = `${dir}/ships-log.jsonl`;
  const ip = `${dir}/intent-log.jsonl`;
  saveWorld(wp, seedWorld());
  const conIds = seededIds("con");
  const conClock = fixedClock();
  const conRun = (argv: string[]) => run([...argv, "--world", wp, "--log", lp], conIds, conClock);
  const ctx: HarnessCtx = {
    ids: seededIds("bridge"),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "DEMO",
    conRun,
  };
  return { ctx, wp, lp, ip, conRun };
}

// ══ 1. The situation ══════════════════════════════════════════════════
rule("STARSHIP — one ship, five officers, a hazard off the port bow");
const { ctx, wp, lp } = rig("demo-out/bridge");
p(starMap(loadWorld(wp)));

// ══ 2. The captain delegates, amalgamates, decides, orders ════════════
rule("The captain handles the hazard (delegate → amalgamate → decide → act)");
const bridge = mkBridge(ctx);
const report = await handleHazard(bridge, "NCC-1");

p(`  → Science (assess):   ${report.assessment.recommendation}`);
p(`      threats:          ${report.assessment.threats.map((t) => `${t.id} @ ${t.range}km, brg ${t.bearing}`).join("; ")}`);
p(`  → Engineering (power): ${report.power.routedTotal}% routed, ${report.power.headroom}% headroom`);
if (report.order) {
  p(`  → Helm (propose burn): vector ${report.order.proposal.vector}, cost ${report.order.proposal.fuelCost}, have ${report.order.proposal.haveFuel} → feasible`);
  p(`  Captain decides:       ${report.decision}`);
  p(`  Order → Helm:          reason = "${report.order.reason}"`);
  const out = report.order.outcome;
  p(`                         outcome = ${out.tag === "done" ? `committed (corr ${out.correlationId})` : out.tag}`);
}

// ══ 3. An illegal order — indistinguishable from a broken engine ══════
rule("An illegal order: a burn costing more fuel than remains");
const bad = await bridge.helm.run(
  { tag: "executeBurn", ship: "NCC-1", vector: "4000,0", reason: "push further out" },
  0,
);
p(`  Order → Helm (burn costing 80, only 20 left):`);
p(`    ${bad.tag === "refused" ? `refused: ${bad.reason}` : "committed"}`);
p(`  From the bridge, a refused order and a jammed engine look the same (MacBeth §5).`);

// ══ 4. The two logs ═══════════════════════════════════════════════════
rule("Layer 1 — the ship's log (WHAT committed, no reason)");
const slog = fileShipLog(lp);
for (const e of slog.all()) {
  p(`  ${e.ts}  ${e.command.padEnd(12)}  corr ${e.correlation_id}`);
}
rule("Layer 2 — the intent-log (WHY, and what was only attempted)");
for (const r of ctx.intentLog.all()) {
  const why = r.mutates ? `"${r.reason}"` : "(read)";
  p(`  ${r.ts}  ${r.agent_id.padEnd(20)} ${r.tool.padEnd(13)} ${r.status.padEnd(9)} ${why}`);
}

// ══ 5. Reconciliation ═════════════════════════════════════════════════
rule("Reconciliation — the two logs audit each other");
const rec = reconcile(slog, ctx.intentLog);
p(`  ${reconSummary(rec)}`);
for (const m of rec.matched) p(`    matched:  ${m.command} by ${m.agentId} (corr ${m.correlationId})`);
for (const b of rec.blocked) p(`    blocked:  ${b.tool} — "${b.reason}" (refused; visible only here)`);

rule("The system after the burn");
p(starMap(loadWorld(wp)));

// ══ 6. What reconciliation CATCHES: a mutation with no logged reason ══
rule("What reconciliation catches — a change made OUTSIDE the bridge");
const rogue = rig("demo-out/alarm");
// one proper, harnessed order (reasoned)
await mkBridge(rogue.ctx).helm.run(
  { tag: "executeBurn", ship: "NCC-1", vector: "500,0", reason: "minor course correction" },
  0,
);
// one rogue order straight at con, bypassing the harness — no intent record
rogue.conRun(["helm", "burn", "--vector", "300,0", "--reason", "(bypassed the bridge)", "--corr", "ROGUE0000000000000000000000"]);
const rogueRec = reconcile(fileShipLog(rogue.lp), rogue.ctx.intentLog);
p(`  ${reconSummary(rogueRec)}`);
for (const a of rogueRec.alarms) {
  if (a.kind === "write-without-reason") {
    p(`    ALARM: ${a.entry.command} committed (corr ${a.entry.correlation_id}) with NO logged reason`);
  }
}
p(`  The ship's log alone could never show this; the two-log cross-check does.`);
p("");
