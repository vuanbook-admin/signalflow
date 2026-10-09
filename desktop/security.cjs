const path = require("node:path");
const { fileURLToPath } = require("node:url");

const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_MEDIA_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const LOCAL_MEDIA_IMPORT_MAX_BASE64_CHARS = Math.ceil(LOCAL_MEDIA_IMPORT_MAX_BYTES / 3) * 4;
const COMMAND_STRING_LIMITS = {
  workspaceId: 128,
  pageId: 64,
  account: 512,
  idempotencyKey: 512,
  prompt: 40_000,
  message: 63_206,
  mediaUrl: 4_096,
  filename: 180,
  contents: 2_000_000,
  localAssetPath: 4_096,
  providerFileId: 256,
  mimeType: 128,
  modifiedAt: 64,
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArg(args, key, limit, { required = true, pattern } = {}) {
  const value = args[key];
  if (typeof value !== "string" || (required && !value.trim()) || value.length > limit || /[\u0000]/.test(value)) {
    throw new Error(`ELECTRON_ARG_INVALID:${key}`);
  }
  if (pattern && value.trim() && !pattern.test(value.trim())) throw new Error(`ELECTRON_ARG_INVALID:${key}`);
  return value;
}

function booleanArg(args, key) {
  if (typeof args[key] !== "boolean") throw new Error(`ELECTRON_ARG_INVALID:${key}`);
  return args[key];
}

function rejectDriveSecretShapedArg(args, key) {
  const value = args[key];
  if (typeof value === "string" && /(?:cookie|token|password|passwd|secret|credential|keychain|session|auth|oauth|private[-_ ]?key|\.env|\.pem|\.p12|\.pfx|\.sqlite(?:3)?|\.db(?:-wal|-shm)?)/i.test(value)) throw new Error(`ELECTRON_ARG_INVALID:${key}`);
}

function localDevOrigin(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!(url.protocol === "http:" || url.protocol === "https:") || !LOCAL_DEV_HOSTS.has(url.hostname) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function createRendererPolicy({ isPackaged, devUrl, rendererPath }) {
  return {
    rendererPath: path.resolve(rendererPath),
    devOrigin: isPackaged ? null : localDevOrigin(devUrl),
  };
}

function isTrustedRendererUrl(rawUrl, policy) {
  if (typeof rawUrl !== "string" || !policy) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "file:") return path.resolve(fileURLToPath(url)) === policy.rendererPath;
    return Boolean(policy.devOrigin) && url.origin === policy.devOrigin;
  } catch {
    return false;
  }
}

function assertTrustedRenderer(event, mainWindow, policy) {
  if (!event?.sender || !mainWindow?.webContents || event.sender !== mainWindow.webContents || !isTrustedRendererUrl(event.senderFrame?.url, policy)) {
    throw new Error("ELECTRON_UNTRUSTED_RENDERER");
  }
}

function safeExternalUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > 4096) throw new Error("ELECTRON_EXTERNAL_URL_INVALID");
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error("ELECTRON_EXTERNAL_URL_INVALID");
    return url.toString();
  } catch {
    throw new Error("ELECTRON_EXTERNAL_URL_INVALID");
  }
}

