import { describe, expect, it } from "vitest";
import { encodeLocalImageFile, parseLocalImageImport, safeLocalImageFileName, validateLocalImageFile } from "./mediaImport";

describe("local image import boundary", () => {
  it("accepts only nonempty PNG, JPEG, and WebP files within 20 MiB", () => {
    expect(validateLocalImageFile({ type: "image/png", size: 12 })).toBeUndefined();
    expect(validateLocalImageFile({ type: "image/jpeg", size: 12 })).toBeUndefined();
    expect(validateLocalImageFile({ type: "image/webp", size: 12 })).toBeUndefined();
    expect(validateLocalImageFile({ type: "image/gif", size: 12 })).toBe("LOCAL_MEDIA_TYPE_UNSUPPORTED");
    expect(validateLocalImageFile({ type: "image/png", size: 0 })).toBe("LOCAL_MEDIA_EMPTY");
    expect(validateLocalImageFile({ type: "image/png", size: 20 * 1024 * 1024 + 1 })).toBe("LOCAL_MEDIA_TOO_LARGE");
  });

  it("base64-encodes bytes without changing binary values", async () => {
    expect(await encodeLocalImageFile({ arrayBuffer: async () => Uint8Array.from([0, 255, 1]).buffer })).toBe("AP8B");
  });

  it("sanitizes native filenames while keeping a MIME-matching extension", () => {
    expect(safeLocalImageFileName("Ảnh áo dài 01.jpeg", "image/jpeg")).toBe("Anh_ao_dai_01.jpg");
    expect(safeLocalImageFileName("../../cover.webp", "image/webp")).toBe("cover.webp");
  });

  it("accepts native import metadata only for the requested Client and Brand", () => {
    const result = { assetId: "asset-a", name: "cover.webp", localAssetPath: "/app/media/cover.webp", mimeType: "image/webp", sha256: "a".repeat(64), sizeBytes: 12, clientId: "client-a", brandId: "brand-a" };
    expect(parseLocalImageImport(result, "client-a", "brand-a")).toMatchObject({ assetId: "asset-a", mimeType: "image/webp", clientId: "client-a", brandId: "brand-a" });
    expect(parseLocalImageImport({ ...result, brandId: "brand-b" }, "client-a", "brand-a")).toBeUndefined();
    expect(parseLocalImageImport({ ...result, sha256: "bad" }, "client-a", "brand-a")).toBeUndefined();
  });
});
