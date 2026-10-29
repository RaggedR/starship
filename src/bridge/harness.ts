// harness.ts — the officer's custom harness: the layer that logs WHY and enforces
// the two hard boundaries (the registry and the reason-gate).
//
//   Registry = permission. Each officer carries an allowlist of con commands.
//     A command not in the allowlist cannot be invoked — refused before con, with
//     no generic "bash" escape hatch. (The container TYPE already prevents asking
//     an officer an out-of-surface shape; this is the same gate at runtime, for
//     defence in depth and so the permission is visible in the log.)
//
//   Reason required. A mutating call with an empty reason is refused BEFORE con
//     runs — the order never reaches the surface — and the refusal is recorded
//     in the intent-log, so "proposed but blocked for want of a reason" is visible.
//
// Write-ahead: append `attempted` before con runs, an outcome record after, both
// sharing one call_id. The correlation id is minted here and handed to con via
// --corr (the correlation-id handshake), joining Layer 2 to Layer 1.

import type { Clock, IdSource } from "../log/ids.ts";
import type { IntentLog, IntentRecord } from "../log/intentlog.ts";

/** What an officer's harness can do with the con surface, injected so the demo and
 *  tests can point it at in-memory or file-backed con without the officer knowing. */
export type ConRun = (argv: string[]) => { value: unknown };

export type HarnessCtx = {
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly intentLog: IntentLog;
  readonly sessionId: string;
  readonly conRun: ConRun;
};

/** An officer's identity and registry. The allowlist IS the permission grant. */
export type Registry = {
  readonly agentId: string; // e.g. "officer:helm"
  readonly allowed: ReadonlySet<string>; // con commands this officer may invoke
};

export type MutationOutcome =
  | { readonly ok: true; readonly correlationId: string; readonly result: unknown }
  | { readonly ok: false; readonly reason: string };

/** Log a read: one combined record, mutates:false, no reason, no correlation. */
export function logRead(
  ctx: HarnessCtx,
  agentId: string,
  tool: string,
  args: Record<string, unknown>,
): void {
  ctx.intentLog.append({
    call_id: ctx.ids.next(),
    ts: ctx.clock.now(),
    agent_id: agentId,
    session_id: ctx.sessionId,
    tool,
    args,
    reason: "",
    mutates: false,
    status: "ok",
    correlation_id: "",
  });
}

/** Read through con: the officer's reads are part of its registry too, so this
 *  checks the allowlist, logs a read record, and returns con's parsed result. A
 *  read never commits and never writes the ship's log. */
export function conRead(
  ctx: HarnessCtx,
  reg: Registry,
  tool: string,
  argv: string[],
  args: Record<string, unknown>,
): unknown {
  if (!reg.allowed.has(tool)) {
    throw new Error(`${tool} is not in ${reg.agentId}'s registry`);
  }
  logRead(ctx, reg.agentId, tool, args);
  return ctx.conRun(argv).value;
}

/** Run a mutating con command through the full gate: registry check, reason gate,
 *  write-ahead intent, con invocation with --corr, outcome record. Returns a typed
 *  outcome — never throws for an ordinary refusal (a refusal is a position). */
export function runMutation(
  ctx: HarnessCtx,
  reg: Registry,
  tool: string,
  argv: string[],
  args: Record<string, unknown>,
  reason: string,
): MutationOutcome {
  const base = (status: IntentRecord["status"], extra: Partial<IntentRecord>): IntentRecord => ({
    call_id: extra.call_id ?? ctx.ids.next(),
    ts: ctx.clock.now(),
    agent_id: reg.agentId,
    session_id: ctx.sessionId,
    tool,
    args,
    reason,
    mutates: true,
    status,
    correlation_id: extra.correlation_id ?? "",
    ...extra,
  });

  // Registry gate — the allowlist, enforced by presence.
  if (!reg.allowed.has(tool)) {
    ctx.intentLog.append(base("refused", {}));
    return { ok: false, reason: `${tool} is not in ${reg.agentId}'s registry` };
  }
  // Reason gate — a mutating order with no reason never reaches con.
  if (!reason || reason.trim() === "") {
    ctx.intentLog.append(base("refused", {}));
    return { ok: false, reason: `${tool} requires a non-empty reason` };
  }

  const callId = ctx.ids.next();
  const correlationId = ctx.ids.next();
  // write-ahead: record the attempt BEFORE anything commits.
  ctx.intentLog.append(base("attempted", { call_id: callId, correlation_id: correlationId }));

  const fullArgv = [...argv, "--reason", reason, "--corr", correlationId];
  try {
    const { value } = ctx.conRun(fullArgv);
    ctx.intentLog.append(base("ok", { call_id: callId, correlation_id: correlationId, exit_code: 0 }));
    return { ok: true, correlationId, result: value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A gate refusal inside con lands here: logged as refused, NOT ok. No ship's
    // log entry exists for it — visible only in Layer 2.
    ctx.intentLog.append(base("refused", { call_id: callId, correlation_id: correlationId, exit_code: 1 }));
    return { ok: false, reason: msg };
  }
}
