const { getSecret, setSecret } = require("./secure-store.cjs");

const GRAPH_VERSION = "v23.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function workspaceKey(workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 128) throw new Error("META_WORKSPACE_INVALID");
  return workspaceId.trim();
}

function tokenAccount(workspaceId) {
  return `workspace:${workspaceKey(workspaceId)}:meta:manual-access-token`;
}

function secretAccount(workspaceId) {
  return `workspace:${workspaceKey(workspaceId)}:meta:app-secret`;
}

function pageTokenAccount(workspaceId, pageId) {
  if (!/^\d{1,64}$/.test(pageId)) throw new Error("META_PAGE_ID_INVALID");
  return `workspace:${workspaceKey(workspaceId)}:meta:page-access-token:${pageId}`;
}

function profileAccount(profileId, account) {
  if (profileId === undefined) return account;
  if (typeof profileId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  return `profile:${profileId}:${account}`;
}

function readProfileSecret(profileId, account) {
  return getSecret(profileAccount(profileId, account));
}

function writeProfileSecret(profileId, account, value) {
  return setSecret(profileAccount(profileId, account), value);
}

async function graph(path, params, method = "POST") {
  const response = await fetch(`${GRAPH_URL}${path}`, { method, headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: method === "GET" ? undefined : new URLSearchParams(params) });
  let payload = {};
  try { payload = await response.json(); } catch { throw new Error("META_GRAPH_INVALID_RESPONSE"); }
  if (!response.ok || payload.error) throw new Error(`META_GRAPH_API_REJECTED_${payload.error?.code ?? response.status}`);
  return payload;
}

async function discoverMetaAccounts(workspaceId, profileId) {
  const token = readProfileSecret(profileId, tokenAccount(workspaceId));
  if (!token) throw new Error("META_ACCESS_TOKEN_NOT_CONFIGURED");
  const query = new URLSearchParams({ fields: "id,name,tasks,instagram_business_account,access_token" });
  const response = await fetch(`${GRAPH_URL}/me/accounts?${query.toString()}`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
  let payload = {};
  try { payload = await response.json(); } catch { throw new Error("META_GRAPH_INVALID_RESPONSE"); }
  if (!response.ok || payload.error) throw new Error(`META_GRAPH_API_REJECTED_${payload.error?.code ?? response.status}`);
  const hints = [];
  for (const page of Array.isArray(payload.data) ? payload.data : []) {
    if (!page?.id) continue;
    if (page.access_token) writeProfileSecret(profileId, pageTokenAccount(workspaceId, String(page.id)), String(page.access_token));
    hints.push({ id: String(page.id), name: page.name ? String(page.name) : undefined, kind: "page", tasks: Array.isArray(page.tasks) ? page.tasks : undefined, instagram_business_account: page.instagram_business_account });
  }
  return { provider: "meta", status: "connected", tokenBoundary: "env_file", accountHints: hints };
}

async function requestOAuthToken(query) {
  const response = await fetch(`${GRAPH_URL}/oauth/access_token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(query) });
  let payload = {};
  try { payload = await response.json(); } catch { throw new Error("META_GRAPH_INVALID_RESPONSE"); }
  if (!response.ok || payload.error || !payload.access_token) throw new Error(`META_GRAPH_API_REJECTED_${payload.error?.code ?? response.status}`);
  return payload;
}

async function exchangeLongLivedToken(workspaceId, appId, profileId) {
  if (!/^\d{1,64}$/.test(String(appId || ""))) throw new Error("META_APP_ID_INVALID");
  const token = readProfileSecret(profileId, tokenAccount(workspaceId));
  const secret = readProfileSecret(profileId, secretAccount(workspaceId));
  if (!token) throw new Error("META_ACCESS_TOKEN_NOT_CONFIGURED");
  if (!secret) throw new Error("META_APP_SECRET_NOT_CONFIGURED");
  const payload = await requestOAuthToken({ grant_type: "fb_exchange_token", client_id: String(appId), client_secret: secret, fb_exchange_token: token });
  writeProfileSecret(profileId, tokenAccount(workspaceId), String(payload.access_token));
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : null;
  return { provider: "meta", status: "long_lived_token_saved", expiresIn, expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null, tokenBoundary: "env_file" };
}

async function exchangeOAuthCode(workspaceId, appId, code, redirectUri, profileId) {
  if (!/^\d{1,64}$/.test(String(appId || ""))) throw new Error("META_APP_ID_INVALID");
  if (typeof code !== "string" || !code.trim() || code.length > 4_096) throw new Error("META_OAUTH_CODE_INVALID");
  if (redirectUri !== "https://localhost/oauth/callback") throw new Error("META_OAUTH_REDIRECT_INVALID");
  const secret = readProfileSecret(profileId, secretAccount(workspaceId));
  if (!secret) throw new Error("META_APP_SECRET_NOT_CONFIGURED");
  const shortLived = await requestOAuthToken({ client_id: String(appId), client_secret: secret, redirect_uri: redirectUri, code: code.trim() });
  const longLived = await requestOAuthToken({ grant_type: "fb_exchange_token", client_id: String(appId), client_secret: secret, fb_exchange_token: String(shortLived.access_token) });
  writeProfileSecret(profileId, tokenAccount(workspaceId), String(longLived.access_token));
  const discovery = await discoverMetaAccounts(workspaceId, profileId);
  const expiresIn = typeof longLived.expires_in === "number" ? longLived.expires_in : null;
  return { ...discovery, status: "oauth_connected", expiresIn, expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null };
}

async function verifyPage(workspaceId, pageId, profileId) {
  const token = readProfileSecret(profileId, pageTokenAccount(workspaceId, pageId));
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN_NOT_CONFIGURED");
  const query = new URLSearchParams({ fields: "id,name" });
  const response = await fetch(`${GRAPH_URL}/${pageId}?${query.toString()}`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
  let payload = {};
  try { payload = await response.json(); } catch { throw new Error("META_GRAPH_INVALID_RESPONSE"); }
  if (!response.ok || payload.error) throw new Error(`META_GRAPH_API_REJECTED_${payload.error?.code ?? response.status}`);
  return { provider: "meta", status: "connected", pageId: String(payload.id || pageId), name: payload.name ? String(payload.name) : undefined, tokenBoundary: "env_file" };
}

async function publishPage(workspaceId, pageId, message, idempotencyKey, { imageUrl, published = true, profileId } = {}) {
  const marker = `workspace:${workspaceKey(workspaceId)}:meta:queue:${imageUrl ? "photo:" : ""}${idempotencyKey}`;
  const existing = readProfileSecret(profileId, marker);
  if (existing) return { provider: "meta", providerJobId: existing, providerState: "published", published, idempotentReplay: true, tokenBoundary: "env_file" };
  const token = readProfileSecret(profileId, pageTokenAccount(workspaceId, pageId));
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN_NOT_CONFIGURED");
  const payload = imageUrl ? await graph(`/${pageId}/photos`, { url: imageUrl, caption: message, published: String(published), access_token: token }) : await graph(`/${pageId}/feed`, { message, published: String(published), access_token: token });
  const providerJobId = String(payload.post_id || payload.id || "");
  if (!providerJobId) throw new Error("META_GRAPH_MISSING_POST_ID");
  writeProfileSecret(profileId, marker, providerJobId);
  return { provider: "meta", providerJobId, providerState: published ? "published" : "accepted", published, idempotentReplay: false, tokenBoundary: "env_file" };
}

async function publishPageVideo(workspaceId, pageId, caption, mediaUrl, idempotencyKey, { published = true, scheduledPublishTime, profileId } = {}) {
  if (typeof mediaUrl !== "string" || !/^https:\/\//i.test(mediaUrl)) throw new Error("META_PAGE_VIDEO_URL_INVALID");
  const marker = `workspace:${workspaceKey(workspaceId)}:meta:queue:video:${idempotencyKey}`;
  const existing = readProfileSecret(profileId, marker);
  if (existing) return { provider: "meta", providerJobId: existing, providerState: "published", published, idempotentReplay: true, tokenBoundary: "env_file" };
  const token = readProfileSecret(profileId, pageTokenAccount(workspaceId, pageId));
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN_NOT_CONFIGURED");
  const params = { file_url: mediaUrl, description: caption, published: String(published), access_token: token };
  if (scheduledPublishTime !== undefined) params.scheduled_publish_time = String(scheduledPublishTime);
  const payload = await graph(`/${pageId}/videos`, params);
  const providerJobId = String(payload.id || payload.video_id || "");
  if (!providerJobId) throw new Error("META_GRAPH_MISSING_VIDEO_ID");
  writeProfileSecret(profileId, marker, providerJobId);
  return { provider: "meta", providerJobId, providerState: published ? "published" : "accepted", published, idempotentReplay: false, tokenBoundary: "env_file" };
}
async function publishInstagram(workspaceId, pageId, instagramUserId, caption, mediaUrl, mediaKind, idempotencyKey, profileId) {
  if (!/^\d{1,64}$/.test(String(instagramUserId || ""))) throw new Error("META_INSTAGRAM_USER_ID_INVALID");
  const marker = `workspace:${workspaceKey(workspaceId)}:meta:instagram:${idempotencyKey}`;
  const existing = readProfileSecret(profileId, marker);
  if (existing) return { provider: "meta", providerJobId: existing, providerState: "published", published: true, idempotentReplay: true, tokenBoundary: "env_file" };
  const token = readProfileSecret(profileId, pageTokenAccount(workspaceId, pageId));
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN_NOT_CONFIGURED");
  const params = { caption, access_token: token };
  if (mediaKind === "image") params.image_url = mediaUrl;
  else if (mediaKind === "video") { params.media_type = "REELS"; params.video_url = mediaUrl; }
  else throw new Error("META_INSTAGRAM_MEDIA_KIND_INVALID");
  const container = await graph(`/${instagramUserId}/media`, params);
  if (!container.id) throw new Error("META_INSTAGRAM_MISSING_CONTAINER_ID");
  if (mediaKind === "video") {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await fetch(`${GRAPH_URL}/${container.id}?fields=status_code`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
      const status = await statusResponse.json();
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`META_INSTAGRAM_CONTAINER_${status.status_code}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  const published = await graph(`/${instagramUserId}/media_publish`, { creation_id: container.id, access_token: token });
  const providerJobId = String(published.id || container.id);
  writeProfileSecret(profileId, marker, providerJobId);
  return { provider: "meta", providerJobId, providerState: "published", published: true, idempotentReplay: false, tokenBoundary: "env_file" };
}

module.exports = { discoverMetaAccounts, exchangeLongLivedToken, exchangeOAuthCode, publishPage, publishPageVideo, publishInstagram, verifyPage };
