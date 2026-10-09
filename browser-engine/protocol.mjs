const PROVIDERS = Object.freeze({
  gemini: Object.freeze({ profile: "gemini", url: "https://gemini.google.com/app", title: "Gemini Pro · SignalFlow", engine: "chromium" }),
  drive: Object.freeze({ profile: "drive", url: "https://drive.google.com/drive/my-drive", title: "Google Drive · SignalFlow", engine: "chromium" }),
  chatgpt: Object.freeze({ profile: "chatgpt", url: "https://chatgpt.com/", title: "ChatGPT Plus · SignalFlow", engine: "chromium" }),
});

const SAFE_ERROR_RE = /^(?:GEMINI|CHATGPT|DRIVE)_[A-Z0-9_]+$/;

export function providerConfig(provider) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error("BRIDGE_PROVIDER_INVALID");
  return config;
}

export function safeBridgeError(error) {
  return typeof error === "string" && SAFE_ERROR_RE.test(error);
}

export function parseBridgeResponse(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("BRIDGE_RESPONSE_INVALID");
  }
  if (!value || typeof value !== "object") throw new Error("BRIDGE_RESPONSE_INVALID");
  if (typeof value.error === "string") {
    if (!safeBridgeError(value.error)) throw new Error("BRIDGE_RESPONSE_INVALID");
    return { error: value.error };
  }
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 100_000) throw new Error("BRIDGE_RESPONSE_INVALID");
  return { text: value.text, ...(typeof value.model === "string" ? { model: value.model } : {}) };
}

export function sameBridgeToken(expected, received) {
  return typeof expected === "string" && expected.length > 0 && typeof received === "string" && received.length > 0 && expected === received;
}
