import type { CompletionAdapterRequest, CompletionResult, ProviderAdapter } from "../types.js";

/**
 * A deterministic, non-network "fixture" adapter. Used ONLY by the AIF-01
 * evaluation harness and by unit/integration tests to exercise the gateway
 * pipeline without a real provider. Phase 1 ships with zero AI providers
 * configured (ADR-0005) — this adapter must never be wired into a real
 * user-facing request path, and its output must never be presented to a
 * user as if it came from a live model.
 */
export class StubFixtureAdapter implements ProviderAdapter {
  readonly provider = "stub-fixture";

  constructor(private readonly responder: (userContent: string) => string) {}

  async complete(request: CompletionAdapterRequest): Promise<CompletionResult> {
    const text = this.responder(request.userContent);
    return {
      text,
      inputTokens: Math.ceil(request.userContent.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      latencyMs: 1,
    };
  }
}
