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
