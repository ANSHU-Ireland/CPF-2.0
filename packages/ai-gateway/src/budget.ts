/** Per-use-case token/day and cost/day budgets (ADR-0005). */

export interface BudgetLimits {
  tokensPerDay: number;
  costCapUsdCents: number;
}

export interface BudgetUsage {
  tokensUsedToday: number;
  costUsedUsdCentsToday: number;
}

export class AiBudgetExhaustedError extends Error {
  readonly code = "AI_BUDGET_EXHAUSTED" as const;
  constructor(public readonly reason: "tokens" | "cost") {
    super(`AI budget exhausted (${reason})`);
    this.name = "AiBudgetExhaustedError";
  }
}

/** Throws AiBudgetExhaustedError if the (estimated) call would exceed either budget. */
export function assertBudgetAvailable(
  limits: BudgetLimits,
  usage: BudgetUsage,
  estimatedTokens: number,
  estimatedCostUsdCents: number,
): void {
  if (usage.tokensUsedToday + estimatedTokens > limits.tokensPerDay) {
    throw new AiBudgetExhaustedError("tokens");
  }
  if (usage.costUsedUsdCentsToday + estimatedCostUsdCents > limits.costCapUsdCents) {
    throw new AiBudgetExhaustedError("cost");
  }
}
