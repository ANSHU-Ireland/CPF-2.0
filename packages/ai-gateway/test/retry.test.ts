import { describe, expect, it, vi } from "vitest";
import { AiTimeoutError, withBoundedRetry, withTimeout } from "../src/retry.js";

describe("withTimeout", () => {
  it("resolves normally when the promise settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejects with AiTimeoutError when the promise takes too long", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("too-late"), 50));
    await expect(withTimeout(slow, 5)).rejects.toBeInstanceOf(AiTimeoutError);
  });
});

describe("withBoundedRetry", () => {
  it("returns the result on the first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withBoundedRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts and then re-throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withBoundedRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds after a transient failure within the attempt budget", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce("recovered");
    const result = await withBoundedRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
