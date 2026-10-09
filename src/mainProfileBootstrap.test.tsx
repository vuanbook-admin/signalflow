import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  App: vi.fn(() => null),
  createRoot: vi.fn(),
  invoke: vi.fn(),
  render: vi.fn(),
  setProfileRuntimeIdentity: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ default: { createRoot: mocks.createRoot } }));
vi.mock("./App", () => ({ default: mocks.App }));
vi.mock("./lib/nativeRuntime", () => ({
  invoke: mocks.invoke,
  isElectronRuntime: () => true,
  setProfileRuntimeIdentity: mocks.setProfileRuntimeIdentity,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function appWasRendered(): boolean {
  return mocks.render.mock.calls.some(([element]) => (element as React.ReactElement<{ children?: React.ReactElement }>).props.children?.type === mocks.App);
}

describe("native profile bootstrap gate", () => {
  beforeEach(async () => {
    await vi.resetModules();
    mocks.App.mockClear();
    mocks.invoke.mockReset();
    mocks.render.mockReset();
    mocks.setProfileRuntimeIdentity.mockReset();
    mocks.createRoot.mockReset().mockReturnValue({ render: mocks.render });
    vi.stubGlobal("document", { getElementById: () => ({}) });
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    };
    vi.stubGlobal("window", { localStorage, location: { reload: vi.fn() } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps App unmounted until native activation reports the exact ready identity", async () => {
    const selection = deferred<{ profileId: string; profileRevision: number }>();
    const activation = deferred<Record<string, unknown>>();
    mocks.invoke.mockImplementation((command: string) => command === "profile_selection" ? selection.promise : activation.promise);

    await import("./main");
    expect(mocks.render.mock.calls).toHaveLength(1);
    expect((mocks.render.mock.calls[0]?.[0] as React.ReactElement<{ role?: string }>).props.role).toBe("status");
    expect(appWasRendered()).toBe(false);

    selection.resolve({ profileId: "profile-native", profileRevision: 4 });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("profile_activate", { profileId: "profile-native" }));
    expect(appWasRendered()).toBe(false);

    activation.resolve({ state: "ready", ready: true, profileId: "profile-native", runtimeId: "runtime-native-1", profileRevision: 4 });
    await vi.waitFor(() => expect(appWasRendered()).toBe(true));
    expect(mocks.setProfileRuntimeIdentity).toHaveBeenCalledWith({ profileId: "profile-native", runtimeId: "runtime-native-1", profileRevision: 4 });
  });

  it("keeps App blocked when native activation identity does not match", async () => {
    mocks.invoke.mockImplementation((command: string) => command === "profile_selection"
      ? Promise.resolve({ profileId: "profile-native" })
      : Promise.resolve({ state: "ready", ready: true, profileId: "profile-other", runtimeId: "runtime-other-1" }));

    await import("./main");
    await vi.waitFor(() => expect((mocks.render.mock.calls[mocks.render.mock.calls.length - 1]?.[0] as React.ReactElement<{ role?: string }>).props.role).toBe("alert"));
    expect(appWasRendered()).toBe(false);
    expect(mocks.setProfileRuntimeIdentity).not.toHaveBeenCalled();
  });

  it("explains how to recover when legacy migration detects an old writer", async () => {
    mocks.invoke.mockImplementation((command: string) => command === "profile_selection"
      ? Promise.resolve({ profileId: "profile-bavy" })
      : Promise.reject(new Error("PROFILE_MIGRATION_CLOSE_SIGNALFLOW")));

    await import("./main");
    await vi.waitFor(() => expect((mocks.render.mock.calls[mocks.render.mock.calls.length - 1]?.[0] as React.ReactElement<{ role?: string }>).props.role).toBe("alert"));
    const alert = mocks.render.mock.calls[mocks.render.mock.calls.length - 1]?.[0] as React.ReactElement<{ children?: React.ReactElement[] }>;
    const paragraph = React.Children.toArray(alert.props.children).find((child) => React.isValidElement(child) && child.type === "p") as React.ReactElement<{ children?: string }> | undefined;
    expect(paragraph?.props.children).toContain("Đóng phiên bản SignalFlow cũ");
    expect(paragraph?.props.children).toContain("Dữ liệu nguồn vẫn được giữ nguyên");
    expect(appWasRendered()).toBe(false);
  });
});
