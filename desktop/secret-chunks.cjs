const PROMPT_SAFE_CHUNK_SIZE = 96;
const MAX_CHUNKS = 1_024;

function chunkSecret(value, chunkSize = PROMPT_SAFE_CHUNK_SIZE) {
  if (typeof value !== "string" || value.length === 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 1) return [];
  const chunks = [];
  for (let index = 0; index < value.length; index += chunkSize) chunks.push(value.slice(index, index + chunkSize));
  return chunks;
}

function formatManifest(generation, count) {
  if (typeof generation !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(generation) || !Number.isSafeInteger(count) || count < 1 || count > MAX_CHUNKS) throw new Error("SECURE_STORE_MANIFEST_INVALID");
  return `v1:${generation}:${count}`;
}

function parseManifest(value) {
  const match = typeof value === "string" ? /^v1:([A-Za-z0-9-]{1,128}):(\d+)$/.exec(value) : null;
  if (!match) return null;
  const count = Number(match[2]);
  return Number.isSafeInteger(count) && count >= 1 && count <= MAX_CHUNKS ? { generation: match[1], count } : null;
}

module.exports = { PROMPT_SAFE_CHUNK_SIZE, MAX_CHUNKS, chunkSecret, formatManifest, parseManifest };
