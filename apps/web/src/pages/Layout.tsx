import { Link, Outlet } from "react-router";

export function Layout() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          Hämtning av möbler
        </Link>
      </header>
      <main className="container">
        <Outlet />
      </main>
      <footer className="site-footer">
        <Link to="/integritet">Integritetspolicy</Link>
      </footer>
    </>
  );
}
