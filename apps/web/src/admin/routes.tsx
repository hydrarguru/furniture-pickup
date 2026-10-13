import { AdminLayout } from "./AdminLayout.js";
import { CategoriesPage } from "./pages/CategoriesPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RequestDetailPage } from "./pages/RequestDetailPage.js";
import { RequestListPage } from "./pages/RequestListPage.js";

export { default } from "./AdminRoot.js";
// Re-exported so main.tsx can lazy-load the whole admin bundle in one chunk.
export { AdminLayout, CategoriesPage, LoginPage, RequestDetailPage, RequestListPage };
