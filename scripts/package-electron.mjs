import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packager = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-packager.cmd" : "electron-packager");
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
const electronZipDir = process.env.SIGNALFLOW_ELECTRON_ZIP_DIR;
if (typeof electronVersion !== "string" || !/^\d+\.\d+\.\d+/.test(electronVersion)) throw new Error("ELECTRON_VERSION_UNAVAILABLE");
const iconCandidates = [
  path.join(root, "src-tauri", "icons", "icon.icns"),
  path.join(root, "assets", "icon.icns"),
  path.join(root, "public", "icon.icns"),
];
const iconPath = iconCandidates.find((candidate) => fs.existsSync(candidate));
if (!iconPath || fs.statSync(iconPath).size < 4096) throw new Error("ELECTRON_ICON_ICNS_MISSING_OR_INVALID");

execFileSync(packager, [
  path.join(root, "dist-electron-staging"),
  "SignalFlow",
  "--platform", "darwin",
  "--arch", "arm64",
  "--electron-version", electronVersion,
  ...(electronZipDir ? ["--electron-zip-dir", electronZipDir] : []),
  "--icon", iconPath,
  "--extend-info", path.join(root, "desktop", "electron-info.plist"),
  "--asar.unpackDir=worker-runtime",
  "--out", path.join(root, "dist-electron"),
  "--overwrite",
  "--prune=true",
  // Packager v20 probes optional macOS 26 Icon Composer `.icon`; required legacy `.icns` is preflighted above.
  "--quiet",
], { cwd: root, stdio: "inherit" });
