import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<string>("…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<{ status: string }>)
      .then((d) => setHealth(d.status))
      .catch(() => setHealth("nere"));
  }, []);

  return (
    <main>
      <h1>Hämtning av second hand</h1>
      <p>Formuläret kommer snart. API-status: {health}</p>
    </main>
  );
}
