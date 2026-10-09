// Regression gate for packaged Electron builds.
// Fails if any desktop/*.cjs module required by desktop/main.cjs is missing
// from dist-electron-staging/desktop (the exact tree electron-packager seals
// into Resources/app.asar). Dependency-free: node builtins only.
// Usage: node scripts/check-electron-staging.mjs [--asar <path-to-app.asar>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asarArg = process.argv.indexOf("--asar");
const asarPath = asarArg === -1 ? null : process.argv[asarArg + 1];

function requiredDesktopModules() {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  const modules = new Set();
  for (const match of main.matchAll(/require\("\.\/([^"]+\.cjs)"\)/g)) modules.add(match[1]);
  // main.cjs itself plus the preload entry must also ship.
  modules.add("main.cjs");
  modules.add("preload.cjs");
  return [...modules].sort();
}

let failed = false;
const required = requiredDesktopModules();

if (asarPath) {
  // app.asar stores its file table as plain-text paths in the header, so a
  // byte scan is a reliable dependency-free presence check.
  if (!fs.existsSync(asarPath)) {
    console.error(`ELECTRON_STAGING_CHECK_FAILED: asar not found: ${asarPath}`);
    process.exit(1);
  }
  const haystack = fs.readFileSync(asarPath);
  const missing = required.filter((m) => !haystack.includes(Buffer.from(`desktop/${m}`)) && !haystack.includes(Buffer.from(m)));
  if (missing.length > 0) {
    console.error(`ELECTRON_STAGING_CHECK_FAILED: missing from asar ${asarPath}: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`electron staging check OK (asar): ${required.length} desktop modules present (${required.join(", ")})`);
} else {
  const stagedDir = path.join(root, "dist-electron-staging", "desktop");
  const missing = required.filter((m) => !fs.existsSync(path.join(stagedDir, m)));
  if (missing.length > 0) {
    console.error(`ELECTRON_STAGING_CHECK_FAILED: missing from dist-electron-staging/desktop: ${missing.join(", ")}`);
    failed = true;
  }
  // The credential service must stay in main-process modules only: fail if the
  // renderer preload ever pulls a secret-holding module directly.
  const preload = fs.readFileSync(path.join(root, "desktop", "preload.cjs"), "utf8");
  const leaked = ["secure-store.cjs", "secret-chunks.cjs", "portable-env.cjs", "provider-models.cjs"].filter((m) => preload.includes(m));
  if (leaked.length > 0) {
    console.error(`ELECTRON_STAGING_CHECK_FAILED: credential modules reachable from renderer preload: ${leaked.join(", ")}`);
    failed = true;
  }
  if (failed) process.exit(1);
  console.log(`electron staging check OK (staging): ${required.length} desktop modules present (${required.join(", ")})`);
}
