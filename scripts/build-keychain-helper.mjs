import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, process.argv[2] ?? "desktop/.signalflow-keychain");

if (process.platform === "darwin") {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync("cc", ["-fobjc-arc", "-framework", "Foundation", "-framework", "Security", path.join(root, "desktop", "keychain-helper.m"), "-o", output], { stdio: "inherit" });
  fs.chmodSync(output, 0o700);
}
