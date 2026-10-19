import { Link } from "react-router";

export function HomePage() {
  return (
    <>
      <h1>Hämtning av möbler</h1>
      <p className="intro">
        Har du möbler eller andra saker som kan få ett nytt hem? Boka en hämtning, så hör vi av oss.
      </p>
      <div className="home-choices">
        <section className="card">
          <h2>Jag vill få något hämtat</h2>
          <p className="muted">
            Fyll i ett formulär med vad du vill skänka. Det tar ungefär fem minuter.
          </p>
          <Link to="/boka" className="button">
            Boka hämtning
          </Link>
        </section>
        <section className="card">
          <h2>Jag arbetar i butiken</h2>
          <p className="muted">Logga in för att hantera inkomna förfrågningar.</p>
          <Link to="/admin/logga-in" className="button secondary">
            Logga in
          </Link>
        </section>
      </div>
    </>
  );
}
