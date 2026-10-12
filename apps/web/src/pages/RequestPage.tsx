import { RequestForm } from "../form/RequestForm.js";

export function RequestPage() {
  return (
    <>
      <h1>Boka hämtning</h1>
      <p className="intro">
        Har du möbler eller andra saker som kan få ett nytt hem? Fyll i formuläret så hör vi av oss.
        Det tar ungefär fem minuter.
      </p>
      <RequestForm />
    </>
  );
}
