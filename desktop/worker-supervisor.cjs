const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const { providerDebugPort } = require("./chrome-browser.cjs");

const CONTROL_PLANE_PORT = 18_787;
const WORKER_PORT = 18_788;
const DEFAULT_LEGACY_CONTROL_PLANE_PORT = 8_787;
const HEALTH_TIMEOUT_MS = 1_500;
const START_TIMEOUT_MS = 20_000;
const HEALTH_INTERVAL_MS = 5_000;
const RESTART_BASE_MS = 1_000;
const RESTART_MAX_MS = 30_000;

function configuredPort(raw, fallback, name) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) throw new Error(`${name}_INVALID`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port <= 0 || port >= 65_536) throw new Error(`${name}_INVALID`);
  return port;
}

function configuredRuntimePorts(env = process.env) {
  const controlPlanePort = configuredPort(env?.SIGNALFLOW_CONTROL_PLANE_PORT, CONTROL_PLANE_PORT, "SIGNALFLOW_CONTROL_PLANE_PORT");
  const workerPort = configuredPort(env?.SIGNALFLOW_WORKER_PORT, WORKER_PORT, "SIGNALFLOW_WORKER_PORT");
  if (controlPlanePort === workerPort) throw new Error("SIGNALFLOW_PORTS_CONFLICT");
  return { controlPlanePort, workerPort };
}

function safeProfileId(profileId) {
  if (profileId === undefined || profileId === "") return "";
  if (typeof profileId !== "string" || profileId !== profileId.trim() || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  return profileId;
}

function resolveDeveloperUserDataRoot(value, { isPackaged = false } = {}) {
  if (value === undefined || value === null || value === "") return "";
  if (isPackaged) throw new Error("SIGNALFLOW_DEV_USER_DATA_ROOT_PACKAGED");
  if (typeof value !== "string" || value !== value.trim()) throw new Error("SIGNALFLOW_DEV_USER_DATA_ROOT_INVALID");
  if (!path.isAbsolute(value)) throw new Error("SIGNALFLOW_DEV_USER_DATA_ROOT_ABSOLUTE");
  const root = path.resolve(value);
  if (root === path.parse(root).root) throw new Error("SIGNALFLOW_DEV_USER_DATA_ROOT_INVALID");
  return root;
}

function safeRuntimeId(runtimeId) {
  const safe = String(runtimeId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(safe)) throw new Error("PROFILE_RUNTIME_ID_INVALID");
  return safe;
}

function readActiveProfileSelection(userDataRoot) {
  const selectionPath = path.join(path.resolve(userDataRoot), "active-profile.json");
  if (!fs.existsSync(selectionPath)) return null;
  try {
    const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
    const profileId = safeProfileId(selection?.profileId);
    if (!profileId) throw new Error();
    return { profileId, runtimeId: safeRuntimeId(selection?.runtimeId) };
  } catch {
    throw new Error("PROFILE_SELECTION_INVALID");
  }
}

function writeActiveProfileSelection(userDataRoot, selection) {
  const root = path.resolve(userDataRoot);
  const profileId = safeProfileId(selection?.profileId);
  if (!profileId) throw new Error("PROFILE_ID_INVALID");
  const runtimeId = safeRuntimeId(selection?.runtimeId);
  const selectionPath = path.join(root, "active-profile.json");
  const temporaryPath = `${selectionPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ profileId, runtimeId, updatedAt: new Date().toISOString() }));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, selectionPath);
    try {
      const directory = fs.openSync(root, "r");
      fs.fsyncSync(directory);
      fs.closeSync(directory);
    } catch { /* rename remains atomic if directory sync is unsupported */ }
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw new Error("PROFILE_SELECTION_PERSIST_FAILED");
  }
  return { profileId, runtimeId };
}

function assertCanonicalDirectory(directory) {
  let stats;
  try { stats = fs.lstatSync(directory); }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  if (stats.isSymbolicLink() || !stats.isDirectory() || path.resolve(fs.realpathSync(directory)) !== path.resolve(directory)) throw new Error("PROFILE_PATH_ALIAS");
  return true;
}

function profileDataRoot(userDataRoot, profileId, { create = false } = {}) {
  const safe = safeProfileId(profileId);
  const requestedRoot = path.resolve(userDataRoot || path.join(process.cwd(), ".signalflow-data"));
  if (create && !fs.existsSync(requestedRoot)) fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  let root = requestedRoot;
  try { root = path.resolve(fs.realpathSync(requestedRoot)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (!safe) return root;
  const profilesRoot = path.join(root, "profiles");
  if (create && !fs.existsSync(profilesRoot)) fs.mkdirSync(profilesRoot, { recursive: true, mode: 0o700 });
  if (assertCanonicalDirectory(profilesRoot) === false) {
    if (!create) return path.join(profilesRoot, safe);
    throw new Error("PROFILE_PATH_ALIAS");
  }
  const profileRoot = path.join(profilesRoot, safe);
  if (create && !fs.existsSync(profileRoot)) fs.mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
  if (assertCanonicalDirectory(profileRoot) === false) {
    if (!create) return profileRoot;
    throw new Error("PROFILE_PATH_ALIAS");
  }
  return profileRoot;
}

function databasePath(userDataRoot, name, profileId) {
  const safe = safeProfileId(profileId);
  const targetRoot = profileDataRoot(userDataRoot, safe);
  return path.join(targetRoot, name);
}

function legacyWriterPorts(env = process.env) {
  const { controlPlanePort, workerPort } = configuredRuntimePorts(env);
  const ports = new Set([CONTROL_PLANE_PORT, WORKER_PORT, DEFAULT_LEGACY_CONTROL_PLANE_PORT, controlPlanePort, workerPort]);
  for (const name of ["PORT", "SIGNALFLOW_LEGACY_CONTROL_PLANE_PORT", "SIGNALFLOW_WORKER_PORT"]) {
    const raw = env?.[name];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const port = Number(raw);
    if (!Number.isInteger(port) || port <= 0 || port >= 65_536) throw new Error("PROFILE_LEGACY_WRITER_PORT_INVALID");
    ports.add(port);
  }
  return [...ports].sort((left, right) => left - right);
}

const PROFILE_DATABASES = ["signalflow-control-plane.sqlite3", "signalflow-worker.sqlite3"];
const PROFILE_DATABASE_SIDECARS = ["", "-wal", "-shm"];
const PROFILE_BROWSER_PROVIDERS = ["gemini", "chatgpt", "drive", "flow", "meta"];

function migrationMarkerPath(profileRoot) {
  return path.join(profileRoot, "profile-migration-v2.json");
}

function explicitLegacyRoots({ userDataRoot, legacyDataRoot, legacyDataRoots } = {}) {
  const candidates = [userDataRoot, ...(Array.isArray(legacyDataRoots) ? legacyDataRoots : []), legacyDataRoot];
  const roots = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    roots.add(path.resolve(candidate));
  }
  return [...roots];
}

function legacyArtifactsAt(root) {
  return PROFILE_DATABASES.some((name) => PROFILE_DATABASE_SIDECARS.some((suffix) => fs.existsSync(path.join(root, `${name}${suffix}`))))
    || legacyBrowserProfileProviders(root).length > 0;
}

function legacyBrowserProfileProviders(root) {
  const accountsRoot = path.join(root, "account-profiles");
  let accountsStats;
  try { accountsStats = fs.lstatSync(accountsRoot); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  if (accountsStats.isSymbolicLink() || !accountsStats.isDirectory()) throw new Error("PROFILE_BROWSER_SOURCE_INVALID");
  const providers = [];
  for (const provider of PROFILE_BROWSER_PROVIDERS) {
    const directory = path.join(root, "account-profiles", provider);
    let stats;
    try { stats = fs.lstatSync(directory); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("PROFILE_BROWSER_SOURCE_INVALID");
    providers.push(provider);
  }
  return providers;
}

function processHasExactProfileArg(commandLine, profileDirectory) {
  const expected = `--user-data-dir=${path.resolve(profileDirectory)}`;
  let offset = -1;
  while ((offset = commandLine.indexOf(expected, offset + 1)) >= 0) {
    const after = commandLine[offset + expected.length];
    if (after === undefined || /[\s"']/.test(after)) return true;
  }
  return false;
}

function listBrowserProcesses() {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|chromium|msedge' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"], { encoding: "utf8", timeout: 5_000 });
      return String(output).split(/\r?\n/).map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.*)$/);
        return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
      }).filter(Boolean);
    }
    const output = execFileSync("ps", ["-ww", "-A", "-o", "pid=,command="], { encoding: "utf8", timeout: 5_000 });
    return String(output).split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
    }).filter(Boolean);
  } catch {
    throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
  }
}

function listLegacyProcessMetadata() {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"], { encoding: "utf8", timeout: 5_000 });
      return String(output).split(/\r?\n/).map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.*)$/);
        return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
      }).filter(Boolean);
    }
    const output = execFileSync("ps", ["-ww", "-A", "-o", "pid=,command="], { encoding: "utf8", timeout: 5_000 });
    return String(output).split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
    }).filter(Boolean);
  } catch {
    throw new Error("PROFILE_LEGACY_WRITER_UNVERIFIABLE");
  }
}

function isKnownLegacyWriterCommand(commandLine) {
  if (typeof commandLine !== "string") return false;
  return /(?:^|[\\/\s"'])(?:automation_worker_service|control_plane_service)\.py(?=$|[\s"'])/i.test(commandLine)
    || /(?:^|[\s"'])backend\.(?:automation_worker_service|control_plane_service)(?=$|[\s:"'])/i.test(commandLine);
}

function assertLegacyWritersStopped(options = {}) {
  let processes;
  try { processes = (options.listProcessMetadata || listLegacyProcessMetadata)(); }
  catch { throw new Error("PROFILE_LEGACY_WRITER_UNVERIFIABLE"); }
  if (!Array.isArray(processes) || processes.some((entry) => !entry || typeof entry !== "object" || typeof entry.commandLine !== "string")) {
    throw new Error("PROFILE_LEGACY_WRITER_UNVERIFIABLE");
  }
  if (processes.some((entry) => isKnownLegacyWriterCommand(entry.commandLine))) throw new Error("PROFILE_MIGRATION_CLOSE_SIGNALFLOW");
}

function browserPortOwnerPids(port) {
  if (!Number.isInteger(port) || port <= 0 || port >= 65_536) throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
  try {
    if (process.platform === "win32") {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress`], { encoding: "utf8", timeout: 5_000 }).trim();
      if (!output || output === "null") return [];
      const value = JSON.parse(output);
      return (Array.isArray(value) ? value : [value]).map(Number).filter(Number.isInteger);
    }
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 5_000 }).trim();
    return output ? [...new Set(output.split(/\s+/).map(Number).filter(Number.isInteger))] : [];
  } catch (error) {
    if (error?.status === 1 && process.platform !== "win32") return [];
    throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
  }
}

