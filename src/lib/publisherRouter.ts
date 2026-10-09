import type { ContentVariant, ProviderPublishResult, ProviderReconciliationResult, PublishJob, SocialConnection, SocialPlatform } from "./mvpContracts";
import { readOAuthToken } from "./connectionRegistry";
import { MetaPublisherExecutor } from "./metaPublisher";
import type { PublisherExecutor } from "./publishQueue";

export interface PublisherRouterOptions {
  meta?: PublisherExecutor;
  fallback?: PublisherExecutor;
}

export class PublisherBoundaryError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "PublisherBoundaryError";
  }
}

export class RoutedPublisherExecutor implements PublisherExecutor {
  private readonly meta: PublisherExecutor;
  private readonly fallback?: PublisherExecutor;

  constructor(options: PublisherRouterOptions = {}) {
    this.meta = options.meta ?? new MetaPublisherExecutor({
      tokenResolver: { getToken: readOAuthToken },
    });
    this.fallback = options.fallback;
  }

  private executorFor(platform: SocialPlatform): PublisherExecutor {
    if (platform === "facebook" || platform === "instagram") return this.meta;
    if (this.fallback) return this.fallback;
    throw new PublisherBoundaryError(`No official publisher adapter is configured for ${platform}; live execution remains disabled.`);
  }

  async publish(job: PublishJob, variant: ContentVariant, connection: SocialConnection): Promise<ProviderPublishResult> {
    return await this.executorFor(connection.platform).publish(job, variant, connection);
  }

  async reconcile(job: PublishJob, variant: ContentVariant, connection: SocialConnection): Promise<ProviderReconciliationResult> {
    const executor = this.executorFor(connection.platform);
    if (!executor.reconcile) {
      throw new PublisherBoundaryError(`Provider reconciliation is not configured for ${connection.platform}.`);
    }
    return await executor.reconcile(job, variant, connection);
  }
}
