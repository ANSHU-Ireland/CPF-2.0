import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totp,
  totpProvisioningUri,
  verifyTotp,
} from "../src/totp.js";

// RFC 6238 Appendix B test vectors (SHA-1, 8 digits).
// Secret: ASCII "12345678901234567890"
const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP — RFC 6238 test vectors", () => {
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(vectors)("time %d → code %s", (time, expected) => {
    expect(totp(RFC_SECRET_B32, time, 30, 8)).toBe(expected);
  });
});

describe("TOTP verification", () => {
  it("accepts the current code and codes within ±1 step", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000;
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 30), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now + 30), now)).toBe(true);
  });

  it("rejects codes outside the window and malformed input", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000;
    expect(verifyTotp(secret, totp(secret, now - 120), now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, "", now)).toBe(false);
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const data = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
    expect(base32Decode(base32Encode(data)).equals(data)).toBe(true);
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("abc!def")).toThrow();
  });
});

describe("provisioning URI", () => {
  it("emits a standards-shaped otpauth URI", () => {
    const uri = totpProvisioningUri("GEZDGNBVGY3TQOJQ", "reviewer@example.eu");
    expect(uri.startsWith("otpauth://totp/CPF%3Areviewer%40example.eu?")).toBe(true);
    expect(uri).toContain("secret=GEZDGNBVGY3TQOJQ");
    expect(uri).toContain("digits=6");
  });
});