function browserProfileInventory(root) {
  const entries = [];
  let totalBytes = 0;
  function visit(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stats = fs.lstatSync(absolute);
      if (stats.isSymbolicLink()) throw new Error("PROFILE_BROWSER_SOURCE_SYMLINK");
      if (stats.isDirectory()) visit(absolute, childRelative);
      else if (stats.isFile()) {
        const descriptor = fs.openSync(absolute, "r");
        const buffer = Buffer.alloc(1024 * 1024);
        const digest = createHash("sha256");
        try {
          let bytesRead;
          while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, bytesRead));
        } finally { fs.closeSync(descriptor); }
        totalBytes += stats.size;
        entries.push({ bytes: stats.size, path: childRelative, sha256: digest.digest("hex") });
      } else throw new Error("PROFILE_BROWSER_SOURCE_INVALID");
    }
  }
  visit(root);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    fileCount: entries.length,
    totalBytes,
    inventorySha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
}

function prepareBrowserMigration(sourceRoot, providers, options = {}) {
  if (!providers.length) return {};
  const canonicalRoot = path.resolve(fs.realpathSync(sourceRoot));
  const processes = options.listBrowserProcesses ? options.listBrowserProcesses() : listBrowserProcesses();
  if (!Array.isArray(processes)) throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
  const portOwners = options.browserPortOwnerPids || browserPortOwnerPids;
  const browserProfiles = {};
  for (const provider of providers) {
    const sourceProfile = path.join(canonicalRoot, "account-profiles", provider);
    const requestedSource = path.resolve(sourceProfile);
    const canonicalSource = path.resolve(fs.realpathSync(sourceProfile));
    if (canonicalSource !== requestedSource || !canonicalSource.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error("PROFILE_BROWSER_SOURCE_INVALID");
    if (processes.some((entry) => typeof entry?.commandLine === "string"
        && (processHasExactProfileArg(entry.commandLine, canonicalSource) || processHasExactProfileArg(entry.commandLine, requestedSource)))) {
      throw new Error("PROFILE_BROWSER_MIGRATION_CLOSE_BROWSER");
    }

    const portsToCheck = new Set([providerDebugPort(provider)]);
    const oldPortPath = path.join(sourceProfile, "SignalFlowCdpPort");
    if (fs.existsSync(oldPortPath)) {
      const rawPort = fs.readFileSync(oldPortPath, "utf8").split(/\r?\n/, 1)[0];
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port <= 0 || port >= 65_536) throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
      portsToCheck.add(port);
    }
    for (const port of portsToCheck) {
      const pids = portOwners(port);
      if (!Array.isArray(pids)) throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
      if (pids.length > 0) {
        if (pids.some((pid) => processes.some((entry) => entry?.pid === pid && typeof entry.commandLine === "string" && processHasExactProfileArg(entry.commandLine, canonicalSource)))) throw new Error("PROFILE_BROWSER_MIGRATION_CLOSE_BROWSER");
        throw new Error("PROFILE_BROWSER_OWNER_UNVERIFIABLE");
      }
    }
    browserProfiles[provider] = {
      relativeRoot: `account-profiles/${provider}`,
      ...browserProfileInventory(canonicalSource),
      ownerVerifiedClosed: true,
      sourcePreserved: true,
    };
  }
  return browserProfiles;
}

