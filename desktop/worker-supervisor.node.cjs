const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { assertRuntimeOperationAllowed, buildWorkerLauncherSpec, configuredRuntimePorts, createWorkerSupervisor, installGracefulQuitHandlers, prepareRuntimeData, probeLoopbackHealth, probePort, readActiveProfileSelection, resolveDeveloperUserDataRoot, safeProfileId, writeActiveProfileSelection } = require("./worker-supervisor.cjs");

function healthFor(profileId, runtimeId, extra = {}) {
  return { controlPlane: true, worker: true, controlPlaneProfileId: profileId, workerProfileId: profileId, controlPlaneRuntimeId: runtimeId, workerRuntimeId: runtimeId, workerState: "running", acceptingJobs: true, inFlightExecutions: 0, runningJobs: 0, ...extra };
}

test("migrates the explicit owner legacy root with verified v2 proof and preserves its source", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-owner-migration-"));
  const createLegacyPair = [
    "import sqlite3, sys",
    "for filename in sys.argv[1:]:",
    "  connection = sqlite3.connect(filename)",
    "  connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')",
    "  connection.executemany('INSERT INTO records(value) VALUES (?)', [('one',), ('two',)])",
    "  connection.commit()",
    "  connection.close()",
  ].join("\n");
  const sourcePaths = ["signalflow-control-plane.sqlite3", "signalflow-worker.sqlite3"].map((name) => path.join(userDataRoot, name));
  const fixture = spawnSync("python3", ["-c", createLegacyPair, ...sourcePaths], { encoding: "utf8" });
  assert.equal(fixture.status, 0, fixture.stderr);
  const sourceHashes = sourcePaths.map((sourcePath) => crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"));

  const result = prepareRuntimeData({ userDataRoot, legacyDataRoot: userDataRoot, legacyWriterStopped: true, profileId: "profile-bavy", listProcessMetadata: () => [] });

  const profileRoot = path.dirname(result.controlPlaneDb);
  const marker = JSON.parse(fs.readFileSync(path.join(profileRoot, "profile-migration-v2.json"), "utf8"));
  assert.equal(marker.version, 2);
  assert.equal(marker.profileId, "profile-bavy");
  assert.equal(marker.integrityCheck, "ok");
  assert.equal(marker.recordCountsVerified, true);
  assert.equal(marker.sourcePreserved, true);
  assert.equal(typeof marker.verifiedAt, "string");
  assert.deepEqual(sourcePaths.map((sourcePath) => crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex")), sourceHashes);
  assert.ok(fs.existsSync(result.controlPlaneDb));
  assert.ok(fs.existsSync(result.workerDb));
});

test("migrates a browser-only owner profile only after proving its legacy Chrome owner is closed", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-browser-only-migration-"));
  const legacyProfile = path.join(userDataRoot, "account-profiles", "gemini");
  fs.mkdirSync(legacyProfile, { recursive: true });
  fs.writeFileSync(path.join(legacyProfile, "Preferences"), "legacy browser state");
  fs.writeFileSync(path.join(legacyProfile, "SignalFlowCdpPort"), "19222\n");
  const before = fs.readFileSync(path.join(legacyProfile, "Preferences"), "utf8");
  const probedPorts = [];

  const result = prepareRuntimeData({
    sourceRoot: path.resolve(__dirname, ".."),
    userDataRoot,
    legacyDataRoot: userDataRoot,
    legacyWriterStopped: true,
    profileId: "profile-bavy",
    listBrowserProcesses: () => [],
    listProcessMetadata: () => [],
    browserPortOwnerPids: (port) => { probedPorts.push(port); return []; },
  });

  const profileRoot = path.dirname(result.controlPlaneDb);
  const marker = JSON.parse(fs.readFileSync(path.join(profileRoot, "profile-migration-v2.json"), "utf8"));
  assert.deepEqual(Object.keys(marker.browserProfiles), ["gemini"]);
  assert.deepEqual(probedPorts.sort((left, right) => left - right), [19_222, 51_819]);
  assert.equal(marker.browserProfiles.gemini.ownerVerifiedClosed, true);
  assert.equal(fs.readFileSync(path.join(profileRoot, "account-profiles", "gemini", "Preferences"), "utf8"), before);
  assert.equal(fs.readFileSync(path.join(legacyProfile, "Preferences"), "utf8"), before);
});

test("migrates owner databases and browser profile in the same atomic migration proof", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-db-browser-migration-"));
  const databaseFixture = spawnSync("python3", ["-c", [
    "import sqlite3, sys",
    "for filename in sys.argv[1:]:",
    "  connection = sqlite3.connect(filename)",
    "  connection.execute('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')",
    "  connection.execute('INSERT INTO records(value) VALUES (?)', ('preserved row',))",
    "  connection.commit()",
    "  connection.close()",
  ].join("\n"), ...["signalflow-control-plane.sqlite3", "signalflow-worker.sqlite3"].map((name) => path.join(userDataRoot, name))], { encoding: "utf8" });
  assert.equal(databaseFixture.status, 0, databaseFixture.stderr);
  const legacyProfile = path.join(userDataRoot, "account-profiles", "drive");
  fs.mkdirSync(legacyProfile, { recursive: true });
  fs.writeFileSync(path.join(legacyProfile, "Preferences"), "drive profile state");

  const result = prepareRuntimeData({
    sourceRoot: path.resolve(__dirname, ".."),
    userDataRoot,
    legacyDataRoot: userDataRoot,
    legacyWriterStopped: true,
    profileId: "profile-bavy",
    listBrowserProcesses: () => [],
    listProcessMetadata: () => [],
  });

  const profileRoot = path.dirname(result.controlPlaneDb);
  const marker = JSON.parse(fs.readFileSync(path.join(profileRoot, "profile-migration-v2.json"), "utf8"));
  assert.equal(marker.recordCounts["signalflow-control-plane.sqlite3"].records, 1);
  assert.deepEqual(Object.keys(marker.browserProfiles), ["drive"]);
  assert.equal(fs.readFileSync(path.join(profileRoot, "account-profiles", "drive", "Preferences"), "utf8"), "drive profile state");
});

test("blocks browser migration when a process command names the exact legacy profile", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-browser-owned-migration-"));
  const legacyProfile = path.join(userDataRoot, "account-profiles", "gemini");
  fs.mkdirSync(legacyProfile, { recursive: true });
  fs.writeFileSync(path.join(legacyProfile, "Preferences"), "legacy browser state");
  let migrationCalls = 0;

  assert.throws(() => prepareRuntimeData({
    userDataRoot,
    legacyDataRoot: userDataRoot,
    legacyWriterStopped: true,
    profileId: "profile-bavy",
    listProcessMetadata: () => [],
    listBrowserProcesses: () => [{ pid: 777, commandLine: `chrome --user-data-dir=${fs.realpathSync(legacyProfile)}` }],
    migrateOwnerData: () => { migrationCalls += 1; },
  }), /PROFILE_BROWSER_MIGRATION_CLOSE_BROWSER/);

  assert.equal(migrationCalls, 0);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "profile-migration-v2.json")), false);
});

test("fails closed when a legacy global provider CDP port is open under an unknown PID", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-browser-unknown-port-"));
  const legacyProfile = path.join(userDataRoot, "account-profiles", "gemini");
  fs.mkdirSync(legacyProfile, { recursive: true });
  fs.writeFileSync(path.join(legacyProfile, "Preferences"), "legacy browser state");
  let migrationCalls = 0;

  assert.throws(() => prepareRuntimeData({
    userDataRoot,
    legacyDataRoot: userDataRoot,
    legacyWriterStopped: true,
    profileId: "profile-bavy",
    listProcessMetadata: () => [],
    listBrowserProcesses: () => [],
    browserPortOwnerPids: (port) => port === 51_819 ? [9876] : [],
    migrateOwnerData: () => { migrationCalls += 1; },
  }), /PROFILE_BROWSER_OWNER_UNVERIFIABLE/);

  assert.equal(migrationCalls, 0);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "profile-migration-v2.json")), false);
});

test("blocks legacy migration when a prior SignalFlow service port is unverified", async () => {
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-unverified-writer-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-unverified-writer-target-"));
  fs.writeFileSync(path.join(legacyRoot, "signalflow-control-plane.sqlite3"), "temp legacy database");
  fs.writeFileSync(path.join(legacyRoot, "signalflow-worker.sqlite3"), "temp legacy database");
  let migrationCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/unused-source-root",
    legacyDataRoot: legacyRoot,
    userDataRoot,
    profileId: "profile-bavy",
    probeHealth: async () => ({ controlPlanePortOpen: true, workerPortOpen: false }),
    migrateOwnerData: () => { migrationCalls += 1; },
    spawnImpl: () => { throw new Error("must not spawn while the old port is open"); },
  });

  const status = await supervisor.start();

  assert.equal(status.lastError, "PROFILE_MIGRATION_CLOSE_SIGNALFLOW");
  assert.equal(migrationCalls, 0);
  assert.equal(fs.readFileSync(path.join(legacyRoot, "signalflow-worker.sqlite3"), "utf8"), "temp legacy database");
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "signalflow-worker.sqlite3")), false);
});

