import "./admin.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Outlet } from "react-router";
import { createQueryClient } from "./queries.js";

/** Entry for everything under /admin. Lazy-loaded, so the public form never downloads it. */
export default function AdminRoot() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  );
}
