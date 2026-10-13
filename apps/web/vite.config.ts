import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false, // keeps `pnpm dev` output from the other services visible
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
