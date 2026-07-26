import type { CompletionAdapterRequest, CompletionResult, ProviderAdapter } from "../types.js";

export interface OpenAiCompatibleConfig {
  /** Base URL of an OpenAI-compatible HTTP API. Point this at an EU-hosted endpoint to satisfy the EU-region routing requirement. */
  baseUrl: string;
  apiKey: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Real provider adapter: any OpenAI-compatible chat-completions HTTP API,
 * base-URL configurable so it can point at an EU-hosted, self-hosted, or
 * third-party endpoint. No provider is configured by default (ADR-0005).
 */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly provider = "openai-compatible";

  constructor(private readonly config: OpenAiCompatibleConfig) {}

  async complete(request: CompletionAdapterRequest): Promise<CompletionResult> {
    const started = Date.now();
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userContent },
        ],
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`AI provider returned HTTP ${response.status}`);
    }
    const json = (await response.json()) as OpenAiChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}