function hasV2MarkerShape(profileRoot, profileId) {
  try {
    const marker = JSON.parse(fs.readFileSync(migrationMarkerPath(profileRoot), "utf8"));
    return marker?.version === 2 && marker?.profileId === profileId
      && marker?.integrityCheck === "ok" && marker?.foreignKeyCheck === "ok"
      && marker?.recordCountsVerified === true && marker?.sourcePreserved === true
      && typeof marker?.verifiedAt === "string" && marker?.recordCounts && marker?.sourceFilesVerified
      && marker?.browserProfiles && typeof marker.browserProfiles === "object" && !Array.isArray(marker.browserProfiles)
      && Object.entries(marker.browserProfiles).every(([provider, proof]) => PROFILE_BROWSER_PROVIDERS.includes(provider)
        && proof?.relativeRoot === `account-profiles/${provider}`
        && proof?.ownerVerifiedClosed === true && proof?.sourcePreserved === true
        && Number.isInteger(proof?.fileCount) && Number.isInteger(proof?.totalBytes)
        && typeof proof?.inventorySha256 === "string")
      && PROFILE_DATABASES.every((name) => marker.recordCounts[name] && typeof marker.recordCounts[name] === "object");
  } catch { return false; }
}

function inspectOwnerMigration({ userDataRoot, legacyDataRoot, legacyDataRoots, profileId } = {}) {
  const safe = safeProfileId(profileId);
  if (safe !== "profile-bavy") return { required: false };
  const root = path.resolve(userDataRoot || path.join(process.cwd(), ".signalflow-data"));
  const profileRoot = path.join(root, "profiles", safe);
  const markerPath = migrationMarkerPath(profileRoot);
  if (fs.existsSync(markerPath)) {
    if (!hasV2MarkerShape(profileRoot, safe)) return { error: "PROFILE_MIGRATION_PROOF_INVALID" };
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      for (const candidate of explicitLegacyRoots({ userDataRoot: root, legacyDataRoot, legacyDataRoots })) {
        if (candidate === profileRoot || candidate === path.resolve(profileRoot)) continue;
        for (const provider of legacyBrowserProfileProviders(candidate)) {
          if (!marker.browserProfiles[provider]) return { error: "PROFILE_BROWSER_MIGRATION_PROOF_INVALID" };
        }
      }
      return { required: false, profileRoot, markerPath };
    } catch (error) {
      return { error: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "PROFILE_MIGRATION_PROOF_INVALID" };
    }
  }
  const sources = [];
  try {
    for (const candidate of explicitLegacyRoots({ userDataRoot: root, legacyDataRoot, legacyDataRoots })) {
      if (candidate !== profileRoot && candidate !== path.resolve(profileRoot) && legacyArtifactsAt(candidate)) sources.push(candidate);
    }
  } catch (error) {
    return { error: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "PROFILE_LEGACY_SOURCE_UNVERIFIABLE" };
  }
  if (sources.length > 1) return { error: "PROFILE_LEGACY_SOURCE_AMBIGUOUS" };
  if (sources.length === 0) return { required: false, profileRoot, markerPath };
  if (PROFILE_DATABASES.some((name) => fs.existsSync(path.join(profileRoot, name)))) {
    return { error: "PROFILE_MIGRATION_DESTINATION_EXISTS_UNVERIFIED" };
  }
  let browserProviders;
  try { browserProviders = legacyBrowserProfileProviders(sources[0]); }
  catch (error) { return { error: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "PROFILE_BROWSER_SOURCE_INVALID" }; }
  if (browserProviders.some((provider) => fs.existsSync(path.join(profileRoot, "account-profiles", provider)))) {
    return { error: "PROFILE_BROWSER_DESTINATION_EXISTS_UNVERIFIED" };
  }
  return { required: true, sourceRoot: sources[0], browserProviders, profileRoot, markerPath };
}

function migrationScriptPath({ isPackaged = false, resourcesPath = "", sourceRoot = path.resolve(__dirname, "..") } = {}) {
  return isPackaged
    ? path.resolve(resourcesPath, "app.asar.unpacked", "worker-runtime", "backend", "profile_database_migration.py")
    : path.resolve(sourceRoot, "backend", "profile_database_migration.py");
}

