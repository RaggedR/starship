// captain.ts — the captain gives no readings and flies nothing directly. The
// captain DELEGATES, AMALGAMATES, and DECIDES (english.txt).
//
//   Delegate + amalgamate. The situation picture is gathered with tensorC: Science
//     is asked to assess and Engineering to report power, both prompted up front,
//     both replies owed. Here amalgamation is a GATHER — two typed positions joined
//     into one picture (contrast the treasury, where it is algebraic summation).
//
//   Decide + act. From that picture the captain computes an escape vector, asks Helm
//     to PROPOSE the burn (a read: feasible?), and only then issues the ORDER to
//     execute — each order carrying a reason derived from what Science saw. Control
//     flows down as a delegated shape; data flowed up as the assessment.

import { tensorC } from "../lib/algebra.ts";
import type { Runner } from "../lib/algebra.ts";
import type {
  Assessment,
  BurnProposal,
  Contact,
  EngineeringC,
  HelmC,
  OfficerResult,
  PowerReport,
  ScienceC,
  WeaponsC,
} from "./containers.ts";
import type { HarnessCtx } from "./harness.ts";
import {
  engineeringOfficer,
  helmOfficer,
  scienceOfficer,
  weaponsOfficer,
} from "./officers.ts";

export type Bridge = {
  readonly science: Runner<ScienceC>;
  readonly helm: Runner<HelmC>;
  readonly weapons: Runner<WeaponsC>;
  readonly engineering: Runner<EngineeringC>;
};

/** Assemble a full bridge of officers over one harness context. The officers take
 *  the ship per-call (in the shape), so one bridge serves any ship in the world. */
export function mkBridge(ctx: HarnessCtx): Bridge {
  return {
    science: scienceOfficer(ctx),
    helm: helmOfficer(ctx),
    weapons: weaponsOfficer(ctx),
    engineering: engineeringOfficer(ctx),
  };
}

export type CaptainReport = {
  readonly ship: string;
  readonly assessment: Assessment;
  readonly power: PowerReport;
  readonly decision: string;
  readonly order?: {
    readonly to: string;
    readonly reason: string;
    readonly proposal: BurnProposal;
    readonly outcome: OfficerResult;
  };
};

/** The escape vector: a 2000 km burn directly away from the nearest threat's
 *  bearing. 2000 km costs 40 fuel, so against the seeded 60 it is feasible — the
 *  numbers of the english.txt scene. */
function escapeVector(threat: Contact): string {
  const away = ((threat.bearing + 180) % 360) * (Math.PI / 180);
  const mag = 2000;
  return `${Math.round(mag * Math.cos(away))},${Math.round(mag * Math.sin(away))}`;
}

/** Handle a hazard: gather the picture, decide, and — if there is a threat and the
 *  burn is feasible — order the evasive burn with a reason drawn from the sweep. */
export async function handleHazard(
  bridge: Bridge,
  ship: string,
): Promise<CaptainReport> {
  // 1. Amalgamate the situation: Science ⊗ Engineering, in parallel.
  const picture = await tensorC(bridge.science, bridge.engineering).run(
    { left: { tag: "assess", ship }, right: { tag: "report", ship } },
    0,
  );
  const assessment = picture.left;
  const power = picture.right;

  // 2. Decide.
  const threat = assessment.threats[0];
  if (!threat) {
    return { ship, assessment, power, decision: "no threats; hold station" };
  }

  // 3. Propose the escape burn (a read — does the fuel cover it?).
  const vector = escapeVector(threat);
  const proposal = await bridge.helm.run({ tag: "proposeBurn", ship, vector }, 0);
  if (!proposal.feasible) {
    return {
      ship,
      assessment,
      power,
      decision: `threat ${threat.id}, but the ${proposal.fuelCost}-fuel burn exceeds ${proposal.haveFuel}; cannot evade`,
    };
  }

  // 4. Order Helm to execute, with a reason derived from what Science saw.
  const reason =
    `evading ${threat.id} (${threat.kind}) reported bearing ${threat.bearing}, range ${threat.range} km`;
  const outcome = await bridge.helm.run({ tag: "executeBurn", ship, vector, reason }, 0);

  return {
    ship,
    assessment,
    power,
    decision: `evade ${threat.id} with a ${proposal.fuelCost}-fuel burn`,
    order: { to: "officer:helm", reason, proposal, outcome },
  };
}
