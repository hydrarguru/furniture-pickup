import type { Mail } from "./index.js";

export function verificationMail(opts: {
  to: string;
  name: string;
  appOrigin: string;
  token: string;
}): Mail {
  const link = `${opts.appOrigin}/bekrafta/${opts.token}`;
  return {
    to: opts.to,
    subject: "Bekräfta din förfrågan om hämtning",
    text: `Hej ${opts.name}!

Tack för din förfrågan om hämtning. Klicka på länken för att bekräfta den:

${link}

Länken måste användas inom 24 timmar. Efter bekräftelsen kan du följa och avboka ärendet via samma länk, så spara gärna mejlet.

Har du inte skickat någon förfrågan? Då kan du bortse från mejlet. Förfrågan raderas automatiskt.
`,
  };
}

const pickupFormat = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});
const timeOnly = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

/** Emailed when staff accept or decline. We only store the token's hash, so no link is included. */
export function statusMail(opts: {
  to: string;
  name: string;
  status: "accepted" | "on_the_way" | "declined";
  confirmedStart?: string | null;
  confirmedEnd?: string | null;
  message?: string | null;
}): Mail {
  const message = opts.message ? `\nMeddelande från oss:\n${opts.message}\n` : "";
  const footer = "\nDu kan följa ärendet via länken i mejlet du fick när du skickade förfrågan.\n";
  const when = opts.confirmedStart
    ? `${pickupFormat.format(new Date(opts.confirmedStart))}${
        opts.confirmedEnd ? `–${timeOnly.format(new Date(opts.confirmedEnd))}` : ""
      }`
    : null;
  if (opts.status === "on_the_way") {
    return {
      to: opts.to,
      subject: "Vi är på väg till dig",
      text: `Hej ${opts.name}!\n\nVi är nu på väg för att hämta dina saker.${
        when ? ` Planerad hämtning: ${when}.` : ""
      }\n${message}${footer}`,
    };
  }
  if (opts.status === "accepted") {
    const when = opts.confirmedStart
      ? `${pickupFormat.format(new Date(opts.confirmedStart))}${
          opts.confirmedEnd ? `–${timeOnly.format(new Date(opts.confirmedEnd))}` : ""
        }`
      : "en tid vi meddelar senare";
    return {
      to: opts.to,
      subject: "Vi hämtar dina saker",
      text: `Hej ${opts.name}!\n\nVi hämtar gärna dina saker. Hämtning sker ${when}.\n${message}${footer}`,
    };
  }
  return {
    to: opts.to,
    subject: "Angående din förfrågan om hämtning",
    text: `Hej ${opts.name}!\n\nTack för att du ville lämna saker till oss. Tyvärr kan vi inte ta emot dem den här gången.\n${message}${footer}`,
  };
}
