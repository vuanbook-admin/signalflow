const { deleteEnvSecret, getEnvSecret, setEnvSecret } = require("./portable-env.cjs");

let activeProfileId = "profile-bavy";

function validateProfileId(profileId) {
  if (typeof profileId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) throw new Error("PROFILE_ID_INVALID");
  return profileId;
}

function validateAccount(account) {
  if (typeof account !== "string" || !account.trim() || account.length > 512 || /[\u0000-\u001f\u007f]/.test(account)) throw new Error("SECURE_STORE_ACCOUNT_INVALID");
  return account.trim();
}

function validateSecret(secret) {
  if (typeof secret !== "string" || secret.length > 100_000 || /[\u0000]/.test(secret)) throw new Error("SECURE_STORE_VALUE_INVALID");
  return secret;
}

function setActiveProfileId(profileId) {
  activeProfileId = validateProfileId(profileId);
  return activeProfileId;
}

function scopedAccount(account) {
  const normalized = validateAccount(account);
  const explicit = normalized.match(/^profile:([^:]+):(.+)$/);
  if (explicit) {
    if (validateProfileId(explicit[1]) !== activeProfileId) throw new Error("PROFILE_SECRET_SCOPE_MISMATCH");
    return normalized;
  }
  return `profile:${activeProfileId}:${normalized}`;
}

function legacyOwnerAccount(account) {
  const explicit = account.match(/^profile:([^:]+):(.+)$/);
  if (explicit) return explicit[1] === "profile-bavy" ? explicit[2] : null;
  return account;
}

function profileSecretReference(profileId, account) {
  const owner = validateProfileId(profileId);
  const encodedAccount = Buffer.from(validateAccount(account), "utf8").toString("hex");
  return `env:signalflow/profiles/${owner}/${encodedAccount}`;
}

function setSecret(account, secret) {
  const normalizedAccount = scopedAccount(account);
  const value = validateSecret(secret);
  setEnvSecret(normalizedAccount, value);
}

function getSecret(account) {
  const normalized = validateAccount(account);
  const value = getEnvSecret(scopedAccount(normalized));
  if (value !== null || activeProfileId !== "profile-bavy") return value;
  const legacyAccount = legacyOwnerAccount(normalized);
  return legacyAccount ? getEnvSecret(legacyAccount) : null;
}

function deleteSecret(account) {
  const normalized = validateAccount(account);
  deleteEnvSecret(scopedAccount(normalized));
  if (activeProfileId === "profile-bavy") {
    const legacyAccount = legacyOwnerAccount(normalized);
    if (legacyAccount) deleteEnvSecret(legacyAccount);
  }
}

module.exports = { deleteSecret, getSecret, profileSecretReference, setActiveProfileId, setSecret };
