const { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { openProvider, statusProvider, completeProvider, setActiveProfileId: setBrowserActiveProfileId, providerUserDataRoot, generateFlowImage, generateFlowVideo, inventoryDriveMetadata } = require("./account-browser.cjs");
const { deleteConfig, generateVertexImage, saveConfig, statusVertex, verifyVertexApi } = require("./vertex-ai.cjs");
const { driveAnalyzeLocalAsset, driveDownloadAsset, driveMakePublic, driveUploadAsset, importLocalMedia, storeGeneratedMedia } = require("./drive-media.cjs");
const { currentChromePageUrl, navigateChromeProvider } = require("./chrome-browser.cjs");
const { setActiveProfileId: setSecureStoreProfileId, setSecret, getSecret, deleteSecret } = require("./secure-store.cjs");
const { discoverProviderModels } = require("./provider-models.cjs");
const { discoverMetaAccounts, exchangeLongLivedToken, exchangeOAuthCode, publishPage, publishPageVideo, publishInstagram, verifyPage } = require("./meta.cjs");
const { assertProfileRequestCurrent, assertTrustedRenderer, createRendererPolicy, safeExternalUrl, validateCommandArgs } = require("./security.cjs");
const { filterOAuthCallbackUrls, isMetaHttpsCallback } = require("./oauth-url.cjs");
const { assertRuntimeOperationAllowed, configuredRuntimePorts, createWorkerSupervisor, installGracefulQuitHandlers, readActiveProfileSelection, resolveDeveloperUserDataRoot, writeActiveProfileSelection } = require("./worker-supervisor.cjs");

let mainWindow;
let rendererPolicy;
let rendererOAuthReady = false;
let pendingOAuthUrls = [];
const metaOAuthWatches = new Map();
let workerSupervisor;
let activeProfileId = "profile-bavy";
let activeProfileRevision = 0;
let nativeProfileSelection = null;
let startupFailure = "";
let activeRuntimeOperations = 0;
let profileActivationPending = 0;

app.setName("SignalFlow");

const runtimePorts = configuredRuntimePorts(process.env);
const developerUserDataRoot = resolveDeveloperUserDataRoot(process.env.SIGNALFLOW_DEV_USER_DATA_ROOT, { isPackaged: app.isPackaged });
if (developerUserDataRoot) app.setPath("userData", developerUserDataRoot);

function setActiveProfileContext(profileId) {
  if (activeProfileId !== profileId) activeProfileRevision += 1;
  activeProfileId = profileId;
  setBrowserActiveProfileId(profileId);
  setSecureStoreProfileId(profileId);
}

function forwardOAuthUrls(rawUrls) {
  const urls = filterOAuthCallbackUrls(rawUrls).filter((url) => !isMetaHttpsCallback(url));
  if (urls.length === 0) return;
  if (rendererOAuthReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("signalflow:oauth-url", urls);
    return;
  }
  pendingOAuthUrls.push(...urls);
}

function startMetaOAuthWatch(session, state) {
  const watch = metaOAuthWatches.get(state);
  if (!watch) return;
  void (async () => {
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) break;
      const rawUrl = await currentChromePageUrl(session, "localhost");
      if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) break;
      const matches = filterOAuthCallbackUrls([rawUrl]);
      if (matches.length > 0 && new URL(matches[0]).searchParams.get("state") === state) {
        const callback = new URL(matches[0]);
        if (isMetaHttpsCallback(matches[0])) {
          const code = callback.searchParams.get("code");
          try {
            if (!code) throw new Error("META_OAUTH_CODE_MISSING");
            const result = await exchangeOAuthCode(watch.workspaceId, watch.appId, code, "https://localhost/oauth/callback", watch.profileId);
            if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) break;
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("signalflow:meta-oauth-result", { ...result, platform: watch.platform, workspaceId: watch.workspaceId, profileId: watch.profileId });
          } catch (error) {
            if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) break;
            const codeName = String(error instanceof Error ? error.message : error).match(/META_[A-Z0-9_:-]+/)?.[0] ?? "META_OAUTH_EXCHANGE_FAILED";
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("signalflow:meta-oauth-result", { status: "error", code: codeName, platform: watch.platform, workspaceId: watch.workspaceId });
          }
        } else {
          forwardOAuthUrls(matches);
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    metaOAuthWatches.delete(state);
  })();
}

