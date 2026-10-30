// model.ts — the neutral model seam: the one boundary that makes "use a free model
// instead of Anthropic" a config choice rather than a rewrite.
//
// The tool dispatch stays deliberately independent of any model SDK: the loop
// (loop.ts) and the dispatch speak ONLY the neutral types below, and an SDK or a
// wire format is adapted into them at the edge. A concrete provider — Groq
// (groq.ts), or the deterministic scripted solver (scripted.ts) — is the only
// thing that knows a wire format. Swapping the provider changes nothing above
// this line.

// ── the neutral wire ────────────────────────────────────────────────────
/** A tool offered to the model: a named capability with a JSON-Schema for its
 *  arguments. Built from the harness registry; `mutates` decides whether a reason
 *  is required (enforced below the model, in the reason-gate). */
export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly mutates: boolean;
  readonly inputSchema: Record<string, unknown>;
};

/** The model's request to run one tool (an SDK tool_use block, erased of SDK
 *  types). `input` is the decoded arguments. */
export type ToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
};

/** What we hand back to the model for one call. */
export type ToolResult = {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
};

/** One entry in the conversation slice, provider-neutral. */
export type Message =
  | { readonly role: "user"; readonly text: string }
  | {
    readonly role: "assistant";
    readonly text: string;
    readonly toolCalls: readonly ToolCall[];
  }
  | { readonly role: "tool"; readonly results: readonly ToolResult[] };

/** One assistant turn: prose plus any tool requests. */
export type Turn = { readonly text: string; readonly toolCalls: readonly ToolCall[] };

/** The one call inside the loop. A provider implements this; the loop depends on
 *  nothing else about the model. */
export interface ModelClient {
  readonly name: string;
  converse(
    system: string,
    messages: readonly Message[],
    tools: readonly ToolSpec[],
  ): Promise<Turn>;
}

// ── the adventurer's tools (the allowlist, as schemas) ───────────────────
// JSON-Schema helpers for the tool argument schemas.
const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** The five tools the adventurer may call. The set IS the permission grant: there
 *  is no `bash`, no generic "run a command" — a capability not here cannot be
 *  named by the model. `move`/`attack` require a `reason`; the reads do not. */
export const ADVENTURER_TOOLS: readonly ToolSpec[] = [
  {
    name: "look",
    description:
      "Perceive your surroundings: your position and hp, what lies to the N/S/E/W " +
      "(wall, floor, exit, or a monster id), and the exit's location, distance and bearing.",
    mutates: false,
    inputSchema: obj({}, []),
  },
  {
    name: "hero",
    description:
      "Report your own status: position, hp, attack, and whether you are alive.",
    mutates: false,
    inputSchema: obj({}, []),
  },
  {
    name: "map",
    description:
      "Return an ASCII map of the whole maze (walls, you, monsters, the exit).",
    mutates: false,
    inputSchema: obj({}, []),
  },
  {
    name: "move",
    description:
      "Step one cell in a direction. Refused if a wall, the maze edge, or a monster " +
      "is that way. Requires a reason.",
    mutates: true,
    inputSchema: obj({
      dir: {
        type: "string",
        enum: ["N", "S", "E", "W"],
        description: "Direction to step.",
      },
      reason: str("Why you are moving this way (required)."),
    }, ["dir", "reason"]),
  },
  {
    name: "attack",
    description:
      "Attack an adjacent monster by id (from a look). It strikes back if it survives. " +
      "Requires a reason.",
    mutates: true,
    inputSchema: obj({
      target: str("The monster id to attack, e.g. goblin-1."),
      reason: str("Why you are attacking it (required)."),
    }, ["target", "reason"]),
  },
];
