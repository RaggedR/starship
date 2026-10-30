// groq.ts — a ModelClient over Groq's free tier. This is the ONLY file that knows
// a model wire format, and it is the whole answer to "a free model instead of
// Anthropic": Groq serves open-weight models (Llama, Qwen, …) for free behind the
// OpenAI-compatible chat/completions API, including OpenAI-style tool calling.
//
// It is the SDK-adapter edge of the harness, but against a free provider and over
// plain `fetch`, so there is no SDK dependency at all. Because the endpoint is
// OpenAI-compatible, pointing
// GROQ_BASE_URL at any other such provider (Cerebras, OpenRouter, a local Ollama at
// http://localhost:11434/v1) switches backends with no code change.
//
//   GROQ_API_KEY   required for a live run (free from console.groq.com)
//   GROQ_MODEL     default "openai/gpt-oss-120b" (list what a key can use with
//                  GET /v1/models; Groq's catalogue changes over time)
//   GROQ_BASE_URL  default "https://api.groq.com/openai/v1"
//
// The free tier throttles on tokens-per-minute, and the transcript grows every
// turn, so a 429 mid-run is routine. converse() waits it out (honouring the
// Retry-After header, then the "try again in Ns" in the body) and retries, so a
// run completes on the free tier; it just pauses.

import type { Message, ModelClient, ToolCall, ToolSpec, Turn } from "./model.ts";

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Adapt the neutral tool specs to OpenAI's function-tool shape. */
function toOpenAITools(tools: readonly ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** Flatten the neutral conversation into OpenAI's message list. An assistant turn
 *  with tool calls is followed by one `tool` message per result, keyed by
 *  tool_call_id — the contract the API requires. */
function toOpenAIMessages(system: string, messages: readonly Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        tool_calls: m.toolCalls.length > 0
          ? m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          }))
          : undefined,
      });
    } else {
      for (const r of m.results) {
        out.push({ role: "tool", tool_call_id: r.toolUseId, content: r.content });
      }
    }
  }
  return out;
}

function parseToolCalls(raw: OpenAIToolCall[] | undefined): ToolCall[] {
  if (!raw) return [];
  return raw.map((tc) => {
    let input: Record<string, unknown> = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      input = {}; // a model that emits non-JSON args gets empty input; the gate refuses
    }
    return { id: tc.id, name: tc.function.name, input };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long to wait before a retry, in milliseconds. Prefer the server's own
 *  instruction: a Retry-After header, either as seconds or as an HTTP date; then
 *  the "try again in 15.03s" that Groq puts in the 429 body; else a linear
 *  backoff. The server's figure is honoured in full (a too-short wait just hits
 *  the same limit again); a 2-minute cap guards only against a pathological value. */
function retryDelayMs(resp: Response, body: string, attempt: number): number {
  let seconds: number | null = null;
  const header = resp.headers.get("retry-after");
  if (header) {
    const asNum = Number(header);
    if (Number.isFinite(asNum) && asNum >= 0) {
      seconds = asNum;
    } else {
      const asDate = Date.parse(header); // Retry-After may be an HTTP date
      if (Number.isFinite(asDate)) seconds = Math.max(0, (asDate - Date.now()) / 1000);
    }
  }
  if (seconds === null) {
    const fromBody = body.match(/try again in ([\d.]+)s/);
    seconds = fromBody ? Number(fromBody[1]) : 2 * attempt;
  }
  return Math.min(seconds + 0.5, 120) * 1000;
}

export function groqClient(): ModelClient {
  const baseUrl = Deno.env.get("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1";
  const model = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";
  const apiKey = Deno.env.get("GROQ_API_KEY");
  const maxAttempts = 8;

  return {
    name: `groq:${model}`,
    async converse(system, messages, tools): Promise<Turn> {
      if (!apiKey) {
        throw new Error(
          "GROQ_API_KEY is not set. Get a free key at https://console.groq.com and " +
            "`export GROQ_API_KEY=...` before a --live run.",
        );
      }
      const payload = JSON.stringify({
        model,
        messages: toOpenAIMessages(system, messages),
        tools: toOpenAITools(tools),
        tool_choice: "auto",
        temperature: 0,
      });

      for (let attempt = 1;; attempt++) {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: payload,
        });
        if (resp.ok) {
          const data = await resp.json();
          const msg = data?.choices?.[0]?.message ?? {};
          return {
            text: typeof msg.content === "string" ? msg.content : "",
            toolCalls: parseToolCalls(msg.tool_calls),
          };
        }
        const body = await resp.text();
        // A free tier throttles on tokens-per-minute (429); 5xx is transient.
        // Both are worth waiting out — the growing transcript makes 429 routine.
        const retryable = resp.status === 429 || resp.status >= 500;
        if (retryable && attempt < maxAttempts) {
          const ms = retryDelayMs(resp, body, attempt);
          console.error(
            `  [groq ${resp.status}; waiting ${Math.round(ms / 1000)}s then retrying]`,
          );
          await sleep(ms);
          continue;
        }
        throw new Error(`groq ${resp.status}: ${body.slice(0, 300)}`);
      }
    },
  };
}
