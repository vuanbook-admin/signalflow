import type { BrandIdentityRecord } from "./brandIdentity";
import type { SocialPlatform } from "./mvpContracts";

const MAX_CONTEXT_LENGTH = 12_000;

export function buildGenerationContext(identity: BrandIdentityRecord, target: { platform: SocialPlatform; targetName: string }, userBrief: string): { identityVersionId: string; context: string } {
  const lines = [
    `Identity version: ${identity.id}`,
    `Brand identity: ${identity.name} v${identity.version}`,
    `Platform: ${target.platform}`,
    `Target: ${target.targetName}`,
    `Strategy: ${identity.strategy.vision}; ${identity.strategy.mission}`,
    `Audience: ${identity.strategy.audience}`,
    `Voice: ${identity.voice.tone}`,
    `Vocabulary: ${identity.voice.vocabulary.join(", ") || "none"}`,
    `Prohibited claims: ${identity.voice.prohibitedClaims.join(", ") || "none"}`,
    ...(identity.voice.requiredDisclosure ? [`Required disclosure: ${identity.voice.requiredDisclosure}`] : []),
    `Visual colors: ${identity.visual.colors.map((color) => `${color.name} ${color.hex}`).join(", ")}`,
    `Typography: ${identity.visual.typography.heading} / ${identity.visual.typography.body}`,
    `Style guide: ${identity.visual.styleGuide}`,
    `Brief: ${userBrief}`,
  ];
  return { identityVersionId: identity.id, context: lines.join("\n").slice(0, MAX_CONTEXT_LENGTH) };
}
