import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBridgeResponse, providerConfig, safeBridgeError, sameBridgeToken } from "./protocol.mjs";
import accountBrowser from "../desktop/account-browser.cjs";

describe("Chromium account bridge protocol", () => {
  it("keeps provider partitions and destinations separate", () => {
    expect(providerConfig("gemini")).toMatchObject({ profile: "gemini", engine: "chromium", url: "https://gemini.google.com/app" });
    expect(providerConfig("drive")).toMatchObject({ profile: "drive", engine: "chromium", url: "https://drive.google.com/drive/my-drive" });
    expect(providerConfig("chatgpt")).toMatchObject({ profile: "chatgpt", engine: "chromium", url: "https://chatgpt.com/" });
    expect(providerConfig("gemini").profile).not.toBe(providerConfig("drive").profile);
  });

  it("accepts only validated text or namespaced safe errors", () => {
    expect(parseBridgeResponse(JSON.stringify({ text: "READY", model: "gemini" }))).toMatchObject({ text: "READY" });
    expect(parseBridgeResponse(JSON.stringify({ error: "GEMINI_WEB_LOGIN_REQUIRED" }))).toMatchObject({ error: "GEMINI_WEB_LOGIN_REQUIRED" });
    expect(() => parseBridgeResponse(JSON.stringify({ error: "secret-token" }))).toThrow("BRIDGE_RESPONSE_INVALID");
    expect(() => parseBridgeResponse(JSON.stringify({ text: "" }))).toThrow("BRIDGE_RESPONSE_INVALID");
    expect(safeBridgeError("CHATGPT_WEB_LOGIN_REQUIRED")).toBe(true);
    expect(safeBridgeError("provider-secret")).toBe(false);
  });

  it("compares the local bridge token without accepting empty values", () => {
    expect(sameBridgeToken("bridge-secret", "bridge-secret")).toBe(true);
    expect(sameBridgeToken("bridge-secret", "other")).toBe(false);
    expect(sameBridgeToken("", "")).toBe(false);
  });

  it("keeps Gemini completion on the visible composer boundary", () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "desktop", "account-browser.cjs"), "utf8");
    expect(source).not.toContain("StreamGenerate");
    expect(source).not.toContain("SNlM0e");
    expect(source).toContain("getChromeProvider");
    expect(source).not.toContain("BrowserWindow");
    expect(source).not.toContain("setUserAgent");
    expect(source).toContain(".ql-clipboard");
    expect(source).toContain("GEMINI_SEND_NOT_CONFIRMED");
    expect(source).toContain("CHATGPT_SEND_NOT_CONFIRMED");
    expect(source).toContain("data-message-author-role=\"user\"");
    expect(source).toContain("beforeUserCount");
    expect(source).toContain("conversationNode");
    expect(source).toContain("dispatchEnter");
    expect(source).toContain("Array.isArray(parsed?.variants)");
    expect(source).toContain("contenteditable");
    expect(source).toContain("Enter");
    expect(source).toContain("assistant");
  });

  it("does not log renderer content from the packaged main process", () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "desktop", "main.cjs"), "utf8");
    expect(source).not.toContain("renderer snapshot");
    expect(source).not.toContain("did-finish-load");
    expect(source).not.toContain("console-message");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("document.body?.innerText");
  });

  it("normalizes compact Gemini responses at the native boundary", () => {
    const normalized = JSON.parse(accountBrowser.normalizeGeminiResponseText(`JSON\n${JSON.stringify({ title: "OK", body: "OK" })}`));
    expect(normalized.variants).toHaveLength(1);
    expect(normalized.variants[0]).toMatchObject({ title: "OK", body: "OK" });
  });
});
