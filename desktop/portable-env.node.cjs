const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { accountEnvKey, deleteEnvSecret, getEnvSecret, setEnvSecret } = require("./portable-env.cjs");

test("round-trips a secret in the portable .env store without changing unrelated lines", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-env-"));
  const envPath = path.join(directory, ".env");
  fs.writeFileSync(envPath, "# keep this comment\nMETA_APP_ID=123\n", { mode: 0o600 });
  const account = "workspace:demo:meta:app-secret";
  const secret = "value with spaces # and = signs";

  setEnvSecret(account, secret, envPath);
  assert.equal(getEnvSecret(account, envPath), secret);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(envPath, "utf8"), /# keep this comment\nMETA_APP_ID=123\n/);
  assert.match(accountEnvKey(account), /^SIGNALFLOW_SECRET_[0-9A-F]+$/);

  deleteEnvSecret(account, envPath);
  assert.equal(getEnvSecret(account, envPath), null);
});
