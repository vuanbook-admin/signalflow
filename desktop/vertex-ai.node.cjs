const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeGeneratedVertexImage } = require("./vertex-ai.cjs");
const { driveAnalyzeLocalAsset } = require("./drive-media.cjs");

test("writes a generated Vertex image under the selected profile and rejects it from another profile", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "signalflow-vertex-profile-root-"));
  const profileA = path.join(parent, "profiles", "profile-a");
  const profileB = path.join(parent, "profiles", "profile-b");
  fs.mkdirSync(profileA, { recursive: true });
  fs.mkdirSync(profileB, { recursive: true });

  const result = writeGeneratedVertexImage(Buffer.from("synthetic image bytes"), { userDataRoot: fs.realpathSync(profileA) });

  assert.equal(result.localAssetPath.startsWith(path.join(fs.realpathSync(profileA), "creative-assets") + path.sep), true);
  assert.equal(result.localAssetPath.startsWith(path.join(fs.realpathSync(profileB), "creative-assets") + path.sep), false);
  assert.throws(() => driveAnalyzeLocalAsset({ userDataRoot: fs.realpathSync(profileB), localAssetPath: result.localAssetPath, mimeType: "image/png" }), /DRIVE_LOCAL_PATH_NOT_OWNED/);
});
