import { describe, expect, it } from "vitest";

async function bindings() { return await import("./channelBinding").catch(() => undefined); }
import { channelBindingStateForConnection } from "./connectionRegistry";

describe("truthful Channel Binding selection", () => {
  it("derives target health from the connection registry instead of a UI demo flag", () => {
    const base = { id: "connection-a", workspaceId: "client-a", platform: "facebook" as const, accountId: "page-a", displayName: "Page A", scopes: ["pages_manage_posts", "pages_read_engagement"], providerMetadata: { connectionMode: "official" } };
    expect(channelBindingStateForConnection(undefined)).toBe("not_configured");
    expect(channelBindingStateForConnection({ ...base, status: "connected" })).toBe("connected");
    expect(channelBindingStateForConnection({ ...base, status: "needs_reauth" })).toBe("needs_reauth");
    expect(channelBindingStateForConnection({ ...base, status: "review_required" })).toBe("review_required");
  });
  it("creates one selectable binding per healthy target and blocks every non-ready state", async () => {
    const api = await bindings();
    expect(api).toBeDefined();
    if (!api) return;
    const targets = [
      { id: "page-1", platform: "facebook", name: "Page 1", state: "connected" },
      { id: "page-2", platform: "facebook", name: "Page 2", state: "connected" },
      { id: "ig-1", platform: "instagram", name: "IG", state: "needs_reauth" },
      { id: "tt-1", platform: "tiktok", name: "TikTok", state: "unsupported" },
    ] as const;
    const result = api.createBindingsForTargets({ brandId: "brand-a", identityId: "identity-a", connectionIdByTarget: { "page-1": "conn-1", "page-2": "conn-2" }, targets });
    expect(result.bindings).toHaveLength(2);
    expect(result.blocked).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ig-1", recoveryCta: "Reconnect" }), expect.objectContaining({ id: "tt-1", label: "Unsupported" })]));
  });

  it("maps only allowed UI states to exact recovery copy", async () => {
    const api = await bindings();
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.presentConnectionState("not_configured")).toEqual({ label: "Not configured", recoveryCta: "Link", selectable: false });
    expect(api.presentConnectionState("needs_reauth")).toEqual({ label: "Needs reauth", recoveryCta: "Reconnect", selectable: false });
    expect(api.presentConnectionState("review_required")).toEqual({ label: "Review required", selectable: false });
    expect(api.presentConnectionState("connected")).toEqual({ label: "Connected", selectable: true });
  });

  it("supports two Facebook Pages, one Instagram account, and another identity on a third Page", async () => {
    const api = await bindings();
    expect(api).toBeDefined();
    if (!api) return;
    const result = api.createBindingsForTargets({
      brandId: "brand-a", identityId: "identity-default", connectionIdByTarget: { "page-1": "conn-1", "page-2": "conn-2", "ig-1": "conn-ig", "page-3": "conn-3" },
      targets: [
        { id: "page-1", platform: "facebook", name: "Page 1", state: "connected" },
        { id: "page-2", platform: "facebook", name: "Page 2", state: "connected" },
        { id: "ig-1", platform: "instagram", name: "Instagram", state: "connected" },
      ],
    });
    const alternate = api.createBindingsForTargets({ brandId: "brand-a", identityId: "identity-alt", connectionIdByTarget: { "page-3": "conn-3" }, targets: [{ id: "page-3", platform: "facebook", name: "Page 3", state: "connected" }] });
    expect(result.bindings).toHaveLength(3);
    expect(alternate.bindings[0]).toMatchObject({ identityId: "identity-alt", targetExternalId: "page-3" });
  });
});
