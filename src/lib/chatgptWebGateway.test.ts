import { describe, expect, it, vi } from "vitest";
import { ChatGPTWebAIGateway } from "./chatgptWebGateway";
import type { AIGenerationRequest } from "./mvpContracts";

const request: AIGenerationRequest = {
  workspaceId: "workspace-1",
  prompt: "Create a short finance post",
  targetPlatforms: ["facebook"],
  contentKinds: ["text"],
  brandSystem: {
    workspaceId: "workspace-1",
    voice: "Clear",
    audience: "Adults",
    prohibitedClaims: [],
    visualTokens: { primary: "#000", secondary: "#fff", typography: "Inter" },
  },
};

describe("ChatGPT web subscription gateway", () => {
  it("opens the persistent in-app session and parses the returned JSON contract", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ opened: true, persistentProfile: true })
      .mockResolvedValueOnce({ text: JSON.stringify({ variants: [{ platform: "facebook", kind: "text", title: "OK", body: "OK", hashtags: [], metadata: {} }], safetyNotes: [] }) });
    const result = await new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate(request);
    expect(result.provider).toBe("chatgpt_web");
    expect(result.variants[0]).toMatchObject({ platform: "facebook", title: "OK", body: "OK" });
    expect(invoke).toHaveBeenNthCalledWith(1, "chatgpt_web_open", { workspaceId: request.workspaceId });
    expect(invoke).toHaveBeenNthCalledWith(2, "chatgpt_web_complete", expect.objectContaining({ model: "gpt-5.6" }));
  });

  it("redacts provider errors and rejects an empty response", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("provider-secret-body"));
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate(request)).rejects.toThrow("ChatGPT SignalFlow Chrome request failed");
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke: vi.fn().mockResolvedValue({ text: "" }) }).generate(request)).rejects.toThrow("ChatGPT SignalFlow Chrome session returned no response");
  });

  it("preserves a namespaced bridge error when Electron wraps the native exception", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'signalflow:invoke': Error: CHATGPT_WEB_RESPONSE_TIMEOUT"));
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate(request)).rejects.toThrow("CHATGPT_WEB_RESPONSE_TIMEOUT");
  });

  it("preserves the exact visible assistant JSON contract with top-level convenience fields", async () => {
    const visibleAssistantJson = JSON.stringify({
      variants: [{ platform: "facebook", kind: "text", title: "OK", body: "OK", hashtags: [], metadata: {}, safetyNotes: [] }],
      platform: "facebook",
      kind: "text",
      title: "OK",
      body: "OK",
      hashtags: [],
      metadata: {},
      safetyNotes: [],
    });
    const invoke = vi.fn()
      .mockResolvedValueOnce({ opened: true })
      .mockResolvedValueOnce({ text: visibleAssistantJson });
    const result = await new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate(request);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({ platform: "facebook", kind: "text", title: "OK", body: "OK", hashtags: [], metadata: {} });
  });

  it("rejects a video attachment before opening ChatGPT", async () => {
    const invoke = vi.fn();
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate({ ...request, mediaAttachments: [{ assetId: "video-1", localAssetPath: "/safe/video.mp4", mimeType: "video/mp4", order: 0, role: "publish" }] })).rejects.toThrow("VIDEO_ATTACHMENT_UNSUPPORTED");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requires SHA-256 before opening the managed session", async () => {
    const invoke = vi.fn();
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate({ ...request, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", order: 0, role: "publish" }] })).rejects.toThrow("MEDIA_ATTACHMENT_HASH_MISSING");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a malformed persisted request ID before opening the managed session", async () => {
    const invoke = vi.fn();
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate({ ...request, metadata: { requestId: "bad request id" }, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" }] })).rejects.toThrow("MEDIA_ATTACHMENT_REQUEST_ID_INVALID");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends an ordered manifest and accepts only matching current-turn evidence", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => command === "chatgpt_web_open"
      ? { opened: true }
      : { text: JSON.stringify({ variants: [{ platform: "facebook", kind: "image", title: "OK", body: "OK", hashtags: [], metadata: {} }], safetyNotes: [] }), requestId: args?.requestId, attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", attachmentEvidence: (args?.attachmentManifest as Array<Record<string, unknown>>).map((item) => ({ ...item, uploadState: "processed" })) });
    const result = await new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate({ ...request, metadata: { requestId: "content-run-chatgpt-1" }, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" }] });
    expect(invoke).toHaveBeenNthCalledWith(2, "chatgpt_web_complete", expect.objectContaining({ requestId: "content-run-chatgpt-1", attachmentPaths: ["/safe/image.png"], attachmentHashes: ["a".repeat(64)], attachmentManifest: [{ assetId: "asset-1", sha256: "a".repeat(64), mimeType: "image/png", order: 0, role: "publish" }] }));
    expect(result.variants[0]?.metadata).toMatchObject({ attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", mediaEvidence: [{ assetId: "asset-1", sha256: "a".repeat(64), uploadState: "processed" }] });
  });

  it("rejects count-only evidence and preserves the attachment error code", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ opened: true })
      .mockImplementationOnce(async (_command: string, args?: Record<string, unknown>) => ({ text: "{}", requestId: args?.requestId, attachmentAccepted: true, attachmentCount: 1, attachmentBoundary: "chat_upload", attachmentEvidence: [] }));
    await expect(new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate({ ...request, mediaAttachments: [{ assetId: "asset-1", localAssetPath: "/safe/image.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" }] })).rejects.toThrow("IMAGE_ATTACHMENT_NOT_CONFIRMED");
  });

  it("unwraps a JSON-encoded native callback string before validating variants", async () => {
    const payload = {
      variants: [{ title: "OK", body: "OK", platform: "facebook", kind: "text", hashtags: [], metadata: {}, safetyNotes: [] }],
      platform: "facebook",
      kind: "text",
      title: "OK",
      body: "OK",
      hashtags: [],
      metadata: {},
      safetyNotes: [],
    };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ opened: true })
      .mockResolvedValueOnce({ text: JSON.stringify(JSON.stringify(payload)) });
    const result = await new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate(request);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({ platform: "facebook", kind: "text", title: "OK", body: "OK" });
  });

  it("accepts a valid JSON contract surrounded by ChatGPT formatting", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ opened: true })
      .mockResolvedValueOnce({ text: "Here is the JSON:\n```json\n{\"variants\":[{\"platform\":\"facebook\",\"kind\":\"text\",\"title\":\"OK\",\"body\":\"OK\",\"hashtags\":[],\"metadata\":{}}],\"safetyNotes\":[]}\n```" });
    const result = await new ChatGPTWebAIGateway({ model: "gpt-5.6", invoke }).generate(request);
    expect(result.variants[0]).toMatchObject({ title: "OK", body: "OK" });
  });
});
