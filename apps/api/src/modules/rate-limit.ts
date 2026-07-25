/**
 * Token-bucket rate limiting (CPF-43).
 *
 * Single-node, in-memory by design for this phase — `RateLimitStore` is an
 * explicit seam so a Redis-backed implementation can be swapped in later for
 * multi-instance deployments without touching call sites. Documented
 * honestly rather than presented as distributed.
 */
export interface RateLimitOutcome {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(key: string, capacityTokens: number, refillPerSecond: number): RateLimitOutcome;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, capacityTokens: number, refillPerSecond: number): RateLimitOutcome {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacityTokens, lastRefillMs: now };
      this.buckets.set(key, bucket);
    }
    const elapsedSeconds = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(capacityTokens, bucket.tokens + elapsedSeconds * refillPerSecond);
    bucket.lastRefillMs = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const deficit = 1 - bucket.tokens;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(deficit / refillPerSecond)) };
  }

  /** Test-only: drop all bucket state so suites don't leak between runs. */
  reset(): void {
    this.buckets.clear();
  }
}