function runPythonMigration(action, { profileId, sourceRoot, profileRoot, isPackaged, resourcesPath, sourceCodeRoot, browserProfiles } = {}) {
  const script = migrationScriptPath({ isPackaged, resourcesPath, sourceRoot: sourceCodeRoot });
  const args = [script, action, "--profile-id", profileId, "--destination-root", profileRoot];
  if (action === "migrate") {
    args.push("--source-root", sourceRoot);
    if (browserProfiles && Object.keys(browserProfiles).length > 0) args.push("--browser-profiles-json", JSON.stringify(browserProfiles));
  }
  const result = spawnSync(process.env.SIGNALFLOW_PYTHON || "python3", args, {
    encoding: "utf8", timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  const lines = `${result.stderr || ""}\n${result.stdout || ""}`.split(/\r?\n/).filter(Boolean);
  let payload = null;
  for (const line of lines.reverse()) {
    try { payload = JSON.parse(line); break; } catch { /* only the helper's JSON line is consumed */ }
  }
  if (result.error) throw new Error(result.error.code === "ENOENT" ? "PROFILE_MIGRATION_RUNTIME_UNAVAILABLE" : "PROFILE_MIGRATION_FAILED");
  if (result.status !== 0 || payload?.ok !== true) throw new Error(payload?.code || "PROFILE_MIGRATION_FAILED");
  return action === "verify" ? payload.ok : payload.marker;
}

function prepareRuntimeData(options = {}) {
  const safe = safeProfileId(options.profileId);
  const targetRoot = path.resolve(options.userDataRoot || path.join(process.cwd(), ".signalflow-data"));
  const profileRoot = profileDataRoot(targetRoot, safe, { create: safe !== "profile-bavy" });
  const paths = {
    controlPlaneDb: path.join(profileRoot, PROFILE_DATABASES[0]),
    workerDb: path.join(profileRoot, PROFILE_DATABASES[1]),
    migrationMarker: migrationMarkerPath(profileRoot),
  };

  if (safe === "profile-bavy") {
    const plan = inspectOwnerMigration({ ...options, profileId: safe, userDataRoot: targetRoot });
    if (plan.error) throw new Error(plan.error);
    if (plan.required) {
      if (options.legacyWriterStopped !== true) throw new Error("PROFILE_LEGACY_WRITER_UNVERIFIABLE");
      assertLegacyWritersStopped(options);
      const browserProfiles = plan.browserProviders?.length
        ? prepareBrowserMigration(plan.sourceRoot, plan.browserProviders, options)
        : {};
      const migration = options.migrateOwnerData
        ? options.migrateOwnerData({ profileId: safe, sourceRoot: plan.sourceRoot, profileRoot, browserProfiles })
        : runPythonMigration("migrate", { profileId: safe, sourceRoot: plan.sourceRoot, profileRoot, isPackaged: options.isPackaged, resourcesPath: options.resourcesPath, sourceCodeRoot: options.sourceRoot, browserProfiles });
      if (!migration || migration.version !== 2 || migration.profileId !== safe || migration.integrityCheck !== "ok"
          || migration.foreignKeyCheck !== "ok" || migration.recordCountsVerified !== true || migration.sourcePreserved !== true) {
        throw new Error("PROFILE_MIGRATION_PROOF_INVALID");
      }
      for (const [provider, proof] of Object.entries(browserProfiles)) {
        const published = migration.browserProfiles?.[provider];
        if (!published || published.relativeRoot !== proof.relativeRoot || published.fileCount !== proof.fileCount
            || published.totalBytes !== proof.totalBytes || published.inventorySha256 !== proof.inventorySha256
            || published.ownerVerifiedClosed !== true || published.sourcePreserved !== true) {
          throw new Error("PROFILE_BROWSER_MIGRATION_PROOF_INVALID");
        }
      }
      const verified = options.verifyOwnerMigration
        ? options.verifyOwnerMigration({ profileId: safe, profileRoot })
        : runPythonMigration("verify", { profileId: safe, profileRoot, isPackaged: options.isPackaged, resourcesPath: options.resourcesPath, sourceCodeRoot: options.sourceRoot });
      if (verified !== true) throw new Error("PROFILE_MIGRATION_PROOF_INVALID");
    } else if (fs.existsSync(plan.markerPath || paths.migrationMarker)) {
      const verified = options.verifyOwnerMigration
        ? options.verifyOwnerMigration({ profileId: safe, profileRoot })
        : runPythonMigration("verify", { profileId: safe, profileRoot, isPackaged: options.isPackaged, resourcesPath: options.resourcesPath, sourceCodeRoot: options.sourceRoot });
      if (verified !== true) throw new Error("PROFILE_MIGRATION_PROOF_INVALID");
    }
  }

  if (safe === "profile-bavy" && !fs.existsSync(profileRoot)) fs.mkdirSync(profileRoot, { recursive: true, mode: 0o700 });

  return paths;
}

function preparationErrorCode(error) {
  const code = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "LOCAL_WORKER_DATA_PREPARE_FAILED";
}

function buildWorkerLauncherSpec({ isPackaged = false, resourcesPath = "", sourceRoot = path.resolve(__dirname, ".."), userDataRoot, profileId, runtimeId, nodePath = process.execPath, env = process.env } = {}) {
  const { controlPlanePort, workerPort } = configuredRuntimePorts(env);
  const source = path.resolve(sourceRoot);
  const runtimeRoot = isPackaged
    ? path.resolve(resourcesPath, "app.asar.unpacked", "worker-runtime")
    : source;
  const launcherPath = isPackaged
    ? path.join(runtimeRoot, "run-local-worker.mjs")
    : path.join(source, "scripts", "run-local-worker.mjs");
  return {
    command: nodePath,
    args: [launcherPath],
    cwd: runtimeRoot,
    runtimeRoot,
    launcherPath,
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      SIGNALFLOW_CONTROL_PLANE_PORT: String(controlPlanePort),
      SIGNALFLOW_WORKER_PORT: String(workerPort),
      SIGNALFLOW_WORKER_RUNTIME_ROOT: runtimeRoot,
      SIGNALFLOW_CONTROL_PLANE_DB: databasePath(userDataRoot, "signalflow-control-plane.sqlite3", profileId),
      SIGNALFLOW_WORKER_DB: databasePath(userDataRoot, "signalflow-worker.sqlite3", profileId),
      PYTHONDONTWRITEBYTECODE: "1",
      ...(profileId ? { SIGNALFLOW_PROFILE_ID: safeProfileId(profileId), ...(runtimeId ? { SIGNALFLOW_RUNTIME_ID: safeRuntimeId(runtimeId) } : {}) } : {}),
    },
  };
}

function probePort(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  if (!Number.isInteger(port) || port <= 0 || port >= 65_536) throw new Error("SIGNALFLOW_PORT_INVALID");
  return new Promise((resolve) => {
    let connected = false;
    const request = http.get({ hostname: "127.0.0.1", port, path: "/health", timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ open: true, ok: response.statusCode >= 200 && response.statusCode < 300 && parsed?.ok === true, value: parsed });
        } catch {
          resolve({ open: true, ok: false, value: null });
        }
      });
    });
    request.on("socket", (socket) => {
      if (!socket.connecting) connected = true;
      else socket.once("connect", () => { connected = true; });
    });
    request.on("error", () => resolve({ open: connected, ok: false, value: null }));
    request.on("timeout", () => { request.destroy(); resolve({ open: connected, ok: false, value: null }); });
  });
}

