function isSignalFlowOAuthCallback(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4_096) return false;
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || url.port) return false;
    if (url.protocol === "https:" && url.hostname === "localhost" && url.pathname === "/oauth/callback") return true;
    if (url.protocol !== "signalflow:") return false;
    return (url.hostname === "oauth" && url.pathname === "/callback") || (url.hostname === "" && url.pathname === "/oauth/callback");
  } catch {
    return false;
  }
}

function filterOAuthCallbackUrls(values) {
  return Array.isArray(values) ? values.filter(isSignalFlowOAuthCallback) : [];
}

function isMetaHttpsCallback(rawUrl) {
  if (!isSignalFlowOAuthCallback(rawUrl)) return false;
  try { const url = new URL(rawUrl); return url.protocol === "https:" && url.hostname === "localhost" && url.pathname === "/oauth/callback"; } catch { return false; }
}

module.exports = { filterOAuthCallbackUrls, isMetaHttpsCallback, isSignalFlowOAuthCallback };