test("builds a packaged launcher spec with unpacked runtime and userData databases", () => {
  const spec = buildWorkerLauncherSpec({
    isPackaged: true,
    resourcesPath: "/Applications/SignalFlow.app/Contents/Resources",
    sourceRoot: "/repo",
    userDataRoot: "/Users/test/Library/Application Support/SignalFlow",
    nodePath: "/Applications/SignalFlow.app/Contents/MacOS/SignalFlow",
  });
  assert.equal(spec.runtimeRoot, "/Applications/SignalFlow.app/Contents/Resources/app.asar.unpacked/worker-runtime");
  assert.equal(spec.launcherPath, path.join(spec.runtimeRoot, "run-local-worker.mjs"));
  assert.equal(spec.cwd, spec.runtimeRoot);
  assert.deepEqual(spec.args, [spec.launcherPath]);
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(spec.env.SIGNALFLOW_WORKER_RUNTIME_ROOT, spec.runtimeRoot);
  assert.equal(spec.env.SIGNALFLOW_CONTROL_PLANE_PORT, "18787");
  assert.equal(spec.env.SIGNALFLOW_WORKER_PORT, "18788");
  assert.equal(spec.env.SIGNALFLOW_CONTROL_PLANE_DB, path.join("/Users/test/Library/Application Support/SignalFlow", "signalflow-control-plane.sqlite3"));
  assert.equal(spec.env.SIGNALFLOW_WORKER_DB, path.join("/Users/test/Library/Application Support/SignalFlow", "signalflow-worker.sqlite3"));
});

test("uses configured runtime ports while retaining default ports as legacy probes", async () => {
  const env = { SIGNALFLOW_CONTROL_PLANE_PORT: "19787", SIGNALFLOW_WORKER_PORT: "19788" };
  assert.deepEqual(configuredRuntimePorts(env), { controlPlanePort: 19787, workerPort: 19788 });
  const spec = buildWorkerLauncherSpec({ sourceRoot: "/repo", userDataRoot: "/Users/test/Library/Application Support/SignalFlow", profileId: "profile-qc", env });
  assert.equal(spec.env.SIGNALFLOW_CONTROL_PLANE_PORT, "19787");
  assert.equal(spec.env.SIGNALFLOW_WORKER_PORT, "19788");

  const calls = [];
  const health = await probeLoopbackHealth({
    env,
    probePortImpl: async (port) => {
      calls.push(port);
      return { open: [18787, 18788, 19787, 19788].includes(port), ok: [19787, 19788].includes(port), value: port === 19787
        ? { ok: true, profileId: "profile-qc", runtimeId: "runtime-qc", workerState: "running", acceptingJobs: true }
        : port === 19788
          ? { ok: true, profileId: "profile-qc", runtimeId: "runtime-qc", workerState: "running", acceptingJobs: true }
          : null };
    },
  });

  assert.deepEqual(calls, [8787, 18787, 18788, 19787, 19788]);
  assert.equal(health.controlPlane, true);
  assert.equal(health.worker, true);
  assert.deepEqual(health.legacyWriterPortsOpen, [18787, 18788]);
});

test("fails closed for invalid configured runtime ports", () => {
  assert.throws(() => configuredRuntimePorts({ SIGNALFLOW_CONTROL_PLANE_PORT: "19787.5" }), /SIGNALFLOW_CONTROL_PLANE_PORT_INVALID/);
  assert.throws(() => configuredRuntimePorts({ SIGNALFLOW_WORKER_PORT: "65536" }), /SIGNALFLOW_WORKER_PORT_INVALID/);
  assert.throws(() => configuredRuntimePorts({ SIGNALFLOW_CONTROL_PLANE_PORT: "19787", SIGNALFLOW_WORKER_PORT: "19787" }), /SIGNALFLOW_PORTS_CONFLICT/);
});

test("persists the active profile and runtime identity as one atomic selection", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-selection-"));
  writeActiveProfileSelection(userDataRoot, { profileId: "profile-linh", runtimeId: "signalflow-profile-linh-launch-1" });
  assert.deepEqual(readActiveProfileSelection(userDataRoot), { profileId: "profile-linh", runtimeId: "signalflow-profile-linh-launch-1" });
  assert.equal(fs.statSync(path.join(userDataRoot, "active-profile.json")).mode & 0o777, 0o600);
  assert.throws(() => writeActiveProfileSelection(userDataRoot, { profileId: "profile-linh" }), /PROFILE_RUNTIME_ID_INVALID/);
});

test("rejects whitespace, numeric, and case-aliased profile IDs before deriving an existing profile path", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-id-alias-"));
  const existingProfile = path.join(userDataRoot, "profiles", "profile-a");
  fs.mkdirSync(existingProfile, { recursive: true });
  const protectedDb = path.join(existingProfile, "signalflow-worker.sqlite3");
  fs.writeFileSync(protectedDb, "do not alias this profile");

  for (const profileId of ["profile-a ", 123, "Profile-a"]) {
    assert.throws(() => safeProfileId(profileId), /PROFILE_ID_INVALID/);
    assert.throws(() => prepareRuntimeData({ userDataRoot, profileId }), /PROFILE_ID_INVALID/);
  }
  assert.equal(fs.readFileSync(protectedDb, "utf8"), "do not alias this profile");
});

test("rejects whitespace and numeric IDs read from active-profile.json", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-selection-alias-"));
  const selectionPath = path.join(userDataRoot, "active-profile.json");
  for (const profileId of ["profile-a ", 123, "Profile-a"]) {
    fs.writeFileSync(selectionPath, JSON.stringify({ profileId, runtimeId: "runtime-a" }));
    assert.throws(() => readActiveProfileSelection(userDataRoot), /PROFILE_SELECTION_INVALID/);
  }
});

test("validates a developer-only absolute Electron userData override", () => {
  const root = path.join(os.tmpdir(), "signalflow-e09-electron-user-data");
  assert.equal(resolveDeveloperUserDataRoot("", { isPackaged: false }), "");
  assert.equal(resolveDeveloperUserDataRoot(root, { isPackaged: false }), path.resolve(root));
  assert.throws(() => resolveDeveloperUserDataRoot("relative-root", { isPackaged: false }), /SIGNALFLOW_DEV_USER_DATA_ROOT_ABSOLUTE/);
  assert.throws(() => resolveDeveloperUserDataRoot(path.parse(root).root, { isPackaged: false }), /SIGNALFLOW_DEV_USER_DATA_ROOT_INVALID/);
  assert.throws(() => resolveDeveloperUserDataRoot(root, { isPackaged: true }), /SIGNALFLOW_DEV_USER_DATA_ROOT_PACKAGED/);
});

test("worker launcher refuses to start without profile-scoped identity and database paths", () => {
  const launcherPath = path.resolve(__dirname, "../scripts/run-local-worker.mjs");
  const result = spawnSync(process.execPath, [launcherPath], { cwd: os.tmpdir(), env: { PATH: process.env.PATH || "" }, encoding: "utf8", timeout: 2_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROFILE_RUNTIME_IDENTITY_REQUIRED/);
});

test("worker launcher rejects absolute databases owned by a different profile", () => {
  const launcherPath = path.resolve(__dirname, "../scripts/run-local-worker.mjs");
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-runner-mismatch-"));
  const profileRoot = path.join(userDataRoot, "profiles", "profile-b");
  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: os.tmpdir(),
    env: {
      PATH: process.env.PATH || "",
      SIGNALFLOW_UV: process.execPath,
      SIGNALFLOW_PROFILE_ID: "profile-a",
      SIGNALFLOW_RUNTIME_ID: "runtime-profile-a-1",
      SIGNALFLOW_CONTROL_PLANE_DB: path.join(profileRoot, "signalflow-control-plane.sqlite3"),
      SIGNALFLOW_WORKER_DB: path.join(profileRoot, "signalflow-worker.sqlite3"),
    },
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROFILE_DATABASE_PATHS_INVALID/);
});

test("worker launcher rejects case-aliased profile IDs before deriving database paths", () => {
  const launcherPath = path.resolve(__dirname, "../scripts/run-local-worker.mjs");
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-runner-case-alias-"));
  const profileRoot = path.join(userDataRoot, "profiles", "profile-a");
  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: os.tmpdir(),
    env: {
      PATH: process.env.PATH || "",
      SIGNALFLOW_UV: process.execPath,
      SIGNALFLOW_PROFILE_ID: "profile-A",
      SIGNALFLOW_RUNTIME_ID: "runtime-profile-a-1",
      SIGNALFLOW_CONTROL_PLANE_DB: path.join(profileRoot, "signalflow-control-plane.sqlite3"),
      SIGNALFLOW_WORKER_DB: path.join(profileRoot, "signalflow-worker.sqlite3"),
    },
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROFILE_RUNTIME_IDENTITY_REQUIRED/);
});

test("worker launcher rejects invalid configured runtime ports before spawning services", () => {
  const launcherPath = path.resolve(__dirname, "../scripts/run-local-worker.mjs");
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-runner-port-invalid-"));
  const profileRoot = path.join(userDataRoot, "profiles", "profile-qc");
  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: os.tmpdir(),
    env: {
      PATH: process.env.PATH || "",
      SIGNALFLOW_UV: process.execPath,
      SIGNALFLOW_PROFILE_ID: "profile-qc",
      SIGNALFLOW_RUNTIME_ID: "runtime-profile-qc-1",
      SIGNALFLOW_CONTROL_PLANE_DB: path.join(profileRoot, "signalflow-control-plane.sqlite3"),
      SIGNALFLOW_WORKER_DB: path.join(profileRoot, "signalflow-worker.sqlite3"),
      SIGNALFLOW_CONTROL_PLANE_PORT: "invalid",
    },
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SIGNALFLOW_CONTROL_PLANE_PORT_INVALID/);
});

