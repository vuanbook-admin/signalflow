import { describe, expect, it, vi } from "vitest";
import { GeminiWebAIGateway, buildGeminiWebPrompt, parseGeminiWebPayload } from "./geminiWebGateway";
import type { AIGenerationRequest } from "./mvpContracts";

const request: AIGenerationRequest = {
  workspaceId: "workspace-1",
  prompt: "Announce the new weekend menu",
  targetPlatforms: ["facebook", "instagram"],
  contentKinds: ["text"],
  brandSystem: {
    workspaceId: "workspace-1",
    voice: "Warm and concise",
    audience: "Local guests",
    prohibitedClaims: ["guaranteed results"],
    visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" },
  },
};

describe("Gemini web subscription gateway", () => {
  it("builds a visible-chat prompt with the requested brand contract", () => {
    const prompt = buildGeminiWebPrompt(request);
    expect(prompt).toContain("Announce the new weekend menu");
    expect(prompt).toContain("facebook, instagram");
    expect(prompt).toContain("Warm and concise");
    expect(prompt).toContain("Return only valid JSON");
  });

  it("maps attachment order to publish/reference roles and includes customer facts", () => {
    const prompt = buildGeminiWebPrompt({ ...request,
      customerFacts: ["Fabric: 100% cotton", "Care: machine washable"],
      mediaAttachments: [
        { assetId: "ref-1", localAssetPath: "/safe/ref.jpg", mimeType: "image/jpeg", sha256: "b".repeat(64), order: 1, role: "reference" },
        { assetId: "publish-1", localAssetPath: "/safe/publish.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" },
      ],
    });
    expect(prompt).toContain("1. publish (image/png)");
    expect(prompt).toContain("2. reference (image/jpeg)");
    expect(prompt).toContain("Fabric: 100% cotton");
    expect(prompt).toContain("Care: machine washable");
  });

  it("parses a JSON response without exposing browser session data", () => {
    const result = parseGeminiWebPayload(JSON.stringify({
      variants: [{ platform: "facebook", kind: "text", title: "Weekend menu", body: "Join us.", hashtags: [], metadata: {} }],
      safetyNotes: ["Human review required"],
    }));
    expect(result.provider).toBe("gemini_web");
    expect(result.variants[0]).toMatchObject({ platform: "facebook", title: "Weekend menu" });
    expect(JSON.stringify(result)).not.toMatch(/cookie|token|session/i);
  });

  it("normalizes Gemini's compact top-level response into the requested platform variant", () => {
    const result = parseGeminiWebPayload('JSON\n{"title":"OK","body":"OK"}', "facebook");
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({ platform: "facebook", kind: "text", title: "OK", body: "OK" });
  });

  it("preserves the Revo structured Content OS fields returned by the provider", () => {
    const result = parseGeminiWebPayload(JSON.stringify({ variants: [{ platform: "facebook", kind: "text", title: "AI topic", body: "A generated caption with enough detail.", content_pillar: "Practical education", objective: "Education", cta: "Save this post", hashtags: ["#one"], seo_keywords: ["topic keyword"], image_concept: "A clean editorial cover", rationale: "Fits the brand strategy" }] }));
    expect(result.variants[0]).toMatchObject({ contentPillar: "Practical education", objective: "Education", cta: "Save this post", seoKeywords: ["topic keyword"], hashtags: ["#one"] });
    expect(result.variants[0]?.metadata).toMatchObject({ imageConcept: "A clean editorial cover", strategyRationale: "Fits the brand strategy" });
  });

  it("invokes completion directly without a duplicate renderer-side provider open", async () => {
    const invoke = vi.fn(async () => ({ text: JSON.stringify({ variants: [{ platform: "facebook", kind: "text", title: "OK", body: "OK", hashtags: [], metadata: {} }], safetyNotes: [] }) }));
    const result = await new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" }).generate(request);
    expect(result.provider).toBe("gemini_web");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenNthCalledWith(1, "gemini_web_complete", expect.objectContaining({ model: "gemini-3.5-pro" }));
    expect(invoke).not.toHaveBeenCalledWith("gemini_web_open");
  });

  it("passes an app-owned image attachment to the native visible upload path", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => ({ text: JSON.stringify({ variants: [{ platform: "facebook", kind: "image", title: "OK", body: "OK", hashtags: [], metadata: {} }], safetyNotes: [] }), requestId: args?.requestId, attachmentEvidence: [{ assetId: "generated-1", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish", uploadState: "processed" }], attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload" }));
    await new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" }).generate({ ...request, metadata: { requestId: "content-run-gemini-1" }, imageAttachment: { assetId: "generated-1", localAssetPath: "/safe/app-owned/generated.png", mimeType: "image/png", sha256: "a".repeat(64) } });
    expect(invoke).toHaveBeenCalledWith("gemini_web_complete", expect.objectContaining({ attachmentPaths: ["/safe/app-owned/generated.png"], attachmentHashes: ["a".repeat(64)], attachmentManifest: [{ assetId: "generated-1", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish" }], requestId: "content-run-gemini-1" }));
  });

  it("passes an ordered media set and requires native acceptance for every file", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => ({ text: JSON.stringify({ variants: [{ platform: "facebook", kind: "image", title: "OK", body: "OK", hashtags: [], metadata: {} }], safetyNotes: [] }), requestId: args?.requestId, attachmentEvidence: args?.attachmentManifest && (args.attachmentManifest as Array<Record<string, unknown>>).map((item) => ({ ...item, uploadState: "processed" })), attachmentAccepted: true, attachmentCount: 2, attachmentBoundary: "chat_upload" }));
    await new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" }).generate({ ...request, mediaAttachments: [
      { assetId: "asset-1", localAssetPath: "/safe/app-owned/one.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" },
      { assetId: "asset-2", localAssetPath: "/safe/app-owned/two.png", mimeType: "image/png", sha256: "b".repeat(64), order: 1, role: "reference" },
    ] });
    expect(invoke).toHaveBeenCalledWith("gemini_web_complete", expect.objectContaining({ attachmentPaths: ["/safe/app-owned/one.png", "/safe/app-owned/two.png"], attachmentHashes: ["a".repeat(64), "b".repeat(64)] }));
  });

  it("rejects an incomplete attachment before opening the provider", async () => {
    const invoke = vi.fn();
    await expect(new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" }).generate({ ...request, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "", mimeType: "image/png", order: 0, role: "publish" }] })).rejects.toThrow("MEDIA_ATTACHMENT_PATH_MISSING");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects missing hashes and unsupported video before invoking the provider", async () => {
    const invoke = vi.fn();
    const gateway = new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" });
    const { sha256: _sha256, ...withoutHash } = { assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" as const };
    await expect(gateway.generate({ ...request, mediaAttachments: [withoutHash] })).rejects.toThrow("MEDIA_ATTACHMENT_HASH_MISSING");
    await expect(gateway.generate({ ...request, mediaAttachments: [{ ...withoutHash, mimeType: "video/mp4" }] })).rejects.toThrow("VIDEO_ATTACHMENT_UNSUPPORTED");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propagates a native changed-file hash failure without claiming processed evidence", async () => {
    const invoke = vi.fn(async () => { throw new Error("GEMINI_WEB_IMAGE_ATTACHMENT_HASH_MISMATCH"); });
    const gateway = new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" });
    await expect(gateway.generate({ ...request, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" }] })).rejects.toThrow("GEMINI_WEB_IMAGE_ATTACHMENT_HASH_MISMATCH");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects count-only or mismatched native attachment evidence", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => ({ text: "{}", requestId: args?.requestId, attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", attachmentEvidence: [] }));
    await expect(new GeminiWebAIGateway({ invoke, model: "gemini-3.5-pro" }).generate({ ...request, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" }] })).rejects.toThrow("IMAGE_ATTACHMENT_NOT_CONFIRMED");
  });

  it("fails safely when the Chrome session returns no response", async () => {
    const gateway = new GeminiWebAIGateway({ invoke: vi.fn(async () => ({ text: "" })), model: "gemini-3.5-pro" });
    await expect(gateway.generate(request)).rejects.toThrow("Gemini SignalFlow Chrome session returned no response");
  });

  it("keeps safe native Gemini error codes actionable", async () => {
    const gateway = new GeminiWebAIGateway({ invoke: vi.fn(async () => { throw new Error("GEMINI_WEB_RESPONSE_TIMEOUT"); }), model: "gemini-3.5-pro" });
    await expect(gateway.generate(request)).rejects.toThrow("GEMINI_WEB_RESPONSE_TIMEOUT");
  });

  it("keeps stringified native errors actionable", async () => {
    const gateway = new GeminiWebAIGateway({ invoke: vi.fn(async () => { throw "GEMINI_COMPOSER_NOT_READY"; }), model: "gemini-3.5-pro" });
    await expect(gateway.generate(request)).rejects.toThrow("GEMINI_COMPOSER_NOT_READY");
  });

  it("keeps an Electron IPC-wrapped native error actionable", async () => {
    const gateway = new GeminiWebAIGateway({ invoke: vi.fn(async () => { throw new Error("Error invoking remote method 'signalflow:invoke': Error: GEMINI_WEB_INPUT_FAILED"); }), model: "gemini-3.5-pro" });
    await expect(gateway.generate(request)).rejects.toThrow("GEMINI_WEB_INPUT_FAILED");
  });
});
