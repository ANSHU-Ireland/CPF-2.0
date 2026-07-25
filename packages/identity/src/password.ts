import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey),
    );
  });
}

/**
 * Password hashing with scrypt (OWASP-recommended KDF, built into Node —
 * no native module supply-chain risk). Parameters follow current OWASP
 * guidance for scrypt; they are stored with every hash so they can be
 * raised later without invalidating existing credentials.
 *
 * Stored format: scrypt$N$r$p$<salt b64url>$<key b64url>
 */
const N = 131072; // 2^17
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;
const MAX_MEMORY = 192 * 1024 * 1024; // must exceed 128 * N * r bytes

export const MAX_PASSWORD_LENGTH = 256;
export const MIN_PASSWORD_LENGTH = 12;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

function assertPasswordShape(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordShape(password);
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEMORY,
  });
  return [
    "scrypt",
    String(N),
    String(R),
    String(P),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time password verification. Returns false (never throws) for
 * malformed stored values so account-state problems cannot become oracles.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4] as string, "base64url");
    const expected = Buffer.from(parts[5] as string, "base64url");
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }
    const actual = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
