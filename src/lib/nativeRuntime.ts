import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

export type SignalFlowBridge = {
  controlPlanePort?: number;
  workerPort?: number;
  controlPlaneUrl?: string;
  workerUrl?: string;
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  openUrl(url: string): Promise<void>;
  onOAuthUrl?(listener: (urls: string[]) => void): () => void;
  onMetaOAuthResult?(listener: (result: Record<string, unknown>) => void): () => void;
};

export type ActiveProfileRuntime = { profileId: string; runtimeId: string; profileRevision: number };
export type ActiveProfileRuntimeInput = { profileId: string; runtimeId: string; profileRevision?: number };
let activeProfileRuntime: ActiveProfileRuntime | undefined;

declare global {
  interface Window {
    signalflow?: SignalFlowBridge;
  }
}

export function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.signalflow);
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function hasNativeRuntime(): boolean {
  return isElectronRuntime() || isTauriRuntime();
}

export function setProfileRuntimeIdentity(identity: ActiveProfileRuntimeInput): void {
  if (!identity.profileId.trim() || !identity.runtimeId.trim()) throw new Error("PROFILE_RUNTIME_NOT_READY");
  const profileRevision = identity.profileRevision ?? 0;
  if (!Number.isSafeInteger(profileRevision) || profileRevision < 0) throw new Error("PROFILE_RUNTIME_NOT_READY");
  activeProfileRuntime = { profileId: identity.profileId, runtimeId: identity.runtimeId, profileRevision };
}

export function profileRuntimeIdentity(): ActiveProfileRuntime | undefined {
  return activeProfileRuntime ? { ...activeProfileRuntime } : undefined;
}

export function profileRuntimeHeaders(): Record<string, string> {
  return activeProfileRuntime ? {
    "x-signalflow-profile-id": activeProfileRuntime.profileId,
    "x-signalflow-runtime-id": activeProfileRuntime.runtimeId,
  } : {};
}

const ELECTRON_ACCOUNT_COMMANDS = new Set([
  "gemini_web_open",
  "gemini_web_status",
  "gemini_web_complete",
  "drive_web_open",
  "drive_web_status",
  "drive_inventory",
  "drive_download_asset",
  "store_generated_media",
  "drive_analyze_local_asset",
  "drive_upload_asset",
  "drive_make_public",
  "chatgpt_web_open",
  "chatgpt_web_status",
  "chatgpt_web_complete",
  "flow_web_open",
  "flow_web_status",
  "flow_web_generate_image",
  "flow_web_generate_video",
  "vertex_ai_status",
  "vertex_ai_save_config",
  "vertex_ai_clear_config",
  "vertex_ai_generate_image",
]);

export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (window.signalflow) return await window.signalflow.invoke<T>(command, args);
  if (isTauriRuntime() && ELECTRON_ACCOUNT_COMMANDS.has(command)) throw new Error("ELECTRON_CHROMIUM_ACCOUNT_RUNTIME_REQUIRED");
  if (isTauriRuntime()) return await tauriInvoke<T>(command, args);
  throw new Error("NATIVE_RUNTIME_NOT_AVAILABLE");
}

export async function openUrl(url: string): Promise<void> {
  if (window.signalflow) return await window.signalflow.openUrl(url);
  if (isTauriRuntime()) return await tauriOpenUrl(url);
  window.open(url, "_blank", "noopener,noreferrer");
}

export function onOAuthUrls(listener: (urls: string[]) => void): () => void {
  if (window.signalflow?.onOAuthUrl) return window.signalflow.onOAuthUrl(listener);
  return () => undefined;
}

export function onMetaOAuthResult(listener: (result: Record<string, unknown>) => void): () => void {
  if (window.signalflow?.onMetaOAuthResult) return window.signalflow.onMetaOAuthResult(listener);
  return () => undefined;
}
