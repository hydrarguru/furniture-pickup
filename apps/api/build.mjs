// Bundles the API into dist/index.js. Only our own code is bundled (including the workspace
// package @hamtning/shared, which is TypeScript source); npm dependencies stay in node_modules,
// which the server installs anyway. That keeps the output small and stack traces readable.
import { readFileSync, rmSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies)
  .filter((name) => !name.startsWith("@hamtning/"))
  .flatMap((name) => [name, `${name}/*`]);

rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  external,
  sourcemap: true,
  logLevel: "info",
});
