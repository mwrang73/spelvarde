// AI-tolkningen mot Claude-API:t (E5 10.7). Bara på servern.
//
// - Nyckeln läses från ANTHROPIC_API_KEY. Saknas den finns ingen klient
//   (getTipsDeps ger ai = null) och rutten svarar 503 AI_NOT_CONFIGURED.
// - Verktyget tvingas (tool_choice), så svaret är alltid JSON enligt schemat.
// - Avvikelse: specen anger temperature: 0, men @anthropic-ai/sdk 1.3 har inte
//   längre parametern för de aktuella modellerna. Den skickas därför inte.
//   Stabiliteten kommer i stället av det tvingade verktyget och valideringen.
// - Klienten har timeout 50 s och maxRetries 1 (specen). Eftersom Vercel
//   avbryter efter 60 s har anropet dessutom en total gräns på 55 s, så att
//   ett nytt försök efter en timeout aldrig kan dra över.
// - Råfel loggas på servern, aldrig nyckeln. Klienten får bara de korta
//   orsakerna nedan.
import Anthropic, { APIConnectionTimeoutError, APIError, APIUserAbortError, AuthenticationError, PermissionDeniedError } from "@anthropic-ai/sdk";
import { TIP_TOOL, TIP_TOOL_NAME } from "@/lib/tips/prompt";

export const TIPS_MODEL = "claude-sonnet-5-5";
export const AI_TIMEOUT_MS = 50_000;
export const AI_TOTAL_MS = 55_000;
export const AI_MAX_TOKENS = 4096;

export const AI_ERR = {
  unreadable: "Svaret gick inte att läsa.",
  timeout: "AI:n svarade inte inom 50 sekunder.",
  overloaded: "AI-tjänsten är överbelastad just nu.",
  badKey: "AI-nyckeln fungerar inte. Kontrollera ANTHROPIC_API_KEY i Vercel.",
  other: "AI-tjänsten svarade med fel.",
} as const;

export type AiRequest = { system: string; user: string; textHash: string };
export type AiResponse = { input: unknown; stopReason: string | null; inputTokens: number; outputTokens: number; model: string };
export type TipsAi = (req: AiRequest) => Promise<AiResponse>;

// Fel från anropet, med HTTP-status för rutten (502, 503 eller 504).
export class AiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

// Anthropics felmeddelande, kort. Innehåller aldrig nyckeln.
function anthropicReason(e: InstanceType<typeof APIError>): string {
  const body = e.error as { error?: { message?: unknown } } | undefined;
  const msg = typeof body?.error?.message === "string" ? body.error.message : e.message;
  return msg.replace(/sk-ant-[\w-]+/g, "[nyckel]").slice(0, 160);
}

export function aiErrorOf(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof APIConnectionTimeoutError || e instanceof APIUserAbortError) return new AiError(504, AI_ERR.timeout);
  if (e instanceof AuthenticationError) return new AiError(503, `${AI_ERR.badKey} (401: nyckeln godkändes inte)`);
  if (e instanceof PermissionDeniedError) return new AiError(503, `${AI_ERR.badKey} (403: ${anthropicReason(e)})`);
  if (e instanceof APIError && (e.status === 429 || e.status === 529)) return new AiError(502, AI_ERR.overloaded);
  // Övriga fel med Anthropics egen förklaring, t.ex. för lite krediter eller okänd modell.
  if (e instanceof APIError && e.status) return new AiError(502, `${AI_ERR.other} (${e.status}: ${anthropicReason(e)})`);
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return new AiError(504, AI_ERR.timeout);
  return new AiError(502, AI_ERR.other);
}

// Verktygets input ur svaret, eller null när det saknas.
export function toolInputOf(content: { type: string; name?: string; input?: unknown }[]): unknown {
  const block = content.find((c) => c.type === "tool_use" && c.name === TIP_TOOL_NAME);
  const input = block?.input;
  if (!input || typeof input !== "object" || !Array.isArray((input as { tips?: unknown }).tips)) return null;
  return input;
}

export function createClaudeAi(apiKey: string, model = TIPS_MODEL): TipsAi {
  const client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  return async ({ system, user }) => {
    try {
      const msg = await client.messages.create(
        {
          model,
          max_tokens: AI_MAX_TOKENS,
          system,
          tools: [TIP_TOOL],
          tool_choice: { type: "tool", name: TIP_TOOL_NAME, disable_parallel_tool_use: true },
          messages: [{ role: "user", content: user }],
        },
        { signal: AbortSignal.timeout(AI_TOTAL_MS) },
      );
      return {
        input: toolInputOf(msg.content as { type: string; name?: string; input?: unknown }[]),
        stopReason: msg.stop_reason ?? null,
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
        model: msg.model ?? model,
      };
    } catch (e) {
      const err = aiErrorOf(e);
      console.error("[tips-ai]", err.message, e instanceof APIError ? `status ${e.status}` : e instanceof Error ? e.name : "");
      throw err;
    }
  };
}