async function waitForMetaOAuth(state) {
  const watch = metaOAuthWatches.get(state);
  if (!watch?.session) throw new Error("META_OAUTH_SESSION_NOT_FOUND");
  if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) {
    metaOAuthWatches.delete(state);
    throw new Error("PROFILE_RESULT_STALE");
  }
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const rawUrl = await currentChromePageUrl(watch.session, "localhost");
    if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) {
      metaOAuthWatches.delete(state);
      throw new Error("PROFILE_RESULT_STALE");
    }
    const matches = filterOAuthCallbackUrls([rawUrl]);
    if (matches.length > 0 && new URL(matches[0]).searchParams.get("state") === state) {
      const callback = new URL(matches[0]);
      const code = callback.searchParams.get("code");
      if (!code) throw new Error("META_OAUTH_CODE_MISSING");
      const result = await exchangeOAuthCode(watch.workspaceId, watch.appId, code, "https://localhost/oauth/callback", watch.profileId);
      if (watch.profileId !== activeProfileId || watch.profileRevision !== activeProfileRevision) {
        metaOAuthWatches.delete(state);
        throw new Error("PROFILE_RESULT_STALE");
      }
      metaOAuthWatches.delete(state);
      return { ...result, platform: watch.platform, workspaceId: watch.workspaceId };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  metaOAuthWatches.delete(state);
  throw new Error("META_OAUTH_TIMEOUT");
}

app.on("open-url", (event, rawUrl) => {
  event.preventDefault();
  forwardOAuthUrls([rawUrl]);
});

function validateFilename(filename) {
  if (typeof filename !== "string" || !/^[a-zA-Z0-9._-]+$/.test(filename) || filename.length > 180) throw new Error("EXPORT_FILENAME_INVALID");
  return filename;
}

async function requestLocalWorker(args) {
  const response = await fetch(`http://127.0.0.1:${runtimePorts.workerPort}${args.path}`, {
    method: args.method,
    headers: { "content-type": "application/json" },
    ...(args.body ? { body: args.body } : {}),
  }).catch(() => null);
  if (!response) throw new Error("LOCAL_WORKER_UNREACHABLE");
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error("LOCAL_WORKER_RESPONSE_TOO_LARGE");
  return { status: response.status, body };
}

