// containers.ts — each officer's container: the finite set of shapes it answers,
// and the typed position it returns. These are the "disjoint sub-surfaces" of
// PLAN §3 made into types. An officer's Runner is typed by its container, so the
// officer literally cannot be ASKED a shape outside its surface — the permission
// model is the type, enforced by the compiler (and, below, by the registry).

import type { Fib } from "../lib/algebra.ts";
import type { PowerBudget } from "../world/types.ts";

// ── Science (read-only): answers an assessment ────────────────────────
export type Contact = {
  readonly id: string;
  readonly kind: string;
  readonly bearing: number;
  readonly range: number;
};

export type Assessment = {
  readonly threats: readonly Contact[];
  readonly opportunities: readonly Contact[];
  readonly recommendation: string;
};

export type AssessShape = { readonly tag: "assess"; readonly ship: string };

/** Science's container: one shape ("assess"), one position (an Assessment). */
export type ScienceC = Fib<AssessShape, Assessment>;

// ── The shared outcome of any mutating order ──────────────────────────
/** Every mutating officer answers with this: a committed order (carrying the
 *  correlation id that joins its ship's-log entry), or a refusal. Crucially, a
 *  refusal is a POSITION, not an exception — from the bridge it is indistinguishable
 *  from a jammed instrument (MacBeth §5). */
export type OfficerResult =
  | { readonly tag: "done"; readonly correlationId: string; readonly result: unknown }
  | { readonly tag: "refused"; readonly reason: string };

// ── Helm: proposes and executes burns, and docks. Cannot fire. ────────
export type BurnProposal = {
  readonly vector: string;
  readonly fuelCost: number;
  readonly haveFuel: number;
  readonly feasible: boolean;
};

export type HelmC =
  | Fib<{ readonly tag: "proposeBurn"; readonly ship: string; readonly vector: string }, BurnProposal>
  | Fib<
    { readonly tag: "executeBurn"; readonly ship: string; readonly vector: string; readonly reason: string },
    OfficerResult
  >
  | Fib<
    { readonly tag: "dock"; readonly ship: string; readonly station: string; readonly reason: string },
    OfficerResult
  >;

// ── Weapons: fires only on an authorized target. Cannot steer. ────────
export type WeaponsC =
  | Fib<
    { readonly tag: "authorize"; readonly ship: string; readonly target: string; readonly reason: string },
    OfficerResult
  >
  | Fib<
    {
      readonly tag: "fire";
      readonly ship: string;
      readonly target: string;
      readonly token: string;
      readonly reason: string;
    },
    OfficerResult
  >;

// ── Ship-captain: what a FLAGSHIP sees of one ship (M5 nesting) ───────
/** The single position a ship-captain returns up to the flagship. This is the
 *  existential boundary (MacBeth §4): the flagship sees ONLY this condensed status
 *  — never the ship's Assessment, PowerReport, proposal, or its four officers. The
 *  ship's internal state is hidden behind this one report, exactly as a child
 *  worker's store is invisible to its parent. */
export type ShipStatusReport = {
  readonly ship: string;
  readonly acted: boolean;
  readonly decision: string;
  readonly fuelAfter: number;
  readonly correlationId: string | null;
};

export type ShipCaptainC = Fib<
  { readonly tag: "handleHazard"; readonly ship: string },
  ShipStatusReport
>;

// ── Engineering: allocates power and moves cargo. ─────────────────────
export type PowerReport = {
  readonly power: PowerBudget;
  readonly routedTotal: number;
  readonly headroom: number;
};

export type EngineeringC =
  | Fib<{ readonly tag: "report"; readonly ship: string }, PowerReport>
  | Fib<
    {
      readonly tag: "route";
      readonly ship: string;
      readonly to: string;
      readonly pct: number;
      readonly reason: string;
    },
    OfficerResult
  >
  | Fib<
    {
      readonly tag: "transfer";
      readonly ship: string;
      readonly cargo: string;
      readonly to: string;
      readonly reason: string;
    },
    OfficerResult
  >;
