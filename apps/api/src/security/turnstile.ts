export interface TurnstileVerifier {
  verify(token: string, remoteIp?: string): Promise<boolean>;
}

/** Cloudflare's documented test secret that always passes. Used in development only. */
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Accepts every token. Load tests only, so they don't send thousands of checks to Cloudflare. */
export class AlwaysPassTurnstile implements TurnstileVerifier {
  async verify() {
    return true;
  }
}

export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string) {}

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      // Fail closed: if Cloudflare is unreachable, submissions are refused rather than unchecked.
      return false;
    }
  }
}