async function invokeCommand(command, rawArgs = {}) {
  const args = validateCommandArgs(command, rawArgs);
  if (command !== "profile_activate" && command !== "profile_selection") {
    if (startupFailure) throw new Error(startupFailure);
    assertRuntimeOperationAllowed(workerSupervisor?.status(), activeProfileId, profileActivationPending);
  } else if (command === "profile_selection" && (workerSupervisor?.isSwitching() || profileActivationPending > 0)) {
    throw new Error("PROFILE_BUSY");
  }
  switch (command) {
    case "profile_selection":
      if (startupFailure) throw new Error(startupFailure);
      return {
        ...(nativeProfileSelection || {}),
        profileId: activeProfileId,
        runtimeId: nativeProfileSelection?.runtimeId || workerSupervisor?.status().runtimeId || null,
        profileRevision: activeProfileRevision,
      };
    case "gemini_web_open": return await openProvider("gemini", activeProfileId).then(() => ({ opened: true, window: "gemini-browser", persistentProfile: true, engine: "chromium" }));
    case "gemini_web_status": return await statusProvider("gemini", activeProfileId);
    case "gemini_web_complete": return await completeProvider("gemini", String(args.prompt || ""), String(args.model || ""), args.attachmentPath, activeProfileId, args.attachmentPaths, args.attachmentHashes, args.requestId, args.attachmentManifest);
    case "drive_web_open": return await openProvider("drive").then(() => ({ opened: true, window: "drive-browser", persistentProfile: true, engine: "chromium" }));
    case "drive_web_status": return await statusProvider("drive");
    case "drive_inventory": return await inventoryDriveMetadata(activeProfileId);
    case "drive_download_asset": return await driveDownloadAsset({ userDataRoot: providerUserDataRoot(activeProfileId), workspaceId: args.workspaceId, clientId: args.clientId, brandId: args.brandId, platform: args.platform, capturedAt: args.capturedAt, contentRunId: args.contentRunId, providerFileId: args.providerFileId, filename: args.filename, mimeType: args.mimeType, modifiedAt: args.modifiedAt, publicReachabilityConfirmed: args.publicReachabilityConfirmed });
    case "store_generated_media": return storeGeneratedMedia({ userDataRoot: providerUserDataRoot(activeProfileId), workspaceId: args.workspaceId, clientId: args.clientId, brandId: args.brandId, platform: args.platform, capturedAt: args.capturedAt, contentRunId: args.contentRunId, localAssetPath: args.localAssetPath, filename: args.filename, mimeType: args.mimeType });
    case "drive_analyze_local_asset": return driveAnalyzeLocalAsset({ userDataRoot: providerUserDataRoot(activeProfileId), localAssetPath: args.localAssetPath, mimeType: args.mimeType, modifiedAt: args.modifiedAt });
    case "import_local_media": return importLocalMedia({ userDataRoot: providerUserDataRoot(activeProfileId), clientId: args.clientId, brandId: args.brandId, fileName: args.fileName, declaredMimeType: args.declaredMimeType, fileBytesBase64: args.fileBytesBase64 });
    case "drive_upload_asset": return await driveUploadAsset({ userDataRoot: providerUserDataRoot(activeProfileId), workspaceId: args.workspaceId, localAssetPath: args.localAssetPath, filename: args.filename });
    case "drive_make_public": return await driveMakePublic({ userDataRoot: providerUserDataRoot(activeProfileId), workspaceId: args.workspaceId, providerFileId: args.providerFileId });
    case "chatgpt_web_open": return await openProvider("chatgpt", activeProfileId).then(() => ({ opened: true, window: "chatgpt-browser", persistentProfile: true, engine: "chromium" }));
    case "chatgpt_web_status": return await statusProvider("chatgpt", activeProfileId);
    case "chatgpt_web_complete": return await completeProvider("chatgpt", String(args.prompt || ""), String(args.model || ""), args.attachmentPath, activeProfileId, args.attachmentPaths, args.attachmentHashes, args.requestId, args.attachmentManifest);
    case "flow_web_open": return await openProvider("flow", activeProfileId).then(() => ({ opened: true, window: "flow-browser", persistentProfile: true, engine: "chromium" }));
    case "flow_web_status": return await statusProvider("flow", activeProfileId);
    case "flow_web_generate_image": return await generateFlowImage(String(args.prompt || ""), activeProfileId);
    case "flow_web_generate_video": return await generateFlowVideo(String(args.prompt || ""), activeProfileId);
    case "profile_activate": {
      if (startupFailure) throw new Error(startupFailure);
      if (!workerSupervisor) throw new Error("PROFILE_RUNTIME_NOT_READY");
      if (activeRuntimeOperations > 0) throw new Error("PROFILE_BUSY");
      const next = String(args.profileId);
      const result = await workerSupervisor.activateProfile(next);
      if (result.state !== "ready" || result.ready !== true || result.profileId !== next || typeof result.runtimeId !== "string" || !result.runtimeId) throw new Error(result.lastError || "PROFILE_RUNTIME_NOT_READY");
      setActiveProfileContext(next);
      return { ...result, ready: true, profileId: next, runtimeId: result.runtimeId, profileRevision: activeProfileRevision };
    }
    case "vertex_ai_status": return statusVertex(args.workspaceId);
    case "vertex_ai_save_config": return saveConfig(args.workspaceId, { projectId: args.projectId, location: args.location, model: args.model });
    case "vertex_ai_clear_config": return deleteConfig(args.workspaceId);
    case "vertex_ai_verify": return await verifyVertexApi(args.workspaceId);
    case "vertex_ai_generate_image": return await generateVertexImage(args.workspaceId, String(args.prompt || ""), { userDataRoot: providerUserDataRoot(activeProfileId) });
    case "secret_set": setSecret(args.account, args.secret); return null;
    case "provider_discover_models": return await discoverProviderModels({ workspaceId: args.workspaceId, providerKind: args.providerKind, baseUrl: args.baseUrl });
    case "secret_get": return getSecret(args.account);
    case "secret_delete": deleteSecret(args.account); return null;
    case "meta_save_access_token": setSecret(`profile:${activeProfileId}:workspace:${args.workspaceId}:meta:manual-access-token`, args.accessToken); return null;
    case "meta_discover_accounts": return await discoverMetaAccounts(args.workspaceId, activeProfileId);
    case "meta_verify_page": return await verifyPage(args.workspaceId, args.pageId, activeProfileId);
    case "meta_exchange_long_lived_token": return await exchangeLongLivedToken(args.workspaceId, args.appId, activeProfileId);
    case "meta_exchange_oauth_code": {
      assertProfileRequestCurrent(args.profileId, args.profileRevision, activeProfileId, activeProfileRevision);
      return await exchangeOAuthCode(args.workspaceId, args.appId, args.code, args.redirectUri, args.profileId);
    }
    case "meta_oauth_open": {
      const url = new URL(args.authorizationUrl);
      const state = url.searchParams.get("state");
      metaOAuthWatches.set(state, { workspaceId: args.workspaceId, appId: args.appId, platform: args.platform, profileId: activeProfileId, profileRevision: activeProfileRevision, session: null });
      const session = await navigateChromeProvider("meta", { url: args.authorizationUrl, userDataRoot: providerUserDataRoot(activeProfileId) });
      metaOAuthWatches.get(state).session = session;
      return { opened: true, engine: "chromium", persistentProfile: true };
    }
    case "meta_oauth_wait": return await waitForMetaOAuth(args.state);
    case "worker_request": return await requestLocalWorker(args);
    case "oauth_callback_ready": {
      rendererOAuthReady = true;
      const urls = pendingOAuthUrls;
      pendingOAuthUrls = [];
      return urls;
    }
    case "meta_publish_unpublished_page_post":
      return await publishPage(args.workspaceId, args.pageId, args.message, `unpublished:${args.pageId}`, { published: false, profileId: activeProfileId });
    case "meta_publish_page_job":
      return await publishPage(args.workspaceId, args.pageId, args.message, args.idempotencyKey, { published: true, profileId: activeProfileId });
    case "meta_publish_page_photo_job":
      return await publishPage(args.workspaceId, args.pageId, args.caption, args.idempotencyKey, { imageUrl: args.mediaUrl, published: true, profileId: activeProfileId });
    case "meta_publish_page_video_job":
      return await publishPageVideo(args.workspaceId, args.pageId, args.caption, args.mediaUrl, args.idempotencyKey, { published: true, profileId: activeProfileId });
    case "meta_publish_instagram_job":
      return await publishInstagram(args.workspaceId, args.pageId, args.instagramUserId, args.caption, args.mediaUrl, args.mediaKind, args.idempotencyKey, activeProfileId);
    case "export_json": {
      const location = path.join(app.getPath("downloads"), validateFilename(args.filename));
      fs.writeFileSync(location, String(args.contents || ""), { encoding: "utf8", mode: 0o600 });
      return location;
    }
    default: throw new Error(`ELECTRON_COMMAND_NOT_IMPLEMENTED:${command}`);
  }
}

