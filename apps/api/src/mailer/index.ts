import type { Env } from "../env.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Logs mail instead of sending it. Used until a domain and email provider exist. */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail) {
    console.log(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
  }
}

export function createMailer(env: Pick<Env, "MAILER">): Mailer {
  switch (env.MAILER) {
    case "console":
      return new ConsoleMailer();
  }
}
