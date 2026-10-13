import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from "node:crypto";

// scrypt is built into Node (no native dependency). N=2^17, r=8, p=1 follows the OWASP
// recommendation; tests use a tiny N so the suite stays fast. Parameters are stored with
// each hash, so they can be raised later without breaking existing passwords.
const N = process.env.NODE_ENV === "test" ? 2 ** 10 : 2 ** 17;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Returns `scrypt$N$r$p$salt$hash` (base64url parts). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Verified against when the email is unknown, so response time doesn't reveal which emails exist. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

/** 16 characters from a 96-bit random value. */
export const generatePassword = () => randomBytes(12).toString("base64url");
