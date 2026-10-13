import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const CHUNK_WARNING_KB = 500;
/** Lazy-loaded only when someone picks a HEIC photo; a prebuilt library that can't be split. */
const LARGE_ON_PURPOSE = /^heic-to/;

/** Vite's size warning, minus the chunks that are large on purpose. */
function chunkSizeWarning(): Plugin {
  return {
    name: "chunk-size-warning",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || LARGE_ON_PURPOSE.test(chunk.name)) continue;
        const kb = Buffer.byteLength(chunk.code) / 1000;
        if (kb > CHUNK_WARNING_KB)
          this.warn(`${chunk.fileName} is ${Math.round(kb)} kB (limit ${CHUNK_WARNING_KB} kB)`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), chunkSizeWarning()],
  clearScreen: false, // keeps `pnpm dev` output from the other services visible
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
  // Checked by chunkSizeWarning above instead.
  build: { chunkSizeWarningLimit: Number.POSITIVE_INFINITY },
});