async function probeLoopbackHealth({ probePortImpl = probePort, env = process.env } = {}) {
  const { controlPlanePort, workerPort } = configuredRuntimePorts(env);
  const ports = legacyWriterPorts(env);
  const probed = await Promise.all(ports.map(async (port) => [port, await probePortImpl(port)]));
  const byPort = new Map(probed);
  const controlPlane = byPort.get(controlPlanePort) || { open: false, ok: false, value: null };
  const worker = byPort.get(workerPort) || { open: false, ok: false, value: null };
  const legacyWriterPortsOpen = ports
    .filter((port) => port !== controlPlanePort && port !== workerPort && byPort.get(port)?.open === true);
  return {
    controlPlanePort,
    workerPort,
    controlPlane: controlPlane.ok,
    worker: worker.ok,
    controlPlanePortOpen: controlPlane.open,
    workerPortOpen: worker.open,
    legacyWriterPortOpen: legacyWriterPortsOpen.length > 0,
    legacyWriterPortsOpen,
    controlPlaneProfileId: controlPlane.value?.profileId,
    workerProfileId: worker.value?.profileId,
    controlPlaneRuntimeId: controlPlane.value?.runtimeId,
    workerRuntimeId: worker.value?.runtimeId,
    inFlightExecutions: worker.value?.inFlightExecutions,
    runningJobs: worker.value?.queue?.running,
    workerState: worker.value?.workerState,
    acceptingJobs: worker.value?.acceptingJobs,
    safeStopRequested: worker.value?.safeStopRequested,
  };
}

function pairHealthy(health) {
  return Boolean(health?.controlPlane === true && health?.worker === true);
}

function childAlive(child) {
  return Boolean(child && child.exitCode === null && child.killed !== true);
}

function hasOpenPorts(health) {
  if (typeof health?.controlPlanePortOpen === "boolean" || typeof health?.workerPortOpen === "boolean") {
    return health.controlPlanePortOpen === true || health.workerPortOpen === true;
  }
  return Boolean(health?.controlPlane || health?.worker);
}

function hasLegacyWriterOpen(health) {
  return health?.legacyWriterPortOpen === true
    || (Array.isArray(health?.legacyWriterPortsOpen) && health.legacyWriterPortsOpen.length > 0);
}

function identitiesMatchProfile(health, profileId, runtimeId = "") {
  const controlRuntimeId = health?.controlPlaneRuntimeId;
  const workerRuntimeId = health?.workerRuntimeId;
  return Boolean(profileId
    && health?.controlPlaneProfileId === profileId
    && health?.workerProfileId === profileId
    && typeof controlRuntimeId === "string" && controlRuntimeId
    && controlRuntimeId === workerRuntimeId
    && (!runtimeId || controlRuntimeId === runtimeId));
}

function workerIdentityMatches(health, profileId, runtimeId = "") {
  const reportedRuntimeId = health?.workerRuntimeId;
  return Boolean(profileId && health?.workerProfileId === profileId
    && typeof reportedRuntimeId === "string" && reportedRuntimeId
    && (!runtimeId || reportedRuntimeId === runtimeId));
}

function runtimeAcceptingJobs(health) {
  return health?.workerState === "running" && health?.acceptingJobs === true;
}

function workerQuiesced(health) {
  return health?.workerState === "stopped" && health.acceptingJobs === false
    && health.safeStopRequested === true && Number(health.inFlightExecutions) === 0
    && Number(health.runningJobs) === 0;
}

function assertRuntimeOperationAllowed(runtimeStatus, expectedProfileId, activationPending = 0) {
  if (runtimeStatus?.stopping || runtimeStatus?.shutdownRequested) throw new Error("PROFILE_RUNTIME_STOPPING");
  if (activationPending > 0 || runtimeStatus?.switching) throw new Error("PROFILE_BUSY");
  if (!runtimeStatus?.ready || runtimeStatus.profileId !== expectedProfileId) throw new Error(runtimeStatus?.lastError || "PROFILE_RUNTIME_NOT_READY");
}

function installGracefulQuitHandlers({ app, dialog, signalEmitter = process, getWorkerSupervisor = () => undefined, scheduleQuit = setImmediate } = {}) {
  let quittingAfterRuntimeStop = false;
  let finalQuitAllowed = false;
  const requestGracefulQuit = () => {
    if (!quittingAfterRuntimeStop) app.quit();
  };
  const beforeQuit = (event) => {
    const supervisor = getWorkerSupervisor();
    if (finalQuitAllowed) {
      finalQuitAllowed = false;
      return;
    }
    if (quittingAfterRuntimeStop) {
      event.preventDefault();
      return;
    }
    if (!supervisor) return;
    event.preventDefault();
    quittingAfterRuntimeStop = true;
    let stopPromise;
    try { stopPromise = supervisor.stop({ preserveShutdownFence: true }); }
    catch (error) { stopPromise = Promise.reject(error); }
    void Promise.resolve(stopPromise).then(() => scheduleQuit(() => {
      finalQuitAllowed = true;
      app.quit();
    })).catch((error) => {
      quittingAfterRuntimeStop = false;
      finalQuitAllowed = false;
      const message = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : "PROFILE_RUNTIME_NOT_READY";
      dialog.showErrorBox("SignalFlow chưa thể đóng an toàn", `Không xác minh được runtime đã dừng an toàn (${message}). Tiến trình chưa bị kết thúc. Hãy xử lý trạng thái đang chạy rồi thử đóng lại.`);
    });
  };
  signalEmitter.on("SIGINT", requestGracefulQuit);
  signalEmitter.on("SIGTERM", requestGracefulQuit);
  app.on("before-quit", beforeQuit);
  return { requestGracefulQuit, beforeQuit };
}

function requestLocalJson(port, route, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method: "POST",
      headers: { "content-type": "application/json" },
      timeout: timeoutMs,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch {}
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(parsed);
        else reject(new Error(parsed?.detail?.code || "PROFILE_RUNTIME_CONFLICT"));
      });
    });
    request.on("error", () => reject(new Error("PROFILE_RUNTIME_CONFLICT")));
    request.on("timeout", () => { request.destroy(); reject(new Error("PROFILE_QUIESCE_TIMEOUT")); });
    request.end(JSON.stringify(payload));
  });
}

