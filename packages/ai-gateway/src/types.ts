/** Provider-agnostic request/response shapes for a single AI completion call. */

export type ProviderRegion = "eu" | "us" | "other";

export interface ModelPin {
  provider: string;
  model: string;
  version: string;
}

export interface CompletionAdapterRequest {
  model: string;
  version: string;
  systemPrompt: string;
  userContent: string;
  timeoutMs: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * A provider adapter implements only synchronous-request completion for now.
 * Embeddings are explicitly out of scope for this phase (ADR-0005/Step 45
 * plan text: "complete + embeddings later") — no method exists for them yet,
 * so callers cannot accidentally invoke an unimplemented capability.
 */
export interface ProviderAdapter {
  readonly provider: string;
  complete(request: CompletionAdapterRequest): Promise<CompletionResult>;
}
