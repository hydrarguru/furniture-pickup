import { STORE_EMAIL, STORE_PHONE } from "@hamtning/shared";
import { Link, Outlet } from "react-router";
import storeIcon from "../../assets/favicon.ico";
import { ThemeToggle } from "../ThemeToggle.js";

export function Layout() {
  return (
    <div className="site">
      <header className="site-header">
        <Link to="/" className="brand">
          {/* Decorative: the store name right next to it says the same. */}
          <img src={storeIcon} alt="" width={32} height={32} />
          Glädjens Secondhand
        </Link>
        <ThemeToggle />
      </header>
      <main className="container">
        <Outlet />
      </main>
      <footer className="site-footer">
        <p className="site-footer-name">Glädjens Secondhand</p>
        <p>
          <a href={`tel:${STORE_PHONE.e164}`}>{STORE_PHONE.display}</a>
          {" · "}
          <a href={`mailto:${STORE_EMAIL}`}>{STORE_EMAIL}</a>
        </p>
        <p>
          <Link to="/integritet">Integritetspolicy</Link>
        </p>
      </footer>
    </div>
  );
}
