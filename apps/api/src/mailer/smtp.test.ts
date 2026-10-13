import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { SmtpMailer } from "./index.js";
import { statusMail } from "./templates.js";

let server: SMTPServer | undefined;
afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

/** A local SMTP server that records what it receives. */
async function startServer() {
  const received: { from: string; to: string[]; data: string; user?: string }[] = [];
  server = new SMTPServer({
    secure: false,
    authOptional: false,
    allowInsecureAuth: true, // plain-text auth is fine against localhost in a test
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      if (auth.username === "mailer" && auth.password === "hemligt")
        callback(null, { user: "mailer" });
      else callback(new Error("bad credentials"));
    },
    onData(stream, session, callback) {
      let data = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        data += chunk;
      });
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          data,
          user: session.user as string | undefined,
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.server.address() as AddressInfo).port;
  return { port, received };
}

const options = (port: number, password = "hemligt") => ({
  host: "127.0.0.1",
  port,
  secure: false,
  requireTLS: false,
  user: "mailer",
  password,
  from: "Butiken <noreply@butiken.test>",
});

describe("SmtpMailer", () => {
  it("delivers Swedish status mail with the status link", async () => {
    const { port, received } = await startServer();
    const mailer = new SmtpMailer(options(port));
    await mailer.verify();
    await mailer.send(
      statusMail({
        to: "anna@example.se",
        name: "Åsa Öberg",
        status: "declined",
        statusUrl: "https://hamta.test/arende/abc",
        message: "Tyvärr tar vi inte emot madrasser.",
      }),
    );

    expect(received).toHaveLength(1);
    const [mail] = received;
    expect(mail).toMatchObject({
      from: "noreply@butiken.test",
      to: ["anna@example.se"],
      user: "mailer",
    });
    expect(mail?.data).toContain("From: Butiken <noreply@butiken.test>");
    expect(mail?.data).toMatch(/charset=utf-8/i);
    // Quoted-printable or not, the decoded body must keep å, ä and ö.
    const body = decodeQuotedPrintable(
      mail?.data
        .split(/\r?\n\r?\n/)
        .slice(1)
        .join("\n\n") ?? "",
    );
    expect(body).toContain("Hej Åsa Öberg!");
    expect(body).toContain("Tyvärr tar vi inte emot madrasser.");
    expect(body).toContain("https://hamta.test/arende/abc");
  });

  it("fails loudly on bad credentials, so the caller can record that no mail went out", async () => {
    const { port, received } = await startServer();
    const mailer = new SmtpMailer(options(port, "fel"));
    await expect(mailer.send({ to: "a@example.se", subject: "x", text: "y" })).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it("refuses to send without TLS unless told otherwise", async () => {
    const { port, received } = await startServer();
    const mailer = new SmtpMailer({ ...options(port), requireTLS: true });
    await expect(mailer.send({ to: "a@example.se", subject: "x", text: "y" })).rejects.toThrow();
    expect(received).toHaveLength(0);
  });
});

describe("mail settings", () => {
  it("needs a host and sender for SMTP", () => {
    expect(() => loadEnv({ MAILER: "smtp" })).toThrow(/SMTP_HOST and MAIL_FROM/);
    const env = loadEnv({
      MAILER: "smtp",
      SMTP_HOST: "smtp.example.se",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      MAIL_FROM: "Butiken <noreply@example.se>",
    });
    expect(env).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
    expect(loadEnv({}).SMTP_SECURE).toBe(false);
  });
});

function decodeQuotedPrintable(s: string) {
  if (!/=[0-9A-F]{2}/.test(s)) return s;
  const bytes = s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
  return Buffer.from(bytes, "latin1").toString("utf8");
}
