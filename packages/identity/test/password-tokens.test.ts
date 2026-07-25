import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  PasswordPolicyError,
  hashPassword,
  verifyPassword,
} from "../src/password.js";
import { generateToken, hashToken, tokenMatchesHash } from "../src/tokens.js";

describe("password hashing (scrypt)", () => {
  it("hashes and verifies a valid password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$131072$8$1$")).toBe(true);
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("incorrect horse battery staple", stored)).resolves.toBe(false);
  });

  it("produces unique salts per hash", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
  });

  it("enforces minimum and maximum password length", async () => {
    await expect(hashPassword("short")).rejects.toThrow(PasswordPolicyError);
    await expect(hashPassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(
      PasswordPolicyError,
    );
  });

  it("returns false for malformed stored values instead of throwing", async () => {
    await expect(verifyPassword("whatever password", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("whatever password", "bcrypt$x$y")).resolves.toBe(false);
    await expect(verifyPassword("whatever password", "")).resolves.toBe(false);
  });
});

describe("opaque tokens", () => {
  it("generates 256-bit base64url tokens and verifies via stored hash only", () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(42);
    const stored = hashToken(token);
    expect(stored).toHaveLength(64); // sha256 hex
    expect(tokenMatchesHash(token, stored)).toBe(true);
    expect(tokenMatchesHash(generateToken(), stored)).toBe(false);
  });
});
