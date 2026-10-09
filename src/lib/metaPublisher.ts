import type { ContentVariant, ProviderPublishResult, PublishJob, SocialConnection } from "./mvpContracts";
import type { PublisherExecutor } from "./publishQueue";

export interface AccessTokenResolver {
  getToken(connection: SocialConnection): Promise<string | null>;
}

export interface MetaPublisherOptions {
  tokenResolver: AccessTokenResolver;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface NativeMetaPageJobPublisher {
  publishPageJob(workspaceId: string, pageId: string, message: string, idempotencyKey: string): Promise<ProviderPublishResult>;
  publishPagePhotoJob?(workspaceId: string, pageId: string, caption: string, mediaUrl: string, idempotencyKey: string): Promise<ProviderPublishResult>;
  publishPageVideoJob?(workspaceId: string, pageId: string, caption: string, mediaUrl: string, idempotencyKey: string): Promise<ProviderPublishResult>;
  publishInstagramJob?(workspaceId: string, pageId: string, instagramUserId: string, caption: string, mediaUrl: string, mediaKind: "image" | "video", idempotencyKey: string): Promise<ProviderPublishResult>;
}

interface MetaResponse {
  id?: string;
  post_id?: string;
  status_code?: string;
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

interface VariantMediaMetadata {
  publicUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  pageId?: string;
  instagramUserId?: string;
}

export class NativeMetaPublisherExecutor implements PublisherExecutor {
  private readonly publisher: NativeMetaPageJobPublisher;

  constructor(publisher: NativeMetaPageJobPublisher) {
    this.publisher = publisher;
  }

  async publish(job: PublishJob, variant: ContentVariant, connection: SocialConnection): Promise<ProviderPublishResult> {
    if (connection.providerMetadata.connectionMode !== "official" || connection.providerMetadata.tokenBoundary !== "env_file") {
      throw new MetaPublisherError("META_LIVE_CONNECTION_REQUIRED: select a discovered official Meta connection with .env credential-file boundary.", false);
    }
    const pageId = typeof connection.providerMetadata.pageId === "string" ? connection.providerMetadata.pageId : connection.accountId;
    const message = [variant.body?.trim(), variant.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ")].filter(Boolean).join("\n\n");
    if (!pageId || (connection.platform === "facebook" && !message)) throw new MetaPublisherError("META_LIVE_INPUT_INVALID: Page ID and message are required.", false);
    if (connection.platform === "facebook") {
      const metadata = metadataFor(variant);
      const imageUrl = metadata.imageUrl ?? metadata.publicUrl;
      if (variant.kind === "image" && imageUrl) {
        if (!this.publisher.publishPagePhotoJob) throw new MetaPublisherError("META_FACEBOOK_MEDIA_ADAPTER_REQUIRED: native Facebook photo publishing is not configured.", false);
        return await this.publisher.publishPagePhotoJob(connection.workspaceId, pageId, message, imageUrl, job.idempotencyKey);
      }
      if (variant.kind === "video" || variant.kind === "short_video") {
        const videoUrl = metadata.videoUrl ?? metadata.publicUrl;
        if (!videoUrl) throw new MetaPublisherError("META_LIVE_INPUT_INVALID: public Facebook video URL is required.", false);
        if (!this.publisher.publishPageVideoJob) throw new MetaPublisherError("META_FACEBOOK_VIDEO_ADAPTER_REQUIRED: native Facebook video publishing is not configured.", false);
        return await this.publisher.publishPageVideoJob(connection.workspaceId, pageId, message, videoUrl, job.idempotencyKey);
      }
      if (variant.kind !== "text") throw new MetaPublisherError("META_LIVE_KIND_UNSUPPORTED: native Facebook route supports text, image, and video posts only.", false);
      return await this.publisher.publishPageJob(connection.workspaceId, pageId, message, job.idempotencyKey);
    }
    if (connection.platform === "instagram") {
      if (!this.publisher.publishInstagramJob) throw new MetaPublisherError("META_INSTAGRAM_NATIVE_ADAPTER_REQUIRED", false);
      const instagramUserId = typeof connection.providerMetadata.instagramUserId === "string" ? connection.providerMetadata.instagramUserId : connection.accountId;
      const metadata = metadataFor(variant);
      const mediaUrl = metadata.publicUrl ?? metadata.imageUrl ?? metadata.videoUrl;
      const mediaKind = variant.kind === "image" ? "image" : variant.kind === "short_video" ? "video" : undefined;
      if (!instagramUserId || !mediaUrl || !mediaKind) throw new MetaPublisherError("META_INSTAGRAM_INPUT_INVALID: Instagram user ID, supported media kind and public URL are required.", false);
      return await this.publisher.publishInstagramJob(connection.workspaceId, pageId, instagramUserId, message, mediaUrl, mediaKind, job.idempotencyKey);
    }
    throw new MetaPublisherError(`Native Meta queue publishing does not support ${connection.platform}.`, false);
  }
}

export class MetaPublisherError extends Error {
  readonly retryable: boolean;
  readonly providerCode?: number;

