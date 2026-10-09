import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accountEnvKey, resolveEnvPath, setEnvSecret } from "../desktop/portable-env.cjs";

if (process.platform !== "darwin") {
  console.log("SignalFlow .env migration skipped: macOS Keychain is not available on this platform.");
  process.exit(0);
}

const dump = spawnSync("security", ["dump-keychain"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
if (dump.error || dump.status !== 0) throw new Error("SIGNALFLOW_KEYCHAIN_DUMP_FAILED");

const accounts = new Set();
for (const block of String(dump.stdout).split(/\n(?=keychain:)/)) {
  if (!/"svce"<blob>="SignalFlow"/.test(block)) continue;
  const match = block.match(/"acct"<blob>="([^"]+)"/);
  if (match) accounts.add(match[1]);
}

const envPath = resolveEnvPath(process.env.SIGNALFLOW_ENV_FILE || path.join(os.homedir(), ".signalflow", ".env"));
fs.mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
let migrated = 0;
for (const account of accounts) {
  const result = spawnSync("security", ["find-generic-password", "-a", account, "-s", "SignalFlow", "-w"], { encoding: "utf8", maxBuffer: 256 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  if (result.error || result.status !== 0) continue;
  const value = String(result.stdout).replace(/\r?\n$/, "");
  if (!value) continue;
  setEnvSecret(account, value, envPath);
  migrated += 1;
}

console.log(`Migrated ${migrated} SignalFlow credential entries to ${envPath}. Values were not printed.`);
console.log(`Encoded key prefix: ${accountEnvKey("workspace:example:meta:app-secret").replace(/[0-9A-F]+$/, "<account-hex>")}`);
