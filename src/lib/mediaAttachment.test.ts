import { describe, expect, it } from "vitest";
import { fingerprintMediaSet, getMediaAttachmentRequestId, validateMediaAttachments } from "./mediaAttachment";

describe("media attachment validation", () => {
  const image = { assetId: "asset-1", localAssetPath: "/app/media/one.png", mimeType: "image/png", sha256: "a".repeat(64), order: 0, role: "publish" as const };

  it("accepts an ordered image for a managed web provider", () => {
    expect(validateMediaAttachments([image], "gemini_web")).toEqual({ ok: true, attachments: [image] });
  });

  it("fails closed when a selected file is missing", () => {
    expect(validateMediaAttachments([{ ...image, localAssetPath: "" }], "gemini_web")).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_PATH_MISSING" });
  });

  it("keeps multiple files ordered for a managed web route", () => {
    expect(validateMediaAttachments([{ ...image, assetId: "asset-2", sha256: "b".repeat(64), order: 1, role: "reference" }, image], "chatgpt_web")).toMatchObject({ ok: true, attachments: [{ assetId: "asset-1" }, { assetId: "asset-2" }] });
  });

  it("fails closed for video until a native chat route proves full-video upload", () => {
    expect(validateMediaAttachments([{ ...image, assetId: "video-1", localAssetPath: "/app/media/clip.mp4", mimeType: "video/mp4" }], "gemini_web")).toMatchObject({ ok: false, code: "VIDEO_ATTACHMENT_UNSUPPORTED", assetId: "video-1" });
  });

  it("rejects a changed or malformed media hash before upload", () => {
    expect(validateMediaAttachments([{ ...image, sha256: "changed" }], "gemini_web")).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_TYPE_UNSUPPORTED", assetId: "asset-1" });
  });

  it("requires a SHA-256 for every selected file", () => {
    const { sha256: _sha256, ...missingHash } = image;
    expect(validateMediaAttachments([missingHash], "gemini_web")).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_HASH_MISSING", assetId: "asset-1" });
  });

  it("rejects publish/reference roles that contradict attachment order", () => {
    expect(validateMediaAttachments([
      { ...image, role: "reference" },
      { ...image, assetId: "asset-2", sha256: "b".repeat(64), order: 1, role: "publish" },
    ], "gemini_web")).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_ROLE_ORDER_INVALID" });
  });

  it("blocks attachments from API routes before they can reach a provider", () => {
    expect(validateMediaAttachments([image], "api")).toMatchObject({ ok: false, code: "MEDIA_ATTACHMENT_PROVIDER_UNSUPPORTED" });
  });

  it("fingerprints exact bytes, order, and publish/reference assignment", async () => {
    const media = [
      image,
      { ...image, assetId: "asset-2", sha256: "b".repeat(64), order: 1, role: "reference" as const },
      { ...image, assetId: "asset-3", sha256: "c".repeat(64), order: 2, role: "reference" as const },
    ];
    const fingerprint = await fingerprintMediaSet(media);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await fingerprintMediaSet([...media].reverse())).toBe(fingerprint);
    expect(await fingerprintMediaSet([{ ...media[0], localAssetPath: "/moved/one.png" }, media[1], media[2]])).toBe(fingerprint);
    expect(await fingerprintMediaSet([{ ...media[0], sha256: "d".repeat(64) }, media[1], media[2]])).not.toBe(fingerprint);
    expect(await fingerprintMediaSet([{ ...media[0], mimeType: "image/jpeg" }, media[1], media[2]])).not.toBe(fingerprint);
    expect(await fingerprintMediaSet([media[0], { ...media[1], order: 2 }, { ...media[2], order: 1 }])).not.toBe(fingerprint);
    expect(await fingerprintMediaSet([{ ...media[1], order: 0, role: "publish" }, { ...media[0], order: 1, role: "reference" }, media[2]])).not.toBe(fingerprint);
  });

  it("reuses safe request IDs and rejects malformed IDs", () => {
    expect(getMediaAttachmentRequestId("content-run-42:revision-3")).toBe("content-run-42:revision-3");
    expect(getMediaAttachmentRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(() => getMediaAttachmentRequestId("invalid request id")).toThrow("MEDIA_ATTACHMENT_REQUEST_ID_INVALID");
  });
});
