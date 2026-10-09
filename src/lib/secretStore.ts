import { hasNativeRuntime, invoke } from "./nativeRuntime";
import { activeUserProfileId } from "./profileDomain";

export interface SecretStore {
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | null>;
  delete(account: string): Promise<void>;
}

export function profileSecretRef(profileId: string, scope: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  if (typeof scope !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,240}$/.test(scope) || scope.includes("..")) throw new Error("SECRET_REF_SCOPE_INVALID");
  return `env:signalflow/profiles/${profileId}/${scope}`;
}

export function profileSecretAccount(profileId: string, account: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  if (typeof account !== "string" || !account.trim() || account.length > 512 || /[\u0000-\u001f\u007f]/.test(account)) throw new Error("SECURE_STORE_ACCOUNT_INVALID");
  const normalized = account.trim();
  const explicit = normalized.match(/^profile:([^:]+):(.+)$/);
  if (explicit) {
    if (explicit[1] !== profileId) throw new Error("PROFILE_SECRET_SCOPE_MISMATCH");
    return normalized;
  }
  return `profile:${profileId}:${normalized}`;
}

function accountForActiveProfile(account: string): string {
  return profileSecretAccount(activeUserProfileId(), account);
}

class SessionSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(account: string, secret: string): Promise<void> {
    this.values.set(accountForActiveProfile(account), secret);
  }

  async get(account: string): Promise<string | null> {
    return this.values.get(accountForActiveProfile(account)) ?? null;
  }

  async delete(account: string): Promise<void> {
    this.values.delete(accountForActiveProfile(account));
  }
}

class TauriNativeSecretStore implements SecretStore {
  async set(account: string, secret: string): Promise<void> {
    await invoke("secret_set", { account: accountForActiveProfile(account), secret });
  }

  async get(account: string): Promise<string | null> {
    return await invoke<string | null>("secret_get", { account: accountForActiveProfile(account) });
  }

  async delete(account: string): Promise<void> {
    await invoke("secret_delete", { account: accountForActiveProfile(account) });
  }
}

export const secretStore: SecretStore = hasNativeRuntime() ? new TauriNativeSecretStore() : new SessionSecretStore();

export function secretStoreBoundary(): "env_file" | "memory" {
  return hasNativeRuntime() ? "env_file" : "memory";
}

export function connectionSecretAccount(workspaceId: string, platform: string, accountId: string): string {
  return `workspace:${workspaceId}:platform:${platform}:account:${accountId}`;
}