function validateCommandArgs(command, rawArgs = {}) {
  if (!isRecord(rawArgs)) throw new Error("ELECTRON_ARGS_INVALID");
  const args = rawArgs;
  switch (command) {
    case "import_local_media": {
      const keys = ["clientId", "brandId", "fileName", "declaredMimeType", "fileBytesBase64"];
      if (Object.keys(args).length !== keys.length || keys.some((key) => !Object.hasOwn(args, key))) throw new Error("ELECTRON_ARGS_INVALID");
      stringArg(args, "clientId", 128, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ });
      stringArg(args, "brandId", 128, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ });
      stringArg(args, "fileName", COMMAND_STRING_LIMITS.filename, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/ });
      for (const key of ["clientId", "brandId", "fileName"]) {
        if (args[key].includes("..") || args[key].endsWith(".")) throw new Error(`ELECTRON_ARG_INVALID:${key}`);
        rejectDriveSecretShapedArg(args, key);
      }
      stringArg(args, "declaredMimeType", COMMAND_STRING_LIMITS.mimeType, { pattern: /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/ });
      if (!["image/png", "image/jpeg", "image/webp"].includes(args.declaredMimeType.toLowerCase())) throw new Error("LOCAL_MEDIA_IMPORT_MIME_UNSUPPORTED");
      if (typeof args.fileBytesBase64 !== "string") throw new Error("ELECTRON_ARG_INVALID:fileBytesBase64");
      if (args.fileBytesBase64.length > LOCAL_MEDIA_IMPORT_MAX_BASE64_CHARS) throw new Error("LOCAL_MEDIA_IMPORT_TOO_LARGE");
      stringArg(args, "fileBytesBase64", LOCAL_MEDIA_IMPORT_MAX_BASE64_CHARS);
      const padding = args.fileBytesBase64.endsWith("==") ? 2 : args.fileBytesBase64.endsWith("=") ? 1 : 0;
      const base64Body = args.fileBytesBase64.slice(0, args.fileBytesBase64.length - padding);
      const expectedRemainder = padding === 2 ? 2 : padding === 1 ? 3 : 0;
      if (args.fileBytesBase64.length % 4 !== 0 || base64Body.length % 4 !== expectedRemainder || !/^[A-Za-z0-9+/]*$/.test(base64Body)) throw new Error("ELECTRON_ARG_INVALID:fileBytesBase64");
      const sizeBytes = (args.fileBytesBase64.length / 4) * 3 - padding;
      if (sizeBytes < 1) throw new Error("ELECTRON_ARG_INVALID:fileBytesBase64");
      if (sizeBytes > LOCAL_MEDIA_IMPORT_MAX_BYTES) throw new Error("LOCAL_MEDIA_IMPORT_TOO_LARGE");
      return args;
    }
    case "gemini_web_open":
    case "gemini_web_status":
      if (args.workspaceId !== undefined) stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { required: false, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      return args;
    case "drive_download_asset":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      if (args.clientId !== undefined) stringArg(args, "clientId", COMMAND_STRING_LIMITS.workspaceId, { required: false, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      if (args.brandId !== undefined) stringArg(args, "brandId", COMMAND_STRING_LIMITS.workspaceId, { required: false, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      if (args.platform !== undefined) stringArg(args, "platform", 32, { required: false, pattern: /^(?:facebook|instagram|tiktok|youtube)$/ });
      if (args.capturedAt !== undefined) stringArg(args, "capturedAt", COMMAND_STRING_LIMITS.modifiedAt, { required: false });
      if (args.contentRunId !== undefined) stringArg(args, "contentRunId", COMMAND_STRING_LIMITS.workspaceId, { required: false, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "providerFileId", COMMAND_STRING_LIMITS.providerFileId, { pattern: /^[A-Za-z0-9_-]{1,256}$/ });
      stringArg(args, "filename", COMMAND_STRING_LIMITS.filename, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/ });
      rejectDriveSecretShapedArg(args, "workspaceId");
      rejectDriveSecretShapedArg(args, "providerFileId");
      rejectDriveSecretShapedArg(args, "filename");
      if (args.mimeType !== undefined) stringArg(args, "mimeType", COMMAND_STRING_LIMITS.mimeType, { required: false, pattern: /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/ });
      if (args.modifiedAt !== undefined) stringArg(args, "modifiedAt", COMMAND_STRING_LIMITS.modifiedAt, { required: false });
      if (args.publicReachabilityConfirmed !== undefined) booleanArg(args, "publicReachabilityConfirmed");
      return args;
    case "store_generated_media":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "clientId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "brandId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "platform", 32, { pattern: /^(?:facebook|instagram|tiktok|youtube)$/ });
      stringArg(args, "capturedAt", COMMAND_STRING_LIMITS.modifiedAt);
      stringArg(args, "contentRunId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "localAssetPath", COMMAND_STRING_LIMITS.localAssetPath);
      stringArg(args, "filename", COMMAND_STRING_LIMITS.filename, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/ });
      if (args.mimeType !== undefined) stringArg(args, "mimeType", COMMAND_STRING_LIMITS.mimeType, { required: false, pattern: /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/ });
      rejectDriveSecretShapedArg(args, "workspaceId");
      rejectDriveSecretShapedArg(args, "clientId");
      rejectDriveSecretShapedArg(args, "brandId");
      rejectDriveSecretShapedArg(args, "contentRunId");
      rejectDriveSecretShapedArg(args, "localAssetPath");
      rejectDriveSecretShapedArg(args, "filename");
      return args;
    case "drive_analyze_local_asset":
      stringArg(args, "localAssetPath", COMMAND_STRING_LIMITS.localAssetPath);
      if (!path.isAbsolute(args.localAssetPath.trim())) throw new Error("ELECTRON_ARG_INVALID:localAssetPath");
      rejectDriveSecretShapedArg(args, "localAssetPath");
      if (args.mimeType !== undefined) stringArg(args, "mimeType", COMMAND_STRING_LIMITS.mimeType, { required: false, pattern: /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/ });
      if (args.modifiedAt !== undefined) stringArg(args, "modifiedAt", COMMAND_STRING_LIMITS.modifiedAt, { required: false });
      return args;
    case "drive_upload_asset":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "localAssetPath", COMMAND_STRING_LIMITS.localAssetPath);
      stringArg(args, "filename", COMMAND_STRING_LIMITS.filename, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/ });
      rejectDriveSecretShapedArg(args, "workspaceId");
      rejectDriveSecretShapedArg(args, "localAssetPath");
      rejectDriveSecretShapedArg(args, "filename");
      return args;
    case "drive_make_public":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "providerFileId", COMMAND_STRING_LIMITS.providerFileId, { pattern: /^[A-Za-z0-9_-]{1,256}$/ });
      rejectDriveSecretShapedArg(args, "workspaceId");
      rejectDriveSecretShapedArg(args, "providerFileId");
      return args;
    case "drive_web_open":
    case "drive_inventory":
    case "drive_web_status":
    case "chatgpt_web_open":
    case "chatgpt_web_status":
      if (args.workspaceId !== undefined) stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { required: false, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      return args;
    case "flow_web_open":
    case "flow_web_status":
      return args;
    case "profile_activate":
      stringArg(args, "profileId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[a-z0-9][a-z0-9_-]{0,63}$/ });
      return args;
    case "profile_selection":
      return args;
    case "gemini_web_complete":
    case "chatgpt_web_complete":
      stringArg(args, "prompt", COMMAND_STRING_LIMITS.prompt);
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId);
      if (args.attachmentPath !== undefined) stringArg(args, "attachmentPath", 4_096);
      if (args.attachmentPaths !== undefined) {
        if (!Array.isArray(args.attachmentPaths) || args.attachmentPaths.length < 1 || args.attachmentPaths.length > 6) throw new Error("ELECTRON_ARG_INVALID:attachmentPaths");
        args.attachmentPaths.forEach((value) => { if (typeof value !== "string" || !value.trim() || value.length > 4_096 || /[\u0000]/.test(value)) throw new Error("ELECTRON_ARG_INVALID:attachmentPaths"); });
      }
      if (args.attachmentHashes !== undefined) {
        if (!Array.isArray(args.attachmentHashes) || args.attachmentHashes.length < 1 || args.attachmentHashes.length > 6) throw new Error("ELECTRON_ARG_INVALID:attachmentHashes");
        args.attachmentHashes.forEach((value) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value.replace(/^sha256:/i, ""))) throw new Error("ELECTRON_ARG_INVALID:attachmentHashes"); });
      }
      stringArg(args, "model", 128, { required: false });
      return args;
    case "flow_web_generate_image":
    case "flow_web_generate_video":
      stringArg(args, "prompt", COMMAND_STRING_LIMITS.prompt);
      return args;
    case "vertex_ai_status":
    case "vertex_ai_clear_config":
    case "vertex_ai_verify":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      return args;
    case "vertex_ai_save_config":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "projectId", 64, { pattern: /^[a-z][a-z0-9-]{4,62}[a-z0-9]$/ });
      stringArg(args, "location", 64, { pattern: /^[a-z0-9-]+$/ });
      stringArg(args, "model", 128, { pattern: /^[A-Za-z0-9._-]+$/ });
      return args;
    case "vertex_ai_generate_image":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "prompt", COMMAND_STRING_LIMITS.prompt);
      return args;
    case "secret_set":
      stringArg(args, "account", COMMAND_STRING_LIMITS.account);
      stringArg(args, "secret", 100_000, { required: false });
      return args;
    case "provider_discover_models": {
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/ });
      stringArg(args, "providerKind", 32, { pattern: /^(?:openrouter|google_gemini_api|vertex_ai|openai_official|openai_compatible|nvidia_nim|opencode_go)$/ });
      if (args.baseUrl !== undefined) {
        stringArg(args, "baseUrl", 500);
        let parsed;
        try {
          parsed = new URL(args.baseUrl.trim());
        } catch {
          throw new Error("ELECTRON_ARG_INVALID:baseUrl");
        }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("ELECTRON_ARG_INVALID:baseUrl");
      }
      return args;
    }
    case "secret_get":
    case "secret_delete":
      stringArg(args, "account", COMMAND_STRING_LIMITS.account);
      return args;
    case "meta_save_access_token":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "accessToken", 8_192);
      return args;
    case "meta_discover_accounts":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      return args;
    case "meta_verify_page":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "pageId", COMMAND_STRING_LIMITS.pageId, { pattern: /^\d{1,64}$/ });
      return args;
    case "meta_exchange_long_lived_token":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "appId", 64, { pattern: /^\d{1,64}$/ });
      return args;
    case "meta_exchange_oauth_code":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "appId", 64, { pattern: /^\d{1,64}$/ });
      stringArg(args, "code", 4_096);
      stringArg(args, "profileId", 64, { pattern: /^[a-z0-9][a-z0-9_-]{0,63}$/ });
      if (!Number.isSafeInteger(args.profileRevision) || args.profileRevision < 0) throw new Error("ELECTRON_ARG_INVALID:profileRevision");
      if (args.redirectUri !== "https://localhost/oauth/callback") throw new Error("ELECTRON_ARG_INVALID:redirectUri");
      return args;
    case "meta_oauth_open": {
      stringArg(args, "authorizationUrl", 4_096);
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "appId", 64, { pattern: /^\d{1,64}$/ });
      stringArg(args, "platform", 32, { pattern: /^(facebook|instagram)$/ });
      const url = new URL(args.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "www.facebook.com" || !/^\/v\d+\.\d+\/dialog\/oauth$/.test(url.pathname) || url.searchParams.get("redirect_uri") !== "https://localhost/oauth/callback" || !/^\d{1,64}$/.test(url.searchParams.get("client_id") ?? "") || !/^[A-Za-z0-9._:-]{16,256}$/.test(url.searchParams.get("state") ?? "")) throw new Error("ELECTRON_ARG_INVALID:authorizationUrl");
      return args;
    }
    case "worker_request": {
      stringArg(args, "path", 512, { pattern: /^\/(?:health|v1\/(?:jobs|stop|recover))(?:\?workspace_id=[A-Za-z0-9%._:-]+)?$/ });
      if (args.path.includes("?")) {
        const url = new URL(args.path, "http://127.0.0.1");
        const workspaceId = url.searchParams.get("workspace_id") ?? "";
        if (args.method !== "GET" || !["/health", "/v1/jobs"].includes(url.pathname) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(workspaceId)) throw new Error("ELECTRON_ARG_INVALID:path");
      } else if (["/v1/stop", "/v1/recover"].includes(args.path) ? args.method !== "POST" : args.method !== "GET") throw new Error("ELECTRON_ARG_INVALID:path");
      stringArg(args, "method", 8, { pattern: /^(GET|POST)$/ });
      stringArg(args, "body", 200_000, { required: false });
      return args;
    }
    case "meta_oauth_wait": {
      stringArg(args, "state", 256, { pattern: /^[A-Za-z0-9._:-]{16,256}$/ });
      return args;
    }
    case "oauth_callback_ready":
      return args;
    case "meta_publish_unpublished_page_post":
      stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
      stringArg(args, "pageId", COMMAND_STRING_LIMITS.pageId, { pattern: /^\d{1,64}$/ });
      stringArg(args, "message", COMMAND_STRING_LIMITS.message);
      return args;
    case "meta_publish_page_job":
      validateLiveMetaArgs(args, { media: false });
      return args;
    case "meta_publish_page_photo_job":
      validateLiveMetaArgs(args, { media: true });
      stringArg(args, "caption", COMMAND_STRING_LIMITS.message);
      stringArg(args, "mediaUrl", COMMAND_STRING_LIMITS.mediaUrl);
      assertHttpsUrl(args.mediaUrl, "mediaUrl");
      return args;
    case "meta_publish_page_video_job":
      validateLiveMetaArgs(args, { media: true });
      stringArg(args, "caption", COMMAND_STRING_LIMITS.message);
      stringArg(args, "mediaUrl", COMMAND_STRING_LIMITS.mediaUrl);
      assertHttpsUrl(args.mediaUrl, "mediaUrl");
      return args;
    case "meta_publish_instagram_job":
      validateLiveMetaArgs(args, { media: true });
      stringArg(args, "instagramUserId", COMMAND_STRING_LIMITS.pageId, { pattern: /^\d{1,64}$/ });
      stringArg(args, "caption", COMMAND_STRING_LIMITS.message);
      stringArg(args, "mediaUrl", COMMAND_STRING_LIMITS.mediaUrl);
      assertHttpsUrl(args.mediaUrl, "mediaUrl");
      if (args.mediaKind !== "image" && args.mediaKind !== "video") throw new Error("ELECTRON_ARG_INVALID:mediaKind");
      return args;
    case "export_json":
      stringArg(args, "filename", COMMAND_STRING_LIMITS.filename, { pattern: /^[a-zA-Z0-9._-]+$/ });
      stringArg(args, "contents", COMMAND_STRING_LIMITS.contents, { required: false });
      return args;
    default:
      throw new Error(`ELECTRON_COMMAND_NOT_IMPLEMENTED:${command}`);
  }
}

