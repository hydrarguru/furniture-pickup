import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../env.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Checks the connection at startup, so a bad configuration shows up in the logs right away. */
  verify?(): Promise<void>;
}

/** Logs mail instead of sending it. Used until a domain and email provider exist. */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail) {
    console.log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  /** TLS from the first byte (port 465). Otherwise STARTTLS. */
  secure: boolean;
  /** Refuse to send over a connection that couldn't be upgraded to TLS. Off only in tests. */
  requireTLS: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Sends through any provider's SMTP server (Resend, Postmark, Amazon SES, Brevo, ...). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: !options.secure && options.requireTLS,
      auth: options.user ? { user: options.user, pass: options.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(mail: Mail) {
    await this.transport.sendMail({
      from: this.options.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }

  async verify() {
    await this.transport.verify();
  }
}

export function createMailer(env: Env): Mailer {
  switch (env.MAILER) {
    case "console":
      return new ConsoleMailer();
    case "smtp":
      return new SmtpMailer({
        host: env.SMTP_HOST as string, // checked by loadEnv
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        requireTLS: true,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.MAIL_FROM as string,
      });
  }
}
