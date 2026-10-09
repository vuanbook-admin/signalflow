import { describe, expect, it } from "vitest";
import { NativeMetaPublisherExecutor } from "./metaPublisher";
import { preflightPublish, type ContentVariant, type SocialConnection } from "./mvpContracts";

const future = () => new Date(Date.now() + 60_000);
const connection: SocialConnection = {
  id: "conn-facebook",
  workspaceId: "workspace-1",
  platform: "facebook",
  accountId: "page-fallback",
  displayName: "Bellamy Baby Page",
  status: "connected",
  scopes: ["pages_manage_posts", "pages_read_engagement"],
  providerMetadata: { connectionMode: "official", tokenBoundary: "env_file", pageId: "100000000000001" },
};
const variant: ContentVariant = {
  id: "variant-video",
  contentId: "content-video",
  platform: "facebook",
  kind: "video",
  title: "Bellamy video",
  body: "Caption",
  mediaAssetIds: ["drive-video"],
  hashtags: ["BellamyBaby"],
  metadata: { videoUrl: "https://cdn.example.com/bellamy-video.mp4" },
  lifecycle: "approved",
};

describe("official Facebook video publishing", () => {
  it("accepts an official Facebook video with a public URL during preflight", () => {
    const result = preflightPublish(variant, connection, future());
    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.key === "kind")?.ok).toBe(true);
  });

  it("routes video URL and preserves the queued idempotency key through the native adapter", async () => {
    const calls: Array<[string, string, string, string, string]> = [];
    const executor = new NativeMetaPublisherExecutor({
      publishPageJob: async () => ({ providerJobId: "unused", providerState: "published" }),
      publishPageVideoJob: async (...args) => {
        calls.push(args);
        return { providerJobId: "fb-video-redacted", providerState: "published" };
      },
    });
    const job = { id: "job-video", variantId: variant.id, connectionId: connection.id, scheduledAt: future().toISOString(), idempotencyKey: "video-idempotency-key", state: "queued" as const, attempts: 0 };
    const result = await executor.publish(job, variant, connection);
    expect(result).toEqual({ providerJobId: "fb-video-redacted", providerState: "published" });
    expect(calls[0]).toEqual(["workspace-1", "100000000000001", "Caption\n\n#BellamyBaby", "https://cdn.example.com/bellamy-video.mp4", "video-idempotency-key"]);
  });

  it("routes short_video drafts to the same native Page-video adapter", async () => {
    let called = false;
    const executor = new NativeMetaPublisherExecutor({
      publishPageJob: async () => ({ providerJobId: "unused", providerState: "published" }),
      publishPageVideoJob: async () => { called = true; return { providerJobId: "fb-short-video", providerState: "published" }; },
    });
    await executor.publish({ id: "job-short-video", variantId: "variant-short-video", connectionId: connection.id, scheduledAt: future().toISOString(), idempotencyKey: "short-video-key", state: "queued", attempts: 0 }, { ...variant, kind: "short_video" }, connection);
    expect(called).toBe(true);
  });
});