function validateLiveMetaArgs(args, { media }) {
  stringArg(args, "workspaceId", COMMAND_STRING_LIMITS.workspaceId, { pattern: /^[A-Za-z0-9._:-]+$/ });
  stringArg(args, "pageId", COMMAND_STRING_LIMITS.pageId, { pattern: /^\d{1,64}$/ });
  stringArg(args, "idempotencyKey", COMMAND_STRING_LIMITS.idempotencyKey);
  if (args.approvalState !== "approved") throw new Error("META_APPROVAL_REQUIRED");
  if (Object.hasOwn(args, "safeMode")) throw new Error("ELECTRON_ARGS_INVALID");
  if (media === false) stringArg(args, "message", COMMAND_STRING_LIMITS.message);
}

function assertHttpsUrl(rawUrl, key) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`ELECTRON_ARG_INVALID:${key}`);
  }
}

function assertProfileRequestCurrent(requestProfileId, requestRevision, activeProfileId, activeProfileRevision) {
  if (requestProfileId !== activeProfileId || requestRevision !== activeProfileRevision) throw new Error("PROFILE_RESULT_STALE");
  return true;
}

module.exports = {
  assertProfileRequestCurrent,
  assertTrustedRenderer,
  createRendererPolicy,
  isTrustedRendererUrl,
  localDevOrigin,
  LOCAL_MEDIA_IMPORT_MAX_BYTES,
  safeExternalUrl,
  validateCommandArgs,
};
