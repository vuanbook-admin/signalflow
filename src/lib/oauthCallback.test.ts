import { describe, expect, it, vi } from "vitest";
import { clearOAuthFlows, exchangeOAuthCallbackIfCurrent, parseOAuthCallback, registerOAuthFlow } from "./oauthCallback";

describe("profile-fenced OAuth callbacks", () => {
  it("discards profile A's callback after native activation has moved to B before renderer reload", async () => {
    clearOAuthFlows();
    registerOAuthFlow({ platform: "facebook", workspaceId: "workspace-shared", state: "state-a", profileId: "profile-a", profileRevision: 11 });
    const callback = parseOAuthCallback("signalflow://oauth/callback?code=code-a&state=state-a");
    expect(callback.ok).toBe(true);
    if (!callback.ok) return;
    const exchange = vi.fn(async () => ({ status: "oauth_connected" }));

    const result = await exchangeOAuthCallbackIfCurrent(
      callback,
      async () => ({ profileId: "profile-b", profileRevision: 12 }),
      exchange,
    );

    expect(result.status).toBe("stale");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("discards A's callback after A→B→A because the native revision changed", async () => {
    clearOAuthFlows();
    registerOAuthFlow({ platform: "instagram", workspaceId: "workspace-shared", state: "state-a-return", profileId: "profile-a", profileRevision: 11 });
    const callback = parseOAuthCallback("signalflow://oauth/callback?code=code-a&state=state-a-return");
    expect(callback.ok).toBe(true);
    if (!callback.ok) return;
    const exchange = vi.fn(async () => ({ status: "oauth_connected" }));

    const result = await exchangeOAuthCallbackIfCurrent(
      callback,
      async () => ({ profileId: "profile-a", profileRevision: 13 }),
      exchange,
    );

    expect(result.status).toBe("stale");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("fails closed for a pending legacy flow without profile identity", () => {
    clearOAuthFlows();
    registerOAuthFlow({
      platform: "facebook",
      workspaceId: "workspace-shared",
      state: "legacy-flow",
      profileId: undefined as unknown as string,
      profileRevision: undefined as unknown as number,
    });

    expect(parseOAuthCallback("signalflow://oauth/callback?code=legacy-code&state=legacy-flow")).toMatchObject({
      ok: false,
      reason: "stale_profile",
    });
  });
});
