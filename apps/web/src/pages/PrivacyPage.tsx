import {
  RETENTION_DAYS_CLOSED,
  RETENTION_DAYS_INACTIVE,
  RETENTION_DAYS_UNVERIFIED,
  STORE_EMAIL,
  STORE_PHONE,
} from "@hamtning/shared";

// DRAFT: the store must review and approve this text (and add its name and contact details).
export function PrivacyPage() {
  return (
    <>
      <h1>Integritetspolicy</h1>
      <p className="banner">Utkast: texten ska granskas och godkännas av butiken.</p>
      <h2>Vilka uppgifter vi samlar in</h2>
      <p>
        Namn, e-post, telefonnummer, adress, uppgifter om föremålen, foton och de tider du föreslår.
        Platsinformation tas bort från fotona innan de skickas.
      </p>
      <h2>Varför</h2>
      <p>För att bedöma om vi kan ta emot sakerna och för att planera och genomföra hämtningen.</p>
      <h2>Hur länge</h2>
      <p>
        Förfrågningar som inte bekräftas via e-post raderas efter {RETENTION_DAYS_UNVERIFIED} dagar.
        Förfrågningar som vi inte har hanterat inom {RETENTION_DAYS_INACTIVE} dagar raderas.
        Avslutade ärenden raderas, tillsammans med foton, {RETENTION_DAYS_CLOSED} dagar efter att de
        avslutats (för godkända hämtningar räknas det från hämtningstillfället). Avbokar du själv
        raderas förfrågan och fotona direkt; anledningen du anger sparas i {RETENTION_DAYS_CLOSED}{" "}
        dagar, utan namn eller kontaktuppgifter.
      </p>
      <h2>Dina rättigheter</h2>
      <p>
        Du kan när som helst be oss radera dina uppgifter tidigare eller få veta vilka uppgifter vi
        har om dig. Kontakta oss på <a href={`mailto:${STORE_EMAIL}`}>{STORE_EMAIL}</a> eller{" "}
        {STORE_PHONE.display}.
      </p>
    </>
  );
}
