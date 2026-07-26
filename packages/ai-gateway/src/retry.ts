export class AiTimeoutError extends Error {
  readonly code = "AI_TIMEOUT" as const;
  constructor(timeoutMs: number) {
    super(`AI provider call timed out after ${timeoutMs}ms`);
    this.name = "AiTimeoutError";
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

/** Bounded retry with linear backoff. Re-throws the last error once attempts are exhausted. */
export async function withBoundedRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, opts.baseDelayMs * attempt));
    }
  }
  throw lastError;
}
