import { Link, Outlet } from "react-router";
import storeIcon from "../../assets/favicon.ico";
import { ThemeToggle } from "../ThemeToggle.js";

export function Layout() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          {/* Decorative: the store name right next to it says the same. */}
          <img src={storeIcon} alt="" width={32} height={32} />
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
