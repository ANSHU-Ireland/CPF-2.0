import { assertBudgetAvailable, type BudgetLimits, type BudgetUsage } from "./budget.js";
import { assertModelAllowed } from "./allow-list.js";
import { assertNotKilled, type KillSwitchState } from "./kill-switch.js";
import { redactPii } from "./redaction.js";
import { withBoundedRetry, withTimeout, type RetryOptions } from "./retry.js";
import type { ModelPin, ProviderAdapter, ProviderRegion } from "./types.js";

export interface GatewayInvocationRecord {
  useCase: string;
  provider: string;
  model: string;
  modelVersion: string;
  promptVersion: string;
  region: ProviderRegion;
  inputTokens: number;
  outputTokens: number;
  costUsdCents: number;
  latencyMs: number;
  redactionsApplied: string[];
  status: "success";
}

export interface CompletionParams {
  useCase: string;
  promptVersion: string;
  model: string;
  version: string;
  systemPrompt: string;
  userContent: string;
  /** Names to redact from userContent before it ever reaches the adapter. */
  knownNames?: readonly string[];
  region: ProviderRegion;
  killSwitch: KillSwitchState;
  budget: { limits: BudgetLimits; usage: BudgetUsage };
}

export interface AiGatewayOptions {
  adapter: ProviderAdapter;
  allowList: readonly ModelPin[];
  /** Cost per token, in USD cents, used to estimate spend before the call and to price the actual usage after. */
  costPerInputTokenUsdCents: number;
  costPerOutputTokenUsdCents: number;
  timeoutMs: number;
  retry: RetryOptions;
}

/**
 * Single entry point for all outbound model calls (ADR-0005). Orchestrates,
 * in order: kill-switch check, model allow-list check, PII redaction,
 * budget check, timeout + bounded retry, and produces a full invocation
 * record for the caller to persist (this package has no DB access itself —
 * logging is the host application's responsibility, per the modular-monolith
 * pure-domain-package convention, ADR-0001).
 */
export class AiGateway {
  constructor(private readonly opts: AiGatewayOptions) {}

  async complete(
    params: CompletionParams,
  ): Promise<{ text: string; invocation: GatewayInvocationRecord }> {
    assertNotKilled(params.killSwitch);
    assertModelAllowed({ provider: this.opts.adapter.provider, model: params.model, version: params.version }, this.opts.allowList);

    const { redactedText, redactionsApplied } = redactPii(params.userContent, params.knownNames ?? []);

    // Rough pre-flight estimate (chars/4 ~ tokens) plus response headroom, so budgets are
    // enforced before spending network time on a call that would exceed them.
    const estimatedInputTokens = Math.ceil(redactedText.length / 4);
    const estimatedTotalTokens = estimatedInputTokens + 512;
    const estimatedCostUsdCents =
      estimatedInputTokens * this.opts.costPerInputTokenUsdCents + 512 * this.opts.costPerOutputTokenUsdCents;
    assertBudgetAvailable(params.budget.limits, params.budget.usage, estimatedTotalTokens, estimatedCostUsdCents);

    const result = await withBoundedRetry(
      () =>
        withTimeout(
          this.opts.adapter.complete({
            model: params.model,
            version: params.version,
            systemPrompt: params.systemPrompt,
            userContent: redactedText,
            timeoutMs: this.opts.timeoutMs,
          }),
          this.opts.timeoutMs,
        ),
      this.opts.retry,
    );

    const costUsdCents =
      result.inputTokens * this.opts.costPerInputTokenUsdCents + result.outputTokens * this.opts.costPerOutputTokenUsdCents;

    const invocation: GatewayInvocationRecord = {
      useCase: params.useCase,
      provider: this.opts.adapter.provider,
      model: params.model,
      modelVersion: params.version,
      promptVersion: params.promptVersion,
      region: params.region,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsdCents,
      latencyMs: result.latencyMs,
      redactionsApplied,
      status: "success",
    };

    return { text: result.text, invocation };
  }
}
