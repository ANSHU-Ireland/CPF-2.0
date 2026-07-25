import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque bearer tokens: 256 bits of entropy, base64url encoded.
 * Only the SHA-256 digest is ever stored; the token itself is shown once.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
