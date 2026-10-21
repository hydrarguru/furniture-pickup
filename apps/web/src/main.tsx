// Lato, self-hosted: the CSP only allows our own fonts, and Google's CDN would see every visitor.
// Latin covers Swedish. Only regular and bold are loaded, so 500/600 weights render as those.
import "@fontsource/lato/latin-400.css";
import "@fontsource/lato/latin-400-italic.css";
import "@fontsource/lato/latin-700.css";
import "./lib/zod-locale.js";
import "./styles.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { initTheme } from "./lib/theme.js";
import { HomePage } from "./pages/HomePage.js";
import { Layout } from "./pages/Layout.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { PrivacyPage } from "./pages/PrivacyPage.js";
import { RequestPage } from "./pages/RequestPage.js";
import { StatusPage } from "./pages/StatusPage.js";
import { ThanksPage } from "./pages/ThanksPage.js";
import { VerifyPage } from "./pages/VerifyPage.js";

initTheme();

// The admin UI is its own chunk: people filling in the form never download it.
const admin = () => import("./admin/routes.js");
const AdminRoot = lazy(admin);
const AdminLayout = lazy(() => admin().then((m) => ({ default: m.AdminLayout })));
const LoginPage = lazy(() => admin().then((m) => ({ default: m.LoginPage })));
const RequestListPage = lazy(() => admin().then((m) => ({ default: m.RequestListPage })));
const RequestDetailPage = lazy(() => admin().then((m) => ({ default: m.RequestDetailPage })));
const CategoriesPage = lazy(() => admin().then((m) => ({ default: m.CategoriesPage })));
const CustomerViewPage = lazy(() => admin().then((m) => ({ default: m.CustomerViewPage })));

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="admin" element={<AdminRoot />}>
            <Route path="logga-in" element={<LoginPage />} />
            <Route element={<AdminLayout />}>
              <Route index element={<RequestListPage />} />
              <Route path="arenden/:id" element={<RequestDetailPage />} />
              <Route path="arenden/:id/kundvy" element={<CustomerViewPage />} />
              <Route path="kategorier" element={<CategoriesPage />} />
            </Route>
          </Route>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="boka" element={<RequestPage />} />
            <Route path="tack" element={<ThanksPage />} />
            <Route path="bekrafta/:token" element={<VerifyPage />} />
            <Route path="arende/:token" element={<StatusPage />} />
            <Route path="integritet" element={<PrivacyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
