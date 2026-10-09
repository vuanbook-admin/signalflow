import type { ChannelBindingState, SocialPlatform } from "./mvpContracts";
import type { ChannelBindingRecord } from "./brandIdentity";

export type ConnectionTarget = { id: string; platform: SocialPlatform; name: string; state: ChannelBindingState };
export type ConnectionStatePresentation = { label: string; selectable: boolean; recoveryCta?: "Link" | "Reconnect" };

export function presentConnectionState(state: ChannelBindingState): ConnectionStatePresentation {
  switch (state) {
    case "connected": return { label: "Connected", selectable: true };
    case "not_configured": return { label: "Not configured", recoveryCta: "Link", selectable: false };
    case "needs_reauth": return { label: "Needs reauth", recoveryCta: "Reconnect", selectable: false };
    case "review_required": return { label: "Review required", selectable: false };
    case "unsupported": return { label: "Unsupported", selectable: false };
  }
}

export function createBindingsForTargets(input: { brandId: string; identityId: string; connectionIdByTarget: Record<string, string>; targets: readonly ConnectionTarget[] }): { bindings: ChannelBindingRecord[]; blocked: Array<ConnectionTarget & ConnectionStatePresentation> } {
  const bindings: ChannelBindingRecord[] = [];
  const blocked: Array<ConnectionTarget & ConnectionStatePresentation> = [];
  for (const target of input.targets) {
    const presentation = presentConnectionState(target.state);
    const connectionId = input.connectionIdByTarget[target.id];
    if (!presentation.selectable || !connectionId) {
      blocked.push({ ...target, ...presentation });
      continue;
    }
    bindings.push({ id: `binding-${input.brandId}-${input.identityId}-${connectionId}-${target.id}`, brandId: input.brandId, identityId: input.identityId, connectionId, targetExternalId: target.id, targetName: target.name, platform: target.platform, state: target.state });
  }
  return { bindings, blocked };
}
