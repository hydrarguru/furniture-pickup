import { createChallenge, randomInt, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { deriveHmacKeySecret } from "altcha-lib/frameworks/hono";
import type { Challenge, Payload } from "altcha-lib/types";

export interface BotCheck {
  /** A fresh proof-of-work challenge for the browser widget. */
  challenge(): Promise<Challenge>;
  /** True for a payload the widget produced by solving one of our challenges, once. */
  verify(payload: string): Promise<boolean>;
}

/** Accepts every payload. Load tests only, so they don't have to solve thousands of challenges. */
export class AlwaysPassBotCheck implements BotCheck {
  async challenge(): Promise<Challenge> {
    throw new Error("not available in LOAD_TEST mode");
  }
  async verify() {
    return true;
  }
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
/**
 * PBKDF2 iterations per attempt. The browser tries counters up to a hidden, random target between
 * `cost` and `2 * cost`, so this sets the work (a few seconds on a phone, split over workers).
 */
const DEFAULT_COST = 5_000;

export class AltchaBotCheck implements BotCheck {
  private readonly signatureSecret: string;
  private readonly keySignatureSecret: Promise<string>;
  /** Challenge id -> expiry. A solved challenge works once; entries go when the challenge would expire anyway. */
  private readonly used = new Map<string, number>();

  constructor(
    secret: string,
    private readonly cost = DEFAULT_COST,
  ) {
    this.signatureSecret = secret;
    this.keySignatureSecret = deriveHmacKeySecret(secret);
  }

  async challenge() {
    return createChallenge({
      algorithm: "PBKDF2/SHA-256",
      cost: this.cost,
      // A known counter makes the challenge self-verifying: checking a solution is a single hash.
      counter: randomInt(this.cost, this.cost * 2),
      deriveKey,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      hmacSignatureSecret: this.signatureSecret,
      hmacKeySignatureSecret: await this.keySignatureSecret,
    });
  }

  async verify(encoded: string): Promise<boolean> {
    let payload: Payload;
    try {
      payload = JSON.parse(atob(encoded));
      if (!payload?.challenge?.parameters?.nonce || !payload.solution) return false;
    } catch {
      return false;
    }
    try {
      const result = await verifySolution({
        challenge: payload.challenge,
        solution: payload.solution,
        deriveKey,
        hmacSignatureSecret: this.signatureSecret,
        hmacKeySignatureSecret: await this.keySignatureSecret,
      });
      if (!result.verified) return false;
    } catch {
      return false;
    }
    return this.claim(payload.challenge.parameters.nonce);
  }

  private claim(id: string): boolean {
    const now = Date.now();
    for (const [key, expires] of this.used) if (expires < now) this.used.delete(key);
    if (this.used.has(id)) return false;
    this.used.set(id, now + CHALLENGE_TTL_MS);
    return true;
  }
}
