const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkSecret, formatManifest, parseManifest } = require("./secret-chunks.cjs");

test("splits a long secret into prompt-safe chunks and round-trips its manifest", () => {
  const value = "x".repeat(250);
  const chunks = chunkSecret(value);
  const manifest = formatManifest("generation-1", chunks.length);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [96, 96, 58]);
  assert.equal(chunks.join(""), value);
  assert.deepEqual(parseManifest(manifest), { generation: "generation-1", count: 3 });
});

test("rejects malformed chunk manifests", () => {
  assert.equal(parseManifest("v1:generation-1:0"), null);
  assert.equal(parseManifest("v1:bad:generation:2"), null);
});