function createWorkerSupervisor(options = {}) {
  let profileId = safeProfileId(options.profileId);
  if (!profileId) throw new Error("PROFILE_ID_REQUIRED");
  let runtimeId = options.runtimeId ? safeRuntimeId(options.runtimeId) : "";
  const runtimeIdFactory = options.runtimeIdFactory || ((id) => `signalflow-${id}-${randomUUID()}`);
  let spec = buildWorkerLauncherSpec({ ...options, profileId, runtimeId: runtimeId || undefined });
  const probeHealth = options.probeHealth || (() => probeLoopbackHealth({ env: options.env || process.env, probePortImpl: options.probePortImpl || probePort }));
  const spawnImpl = options.spawnImpl || spawn;
  const persistActiveProfile = options.persistActiveProfile || (() => undefined);
  const { workerPort } = configuredRuntimePorts(options.env || process.env);
  const quiesceWorker = options.quiesceWorker || (() => requestLocalJson(workerPort, "/v1/stop", { reason: "profile_switch" }, HEALTH_TIMEOUT_MS));
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const setIntervalImpl = options.setIntervalImpl || setInterval;
  const clearIntervalImpl = options.clearIntervalImpl || clearInterval;
  const healthTimeoutMs = Number(options.healthTimeoutMs || START_TIMEOUT_MS);
  const healthIntervalMs = Number(options.healthIntervalMs || HEALTH_INTERVAL_MS);
  const restartBaseMs = Number(options.restartBaseMs ?? RESTART_BASE_MS);
  const restartMaxMs = Number(options.restartMaxMs ?? RESTART_MAX_MS);
  const quiesceTimeoutMs = Number(options.quiesceTimeoutMs ?? 60_000);
  const portReleaseTimeoutMs = Number(options.portReleaseTimeoutMs ?? 5_000);
  const childExitTimeoutMs = Number(options.childExitTimeoutMs ?? 5_000);

  let child = null;
  let ownsRuntime = false;
  let ownedRuntimeLineage = null;
  let state = "stopped";
  let restartCount = 0;
  let lastError = "";
  let restartTimer = null;
  let healthTimer = null;
  let startPromise = null;
  let recoveryPromise = null;
  let activationQueue = Promise.resolve();
  let switching = false;
  let stopping = false;
  let shutdownRequested = false;
  let activationPromise = null;
  let lifecycleGeneration = 0;
  let monitorPromise = null;
  let monitorTimerGeneration = 0;

  const status = () => ({ state, ready: state === "ready", switching, stopping, shutdownRequested, controlPlane: state === "ready", worker: state === "ready", ownsRuntime, restartCount, profileId, runtimeId: runtimeId || undefined, ...(lastError ? { lastError } : {}) });

  const readHealth = () => probeHealth().catch(() => ({ controlPlane: false, worker: false, controlPlanePortOpen: true, workerPortOpen: true, legacyWriterPortOpen: true }));
  const sleep = (ms) => new Promise((resolve) => setTimeoutImpl(resolve, Math.max(0, ms)));

  function configureProfile(nextProfileId, nextRuntimeId = "") {
    lifecycleGeneration += 1;
    if (healthTimer) monitorTimerGeneration = lifecycleGeneration;
    profileId = safeProfileId(nextProfileId);
    if (!profileId) throw new Error("PROFILE_ID_REQUIRED");
    runtimeId = nextRuntimeId ? safeRuntimeId(nextRuntimeId) : "";
    spec = buildWorkerLauncherSpec({ ...options, profileId, runtimeId: runtimeId || undefined });
  }

  function newRuntimeId() {
    const next = safeRuntimeId(runtimeIdFactory(profileId));
    if (next === runtimeId) throw new Error("PROFILE_RUNTIME_ID_REUSED");
    runtimeId = next;
    spec = buildWorkerLauncherSpec({ ...options, profileId, runtimeId });
    return next;
  }

  function healthMatches(health) {
    return identitiesMatchProfile(health, profileId, runtimeId);
  }

  function healthReady(health) {
    return pairHealthy(health) && healthMatches(health) && runtimeAcceptingJobs(health);
  }

  function retainedOwnershipMatches(health) {
    return ownsRuntime && !childAlive(child)
      && ownedRuntimeLineage?.profileId === profileId
      && ownedRuntimeLineage?.runtimeId === runtimeId
      && typeof runtimeId === "string" && runtimeId
      && health?.controlPlaneRuntimeId === runtimeId
      && health?.workerRuntimeId === runtimeId;
  }

  async function markReady(health, owned = childAlive(child)) {
    if (!healthReady(health)) return false;
    const retainedOwnership = retainedOwnershipMatches(health);
    runtimeId = health.controlPlaneRuntimeId;
    spec = buildWorkerLauncherSpec({ ...options, profileId, runtimeId });
    state = "ready";
    ownsRuntime = owned || retainedOwnership;
    ownedRuntimeLineage = ownsRuntime ? { profileId, runtimeId } : null;
    restartCount = 0;
    lastError = "";
    try {
      await persistActiveProfile({ profileId, runtimeId });
      return true;
    } catch {
      state = "degraded";
      ownsRuntime = owned || retainedOwnership;
      ownedRuntimeLineage = ownsRuntime ? { profileId, runtimeId } : null;
      lastError = "PROFILE_SELECTION_PERSIST_FAILED";
      return false;
    }
  }

  async function waitForHealthy() {
    const deadline = Date.now() + healthTimeoutMs;
    while (!stopping && Date.now() <= deadline) {
      const health = await readHealth();
      if (healthReady(health)) return health;
      await sleep(Math.min(healthIntervalMs, Math.max(1, deadline - Date.now())));
    }
    return null;
  }

  async function waitForQuiesced() {
    const deadline = Date.now() + quiesceTimeoutMs;
    while (Date.now() <= deadline) {
      const health = await readHealth();
      if (!workerIdentityMatches(health, profileId, runtimeId)) throw new Error("PROFILE_RUNTIME_CONFLICT");
      if (workerQuiesced(health)) return health;
      await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    throw new Error("PROFILE_QUIESCE_TIMEOUT");
  }

  async function waitForPortsReleased() {
    const deadline = Date.now() + portReleaseTimeoutMs;
    while (Date.now() <= deadline) {
      const health = await readHealth();
      if (!hasOpenPorts(health)) return true;
      await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    return false;
  }

  async function waitForExit(current) {
    if (!current || current.exitCode !== null) return true;
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (didExit) => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        resolve(didExit);
      };
      const timer = setTimeoutImpl(() => finish(current.exitCode !== null), childExitTimeoutMs);
      current.once?.("exit", () => finish(true));
    });
  }

  async function stopOwnedRuntime({ preserveShutdownFence = false } = {}) {
    stopping = true;
    lifecycleGeneration += 1;
    if (healthTimer) { clearIntervalImpl(healthTimer); healthTimer = null; }
    if (restartTimer) { clearTimeoutImpl(restartTimer); restartTimer = null; }
    if (monitorPromise) await Promise.allSettled([monitorPromise]);
    const current = child;
    if (ownsRuntime) {
      if (current && current.exitCode === null) {
        if (!current.killed) current.kill?.("SIGTERM");
        if (!await waitForExit(current)) throw new Error("PROFILE_RUNTIME_STOP_TIMEOUT");
      }
      if (!await waitForPortsReleased()) throw new Error("PROFILE_RUNTIME_CONFLICT");
    }
    child = null;
    ownsRuntime = false;
    ownedRuntimeLineage = null;
    state = "stopped";
    lastError = "";
    stopping = false;
    shutdownRequested = preserveShutdownFence;
  }

  async function quiesceCurrentWorker({ rejectIfBusy = true } = {}) {
    if (!workerIdentityMatches(await readHealth(), profileId, runtimeId)) throw new Error("PROFILE_RUNTIME_CONFLICT");
    const response = await quiesceWorker({ profileId, runtimeId });
    const busyAtBarrier = Number(response?.inFlightExecutions) > 0 || response?.state === "stopping";
    await waitForQuiesced();
    if (busyAtBarrier && rejectIfBusy) {
      const error = new Error("PROFILE_BUSY");
      error.quiesced = true;
      throw error;
    }
  }

  function scheduleRestart() {
    if (stopping || !ownsRuntime || restartTimer) return;
    const exponent = Math.max(0, restartCount - 1);
    const delay = Math.min(restartMaxMs, restartBaseMs * (2 ** exponent));
    restartTimer = setTimeoutImpl(() => {
      restartTimer = null;
      void recover();
    }, Math.max(0, delay));
  }

  function onChildExit() {
    child = null;
    if (stopping) return;
    state = "degraded";
    lastError = "LOCAL_WORKER_RUNTIME_EXITED";
    scheduleRestart();
  }

  function onChildError() {
    state = "degraded";
    lastError = "LOCAL_WORKER_RUNTIME_START_FAILED";
    if (!childAlive(child)) {
      child = null;
      scheduleRestart();
    }
  }

  function spawnRuntime() {
    if (childAlive(child)) return child;
    newRuntimeId();
    child = spawnImpl(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: "ignore", windowsHide: true });
    ownsRuntime = true;
    ownedRuntimeLineage = { profileId, runtimeId };
    child.once?.("exit", onChildExit);
    child.once?.("error", onChildError);
    return child;
  }

  async function recover() {
    if (stopping || recoveryPromise) return recoveryPromise;
    recoveryPromise = (async () => {
      const health = await readHealth();
      const migrationPlan = inspectOwnerMigration({ ...options, profileId, userDataRoot: options.userDataRoot });
      if (migrationPlan.error) {
        state = "degraded";
        lastError = migrationPlan.error;
        return;
      }
      if (migrationPlan.required && (hasOpenPorts(health) || hasLegacyWriterOpen(health))) {
        state = "degraded";
        lastError = "PROFILE_MIGRATION_CLOSE_SIGNALFLOW";
        return;
      }
      if (healthReady(health)) {
        try { prepareRuntimeData({ ...options, profileId, legacyWriterStopped: false }); }
        catch (error) { state = "degraded"; lastError = preparationErrorCode(error); return; }
        await markReady(health, childAlive(child));
        return;
      }
      if (hasOpenPorts(health)) {
        state = "degraded";
        lastError = migrationPlan.required ? "PROFILE_MIGRATION_CLOSE_SIGNALFLOW" : healthMatches(health) ? "LOCAL_WORKER_RUNTIME_PARTIAL" : "PROFILE_RUNTIME_CONFLICT";
        return;
      }
      restartCount += 1;
      state = "starting";
      try {
        prepareRuntimeData({ ...options, profileId, legacyWriterStopped: true });
      } catch (error) {
        state = "degraded";
        lastError = preparationErrorCode(error);
        return;
      }
      if (stopping) return;
      try {
        spawnRuntime();
      } catch {
        child = null;
        ownsRuntime = false;
        state = "degraded";
        lastError = "LOCAL_WORKER_RUNTIME_START_FAILED";
        return;
      }
      const readyHealth = await waitForHealthy();
      if (readyHealth && await markReady(readyHealth, true)) {
        return;
      } else {
        state = "degraded";
        lastError = hasOpenPorts(await readHealth()) ? "PROFILE_RUNTIME_CONFLICT" : "LOCAL_WORKER_RUNTIME_NOT_READY";
        scheduleRestart();
      }
    })().finally(() => { recoveryPromise = null; });
    return recoveryPromise;
  }

  async function monitor() {
    const generation = lifecycleGeneration;
    const monitoredProfileId = profileId;
    const monitoredRuntimeId = runtimeId;
    const health = await readHealth();
    if (generation !== lifecycleGeneration || stopping || shutdownRequested || switching
        || monitoredProfileId !== profileId || monitoredRuntimeId !== runtimeId) return;
    if (healthReady(health)) {
      state = "ready";
      if (childAlive(child)) {
        ownsRuntime = true;
        ownedRuntimeLineage = { profileId, runtimeId };
      } else if (!retainedOwnershipMatches(health)) {
        ownsRuntime = false;
        ownedRuntimeLineage = null;
      }
      lastError = "";
      restartCount = 0;
      return;
    }
    if (hasOpenPorts(health)) {
      state = "degraded";
      lastError = healthMatches(health) ? "LOCAL_WORKER_RUNTIME_QUIESCED" : "PROFILE_RUNTIME_CONFLICT";
      return;
    }
    state = "degraded";
    if (!childAlive(child)) scheduleRestart();
  }

  function startMonitoring() {
    if (healthTimer || stopping || shutdownRequested) return;
    monitorTimerGeneration = lifecycleGeneration;
    healthTimer = setIntervalImpl(() => {
      if (monitorTimerGeneration !== lifecycleGeneration || stopping || shutdownRequested || switching || monitorPromise) return;
      monitorPromise = monitor();
      void monitorPromise.then(() => {
        monitorPromise = null;
      }, () => {
        monitorPromise = null;
      });
    }, healthIntervalMs);
  }

  async function start() {
    if (startPromise) return startPromise;
    if (stopping || shutdownRequested) throw new Error("PROFILE_RUNTIME_STOPPING");
    stopping = false;
    const startGeneration = lifecycleGeneration;
    startPromise = (async () => {
      const health = await readHealth();
      const migrationPlan = inspectOwnerMigration({ ...options, profileId, userDataRoot: options.userDataRoot });
      if (migrationPlan.error) {
        state = "degraded";
        lastError = migrationPlan.error;
      } else if (migrationPlan.required && (hasOpenPorts(health) || hasLegacyWriterOpen(health))) {
        state = "degraded";
        lastError = "PROFILE_MIGRATION_CLOSE_SIGNALFLOW";
      } else if (hasOpenPorts(health)) {
        try {
          prepareRuntimeData({ ...options, profileId, legacyWriterStopped: false });
          if (pairHealthy(health) && identitiesMatchProfile(health, profileId, runtimeId) && runtimeAcceptingJobs(health)) {
            if (!runtimeId) runtimeId = health.controlPlaneRuntimeId;
            if (!await markReady(health, childAlive(child))) lastError = "PROFILE_SELECTION_PERSIST_FAILED";
          } else {
            state = "degraded";
            lastError = healthMatches(health) ? "LOCAL_WORKER_RUNTIME_NOT_READY" : "PROFILE_RUNTIME_CONFLICT";
          }
        } catch (error) {
          state = "degraded";
          lastError = preparationErrorCode(error);
        }
      } else {
        await recover();
      }
      if (startGeneration === lifecycleGeneration && !stopping && !shutdownRequested && (state === "ready" || childAlive(child))) startMonitoring();
      return status();
    })().finally(() => { startPromise = null; });
    return startPromise;
  }

  async function stop({ preserveShutdownFence = false } = {}) {
    if (switching) throw new Error("PROFILE_BUSY");
    shutdownRequested = true;
    stopping = true;
    lifecycleGeneration += 1;
    if (healthTimer) { clearIntervalImpl(healthTimer); healthTimer = null; }
    if (restartTimer) { clearTimeoutImpl(restartTimer); restartTimer = null; }
    if (monitorPromise) await Promise.allSettled([monitorPromise]);
    const pendingWork = [...new Set([startPromise, recoveryPromise, activationPromise, activationQueue].filter(Boolean))];
    if (pendingWork.length > 0) await Promise.allSettled(pendingWork);
    if (!ownsRuntime) {
      state = "stopped";
      stopping = false;
      shutdownRequested = preserveShutdownFence;
      return status();
    }
    const health = await readHealth();
    if (childAlive(child) && !workerIdentityMatches(health, profileId, runtimeId)) throw new Error("PROFILE_RUNTIME_CONFLICT");
    if (hasOpenPorts(health) && !workerQuiesced(health)) await quiesceCurrentWorker({ rejectIfBusy: false });
    await stopOwnedRuntime({ preserveShutdownFence });
    return status();
  }

  async function activateProfileSerial(nextProfileId) {
    if (stopping || shutdownRequested) throw new Error("PROFILE_RUNTIME_STOPPING");
    const next = safeProfileId(nextProfileId);
    if (!next) throw new Error("PROFILE_ID_INVALID");
    if (next === profileId) {
      const started = await start();
      if (started.state !== "ready" || !healthReady(await readHealth())) throw new Error(started.lastError || "PROFILE_RUNTIME_NOT_READY");
      return started;
    }

    const targetPlan = inspectOwnerMigration({ ...options, profileId: next, userDataRoot: options.userDataRoot });
    const currentHealth = await readHealth();
    if (shutdownRequested) throw new Error("PROFILE_RUNTIME_STOPPING");
    if (targetPlan.error) throw new Error(targetPlan.error);
    if (targetPlan.required && hasLegacyWriterOpen(currentHealth)) throw new Error("PROFILE_MIGRATION_CLOSE_SIGNALFLOW");
    if (Number(currentHealth.inFlightExecutions) > 0 || Number(currentHealth.runningJobs) > 0) throw new Error("PROFILE_BUSY");
    if (hasOpenPorts(currentHealth) && (!ownsRuntime || !childAlive(child) || !healthMatches(currentHealth))) throw new Error("PROFILE_RUNTIME_CONFLICT");
    const previousProfileId = profileId;
    let oldStopped = false;
    let quiesceStarted = false;
    switching = true;
    state = "switching";
    try {
      if (hasOpenPorts(currentHealth) && ownsRuntime) {
        try {
          await quiesceCurrentWorker();
          quiesceStarted = true;
        } catch (error) {
          quiesceStarted = error?.quiesced === true;
          throw error;
        }
      }
      if (ownsRuntime) {
        await stopOwnedRuntime();
        oldStopped = true;
      }
      configureProfile(next);
      state = "stopped";
      const target = await start();
      if (target.state !== "ready" || !healthReady(await readHealth())) throw new Error(target.lastError || "PROFILE_RUNTIME_NOT_READY");
      return target;
    } catch (error) {
      const needsRestore = profileId !== previousProfileId || oldStopped || quiesceStarted;
      if (needsRestore) {
        try {
          if (profileId !== previousProfileId && ownsRuntime && child) {
            const targetHealth = await readHealth();
            if (childAlive(child) && !workerIdentityMatches(targetHealth, profileId, runtimeId)) throw new Error("PROFILE_RUNTIME_CONFLICT");
            if (workerIdentityMatches(targetHealth, profileId, runtimeId) && !workerQuiesced(targetHealth)) await quiesceCurrentWorker({ rejectIfBusy: false });
            await stopOwnedRuntime();
          } else if (quiesceStarted && ownsRuntime && child) {
            await stopOwnedRuntime();
          }
          configureProfile(previousProfileId);
          state = "stopped";
          const restored = await start();
          if (restored.state !== "ready") throw new Error("PROFILE_RUNTIME_ROLLBACK_FAILED");
        } catch {
          state = "degraded";
          lastError = "PROFILE_RUNTIME_ROLLBACK_FAILED";
          throw new Error(lastError);
        }
      } else {
        state = ownsRuntime ? "ready" : "degraded";
        lastError = "";
      }
      throw error instanceof Error ? error : new Error("PROFILE_RUNTIME_NOT_READY");
    } finally {
      switching = false;
    }
  }

  function activateProfile(nextProfileId) {
    if (shutdownRequested) return Promise.reject(new Error("PROFILE_RUNTIME_STOPPING"));
    const activation = activationQueue.then(() => activateProfileSerial(nextProfileId));
    activationPromise = activation;
    void activation.then(() => {
      if (activationPromise === activation) activationPromise = null;
    }, () => {
      if (activationPromise === activation) activationPromise = null;
    });
    activationQueue = activation.catch(() => undefined);
    return activation;
  }

  return { start, stop, activateProfile, status, get spec() { return spec; }, isSwitching: () => switching };
}

module.exports = { assertRuntimeOperationAllowed, buildWorkerLauncherSpec, configuredRuntimePorts, createWorkerSupervisor, installGracefulQuitHandlers, pairHealthy, prepareRuntimeData, probeLoopbackHealth, probePort, profileDataRoot, readActiveProfileSelection, resolveDeveloperUserDataRoot, safeProfileId, writeActiveProfileSelection };