test("worker launcher passes configured ports and provider executor URL to both services", () => {
  const launcherPath = path.resolve(__dirname, "../scripts/run-local-worker.mjs");
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-runner-port-configured-"));
  const capturePath = path.join(userDataRoot, "children.jsonl");
  const fakeUvPath = path.join(userDataRoot, "fake-uv.cjs");
  fs.writeFileSync(fakeUvPath, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ args: process.argv.slice(2), env: { PORT: process.env.PORT, SIGNALFLOW_CONTROL_PLANE_PORT: process.env.SIGNALFLOW_CONTROL_PLANE_PORT, SIGNALFLOW_WORKER_PORT: process.env.SIGNALFLOW_WORKER_PORT, SIGNALFLOW_WORKER_URL: process.env.SIGNALFLOW_WORKER_URL, SIGNALFLOW_PROVIDER_EXECUTOR_URL: process.env.SIGNALFLOW_PROVIDER_EXECUTOR_URL } }) + '\\n');`,
  ].join("\n"));
  fs.chmodSync(fakeUvPath, 0o755);
  const profileRoot = path.join(userDataRoot, "profiles", "profile-qc");
  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: os.tmpdir(),
    env: {
      PATH: process.env.PATH || "",
      SIGNALFLOW_UV: fakeUvPath,
      SIGNALFLOW_PROFILE_ID: "profile-qc",
      SIGNALFLOW_RUNTIME_ID: "runtime-profile-qc-1",
      SIGNALFLOW_CONTROL_PLANE_DB: path.join(profileRoot, "signalflow-control-plane.sqlite3"),
      SIGNALFLOW_WORKER_DB: path.join(profileRoot, "signalflow-worker.sqlite3"),
      SIGNALFLOW_CONTROL_PLANE_PORT: "19787",
      SIGNALFLOW_WORKER_PORT: "19788",
    },
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.status, 1);
  const records = fs.readFileSync(capturePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  const control = records.find((record) => record.env.PORT === "19787");
  const worker = records.find((record) => record.env.SIGNALFLOW_WORKER_PORT === "19788" && record.env.SIGNALFLOW_PROVIDER_EXECUTOR_URL);
  assert.equal(control.env.SIGNALFLOW_CONTROL_PLANE_PORT, "19787");
  assert.equal(control.env.SIGNALFLOW_WORKER_URL, "http://127.0.0.1:19788");
  assert.equal(worker.env.SIGNALFLOW_CONTROL_PLANE_PORT, "19787");
  assert.equal(worker.env.SIGNALFLOW_WORKER_URL, "http://127.0.0.1:19788");
  assert.equal(worker.env.SIGNALFLOW_PROVIDER_EXECUTOR_URL, "http://127.0.0.1:19787/v1/worker/meta/page-text");
});

test("keeps an accepted TCP port marked open when its health request times out", async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await probePort(port, 20);
    assert.equal(result.open, true);
    assert.equal(result.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("blocks new IPC work while switching or when the active runtime does not match", () => {
  assert.throws(() => assertRuntimeOperationAllowed({ ready: true, switching: true, profileId: "profile-a" }, "profile-a"), /PROFILE_BUSY/);
  assert.throws(() => assertRuntimeOperationAllowed({ ready: true, switching: false, profileId: "profile-a" }, "profile-a", 1), /PROFILE_BUSY/);
  assert.throws(() => assertRuntimeOperationAllowed({ ready: true, switching: false, profileId: "profile-b" }, "profile-a"), /PROFILE_RUNTIME_NOT_READY/);
  assert.doesNotThrow(() => assertRuntimeOperationAllowed({ ready: true, switching: false, profileId: "profile-a" }, "profile-a"));
});

test("fails closed instead of raw-copying an existing owner's SQLite database", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-legacy-source-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-user-data-"));
  fs.writeFileSync(path.join(sourceRoot, "signalflow-control-plane.sqlite3"), "legacy-control-plane");
  fs.writeFileSync(path.join(sourceRoot, "signalflow-worker.sqlite3"), "legacy-worker");
  fs.writeFileSync(path.join(sourceRoot, "signalflow-control-plane.sqlite3-wal"), "live-wal");
  assert.throws(() => prepareRuntimeData({ sourceRoot, legacyDataRoot: sourceRoot, userDataRoot, profileId: "profile-bavy" }), /PROFILE_LEGACY_WRITER_UNVERIFIABLE/);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "signalflow-control-plane.sqlite3")), false);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "profile-migration-v1.json")), false);
});

test("does not trust existing owner profile databases when legacy source data lacks verified migration proof", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-existing-legacy-source-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-existing-profile-data-"));
  const profileRoot = path.join(userDataRoot, "profiles", "profile-bavy");
  fs.mkdirSync(profileRoot, { recursive: true });
  for (const name of ["signalflow-control-plane.sqlite3", "signalflow-worker.sqlite3"]) {
    fs.writeFileSync(path.join(sourceRoot, name), "legacy-source");
    fs.writeFileSync(path.join(profileRoot, name), "existing-profile-data");
  }
  fs.writeFileSync(path.join(sourceRoot, "signalflow-worker.sqlite3-wal"), "unverified-wal");
  fs.writeFileSync(path.join(profileRoot, "profile-migration-v1.json"), JSON.stringify({ profileId: "profile-bavy", migratedAt: "2026-09-11T00:00:00.000Z", sourcePreserved: true }));
  assert.throws(() => prepareRuntimeData({ sourceRoot, legacyDataRoot: sourceRoot, userDataRoot, profileId: "profile-bavy" }), /PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED/);
});

test("namespaces worker databases and launcher identity by profile", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-data-"));
  const canonicalUserDataRoot = fs.realpathSync(userDataRoot);
  const spec = buildWorkerLauncherSpec({ sourceRoot: "/repo", userDataRoot, profileId: "profile-linh", runtimeId: "signalflow-profile-linh-launch-1" });
  assert.equal(spec.env.SIGNALFLOW_PROFILE_ID, "profile-linh");
  assert.equal(spec.env.SIGNALFLOW_RUNTIME_ID, "signalflow-profile-linh-launch-1");
  assert.equal(spec.env.SIGNALFLOW_WORKER_DB, path.join(canonicalUserDataRoot, "profiles", "profile-linh", "signalflow-worker.sqlite3"));
  assert.equal(spec.env.SIGNALFLOW_CONTROL_PLANE_DB, path.join(canonicalUserDataRoot, "profiles", "profile-linh", "signalflow-control-plane.sqlite3"));
});

test("does not copy legacy databases into a newly created profile", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-legacy-isolation-source-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-isolation-data-"));
  fs.writeFileSync(path.join(sourceRoot, "signalflow-control-plane.sqlite3"), "legacy-control-plane");
  fs.writeFileSync(path.join(sourceRoot, "signalflow-worker.sqlite3"), "legacy-worker");
  const paths = prepareRuntimeData({ sourceRoot, legacyDataRoot: sourceRoot, userDataRoot, profileId: "profile-new" });
  assert.equal(fs.existsSync(paths.controlPlaneDb), false);
  assert.equal(fs.existsSync(paths.workerDb), false);
});

test("rejects a profile root symlink that aliases another user's data", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-root-alias-"));
  const profilesRoot = path.join(userDataRoot, "profiles");
  const profileA = path.join(profilesRoot, "profile-a");
  fs.mkdirSync(profileA, { recursive: true });
  fs.symlinkSync(profileA, path.join(profilesRoot, "profile-b"), "dir");

  assert.throws(() => prepareRuntimeData({ userDataRoot, profileId: "profile-b" }), /PROFILE_PATH_ALIAS/);
  assert.equal(fs.existsSync(path.join(profileA, "signalflow-worker.sqlite3")), false);
});

test("adopts an already healthy runtime without spawning a duplicate", async () => {
  let spawnCount = 0;
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-adopt-data-"));
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo",
    userDataRoot,
    profileId: "profile-a", runtimeId: "runtime-a",
    probeHealth: async () => healthFor("profile-a", "runtime-a"),
    spawnImpl: () => { spawnCount += 1; throw new Error("must not spawn"); },
    healthIntervalMs: 1,
  });
  const status = await supervisor.start();
  assert.equal(status.state, "ready");
  assert.equal(status.ownsRuntime, false);
  assert.equal(spawnCount, 0);
  await supervisor.stop();
});

test("blocks owner migration when the legacy Control Plane port 8787 is open", async () => {
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-old-port-source-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-old-port-target-"));
  fs.mkdirSync(path.join(legacyRoot, "account-profiles", "gemini"), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "account-profiles", "gemini", "Preferences"), "legacy");
  let migrationCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: path.resolve(__dirname, ".."),
    legacyDataRoot: legacyRoot,
    userDataRoot,
    profileId: "profile-bavy",
    probeHealth: async () => ({ controlPlanePortOpen: false, workerPortOpen: false, legacyWriterPortOpen: true }),
    listBrowserProcesses: () => [],
    migrateOwnerData: () => { migrationCalls += 1; },
    spawnImpl: () => { throw new Error("must not spawn while the legacy writer is open"); },
  });

  const status = await supervisor.start();

  assert.equal(status.lastError, "PROFILE_MIGRATION_CLOSE_SIGNALFLOW");
  assert.equal(migrationCalls, 0);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "profile-migration-v2.json")), false);
});

test("blocks owner migration when a known writer process remains after its ports close", () => {
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-background-writer-source-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-background-writer-target-"));
  fs.writeFileSync(path.join(legacyRoot, "signalflow-control-plane.sqlite3"), "legacy control plane");
  fs.writeFileSync(path.join(legacyRoot, "signalflow-worker.sqlite3"), "legacy worker");
  let migrationCalls = 0;

  assert.throws(() => prepareRuntimeData({
    sourceRoot: path.resolve(__dirname, ".."),
    userDataRoot,
    legacyDataRoot: legacyRoot,
    legacyWriterStopped: true,
    profileId: "profile-bavy",
    listProcessMetadata: () => [{ pid: 777, commandLine: "python3 -m backend.control_plane_service" }],
    migrateOwnerData: () => { migrationCalls += 1; },
  }), /PROFILE_MIGRATION_CLOSE_SIGNALFLOW/);

  assert.equal(migrationCalls, 0);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "profile-migration-v2.json")), false);
  assert.equal(fs.readFileSync(path.join(legacyRoot, "signalflow-control-plane.sqlite3"), "utf8"), "legacy control plane");
});

test("fails closed when legacy writer process metadata cannot be enumerated", () => {
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-unverifiable-process-source-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-unverifiable-process-target-"));
  fs.writeFileSync(path.join(legacyRoot, "signalflow-control-plane.sqlite3"), "legacy control plane");
  fs.writeFileSync(path.join(legacyRoot, "signalflow-worker.sqlite3"), "legacy worker");
  let migrationCalls = 0;

  assert.throws(() => prepareRuntimeData({
    userDataRoot,
    legacyDataRoot: legacyRoot,
    legacyWriterStopped: true,
    profileId: "profile-bavy",
    listProcessMetadata: () => { throw new Error("process listing unavailable"); },
    migrateOwnerData: () => { migrationCalls += 1; },
  }), /PROFILE_LEGACY_WRITER_UNVERIFIABLE/);

  assert.equal(migrationCalls, 0);
  assert.equal(fs.existsSync(path.join(userDataRoot, "profiles", "profile-bavy", "profile-migration-v2.json")), false);
});

test("probes known and configured legacy writer ports through an injectable port probe", async () => {
  const { probeLoopbackHealth } = require("./worker-supervisor.cjs");
  const calls = [];
  const health = await probeLoopbackHealth({
    env: { PORT: "18789", SIGNALFLOW_LEGACY_CONTROL_PLANE_PORT: "18790", SIGNALFLOW_WORKER_PORT: "18791" },
    probePortImpl: async (port) => { calls.push(port); return { open: port === 8787 || port === 18_791, ok: false, value: null }; },
  });

  assert.deepEqual(calls.sort((left, right) => left - right), [8787, 18787, 18788, 18789, 18790, 18791]);
  assert.equal(health.legacyWriterPortOpen, true);
  assert.deepEqual(health.legacyWriterPortsOpen, [8787]);
});

test("starts a missing runtime and restarts its owned child after exit", async () => {
  let spawned = false;
  let quiesced = false;
  let spawnCount = 0;
  let runtimeId = "";
  const children = [];
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-restart-data-"));
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo",
    userDataRoot,
    profileId: "profile-a",
    probeHealth: async () => spawned ? healthFor("profile-a", runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {}) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      spawned = true;
      quiesced = false;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      spawnCount += 1;
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => { spawned = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      child.on("exit", () => { spawned = false; });
      children.push(child);
      return child;
    },
    healthTimeoutMs: 100,
    healthIntervalMs: 1,
    restartBaseMs: 0,
    restartMaxMs: 0,
  });
  const status = await supervisor.start();
  assert.equal(status.state, "ready");
  assert.equal(status.ownsRuntime, true);
  assert.equal(spawnCount, 1);
  children[0].emit("exit", 1, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(spawnCount, 2);
  await supervisor.stop();
});

test("does not adopt a healthy runtime owned by another profile", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-conflict-"));
  let spawnCount = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo",
    userDataRoot,
    profileId: "profile-b",
    probeHealth: async () => ({ controlPlane: true, worker: true, controlPlaneProfileId: "profile-a", workerProfileId: "profile-a", controlPlaneRuntimeId: "signalflow-profile-a", workerRuntimeId: "signalflow-profile-a" }),
    spawnImpl: () => { spawnCount += 1; throw new Error("foreign runtime must not be replaced"); },
  });
  const status = await supervisor.start();
  assert.equal(status.lastError, "PROFILE_RUNTIME_CONFLICT");
  assert.equal(spawnCount, 0);
  await supervisor.stop();
});

test("reports a launcher failure separately from an owner migration requirement", async () => {
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo",
    userDataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-launch-failure-")),
    profileId: "profile-a",
    probeHealth: async () => ({ controlPlane: false, worker: false }),
    spawnImpl: () => { throw new Error("ENOENT"); },
  });
  const status = await supervisor.start();
  assert.equal(status.state, "degraded");
  assert.equal(status.lastError, "LOCAL_WORKER_RUNTIME_START_FAILED");
  await supervisor.stop();
});

test("same-profile activation starts and verifies the runtime before returning ready", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-same-profile-"));
  let live = false;
  let spawnCount = 0;
  let runtimeId = "";
  let quiesced = false;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo",
    userDataRoot,
    profileId: "profile-a",
    probeHealth: async () => live ? healthFor("profile-a", runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {}) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => { spawnCount += 1; runtimeId = options.env.SIGNALFLOW_RUNTIME_ID; quiesced = false; live = true; const child = new EventEmitter(); child.exitCode = null; child.kill = () => { live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); }; return child; },
    healthTimeoutMs: 100,
    healthIntervalMs: 1,
  });

  const activation = await supervisor.activateProfile("profile-a");

  assert.equal(activation.state, "ready");
  assert.equal(activation.profileId, "profile-a");
  assert.equal(spawnCount, 1);
  await supervisor.stop();
});

test("rejects incomplete health identities without replacing the native selection", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-incomplete-health-"));
  writeActiveProfileSelection(userDataRoot, { profileId: "profile-a", runtimeId: "runtime-a" });
  let spawnCount = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-a",
    probeHealth: async () => ({ controlPlane: true, worker: true, controlPlaneProfileId: "profile-a", workerProfileId: "profile-a" }),
    spawnImpl: () => { spawnCount += 1; throw new Error("incomplete health must not be replaced"); },
    persistActiveProfile: (selection) => writeActiveProfileSelection(userDataRoot, selection),
  });
  const activation = await supervisor.start();
  assert.equal(activation.state, "degraded");
  assert.equal(activation.lastError, "PROFILE_RUNTIME_CONFLICT");
  assert.equal(spawnCount, 0);
  assert.deepEqual(readActiveProfileSelection(userDataRoot), { profileId: "profile-a", runtimeId: "runtime-a" });
  await supervisor.stop();
});

test("serializes concurrent profile activations", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-serial-"));
  let live = false;
  let quiesced = false;
  let runtimeId = "";
  let currentProfile = "profile-a";
  const events = [];
  const children = [];
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeIdFactory: (profileId) => `runtime-${profileId}-${events.length}`,
    probeHealth: async () => live ? healthFor(currentProfile, runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {}) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { events.push(`quiesce:${currentProfile}`); quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      currentProfile = options.env.SIGNALFLOW_PROFILE_ID;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      quiesced = false;
      events.push(`start:${currentProfile}`);
      live = true;
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => { live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      children.push(child);
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1, portReleaseTimeoutMs: 100, quiesceTimeoutMs: 100,
  });
  await supervisor.activateProfile("profile-a");
  events.length = 0;
  const first = supervisor.activateProfile("profile-b");
  const second = supervisor.activateProfile("profile-c");
  await Promise.all([first, second]);
  assert.deepEqual(events, ["quiesce:profile-a", "start:profile-b", "quiesce:profile-b", "start:profile-c"]);
  assert.equal(supervisor.status().profileId, "profile-c");
  await supervisor.stop();
});

test("waits for child exit and both loopback ports to release before switching", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-port-release-"));
  let live = false;
  let runtimeId = "";
  let profileId = "profile-a";
  let quiesced = false;
  let delayedPortChecks = 0;
  let releasedBeforeTargetStart = false;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId,
    probeHealth: async () => {
      if (live) return healthFor(profileId, runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {});
      if (delayedPortChecks > 0) {
        delayedPortChecks -= 1;
        return { controlPlane: false, worker: false, controlPlanePortOpen: true, workerPortOpen: true };
      }
      return { controlPlane: false, worker: false, controlPlanePortOpen: false, workerPortOpen: false };
    },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      if (options.env.SIGNALFLOW_PROFILE_ID === "profile-b") releasedBeforeTargetStart = delayedPortChecks === 0;
      live = true;
      profileId = options.env.SIGNALFLOW_PROFILE_ID;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      quiesced = false;
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => { live = false; delayedPortChecks = 2; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1, quiesceTimeoutMs: 100, portReleaseTimeoutMs: 500,
  });
  await supervisor.activateProfile("profile-a");
  await supervisor.activateProfile("profile-b");
  assert.equal(releasedBeforeTargetStart, true);
  await supervisor.stop();
});

test("A to B to A restores only A's profile database and gives every launch a new runtime ID", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-roundtrip-"));
  let live = false;
  let runtimeId = "";
  let profileId = "profile-a";
  let quiesced = false;
  const runtimeIds = [];
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId,
    probeHealth: async () => live ? healthFor(profileId, runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {}) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      live = true;
      profileId = options.env.SIGNALFLOW_PROFILE_ID;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      runtimeIds.push(runtimeId);
      fs.writeFileSync(path.join(path.dirname(options.env.SIGNALFLOW_WORKER_DB), "profile-fixture"), profileId);
      quiesced = false;
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => { live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1, quiesceTimeoutMs: 100, portReleaseTimeoutMs: 100,
  });
  await supervisor.activateProfile("profile-a");
  const firstA = supervisor.status().runtimeId;
  await supervisor.activateProfile("profile-b");
  await supervisor.activateProfile("profile-a");
  assert.equal(fs.readFileSync(path.join(userDataRoot, "profiles", "profile-a", "profile-fixture"), "utf8"), "profile-a");
  assert.equal(fs.readFileSync(path.join(userDataRoot, "profiles", "profile-b", "profile-fixture"), "utf8"), "profile-b");
  assert.notEqual(supervisor.status().runtimeId, firstA);
  assert.equal(new Set(runtimeIds).size, 3);
  await supervisor.stop();
});

test("uses a worker quiesce barrier to reject a publish that starts after the health snapshot", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-quiesce-busy-"));
  let live = false;
  let runtimeId = "";
  let killed = false;
  let quiesceCalls = 0;
  let quiesceRejected = true;
  let quiesced = false;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a",
    probeHealth: async () => live ? healthFor("profile-a", runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {}) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesceCalls += 1; if (quiesceRejected) throw new Error("PROFILE_BUSY"); quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => { runtimeId = options.env.SIGNALFLOW_RUNTIME_ID; quiesced = false; live = true; const child = new EventEmitter(); child.exitCode = null; child.kill = () => { killed = true; live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); }; return child; },
    healthTimeoutMs: 100, healthIntervalMs: 1, quiesceTimeoutMs: 100,
  });
  await supervisor.activateProfile("profile-a");
  await assert.rejects(supervisor.activateProfile("profile-b"), /PROFILE_BUSY/);
  assert.equal(quiesceCalls, 1);
  assert.equal(killed, false);
  assert.equal(supervisor.status().profileId, "profile-a");
  quiesceRejected = false;
  await supervisor.stop();
});

test("quiesces a partial target worker before rollback can terminate its in-flight publish", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-partial-rollback-"));
  let live = false;
  let profileId = "profile-a";
  let runtimeId = "";
  let quiesced = false;
  let targetInFlight = false;
  const events = [];
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId,
    probeHealth: async () => {
      if (!live) return { controlPlane: false, worker: false };
      if (profileId === "profile-b") {
        return {
          controlPlane: false,
          worker: true,
          workerProfileId: profileId,
          workerRuntimeId: runtimeId,
          workerState: quiesced ? "stopped" : "running",
          acceptingJobs: !quiesced,
          safeStopRequested: quiesced,
          inFlightExecutions: targetInFlight && !quiesced ? 1 : 0,
          runningJobs: targetInFlight && !quiesced ? 1 : 0,
          workerPortOpen: true,
          controlPlanePortOpen: false,
        };
      }
      return healthFor(profileId, runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {});
    },
    quiesceWorker: async ({ profileId: requestedProfile }) => {
      events.push(`quiesce:${requestedProfile}`);
      quiesced = true;
      const busy = targetInFlight;
      if (busy) setTimeout(() => { targetInFlight = false; events.push("drained:profile-b"); }, 5);
      return { ok: true, state: busy ? "stopping" : "stopped", inFlightExecutions: busy ? 1 : 0 };
    },
    spawnImpl: (_command, _args, options) => {
      profileId = options.env.SIGNALFLOW_PROFILE_ID;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      live = true;
      quiesced = false;
      if (profileId === "profile-b") targetInFlight = true;
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => {
        events.push(`kill:${profileId}`);
        live = false;
        targetInFlight = false;
        child.exitCode = 0;
        child.emit("exit", 0, "SIGTERM");
      };
      return child;
    },
    healthTimeoutMs: 10, healthIntervalMs: 1, quiesceTimeoutMs: 50, portReleaseTimeoutMs: 50,
  });

  await supervisor.activateProfile("profile-a");
  await assert.rejects(supervisor.activateProfile("profile-b"), /PROFILE_RUNTIME_CONFLICT/);
  assert.ok(events.indexOf("quiesce:profile-b") >= 0);
  assert.ok(events.indexOf("quiesce:profile-b") < events.indexOf("kill:profile-b"));
  assert.ok(events.indexOf("drained:profile-b") < events.indexOf("kill:profile-b"));
  assert.equal(supervisor.status().profileId, "profile-a");
  assert.equal(supervisor.status().ready, true);
  await supervisor.stop();
});

test("shutdown quiesces and drains an in-flight publish before killing the owned runner", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-shutdown-drain-"));
  let live = false;
  let runtimeId = "";
  let inFlight = 1;
  let quiesced = false;
  const events = [];
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", quiesceTimeoutMs: 500, portReleaseTimeoutMs: 100,
    probeHealth: async () => live ? healthFor("profile-a", runtimeId, quiesced ? { workerState: inFlight ? "stopping" : "stopped", acceptingJobs: false, safeStopRequested: true, inFlightExecutions: inFlight, runningJobs: inFlight } : { inFlightExecutions: inFlight, runningJobs: inFlight }) : { controlPlane: false, worker: false },
    quiesceWorker: async () => {
      events.push("quiesce");
      quiesced = true;
      setTimeout(() => { inFlight = 0; events.push("idle"); }, 5);
      return { ok: true, state: "stopping", inFlightExecutions: 1 };
    },
    spawnImpl: (_command, _args, options) => {
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      live = true;
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => { events.push("kill"); live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1,
  });
  await supervisor.activateProfile("profile-a");
  await supervisor.stop();
  assert.deepEqual(events, ["quiesce", "idle", "kill"]);
});

test("shutdown refuses to kill an owned child when worker identity cannot be verified", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-shutdown-unknown-"));
  let live = false;
  let identityValid = true;
  let runtimeId = "";
  let quiesced = false;
  let killed = false;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", quiesceTimeoutMs: 100, portReleaseTimeoutMs: 100,
    probeHealth: async () => {
      if (!live) return { controlPlane: false, worker: false };
      if (!identityValid) return { controlPlane: true, worker: true, controlPlanePortOpen: true, workerPortOpen: true };
      return healthFor("profile-a", runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {});
    },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => { runtimeId = options.env.SIGNALFLOW_RUNTIME_ID; live = true; const child = new EventEmitter(); child.exitCode = null; child.kill = () => { killed = true; live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); }; return child; },
    healthTimeoutMs: 100, healthIntervalMs: 1,
  });
  await supervisor.activateProfile("profile-a");
  identityValid = false;
  await assert.rejects(supervisor.stop(), /PROFILE_RUNTIME_CONFLICT/);
  assert.equal(killed, false);
  identityValid = true;
  await supervisor.stop();
  assert.equal(killed, true);
});

test("retains owned runtime when health probe is rejected until ports are explicitly closed", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-rejected-health-ownership-"));
  let phase = 0;
  let runtimeId = "";
  let child;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-a",
    probeHealth: async () => {
      if (phase < 2) {
        phase += 1;
        return { controlPlane: false, worker: false, controlPlanePortOpen: false, workerPortOpen: false };
      }
      if (phase === 2) {
        phase += 1;
        return healthFor("profile-a", runtimeId);
      }
      if (phase === 3) throw new Error("HEALTH_UNAVAILABLE");
      return { controlPlane: false, worker: false, controlPlanePortOpen: false, workerPortOpen: false };
    },
    spawnImpl: (_command, _args, options) => {
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      return child;
    },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    healthTimeoutMs: 100,
    portReleaseTimeoutMs: 100,
  });

  const started = await supervisor.start();
  assert.equal(started.state, "ready");
  assert.equal(started.ownsRuntime, true);
  child.exitCode = 0;
  child.emit("exit", 0, "SIGTERM");
  assert.equal(supervisor.status().ownsRuntime, true);

  await assert.rejects(supervisor.stop(), /PROFILE_RUNTIME_CONFLICT/);
  assert.equal(supervisor.status().ownsRuntime, true);

  phase = 4;
  const stopped = await supervisor.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.ownsRuntime, false);
});

function createQuitStub() {
  const app = new EventEmitter();
  let quitCalls = 0;
  const beforeQuitEvents = [];
  const emitBeforeQuit = () => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    beforeQuitEvents.push(event);
    app.emit("before-quit", event);
    return event;
  };
  app.quit = () => {
    quitCalls += 1;
    return emitBeforeQuit();
  };
  return { app, emitBeforeQuit, beforeQuitEvents, get quitCalls() { return quitCalls; } };
}

const flushQuit = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

test("Electron termination signals execute the graceful bridge and do not recurse while stop is pending", async () => {
  const quit = createQuitStub();
  const signals = new EventEmitter();
  const dialog = { calls: [], showErrorBox(...args) { this.calls.push(args); } };
  let resolveStop;
  let stopCalls = 0;
  const supervisor = { stop: () => { stopCalls += 1; return new Promise((resolve) => { resolveStop = resolve; }); } };
  installGracefulQuitHandlers({ app: quit.app, dialog, signalEmitter: signals, getWorkerSupervisor: () => supervisor });

  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  assert.equal(quit.quitCalls, 1);
  assert.equal(stopCalls, 1);
  assert.equal(dialog.calls.length, 0);
  resolveStop();
  await flushQuit();
  assert.equal(quit.quitCalls, 2);
  assert.equal(stopCalls, 1);
});

test("prevents a second before-quit during pending stop and allows only the deferred quit", async () => {
  const quit = createQuitStub();
  const signals = new EventEmitter();
  const dialog = { calls: [], showErrorBox(...args) { this.calls.push(args); } };
  let resolveStop;
  let stopCalls = 0;
  const supervisor = { stop: () => { stopCalls += 1; return new Promise((resolve) => { resolveStop = resolve; }); } };
  installGracefulQuitHandlers({ app: quit.app, dialog, signalEmitter: signals, getWorkerSupervisor: () => supervisor });

  signals.emit("SIGTERM");
  const secondBeforeQuit = quit.emitBeforeQuit();
  assert.deepEqual(quit.beforeQuitEvents.map((event) => event.defaultPrevented), [true, true]);
  assert.equal(secondBeforeQuit.defaultPrevented, true);
  assert.equal(stopCalls, 1);

  resolveStop();
  await flushQuit();
  assert.deepEqual(quit.beforeQuitEvents.map((event) => event.defaultPrevented), [true, true, false]);
  assert.equal(quit.quitCalls, 2);
  assert.equal(stopCalls, 1);
  assert.equal(dialog.calls.length, 0);
});

test("Electron termination bridge resets its guard after stop rejection and preserves the error dialog", async () => {
  const quit = createQuitStub();
  const signals = new EventEmitter();
  const dialog = { calls: [], showErrorBox(...args) { this.calls.push(args); } };
  let stopCalls = 0;
  const supervisor = { stop: () => { stopCalls += 1; return Promise.reject(new Error("PROFILE_RUNTIME_CONFLICT")); } };
  installGracefulQuitHandlers({ app: quit.app, dialog, signalEmitter: signals, getWorkerSupervisor: () => supervisor });

  signals.emit("SIGTERM");
  await flushQuit();
  assert.equal(quit.quitCalls, 1);
  assert.deepEqual(quit.beforeQuitEvents.map((event) => event.defaultPrevented), [true]);
  assert.equal(stopCalls, 1);
  assert.equal(dialog.calls.length, 1);
  assert.equal(dialog.calls[0][0], "SignalFlow chưa thể đóng an toàn");
  signals.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quit.quitCalls, 2);
  assert.deepEqual(quit.beforeQuitEvents.map((event) => event.defaultPrevented), [true, true]);
  assert.equal(stopCalls, 2);
  assert.equal(dialog.calls.length, 2);
});

test("Electron termination bridge preserves adopted no-kill and direct-stop restartability", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-adopted-quit-"));
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => healthFor("profile-a", "runtime-adopted"),
    spawnImpl: () => { throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
  });
  const started = await supervisor.start();
  assert.equal(started.ownsRuntime, false);
  const directStopped = await supervisor.stop();
  assert.equal(directStopped.state, "stopped");
  const directRestart = await supervisor.start();
  assert.equal(directRestart.state, "ready");
  assert.equal(directRestart.ownsRuntime, false);
  const quit = createQuitStub();
  const signals = new EventEmitter();
  installGracefulQuitHandlers({ app: quit.app, dialog: { showErrorBox() {} }, signalEmitter: signals, getWorkerSupervisor: () => supervisor });
  signals.emit("SIGTERM");
  await flushQuit();
  assert.equal(quit.quitCalls, 2);
  assert.equal(supervisor.status().ownsRuntime, false);
  await assert.rejects(supervisor.start(), /PROFILE_RUNTIME_STOPPING/);
  await supervisor.stop();
});

test("keeps the shutdown fence through deferred adopted-runtime quit", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-adopted-quit-fence-"));
  let runtimeLive = true;
  let spawnCount = 0;
  let deferredQuit;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => runtimeLive ? healthFor("profile-a", "runtime-adopted") : { controlPlane: false, worker: false },
    spawnImpl: () => { spawnCount += 1; throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
  });
  const started = await supervisor.start();
  assert.equal(started.ownsRuntime, false);

  const quit = createQuitStub();
  const signals = new EventEmitter();
  installGracefulQuitHandlers({
    app: quit.app,
    dialog: { showErrorBox() {} },
    signalEmitter: signals,
    getWorkerSupervisor: () => supervisor,
    scheduleQuit: (callback) => { deferredQuit = callback; },
  });
  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quit.quitCalls, 1);
  assert.equal(typeof deferredQuit, "function");

  runtimeLive = false;
  await assert.rejects(supervisor.start(), /PROFILE_RUNTIME_STOPPING/);
  assert.equal(spawnCount, 0);
  deferredQuit();
  assert.equal(quit.quitCalls, 2);
  await supervisor.stop();
});

test("rejects normal IPC work after first quit while graceful stop is pending", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-ipc-quit-fence-"));
  let intervalCallback;
  let monitorStarted;
  let releaseMonitor;
  const monitorStartedPromise = new Promise((resolve) => { monitorStarted = resolve; });
  const monitorReleasePromise = new Promise((resolve) => { releaseMonitor = resolve; });
  let probeCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 2) {
        monitorStarted();
        await monitorReleasePromise;
      }
      return healthFor("profile-a", "runtime-adopted");
    },
    spawnImpl: () => { throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
    setIntervalImpl: (callback) => { intervalCallback = callback; return 1; },
    clearIntervalImpl: () => { intervalCallback = null; },
  });
  await supervisor.start();
  intervalCallback();
  await monitorStartedPromise;

  const quit = createQuitStub();
  const signals = new EventEmitter();
  let deferredQuit;
  installGracefulQuitHandlers({
    app: quit.app,
    dialog: { showErrorBox() {} },
    signalEmitter: signals,
    getWorkerSupervisor: () => supervisor,
    scheduleQuit: (callback) => { deferredQuit = callback; },
  });
  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));

  const pendingStatus = supervisor.status();
  assert.equal(pendingStatus.stopping, true);
  assert.equal(pendingStatus.shutdownRequested, true);
  assert.throws(() => assertRuntimeOperationAllowed(pendingStatus, "profile-a"), /PROFILE_RUNTIME_STOPPING/);

  releaseMonitor();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof deferredQuit, "function");
  deferredQuit();
  await supervisor.stop();
});

test("exits an adopted runtime after UI readiness without killing the external worker", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-adopted-ui-ready-"));
  let externalRuntimeAlive = true;
  let uiReady = false;
  let spawnCount = 0;
  let killCount = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-ui", runtimeId: "runtime-ui-external",
    probeHealth: async () => externalRuntimeAlive ? healthFor("profile-ui", "runtime-ui-external") : { controlPlane: false, worker: false },
    spawnImpl: () => { spawnCount += 1; throw new Error("ADOPTED_UI_RUNTIME_MUST_NOT_SPAWN"); },
    quiesceWorker: async () => { killCount += 1; throw new Error("ADOPTED_UI_RUNTIME_MUST_NOT_QUIESCE"); },
  });
  const activation = await supervisor.activateProfile("profile-ui");
  uiReady = activation.state === "ready";
  assert.equal(uiReady, true);

  const quit = createQuitStub();
  const signals = new EventEmitter();
  installGracefulQuitHandlers({ app: quit.app, dialog: { showErrorBox() {} }, signalEmitter: signals, getWorkerSupervisor: () => supervisor });
  signals.emit("SIGTERM");
  await flushQuit();

  assert.equal(quit.quitCalls, 2);
  assert.equal(externalRuntimeAlive, true);
  assert.equal(spawnCount, 0);
  assert.equal(killCount, 0);
  await supervisor.stop();
});

test("does not let an in-flight monitor resurrect readiness after direct stop", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-monitor-stop-race-"));
  let intervalCallback;
  let monitorStarted;
  let releaseMonitor;
  let monitorFinished;
  const monitorStartedPromise = new Promise((resolve) => { monitorStarted = resolve; });
  const monitorReleasePromise = new Promise((resolve) => { releaseMonitor = resolve; });
  const monitorFinishedPromise = new Promise((resolve) => { monitorFinished = resolve; });
  let probeCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 2) {
        monitorStarted();
        await monitorReleasePromise;
        monitorFinished();
      }
      return healthFor("profile-a", "runtime-adopted");
    },
    spawnImpl: () => { throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
    setIntervalImpl: (callback) => { intervalCallback = callback; return 1; },
    clearIntervalImpl: () => { intervalCallback = null; },
  });
  await supervisor.start();
  intervalCallback();
  await monitorStartedPromise;
  const queuedMonitorCallback = intervalCallback;

  let stopSettled = false;
  const shutdown = supervisor.stop().then((result) => { stopSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false);
  releaseMonitor();
  const stopped = await shutdown;
  await monitorFinishedPromise;
  queuedMonitorCallback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped.state, "stopped");
  assert.equal(supervisor.status().state, "stopped");
  assert.equal(supervisor.status().ready, false);
});

test("does not recreate a health timer when direct stop overlaps start completion", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-start-stop-timer-race-"));
  let initialHealthStarted;
  let releaseInitialHealth;
  const initialHealth = new Promise((resolve) => { initialHealthStarted = resolve; });
  const initialHealthRelease = new Promise((resolve) => { releaseInitialHealth = resolve; });
  const intervalCallbacks = [];
  let clearCalls = 0;
  let probeCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 1) {
        initialHealthStarted();
        await initialHealthRelease;
      }
      return healthFor("profile-a", "runtime-adopted");
    },
    spawnImpl: () => { throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
    setIntervalImpl: (callback) => { intervalCallbacks.push(callback); return intervalCallbacks.length; },
    clearIntervalImpl: () => { clearCalls += 1; },
  });

  const starting = supervisor.start();
  await initialHealth;
  const shutdown = supervisor.stop();
  releaseInitialHealth();
  await new Promise((resolve) => setImmediate(resolve));

  const retainedCallbacks = intervalCallbacks.slice();
  retainedCallbacks.forEach((callback) => callback());
  await Promise.all([starting, shutdown]);
  retainedCallbacks.forEach((callback) => callback());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(clearCalls, 0);
  assert.equal(intervalCallbacks.length, 0);
  assert.equal(supervisor.status().state, "stopped");
  assert.equal(supervisor.status().ready, false);
});

test("does not let an in-flight monitor reopen readiness during preserved quit", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-monitor-quit-race-"));
  let intervalCallback;
  let monitorStarted;
  let releaseMonitor;
  let monitorFinished;
  const monitorStartedPromise = new Promise((resolve) => { monitorStarted = resolve; });
  const monitorReleasePromise = new Promise((resolve) => { releaseMonitor = resolve; });
  const monitorFinishedPromise = new Promise((resolve) => { monitorFinished = resolve; });
  let probeCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 2) {
        monitorStarted();
        await monitorReleasePromise;
        monitorFinished();
      }
      return healthFor("profile-a", "runtime-adopted");
    },
    spawnImpl: () => { throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
    setIntervalImpl: (callback) => { intervalCallback = callback; return 1; },
    clearIntervalImpl: () => { intervalCallback = null; },
  });
  await supervisor.start();
  intervalCallback();
  await monitorStartedPromise;

  const quit = createQuitStub();
  const signals = new EventEmitter();
  let deferredQuit;
  installGracefulQuitHandlers({
    app: quit.app,
    dialog: { showErrorBox() {} },
    signalEmitter: signals,
    getWorkerSupervisor: () => supervisor,
    scheduleQuit: (callback) => { deferredQuit = callback; },
  });
  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quit.quitCalls, 1);
  assert.equal(deferredQuit, undefined);

  releaseMonitor();
  await monitorFinishedPromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.status().state, "stopped");
  assert.equal(supervisor.status().ready, false);
  assert.equal(typeof deferredQuit, "function");
  deferredQuit();
  assert.equal(quit.quitCalls, 2);
  await supervisor.stop();
});

test("ignores a stale monitor response after A-to-B activation", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-monitor-profile-race-"));
  let intervalCallback;
  let monitorStarted;
  let releaseMonitor;
  let monitorFinished;
  const monitorStartedPromise = new Promise((resolve) => { monitorStarted = resolve; });
  const monitorReleasePromise = new Promise((resolve) => { releaseMonitor = resolve; });
  const monitorFinishedPromise = new Promise((resolve) => { monitorFinished = resolve; });
  let probeCalls = 0;
  const noPorts = { controlPlanePortOpen: false, workerPortOpen: false };
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-a",
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 3) {
        monitorStarted();
        await monitorReleasePromise;
        monitorFinished();
        return healthFor("profile-a", "runtime-a", noPorts);
      }
      if (probeCalls === 4) return healthFor("profile-a", "runtime-a", noPorts);
      if (probeCalls <= 2) return healthFor("profile-a", "runtime-a", noPorts);
      return healthFor("profile-b", "runtime-b", noPorts);
    },
    spawnImpl: () => { throw new Error("EXTERNAL_RUNTIME_MUST_NOT_SPAWN"); },
    setIntervalImpl: (callback) => { intervalCallback = callback; return 1; },
    clearIntervalImpl: () => { intervalCallback = null; },
  });
  await supervisor.start();
  intervalCallback();
  await monitorStartedPromise;
  const activation = supervisor.activateProfile("profile-b");
  const activated = await activation;
  assert.equal(activated.profileId, "profile-b");
  assert.equal(activated.runtimeId, "runtime-b");
  assert.equal(activated.state, "ready");

  releaseMonitor();
  await monitorFinishedPromise;
  await new Promise((resolve) => setImmediate(resolve));
  const finalStatus = supervisor.status();
  assert.equal(finalStatus.profileId, "profile-b");
  assert.equal(finalStatus.runtimeId, "runtime-b");
  assert.equal(finalStatus.state, "ready");
  assert.equal(finalStatus.lastError, undefined);
  await supervisor.stop();
});

test("adopted runtime completes SIGTERM quit while same-profile activation is pending", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-adopted-pending-quit-"));
  let probeCalls = 0;
  let activationProbeStarted;
  let releaseActivationProbe;
  const activationProbe = new Promise((resolve) => { activationProbeStarted = resolve; });
  const activationProbeRelease = new Promise((resolve) => { releaseActivationProbe = resolve; });
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", runtimeId: "runtime-adopted",
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 2) { activationProbeStarted(); await activationProbeRelease; }
      return healthFor("profile-a", "runtime-adopted");
    },
    spawnImpl: () => { throw new Error("ADOPTED_RUNTIME_MUST_NOT_SPAWN"); },
  });
  await supervisor.start();
  const activation = supervisor.activateProfile("profile-a");
  await activationProbe;
  const quit = createQuitStub();
  const signals = new EventEmitter();
  installGracefulQuitHandlers({ app: quit.app, dialog: { showErrorBox() {} }, signalEmitter: signals, getWorkerSupervisor: () => supervisor });
  signals.emit("SIGTERM");
  assert.equal(quit.quitCalls, 1);
  releaseActivationProbe();
  const activationResult = await activation;
  assert.equal(activationResult.state, "ready");
  await flushQuit();
  assert.equal(quit.quitCalls, 2);
  assert.equal(supervisor.status().ownsRuntime, false);
  await supervisor.stop();
});

test("owned runtime keeps its ownership barrier after the launcher exits while services remain", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-owned-exited-services-"));
  let servicesLive = true;
  let runtimeStarted = false;
  let quiesced = false;
  let runtimeId = "";
  let quiesceCalls = 0;
  let child;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", portReleaseTimeoutMs: 10, quiesceTimeoutMs: 100,
    probeHealth: async () => runtimeStarted && servicesLive ? healthFor("profile-a", runtimeId, quiesced
      ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true, controlPlanePortOpen: true, workerPortOpen: true }
      : { controlPlanePortOpen: true, workerPortOpen: true }) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesceCalls += 1; quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      runtimeStarted = true;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1,
  });
  await supervisor.start();
  child.exitCode = 1;
  child.emit("exit", 1, "SIGTERM");
  await assert.rejects(supervisor.stop(), /PROFILE_RUNTIME_CONFLICT/);
  assert.equal(quiesceCalls, 1);
  assert.equal(supervisor.status().ownsRuntime, true);
  servicesLive = false;
});

test("retains ownership when selection persistence fails after launcher exit", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-retained-persist-failure-"));
  let servicesLive = false;
  let quiesced = false;
  let runtimeId = "";
  let child;
  let persistCalls = 0;
  let quiesceCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", healthTimeoutMs: 100, healthIntervalMs: 60_000,
    quiesceTimeoutMs: 100, portReleaseTimeoutMs: 10,
    persistActiveProfile: () => {
      persistCalls += 1;
      if (persistCalls > 1) throw new Error("selection persistence unavailable");
    },
    probeHealth: async () => servicesLive ? healthFor("profile-a", runtimeId, quiesced
      ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true, controlPlanePortOpen: true, workerPortOpen: true }
      : { controlPlanePortOpen: true, workerPortOpen: true }) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesceCalls += 1; quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      servicesLive = true;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      quiesced = false;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => { servicesLive = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
  });

  await supervisor.start();
  child.exitCode = 1;
  child.emit("exit", 1, "SIGTERM");
  const degraded = await supervisor.start();
  assert.equal(degraded.lastError, "PROFILE_SELECTION_PERSIST_FAILED");
  assert.equal(degraded.ownsRuntime, true);
  await assert.rejects(supervisor.stop(), /PROFILE_RUNTIME_CONFLICT/);
  assert.equal(quiesceCalls, 1);

  servicesLive = false;
  const stopped = await supervisor.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.ownsRuntime, false);
});

test("does not transfer retained ownership to another profile's adopted runtime", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-retained-lineage-switch-"));
  let runtimeLive = false;
  let currentProfile = "profile-a";
  let runtimeId = "";
  let child;
  let spawnCount = 0;
  let quiesceCalls = 0;
  let deadRuntimeProbeCount = 0;
  let startedOnce = false;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", healthTimeoutMs: 100, healthIntervalMs: 60_000,
    probeHealth: async () => {
      if (!runtimeLive) {
        if (!startedOnce || deadRuntimeProbeCount < 2) {
          if (startedOnce) deadRuntimeProbeCount += 1;
          return { controlPlane: false, worker: false };
        }
        return healthFor("profile-b", "external-profile-b");
      }
      return runtimeLive ? healthFor("profile-a", runtimeId) : { controlPlane: false, worker: false };
    },
    quiesceWorker: async () => { quiesceCalls += 1; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      spawnCount += 1;
      startedOnce = true;
      currentProfile = options.env.SIGNALFLOW_PROFILE_ID;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      runtimeLive = true;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => { runtimeLive = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
  });

  await supervisor.start();
  runtimeLive = false;
  child.exitCode = 1;
  child.emit("exit", 1, "SIGTERM");
  const switched = await supervisor.activateProfile("profile-b");

  assert.equal(switched.state, "ready");
  assert.equal(switched.profileId, "profile-b");
  assert.equal(switched.runtimeId, "external-profile-b");
  assert.equal(switched.ownsRuntime, false);
  assert.equal(spawnCount, 1);
  assert.equal(quiesceCalls, 0);
  await supervisor.stop();
});

test("retries a failed owned stop after retained service ports release", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-stop-retry-release-"));
  let servicesLive = false;
  let quiesced = false;
  let runtimeId = "";
  let child;
  let spawnCount = 0;
  let quiesceCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", healthTimeoutMs: 100, healthIntervalMs: 60_000,
    quiesceTimeoutMs: 100, portReleaseTimeoutMs: 10,
    probeHealth: async () => servicesLive
      ? healthFor("profile-a", runtimeId, quiesced
        ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true, controlPlanePortOpen: true, workerPortOpen: true }
        : { controlPlanePortOpen: true, workerPortOpen: true })
      : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesceCalls += 1; quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      spawnCount += 1;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      servicesLive = true;
      quiesced = false;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => { servicesLive = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
  });

  await supervisor.start();
  child.exitCode = 1;
  child.emit("exit", 1, "SIGTERM");
  await assert.rejects(supervisor.stop(), /PROFILE_RUNTIME_CONFLICT/);
  assert.equal(supervisor.status().ownsRuntime, true);

  servicesLive = false;
  const stopped = await supervisor.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.ownsRuntime, false);
  assert.equal(quiesceCalls, 1);

  const restarted = await supervisor.start();
  assert.equal(restarted.state, "ready");
  assert.equal(restarted.ownsRuntime, true);
  assert.equal(spawnCount, 2);
  await supervisor.stop();
});

test("Electron termination signals are wired to the graceful bridge source", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /installGracefulQuitHandlers\(\{ app, dialog, signalEmitter: process, getWorkerSupervisor: \(\) => workerSupervisor \}\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "worker-supervisor.cjs"), "utf8"), /signalEmitter\.on\("SIGINT", requestGracefulQuit\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "worker-supervisor.cjs"), "utf8"), /signalEmitter\.on\("SIGTERM", requestGracefulQuit\);/);
});

test("shutdown waits for in-flight startup before resolving and leaves no child after a concurrent stop", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-shutdown-race-"));
  let live = false;
  let quiesced = false;
  let runtimeId = "";
  let spawnCount = 0;
  let killCount = 0;
  let initialRecoveryProbe;
  let releaseRecoveryProbe;
  const recoveryProbeStarted = new Promise((resolve) => { initialRecoveryProbe = resolve; });
  const recoveryProbeRelease = new Promise((resolve) => { releaseRecoveryProbe = resolve; });
  let probeCalls = 0;
  let child;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", quiesceTimeoutMs: 100, portReleaseTimeoutMs: 100,
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 2) { initialRecoveryProbe(); await recoveryProbeRelease; }
      if (!live) return { controlPlane: false, worker: false };
      return healthFor("profile-a", runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {});
    },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => {
      spawnCount += 1;
      live = true;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => { killCount += 1; child.killed = true; live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1, restartBaseMs: 0, restartMaxMs: 0,
  });
  const activation = supervisor.activateProfile("profile-a");
  await recoveryProbeStarted;
  let stopSettled = false;
  const shutdown = supervisor.stop().then((result) => { stopSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false);
  releaseRecoveryProbe();
  const [stopped] = await Promise.all([shutdown, activation.catch(() => undefined)]);
  assert.equal(stopped.state, "stopped");
  assert.equal(spawnCount, 0);
  assert.equal(killCount, 0);
  assert.equal(live, false);
  assert.equal(child, undefined);
});

test("shutdown neutralizes profile activation before its switching barrier is entered", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-activation-shutdown-race-"));
  let releaseInitialHealth;
  let initialHealthStarted;
  const initialHealth = new Promise((resolve) => { initialHealthStarted = resolve; });
  const initialHealthRelease = new Promise((resolve) => { releaseInitialHealth = resolve; });
  let live = false;
  let spawnCount = 0;
  let killCount = 0;
  let runtimeId = "";
  let child;
  let probeCalls = 0;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot, profileId: "profile-a", quiesceTimeoutMs: 100, portReleaseTimeoutMs: 100,
    probeHealth: async () => {
      probeCalls += 1;
      if (probeCalls === 1) { initialHealthStarted(); await initialHealthRelease; }
      if (!live) return { controlPlane: false, worker: false };
      return healthFor("profile-a", runtimeId);
    },
    spawnImpl: (_command, _args, options) => {
      spawnCount += 1;
      live = true;
      runtimeId = options.env.SIGNALFLOW_RUNTIME_ID;
      child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => { killCount += 1; child.killed = true; live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); };
      return child;
    },
    healthTimeoutMs: 100, healthIntervalMs: 1, restartBaseMs: 0, restartMaxMs: 0,
  });
  const activation = supervisor.activateProfile("profile-b");
  await initialHealth;
  let stopSettled = false;
  const shutdown = supervisor.stop().then((result) => { stopSettled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false);
  releaseInitialHealth();
  const [stopped, activationError] = await Promise.all([
    shutdown,
    activation.then(() => null, (error) => error),
  ]);
  assert.equal(stopped.state, "stopped");
  assert.equal(activationError?.message, "PROFILE_RUNTIME_STOPPING");
  assert.equal(spawnCount, 0);
  assert.equal(killCount, 0);
  assert.equal(live, false);
  assert.equal(child, undefined);
});

test("switches an owned runtime to a new profile database", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-profile-switch-"));
  const canonicalUserDataRoot = fs.realpathSync(userDataRoot);
  let live = false;
  let quiesced = false;
  let runtimeId = "";
  let currentProfile = "profile-a";
  const children = [];
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo",
    userDataRoot,
    profileId: currentProfile,
    probeHealth: async () => live ? healthFor(currentProfile, runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : {}) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => { live = true; currentProfile = options.env.SIGNALFLOW_PROFILE_ID; runtimeId = options.env.SIGNALFLOW_RUNTIME_ID; quiesced = false; const child = new EventEmitter(); child.exitCode = null; child.kill = () => { live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); }; children.push(child); return child; },
    healthTimeoutMs: 100,
    healthIntervalMs: 1,
    restartBaseMs: 0,
    restartMaxMs: 0,
  });
  await supervisor.start();
  const switched = await supervisor.activateProfile("profile-b");
  assert.equal(switched.profileId, "profile-b");
  assert.match(switched.runtimeId, /^signalflow-profile-b-/);
  assert.equal(switched.runtimeId, children[1] ? supervisor.spec.env.SIGNALFLOW_RUNTIME_ID : "");
  assert.equal(supervisor.spec.env.SIGNALFLOW_WORKER_DB, path.join(canonicalUserDataRoot, "profiles", "profile-b", "signalflow-worker.sqlite3"));
  assert.equal(children.length, 2);
  await supervisor.stop();
});

test("refuses a profile switch when publication is in flight", async () => {
  let killed = false;
  let live = false;
  let runtimeId = "";
  let inFlight = 1;
  let quiesced = false;
  const supervisor = createWorkerSupervisor({
    sourceRoot: "/repo", userDataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-busy-")), profileId: "profile-a",
    probeHealth: async () => live ? healthFor("profile-a", runtimeId, quiesced ? { workerState: "stopped", acceptingJobs: false, safeStopRequested: true } : { inFlightExecutions: inFlight }) : { controlPlane: false, worker: false },
    quiesceWorker: async () => { quiesced = true; return { ok: true, state: "stopped", inFlightExecutions: 0 }; },
    spawnImpl: (_command, _args, options) => { runtimeId = options.env.SIGNALFLOW_RUNTIME_ID; live = true; const child = new EventEmitter(); child.exitCode = null; child.kill = () => { killed = true; live = false; child.exitCode = 0; child.emit("exit", 0, "SIGTERM"); }; return child; },
    healthIntervalMs: 1,
  });
  await supervisor.start();
  await assert.rejects(supervisor.activateProfile("profile-b"), /PROFILE_BUSY/);
  assert.equal(killed, false);
  assert.equal(supervisor.status().profileId, "profile-a");
  inFlight = 0;
  await supervisor.stop();
});
