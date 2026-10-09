import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mainRequiredModules() {
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  const modules = new Set();
  for (const match of main.matchAll(/require\("\.\/([^"]+\.cjs)"\)/g)) modules.add(match[1]);
  return [...modules].sort();
}

function stagingAllowlist() {
  const staging = fs.readFileSync(path.join(root, "scripts", "build-electron-staging.mjs"), "utf8");
  const match = staging.match(/for \(const filename of \[([^\]]+)\]\)/);
  if (!match) throw new Error("STAGING_ALLOWLIST_NOT_FOUND");
  return match[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

describe("electron packaging regression", () => {
  it("stages every desktop module required by main.cjs (e.g. provider-models.cjs)", () => {
    const required = mainRequiredModules();
    expect(required).toContain("provider-models.cjs");
    const allowlist = stagingAllowlist();
    const missing = required.filter((m) => !allowlist.includes(m));
    expect(missing).toEqual([]);
  });

  it("keeps credential modules out of the renderer preload", () => {
    const preload = fs.readFileSync(path.join(root, "desktop", "preload.cjs"), "utf8");
    for (const m of ["secure-store.cjs", "secret-chunks.cjs", "portable-env.cjs", "provider-models.cjs"]) {
      expect(preload.includes(m)).toBe(false);
    }
  });

  it("stages the stdlib profile migration helper outside the app archive", () => {
    const staging = fs.readFileSync(path.join(root, "scripts", "build-electron-staging.mjs"), "utf8");
    expect(staging).toContain('"profile_database_migration.py"');
    expect(staging).toMatch(/fs\.copyFileSync\(path\.join\(root, "backend", filename\), path\.join\(workerRuntime, "backend", filename\)\)/);
    expect(fs.existsSync(path.join(root, "backend", "profile_database_migration.py"))).toBe(true);
  });
});
