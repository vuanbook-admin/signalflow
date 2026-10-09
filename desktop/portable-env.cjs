const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveEnvPath(customPath) {
  const configured = customPath || process.env.SIGNALFLOW_ENV_FILE;
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".signalflow", ".env");
}

function accountEnvKey(account) {
  if (typeof account !== "string" || !account.trim() || account.length > 512 || /[\u0000-\u001f\u007f]/.test(account)) throw new Error("SECURE_STORE_ACCOUNT_INVALID");
  return `SIGNALFLOW_SECRET_${Buffer.from(account.trim(), "utf8").toString("hex").toUpperCase()}`;
}

function parseEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/\\'/g, "'");
  return value;
}

function readEnvEntries(envPath) {
  if (!fs.existsSync(envPath)) return new Map();
  const entries = new Map();
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) entries.set(match[1], parseEnvValue(match[2]));
  }
  return entries;
}

function encodeEnvValue(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@+,=-]+$/.test(text) ? text : JSON.stringify(text);
}

function writeEnvEntry(envPath, key, value) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\s*=`);
  const next = [];
  let replaced = false;
  for (const line of lines) {
    if (keyPattern.test(line)) {
      if (!replaced) next.push(`${key}=${encodeEnvValue(value)}`);
      replaced = true;
    } else {
      next.push(line);
    }
  }
  if (!replaced) {
    while (next.length > 0 && next[next.length - 1] === "") next.pop();
    if (next.length > 0) next.push("");
    next.push(`${key}=${encodeEnvValue(value)}`);
  }
  const contents = `${next.join("\n").replace(/\n+$/, "")}\n`;
  const temporary = `${envPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch {}
  fs.renameSync(temporary, envPath);
}

function setEnvSecret(account, secret, customPath) {
  if (typeof secret !== "string" || secret.length > 100_000 || /[\u0000]/.test(secret)) throw new Error("SECURE_STORE_VALUE_INVALID");
  const envPath = resolveEnvPath(customPath);
  if (!secret) return deleteEnvSecret(account, envPath);
  writeEnvEntry(envPath, accountEnvKey(account), secret);
}

function getEnvSecret(account, customPath) {
  const key = accountEnvKey(account);
  if (typeof process.env[key] === "string" && process.env[key] !== "") return process.env[key];
  return readEnvEntries(resolveEnvPath(customPath)).get(key) ?? null;
}

function deleteEnvSecret(account, customPath) {
  const envPath = resolveEnvPath(customPath);
  if (!fs.existsSync(envPath)) return;
  const key = accountEnvKey(account);
  const contents = fs.readFileSync(envPath, "utf8");
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\s*=`, "m");
  if (!keyPattern.test(contents)) return;
  const lines = contents.split(/\r?\n/).filter((line) => !keyPattern.test(line));
  const next = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const temporary = `${envPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, next, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch {}
  fs.renameSync(temporary, envPath);
}

module.exports = { accountEnvKey, deleteEnvSecret, getEnvSecret, resolveEnvPath, setEnvSecret };
