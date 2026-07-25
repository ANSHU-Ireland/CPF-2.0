import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 4226 HOTP / RFC 6238 TOTP (SHA-1 as specified by the RFCs and required
 * for authenticator-app compatibility). Verified against the RFC 6238
 * Appendix B test vectors in totp.test.ts.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/u, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new 160-bit TOTP secret, base32-encoded for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const code =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(
  secretBase32: string,
  unixTimeSeconds: number,
  stepSeconds = 30,
  digits = 6,
): string {
  return hotp(secretBase32, Math.floor(unixTimeSeconds / stepSeconds), digits);
}

/**
 * Verify a submitted TOTP code with a ±1 step window (constant-time digit
 * comparison per candidate).
 */
export function verifyTotp(
  secretBase32: string,
  submitted: string,
  unixTimeSeconds = Math.floor(Date.now() / 1000),
  stepSeconds = 30,
  digits = 6,
): boolean {
  if (!/^\d+$/u.test(submitted) || submitted.length !== digits) return false;
  const submittedBuffer = Buffer.from(submitted, "utf8");
  let valid = false;
  for (const drift of [-1, 0, 1]) {
    const candidate = totp(
      secretBase32,
      unixTimeSeconds + drift * stepSeconds,
      stepSeconds,
      digits,
    );
    const candidateBuffer = Buffer.from(candidate, "utf8");
    if (
      candidateBuffer.length === submittedBuffer.length &&
      timingSafeEqual(candidateBuffer, submittedBuffer)
    ) {
      valid = true;
    }
  }
  return valid;
}

/** otpauth:// provisioning URI for authenticator apps. */
export function totpProvisioningUri(
  secretBase32: string,
  accountName: string,
  issuer = "CPF",
): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
