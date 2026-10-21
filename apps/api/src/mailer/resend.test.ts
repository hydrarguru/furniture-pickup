import { describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { createMailer, ResendMailer } from "./index.js";
import { verificationMail } from "./templates.js";

/** A stand-in for Resend's API that records each call. */
function fakeApi(response: () => Response = () => Response.json({ id: "email-1" })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const options = { apiKey: "re_test_123", from: "Butiken <noreply@butiken.test>" };

describe("ResendMailer", () => {
  it("posts the mail to Resend's API with the key", async () => {
    const api = fakeApi();
    const mailer = new ResendMailer({ ...options, fetch: api.fetch });
    await mailer.send(
      verificationMail({
        to: "anna@example.se",
        name: "Åsa Öberg",
        appOrigin: "https://hamta.test",
        token: "abc",
      }),
    );

    expect(api.calls).toHaveLength(1);
    const [call] = api.calls;
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toMatchObject({ authorization: "Bearer re_test_123" });
    const body = JSON.parse(call?.init.body as string);
    expect(body).toMatchObject({
      from: "Butiken <noreply@butiken.test>",
      to: ["anna@example.se"],
      subject: "Bekräfta din förfrågan om hämtning",
    });
    expect(body.text).toContain("Hej Åsa Öberg!");
    expect(body.text).toContain("https://hamta.test/bekrafta/abc");
  });

  it("fails loudly with Resend's reason, so the caller can record that no mail went out", async () => {
    const api = fakeApi(() =>
      Response.json(
        { name: "validation_error", message: "The butiken.test domain is not verified." },
        { status: 403 },
      ),
    );
    const mailer = new ResendMailer({ ...options, fetch: api.fetch });
    await expect(mailer.send({ to: "a@example.se", subject: "x", text: "y" })).rejects.toThrow(
      /Resend 403: .*domain is not verified/,
    );
  });
});

describe("Resend settings", () => {
  it("needs an API key and sender", () => {
    expect(() => loadEnv({ MAILER: "resend" })).toThrow(/RESEND_API_KEY and MAIL_FROM/);
    expect(() => loadEnv({ MAILER: "resend", RESEND_API_KEY: "re_x" })).toThrow(/MAIL_FROM/);
    const env = loadEnv({
      MAILER: "resend",
      RESEND_API_KEY: "re_x",
      MAIL_FROM: "Butiken <noreply@example.se>",
    });
    expect(createMailer(env)).toBeInstanceOf(ResendMailer);
  });
});
