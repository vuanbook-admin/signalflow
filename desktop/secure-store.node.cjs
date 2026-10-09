const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setActiveProfileId, setSecret, getSecret, deleteSecret } = require("./secure-store.cjs");

test("stores a long secret in the portable .env file and round-trips the original value", () => {
  const account = `test:signalflow:chunked:${randomUUID()}`;
  const value = "x".repeat(250);
  const envPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-secure-store-")), ".env");
  const previousPath = process.env.SIGNALFLOW_ENV_FILE;
  process.env.SIGNALFLOW_ENV_FILE = envPath;
  try {
    setSecret(account, value);
    assert.equal(getSecret(account), value);
  } finally {
    deleteSecret(account);
    if (previousPath === undefined) delete process.env.SIGNALFLOW_ENV_FILE;
    else process.env.SIGNALFLOW_ENV_FILE = previousPath;
  }
});

test("scopes secrets by profile and keeps legacy unscoped secrets owner-only", () => {
  const account = `test:signalflow:profile-scope:${randomUUID()}`;
  const envPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-secrets-")), ".env");
  const previousPath = process.env.SIGNALFLOW_ENV_FILE;
  process.env.SIGNALFLOW_ENV_FILE = envPath;
  try {
    const { setEnvSecret } = require("./portable-env.cjs");
    setEnvSecret(account, "owner legacy value", envPath);
    setActiveProfileId("profile-bavy");
    assert.equal(getSecret(account), "owner legacy value");
    assert.equal(getSecret(`profile:profile-bavy:${account}`), "owner legacy value");
    setActiveProfileId("profile-linh");
    assert.equal(getSecret(account), null);
    setSecret(account, "linh profile value");
    assert.equal(getSecret(account), "linh profile value");
    setActiveProfileId("profile-bavy");
    assert.equal(getSecret(account), "owner legacy value");
    deleteSecret(`profile:profile-bavy:${account}`);
    assert.equal(getSecret(account), null);
  } finally {
    setActiveProfileId("profile-bavy");
    deleteSecret(account);
    if (previousPath === undefined) delete process.env.SIGNALFLOW_ENV_FILE;
    else process.env.SIGNALFLOW_ENV_FILE = previousPath;
  }
});
