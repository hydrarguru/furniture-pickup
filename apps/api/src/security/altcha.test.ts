import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { describe, expect, it } from "vitest";
import { AltchaBotCheck } from "./altcha.js";

const SECRET = "test-secret-test-secret-test-secret!";
/** Low, so solving takes milliseconds. */
const COST = 10;

async function solved(check: AltchaBotCheck) {
  const challenge = await check.challenge();
  const solution = await solveChallenge({ challenge, deriveKey });
  return btoa(JSON.stringify({ challenge, solution }));
}

describe("AltchaBotCheck", () => {
  it("accepts a solved challenge once", async () => {
    const check = new AltchaBotCheck(SECRET, COST);
    const payload = await solved(check);
    expect(await check.verify(payload)).toBe(true);
    expect(await check.verify(payload)).toBe(false);
  });

  it("rejects a challenge signed with another secret", async () => {
    const payload = await solved(new AltchaBotCheck("another-secret-another-secret-12345", COST));
    expect(await new AltchaBotCheck(SECRET, COST).verify(payload)).toBe(false);
  });

  it("rejects a wrong solution", async () => {
    const check = new AltchaBotCheck(SECRET, COST);
    const payload = JSON.parse(atob(await solved(check)));
    payload.solution.derivedKey = "00".repeat(32);
    expect(await check.verify(btoa(JSON.stringify(payload)))).toBe(false);
  });

  it.each(["", "not base64!", btoa("not json"), btoa("{}")])("rejects garbage %j", async (p) => {
    expect(await new AltchaBotCheck(SECRET, COST).verify(p)).toBe(false);
  });
});
