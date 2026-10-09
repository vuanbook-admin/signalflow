export type UserProfile = { id: string; displayName: string; createdAt: string; status: "active" | "archived" };
export type ProfileActivation = { state: "ready"; ready: true; profileId: string; runtimeId: string; profileRevision?: number };

const PROFILE_REGISTRY_KEY = "signalflow.user-profiles.v1";
const ACTIVE_PROFILE_KEY = "signalflow.active-profile.v1";
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function storage(): Storage | undefined {
  try { return typeof window !== "undefined" ? window.localStorage : undefined; } catch { return undefined; }
}

function validateProfileId(value: string): string {
  if (typeof value !== "string" || !PROFILE_ID_PATTERN.test(value)) throw new Error("PROFILE_ID_INVALID");
  return value;
}

function validProfileId(value: unknown): value is string {
  return typeof value === "string" && PROFILE_ID_PATTERN.test(value);
}

export function profileDataRoot(baseRoot: string, profileId: string): string {
  const id = validateProfileId(profileId);
  return `${baseRoot.replace(/[\\/]+$/, "")}/profiles/${id}`;
}

export function profileSnapshotKey(profileId: string): string {
  return `signalflow.profile.${validateProfileId(profileId)}.snapshot.v1`;
}

export function createEmptyProfile(displayName: string, id = `profile-${Date.now()}`, now = new Date()): UserProfile {
  return { id: validateProfileId(id), displayName: displayName.trim() || "Người dùng mới", createdAt: now.toISOString(), status: "active" };
}

export function listUserProfiles(store = storage()): UserProfile[] {
  if (!store) return [createEmptyProfile("Bảo Vy", "profile-bavy", new Date(0))];
  try {
    const parsed = JSON.parse(store.getItem(PROFILE_REGISTRY_KEY) ?? "[]") as unknown;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => item && typeof item === "object" && validProfileId((item as UserProfile).id))) return parsed as UserProfile[];
  } catch { /* use migration default */ }
  const initial = [createEmptyProfile("Bảo Vy", "profile-bavy", new Date())];
  try { store.setItem(PROFILE_REGISTRY_KEY, JSON.stringify(initial)); } catch { /* best effort */ }
  return initial;
}

export function activeUserProfileId(store = storage()): string {
  const profiles = listUserProfiles(store);
  let active: string | null | undefined;
  try { active = store?.getItem(ACTIVE_PROFILE_KEY); } catch { active = undefined; }
  if (active) {
    if (!validProfileId(active)) throw new Error("PROFILE_ID_INVALID");
    if (!profiles.some((profile) => profile.id === active && profile.status === "active")) throw new Error("PROFILE_SELECTION_INVALID");
    return active;
  }
  return profiles[0]?.id ?? "profile-bavy";
}

export function startupUserProfileId(store = storage()): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(store?.getItem(PROFILE_REGISTRY_KEY) ?? "[]") as unknown;
  } catch {
    return "profile-bavy";
  }
  const profiles = Array.isArray(parsed) ? parsed.filter((item): item is UserProfile => Boolean(item && typeof item === "object" && validProfileId((item as UserProfile).id) && (item as UserProfile).status !== "archived")) : [];
  let active: string | null | undefined;
  try { active = store?.getItem(ACTIVE_PROFILE_KEY); } catch { active = undefined; }
  if (active) {
    if (!validProfileId(active)) throw new Error("PROFILE_ID_INVALID");
    if (!profiles.some((profile) => profile.id === active)) throw new Error("PROFILE_SELECTION_INVALID");
    return active;
  }
  return profiles[0]?.id ?? "profile-bavy";
}

export function preferredStartupProfileId(nativeProfileId: string | null | undefined, store = storage()): string {
  if (nativeProfileId === undefined || nativeProfileId === null || nativeProfileId === "") return startupUserProfileId(store);
  return validateProfileId(nativeProfileId);
}

export function saveUserProfile(profile: UserProfile, store = storage()): UserProfile[] {
  const safeProfile = { ...profile, id: validateProfileId(profile.id) };
  const profiles = listUserProfiles(store).filter((item) => item.id !== safeProfile.id);
  const next = [...profiles, safeProfile];
  try { store?.setItem(PROFILE_REGISTRY_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}

export function setActiveUserProfile(profileId: string, store = storage()): boolean {
  const safeProfileId = validateProfileId(profileId);
  const profile = listUserProfiles(store).find((item) => item.id === safeProfileId && item.status === "active");
  if (!profile) return false;
  try { store?.setItem(ACTIVE_PROFILE_KEY, safeProfileId); return true; } catch { return false; }
}

export function isReadyProfileActivation(value: unknown, expectedProfileId: string): value is ProfileActivation {
  if (!value || typeof value !== "object") return false;
  const activation = value as Partial<ProfileActivation>;
  return activation.state === "ready" && activation.ready === true
    && activation.profileId === expectedProfileId
    && typeof activation.runtimeId === "string" && activation.runtimeId.trim().length > 0;
}

export async function activateUserProfile(profileId: string, activate: () => Promise<unknown>, store = storage(), rollback?: (previousProfileId: string) => Promise<unknown>): Promise<ProfileActivation> {
  const safeProfileId = validateProfileId(profileId);
  const previousProfileId = startupUserProfileId(store);
  const activation = await activate();
  if (!isReadyProfileActivation(activation, safeProfileId)) throw new Error("PROFILE_RUNTIME_NOT_READY");
  try {
    const registered = listUserProfiles(store).find((profile) => profile.id === safeProfileId);
    if (registered?.status === "archived") throw new Error("PROFILE_REGISTRY_CORRUPT");
    if (!registered) saveUserProfile(createEmptyProfile("Người dùng", safeProfileId), store);
    if (!setActiveUserProfile(safeProfileId, store)) throw new Error("PROFILE_REGISTRY_UPDATE_FAILED");
  } catch (error) {
    if (rollback && previousProfileId !== safeProfileId) {
      try {
        const restored = await rollback(previousProfileId);
        if (!isReadyProfileActivation(restored, previousProfileId)) throw new Error("PROFILE_RUNTIME_ROLLBACK_FAILED");
      } catch {
        throw new Error("PROFILE_RUNTIME_ROLLBACK_FAILED");
      }
    }
    throw error;
  }
  return activation;
}
