import type { BrandStrategyCatalog, StrategySnapshot } from "./contentStrategy";
import { resolveStrategyForSlot, type AutomationStrategySelection, type ResolvedStrategy } from "./contentStrategyResolver";
import type { SocialPlatform } from "./mvpContracts";

export type AssetGenerationFormat = "text" | "image" | "video";

export type GenerationStrategyInput = {
  catalog: BrandStrategyCatalog;
  channel: SocialPlatform;
  format: AssetGenerationFormat;
  selection: AutomationStrategySelection;
  slotIndex: number;
};

export function prepareStrategyGeneration(input: GenerationStrategyInput): { ok: true; strategy: ResolvedStrategy } | { ok: false; code: string; message: string } {
  if (input.format !== "text" && input.format !== "image" && input.format !== "video") return { ok: false, code: "FORMAT_INVALID", message: "Generation format must be text, image, or video." };
  const resolved = resolveStrategyForSlot(input);
  if (!resolved.ok) return resolved;
  const strategy = { ...resolved.strategy, format: input.format } as ResolvedStrategy;
  const strategySnapshot: StrategySnapshot = {
    objectiveKey: strategy.objectiveKey,
    objectiveLabel: strategy.objectiveLabel,
    pillarId: strategy.pillarId,
    pillarLabel: strategy.pillarLabel,
    angleId: strategy.angleId,
    angleLabel: strategy.angleLabel,
    angleGuidance: strategy.angleGuidance,
    ...(strategy.angleIdByChannel ? { angleIdByChannel: { ...strategy.angleIdByChannel } } : {}),
    channel: input.channel,
    format: input.format,
    strategyVersion: strategy.strategyVersion,
    catalogFingerprint: strategy.catalogFingerprint,
    ...(strategy.recipeId ? { recipeId: strategy.recipeId } : {}),
  };
  return { ok: true, strategy: { ...strategy, strategySnapshot } };
}

export function prepareStrategyGenerationForChannels(input: Omit<GenerationStrategyInput, "channel"> & { channels: SocialPlatform[] }): { ok: true; strategies: Record<SocialPlatform, ResolvedStrategy> } | { ok: false; code: string; message: string } {
  const strategies: Partial<Record<SocialPlatform, ResolvedStrategy>> = {};
  for (const channel of [...new Set(input.channels)]) {
    const resolved = prepareStrategyGeneration({ ...input, channel });
    if (!resolved.ok) return resolved;
    strategies[channel] = resolved.strategy;
  }
  return { ok: true, strategies: strategies as Record<SocialPlatform, ResolvedStrategy> };
}

export function generationIdempotencyKey(input: { contentRunId: string; strategyVersion: number; format: AssetGenerationFormat }): string {
  return `generation:${input.contentRunId}:v${input.strategyVersion}:${input.format}`;
}

export function isDeterministicGenerationFailure(message: string): boolean {
  return /^(?:STRATEGY_|IMAGE_METADATA_REQUIRED|VIDEO_METADATA_REQUIRED|TEXT_ASSET_METADATA_FORBIDDEN|IMAGE_VIDEO_METADATA_FORBIDDEN|VIDEO_IMAGE_METADATA_FORBIDDEN|AI_STRUCTURED_CONTENT_INVALID|CONTENT_GENERATION_EMPTY_RESULT)/.test(message);
}

export type GenerationAttemptCounter = { value: number };

export async function runStrategyGenerationWithRetry<T>(input: {
  contentRunId: string;
  strategy: ResolvedStrategy;
  format: AssetGenerationFormat;
  attemptCounter?: GenerationAttemptCounter;
  generate: (attempt: { attempt: number; idempotencyKey: string }) => Promise<T>;
  validate: (result: T) => { ok: true } | { ok: false; code: string; message: string };
}): Promise<T> {
  const idempotencyKey = generationIdempotencyKey({ contentRunId: input.contentRunId, strategyVersion: input.strategy.strategyVersion, format: input.format });
  let lastError = "STRATEGY_OUTPUT_INVALID";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (input.attemptCounter) input.attemptCounter.value += 1;
      const result = await input.generate({ attempt, idempotencyKey });
      const check = input.validate(result);
      if (check.ok) return result;
      lastError = `${check.code}: ${check.message}`;
    } catch (error) {
      const typed = error && typeof error === "object" && "code" in error ? error as { code?: unknown } : undefined;
      const message = error instanceof Error ? error.message : String(error);
      const code = typeof typed?.code === "string" ? typed.code : message;
      if (attempt === 2 || !isDeterministicGenerationFailure(code)) throw error;
      lastError = message;
    }
  }
  throw new Error(lastError);
}

export type GenerationDecision = {
  route?: "managed_browser" | "provider_api";
  blockedReason?: "APP_OPEN_REQUIRED" | "LLM_PROVIDER_NOT_READY" | "GENERATION_CAPABILITY_MISSING" | string;
  mode: "subscription_package" | "llm_provider";
  provider: string;
  model: string;
  capabilities: string[];
};

export function presentGenerationDecision(decision: GenerationDecision): { state: "ready" | "blocked"; label: string; alternateRoute: "inactive"; recoveryCode?: string } {
  const modeLabel = decision.mode === "subscription_package" ? "Subscription package" : "LLM provider";
  const providerLabel = decision.provider === "openrouter" ? "OpenRouter" : decision.provider === "gemini_web" ? "Gemini" : decision.provider;
  if (decision.blockedReason) return { state: "blocked", label: `${modeLabel} · ${providerLabel} · ${decision.model}`, alternateRoute: "inactive", recoveryCode: decision.blockedReason };
  return { state: "ready", label: `${modeLabel} · ${providerLabel} · ${decision.model}`, alternateRoute: "inactive" };
}

export function canChangeGenerationProfile(run: { providerAttempted: boolean; generationProfileId: string }, nextProfileId: string): boolean {
  return !run.providerAttempted || run.generationProfileId === nextProfileId;
}