function createMainWindow() {
  rendererOAuthReady = false;
  nativeTheme.themeSource = "light";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "SignalFlow · Social operating system",
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--signalflow-control-plane-port=${runtimePorts.controlPlanePort}`,
        `--signalflow-worker-port=${runtimePorts.workerPort}`,
      ],
    },
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => console.error("SignalFlow renderer failed", errorCode, errorDescription, validatedURL));
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => console.error("SignalFlow preload failed", preloadPath, error));
  mainWindow.webContents.on("render-process-gone", (_event, details) => console.error("SignalFlow renderer exited", details));
  const devUrl = app.isPackaged ? "" : process.env.SIGNALFLOW_DEV_URL;
  rendererPolicy = createRendererPolicy({ isPackaged: app.isPackaged, devUrl, rendererPath: path.join(__dirname, "..", "dist", "index.html") });
  if (process.env.SIGNALFLOW_DEV_URL && app.isPackaged) console.warn("SignalFlow ignored SIGNALFLOW_DEV_URL in packaged mode");
  if (devUrl && !rendererPolicy.devOrigin) console.warn("SignalFlow ignored non-local SIGNALFLOW_DEV_URL");
  if (rendererPolicy.devOrigin) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.on("closed", () => { rendererOAuthReady = false; });
}

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient("signalflow");
  const sourceRoot = path.resolve(__dirname, "..");
  const userDataRoot = app.getPath("userData");
  let persistedSelection = null;
  try {
    persistedSelection = readActiveProfileSelection(userDataRoot);
    nativeProfileSelection = persistedSelection;
    const configuredProfileId = process.env.SIGNALFLOW_PROFILE_ID;
    activeProfileId = configuredProfileId || persistedSelection?.profileId || "profile-bavy";
    if (configuredProfileId && persistedSelection?.profileId !== configuredProfileId) {
      persistedSelection = null;
      nativeProfileSelection = null;
    }
  } catch (error) {
    startupFailure = error instanceof Error ? error.message : "PROFILE_SELECTION_INVALID";
  }
  try { setActiveProfileContext(activeProfileId); }
  catch (error) { startupFailure = error instanceof Error ? error.message : "PROFILE_ID_INVALID"; }
  if (!startupFailure) {
    try {
      workerSupervisor = createWorkerSupervisor({
        userDataRoot,
        profileId: activeProfileId,
        runtimeId: persistedSelection?.runtimeId,
        persistActiveProfile: (selection) => {
          nativeProfileSelection = writeActiveProfileSelection(userDataRoot, selection);
          return nativeProfileSelection;
        },
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        sourceRoot,
        env: process.env,
        legacyDataRoots: process.env.SIGNALFLOW_LEGACY_DATA_ROOT ? [process.env.SIGNALFLOW_LEGACY_DATA_ROOT] : [],
      });
    } catch (error) {
      startupFailure = error instanceof Error ? error.message : "PROFILE_RUNTIME_NOT_READY";
    }
  }
  ipcMain.handle("signalflow:invoke", async (event, command, args) => {
    assertTrustedRenderer(event, mainWindow, rendererPolicy);
    if (typeof command !== "string" || command.length > 128) throw new Error("ELECTRON_COMMAND_INVALID");
    const activation = command === "profile_activate";
    const requestProfileId = activeProfileId;
    const requestProfileRevision = activeProfileRevision;
    if (activation) profileActivationPending += 1;
    if (!activation && (profileActivationPending > 0 || workerSupervisor?.isSwitching())) throw new Error("PROFILE_BUSY");
    if (!activation && command !== "profile_selection") {
      if (startupFailure) throw new Error(startupFailure);
      assertRuntimeOperationAllowed(workerSupervisor?.status(), activeProfileId, profileActivationPending);
    }
    if (!activation) activeRuntimeOperations += 1;
    try {
      const result = await invokeCommand(command, args);
      if (!activation && command !== "profile_selection") assertProfileRequestCurrent(requestProfileId, requestProfileRevision, activeProfileId, activeProfileRevision);
      return result;
    } finally {
      if (activation) profileActivationPending -= 1;
      else activeRuntimeOperations -= 1;
    }
  });
  ipcMain.handle("signalflow:open-url", async (event, url) => {
    assertTrustedRenderer(event, mainWindow, rendererPolicy);
    await shell.openExternal(safeExternalUrl(url));
  });
  createMainWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
}).catch((error) => { console.error("SignalFlow Electron startup failed", error); app.quit(); });

installGracefulQuitHandlers({ app, dialog, signalEmitter: process, getWorkerSupervisor: () => workerSupervisor });

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
