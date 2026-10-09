import { describe, expect, it, vi } from "vitest";
import { GoogleFlowImageProvider, GoogleFlowVideoProvider, VertexAIImageProvider, assetPromptForDraft, buildImageAwareCopyRequest, buildMediaAwareCopyRequest, buildVideoAwareCopyRequest, getManagedCopyCapability, type NativeProviderInvoke } from "./creativeProviders";

describe("native creative provider boundaries", () => {
  it("routes an image request through visualPrompt only", () => {
    expect(assetPromptForDraft({ mediaKind: "image", visualPrompt: "image branch", videoPrompt: "video branch" }, "image")).toEqual({ ok: true, prompt: "image branch" });
  });

  it("routes a video request through videoPrompt only", () => {
    expect(assetPromptForDraft({ mediaKind: "video", visualPrompt: "image branch", videoPrompt: "video branch" }, "video")).toEqual({ ok: true, prompt: "video branch" });
  });

  it("returns a named error when the requested asset branch is missing", () => {
    expect(assetPromptForDraft({ mediaKind: "video", visualPrompt: "image branch" }, "video")).toMatchObject({ ok: false, code: "VIDEO_PROMPT_REQUIRED" });
    expect(assetPromptForDraft({ mediaKind: "image", videoPrompt: "video branch" }, "image")).toMatchObject({ ok: false, code: "IMAGE_PROMPT_REQUIRED" });
  });

  it("forwards slot strategy and idempotency identity through the image provider boundary", async () => {
    const request = { kind: "image" as const, workspaceId: "ws-1", prompt: "image branch", concept: "concept", slotId: "slot-1", strategyVersion: 3, idempotencyKey: "slot-1:v3:image" };
    const invoke = vi.fn<NativeProviderInvoke>(async (command) => command === "flow_web_status"
      ? { connected: true, composer: true, profilePersistent: true, engine: "chromium", windowOpen: true }
      : { provider: "google_flow", live: true, localAssetPath: "/safe/app-owned/flow-identity.png", mimeType: "image/png" });
    await expect(new GoogleFlowImageProvider({ invoke }).generate(request)).resolves.toMatchObject({ localAssetPath: "/safe/app-owned/flow-identity.png" });
    expect(invoke).toHaveBeenCalledWith("flow_web_generate_image", { prompt: request.prompt, workspaceId: request.workspaceId, slotId: request.slotId, strategyVersion: request.strategyVersion, idempotencyKey: request.idempotencyKey });
  });

  it("discovers a verified Google Flow managed-Chromium capability and returns an app-owned result", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async (command) => command === "flow_web_status"
      ? { connected: true, composer: true, profilePersistent: true, engine: "chromium", windowOpen: true }
      : { provider: "google_flow", live: true, localAssetPath: "/safe/app-owned/flow-1.png", mimeType: "image/png", generatedAt: "2026-08-23T00:00:00.000Z" });
    const provider = new GoogleFlowImageProvider({ invoke });
    await expect(provider.status()).resolves.toMatchObject({ live: true, managedBrowserSession: true });
    await expect(provider.generate({ prompt: "A calm emergency fund illustration" })).resolves.toMatchObject({ provider: "google_flow", live: true, localAssetPath: "/safe/app-owned/flow-1.png" });
    expect(invoke).toHaveBeenCalledWith("flow_web_generate_image", { prompt: "A calm emergency fund illustration" });
  });

  it("blocks Flow generation when the managed session is not verified", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async () => ({ connected: false, loginRequired: true, profilePersistent: true, engine: "chromium" }));
    await expect(new GoogleFlowImageProvider({ invoke }).generate({ prompt: "do not run" })).rejects.toThrow("FLOW_SESSION_NOT_VERIFIED");
  });

  it("blocks Flow generation when the managed window is on its landing route", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async (command) => command === "flow_web_status"
      ? { connected: false, composer: false, projectRoute: true, windowOpen: true, profilePersistent: true, engine: "chromium" }
      : { provider: "google_flow", live: true, localAssetPath: "/safe/app-owned/flow-landing.png", mimeType: "image/png", generatedAt: "2026-09-01T00:00:00.000Z" });
    await expect(new GoogleFlowImageProvider({ invoke }).generate({ prompt: "open the composer" })).rejects.toThrow("FLOW_SESSION_NOT_VERIFIED");
    expect(invoke).not.toHaveBeenCalledWith("flow_web_generate_image", expect.anything());
  });

  it("surfaces Flow unusual-activity throttling instead of misreporting a missing session", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async () => ({ connected: false, composer: true, throttled: true, profilePersistent: true, engine: "chromium", windowOpen: true }));
    const provider = new GoogleFlowImageProvider({ invoke });
    await expect(provider.status()).resolves.toMatchObject({ live: false, throttled: true, reason: expect.stringContaining("unusual activity") });
    await expect(provider.generate({ prompt: "blocked" })).rejects.toThrow("FLOW_THROTTLED_UNUSUAL_ACTIVITY");
  });

  it("keeps fresh Flow video generation on the explicit Veo route", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async (command) => command === "flow_web_status"
      ? { connected: true, composer: true, profilePersistent: true, engine: "chromium", windowOpen: true }
      : { provider: "google_flow", live: true, localAssetPath: "/safe/app-owned/flow-video-1.mp4", mimeType: "video/mp4", generatedAt: "2026-08-30T00:00:00.000Z" });
    const provider = new GoogleFlowVideoProvider({ invoke });
    await expect(provider.generate({ prompt: "A calm cotton outfit product video" })).resolves.toMatchObject({ provider: "veo", live: true, localAssetPath: "/safe/app-owned/flow-video-1.mp4" });
    expect(invoke).toHaveBeenCalledWith("flow_web_generate_video", { prompt: "A calm cotton outfit product video" });
  });

  it("does not trust malformed native checksum or visual fingerprint metadata", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async (command) => command === "flow_web_status"
      ? { connected: true, composer: true, profilePersistent: true, engine: "chromium", windowOpen: true }
      : { provider: "google_flow", live: true, localAssetPath: "/safe/app-owned/flow-1.png", generatedSha256: "not-a-sha", visualFingerprint: "not-a-fingerprint" });
    const result = await new GoogleFlowImageProvider({ invoke }).generate({ prompt: "safe" });
    expect(result.generatedSha256).toBeUndefined();
    expect(result.visualFingerprint).toBeUndefined();
  });

  it("exposes Vertex setup status and keeps generation behind the native boundary", async () => {
    const invoke = vi.fn<NativeProviderInvoke>(async (command) => command === "vertex_ai_status"
      ? { configured: true, officialApiVerified: true, projectIdPresent: true, location: "us-central1", model: "imagen-3.0-generate-002" }
      : { provider: "vertex_ai", live: true, localAssetPath: "/safe/app-owned/vertex-1.png", mimeType: "image/png", generatedAt: "2026-08-23T00:00:00.000Z" });
    const provider = new VertexAIImageProvider({ invoke });
    await expect(provider.status()).resolves.toMatchObject({ live: true, officialApiVerified: true });
    await expect(provider.generate({ prompt: "A calm emergency fund illustration" })).resolves.toMatchObject({ provider: "vertex_ai", localAssetPath: "/safe/app-owned/vertex-1.png" });
    expect(invoke).toHaveBeenCalledWith("vertex_ai_generate_image", { prompt: "A calm emergency fund illustration" });
  });

  it("blocks image-aware copy when the app-internal managed session is unavailable", async () => {
    await expect(getManagedCopyCapability("gemini", async () => ({ connected: false, composer: false, loginRequired: true }))).resolves.toMatchObject({ live: false, reason: "The app-internal managed browser session is not verified." });
  });

  it("passes an actual app-owned image attachment to image-aware copy generation", () => {
    const request = buildImageAwareCopyRequest({ workspaceId: "ws-1", prompt: "Write a caption", imageAssetId: "asset-1", imageLocalAssetPath: "/safe/app-owned/flow-1.png", imageMimeType: "image/png", imageSha256: "a".repeat(64), targetPlatforms: ["facebook"], brandVoice: "Evidence-led" });
    expect(request.imageAttachment).toEqual({ assetId: "asset-1", localAssetPath: "/safe/app-owned/flow-1.png", mimeType: "image/png", sha256: "a".repeat(64) });
    expect(request.prompt).toContain("customer media attachment");
    expect(request.metadata?.imageAware).toBe(true);
  });

  it("preserves ordered publish/reference media attachments in one request", () => {
    const request = buildMediaAwareCopyRequest({ workspaceId: "ws-1", prompt: "Write a caption", attachments: [
      { assetId: "asset-2", localAssetPath: "/safe/app-owned/two.png", mimeType: "image/jpeg", sha256: "b".repeat(64), order: 1, role: "reference" },
      { assetId: "asset-1", localAssetPath: "/safe/app-owned/one.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" },
    ], customerFacts: ["The product is 100% cotton."], targetPlatforms: ["facebook"], brandVoice: "Evidence-led" });
    expect(request.mediaAttachments?.map((attachment) => [attachment.assetId, attachment.role])).toEqual([["asset-1", "publish"], ["asset-2", "reference"]]);
    expect(request.metadata).toMatchObject({ mediaAware: true });
    expect(request.metadata?.mediaSetFingerprint).toBeUndefined();
    expect(request.customerFacts).toEqual(["The product is 100% cotton."]);
  });

  it("keeps automatic video media in the publish boundary without sending it to the image-only copy uploader", () => {
    const request = buildVideoAwareCopyRequest({ workspaceId: "ws-1", prompt: "Write a caption for this video slot", videoAssetId: "video-1", videoLocalAssetPath: "/safe/app-owned/video.mp4", videoMimeType: "video/mp4", videoSha256: "a".repeat(64), targetPlatforms: ["facebook"], brandVoice: "Evidence-led" });
    expect(request.contentKinds).toEqual(["video"]);
    expect(request.mediaAttachments).toBeUndefined();
    expect(request.metadata).toMatchObject({ videoAware: true, videoMediaDeferred: true, mediaAssetIds: ["video-1"] });
  });

  it("rejects an invalid image attachment before any provider boundary is opened", () => {
    expect(() => buildMediaAwareCopyRequest({ workspaceId: "ws-1", prompt: "caption", attachments: [{ assetId: "video-1", localAssetPath: "/safe/app-owned/video.mp4", mimeType: "video/mp4", sha256: "a".repeat(64), order: 0, role: "publish" }], targetPlatforms: ["facebook"], brandVoice: "Evidence-led" })).toThrow("VIDEO_ATTACHMENT_UNSUPPORTED");
  });
});
