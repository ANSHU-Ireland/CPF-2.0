import { describe, expect, it } from "vitest";
import { AiBudgetExhaustedError, assertBudgetAvailable } from "../src/budget.js";

describe("assertBudgetAvailable", () => {
  const limits = { tokensPerDay: 1000, costCapUsdCents: 500 };

  it("allows a call within both budgets", () => {
    expect(() =>
      assertBudgetAvailable(limits, { tokensUsedToday: 100, costUsedUsdCentsToday: 50 }, 200, 20),
    ).not.toThrow();
  });

  it("throws AI_BUDGET_EXHAUSTED (tokens) when the token budget would be exceeded", () => {
    try {
      assertBudgetAvailable(limits, { tokensUsedToday: 900, costUsedUsdCentsToday: 0 }, 200, 1);
      expect.unreachable("expected assertBudgetAvailable to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AiBudgetExhaustedError);
      expect((err as AiBudgetExhaustedError).code).toBe("AI_BUDGET_EXHAUSTED");
      expect((err as AiBudgetExhaustedError).reason).toBe("tokens");
    }
  });

  it("throws AI_BUDGET_EXHAUSTED (cost) when the cost cap would be exceeded", () => {
    try {
      assertBudgetAvailable(limits, { tokensUsedToday: 0, costUsedUsdCentsToday: 480 }, 1, 50);
      expect.unreachable("expected assertBudgetAvailable to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AiBudgetExhaustedError);
      expect((err as AiBudgetExhaustedError).reason).toBe("cost");
    }
  });

  it("allows a call that lands exactly on the budget ceiling", () => {
    expect(() =>
      assertBudgetAvailable(limits, { tokensUsedToday: 800, costUsedUsdCentsToday: 400 }, 200, 100),
    ).not.toThrow();
  });
});
