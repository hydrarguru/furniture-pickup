import { Link, Outlet } from "react-router";
import { ThemeToggle } from "../ThemeToggle.js";

export function Layout() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          Glädjens Secondhand - Formulär
        </Link>
        <ThemeToggle />
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