  constructor(message: string, retryable: boolean, providerCode?: number) {
    super(message);
    this.name = "MetaPublisherError";
    this.retryable = retryable;
    this.providerCode = providerCode;
  }
}

function metadataFor(variant: ContentVariant): VariantMediaMetadata {
  return variant.metadata as VariantMediaMetadata;
}

function captionFor(variant: ContentVariant): string {
  return [variant.body?.trim(), variant.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export class MetaPublisherExecutor implements PublisherExecutor {
  private readonly tokenResolver: AccessTokenResolver;
  private readonly graphVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: MetaPublisherOptions) {
    this.tokenResolver = options.tokenResolver;
    this.graphVersion = options.graphVersion ?? "v26.0";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_500;
    this.maxPollAttempts = options.maxPollAttempts ?? 20;
  }

  async publish(job: PublishJob, variant: ContentVariant, connection: SocialConnection): Promise<ProviderPublishResult> {
    const token = await this.tokenResolver.getToken(connection);
    if (!token) throw new MetaPublisherError("No access token is available for this connection.", false);

    if (connection.platform === "facebook") {
      return await this.publishFacebook(job, variant, connection, token);
    }
    if (connection.platform === "instagram") {
      return await this.publishInstagram(variant, connection, token);
    }
    throw new MetaPublisherError(`Meta adapter does not support ${connection.platform}.`, false);
  }

  private async publishFacebook(job: PublishJob, variant: ContentVariant, connection: SocialConnection, token: string): Promise<ProviderPublishResult> {
    const metadata = metadataFor(variant);
    const pageId = metadata.pageId ?? connection.accountId;
    const caption = captionFor(variant);
    const scheduledAt = Math.floor(new Date(job.scheduledAt).getTime() / 1000);

    if (variant.kind === "text" || (!metadata.imageUrl && !metadata.videoUrl && variant.kind !== "image")) {
      const response = await this.postGraph(`/${pageId}/feed`, token, {
        message: caption,
        published: "false",
        scheduled_publish_time: String(scheduledAt),
      });
      return { providerJobId: response.id, providerState: "published" };
    }

    if (variant.kind === "image" && metadata.imageUrl) {
      const response = await this.postGraph(`/${pageId}/photos`, token, {
        url: metadata.imageUrl,
        caption,
        published: "false",
        scheduled_publish_time: String(scheduledAt),
      });
      return { providerJobId: response.post_id ?? response.id, providerState: "published" };
    }

    if (variant.kind === "video" && metadata.videoUrl) {
      throw new MetaPublisherError("Facebook video publishing requires the resumable Video API upload handle and is not enabled in this first adapter slice.", false);
    }

    throw new MetaPublisherError("Facebook variant is missing a supported public media URL.", false);
  }

  private async publishInstagram(variant: ContentVariant, connection: SocialConnection, token: string): Promise<ProviderPublishResult> {
    const metadata = metadataFor(variant);
    const instagramUserId = metadata.instagramUserId ?? connection.accountId;
    const caption = captionFor(variant);
    const mediaUrl = metadata.publicUrl ?? metadata.imageUrl ?? metadata.videoUrl;

    if (!mediaUrl) {
      throw new MetaPublisherError("Instagram publishing requires a public media URL.", false);
    }

    const params: Record<string, string> = { caption };
    if (variant.kind === "short_video" || metadata.videoUrl) {
      params.media_type = "REELS";
      params.video_url = metadata.videoUrl ?? mediaUrl;
    } else if (variant.kind === "image") {
      params.image_url = metadata.imageUrl ?? mediaUrl;
    } else {
      throw new MetaPublisherError(`Instagram adapter does not support ${variant.kind} in this slice.`, false);
    }

    const container = await this.postGraph(`/${instagramUserId}/media`, token, params);
    if (!container.id) throw new MetaPublisherError("Meta did not return an Instagram media container ID.", false);

    if (variant.kind === "short_video" || metadata.videoUrl) {
      await this.waitForContainer(container.id, token);
    }

    const published = await this.postGraph(`/${instagramUserId}/media_publish`, token, { creation_id: container.id });
    return { providerJobId: published.id ?? container.id, providerState: "published" };
  }

  private async waitForContainer(containerId: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const response = await this.getGraph(`/${containerId}?fields=status_code`, token);
      if (response.status_code === "FINISHED") return;
      if (response.status_code === "ERROR" || response.status_code === "EXPIRED") {
        throw new MetaPublisherError(`Instagram media container entered ${response.status_code} state.`, false);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new MetaPublisherError("Instagram media container processing timed out.", true);
  }

  private async postGraph(path: string, token: string, params: Record<string, string>): Promise<MetaResponse> {
    return await this.requestGraph(path, token, "POST", params);
  }

  private async getGraph(path: string, token: string): Promise<MetaResponse> {
    return await this.requestGraph(path, token, "GET");
  }

  private async requestGraph(path: string, token: string, method: "GET" | "POST", params?: Record<string, string>): Promise<MetaResponse> {
    const base = `https://graph.facebook.com/${this.graphVersion}${path}`;
    const url = method === "GET" && params
      ? `${base}?${new URLSearchParams(params).toString()}`
      : base;
    const response = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: method === "POST" ? new URLSearchParams(params).toString() : undefined,
    });

    let payload: MetaResponse = {};
    try {
      payload = await response.json() as MetaResponse;
    } catch {
      throw new MetaPublisherError(`Meta returned a non-JSON response with HTTP ${response.status}.`, isRetryableStatus(response.status), response.status);
    }

    if (!response.ok || payload.error) {
      const providerMessage = payload.error?.message ?? `Meta request failed with HTTP ${response.status}.`;
      throw new MetaPublisherError(providerMessage, isRetryableStatus(response.status), payload.error?.code ?? response.status);
    }
    return payload;
  }
}
