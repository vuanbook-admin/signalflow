const test = require("node:test");
const assert = require("node:assert/strict");
const secureStorePath = require.resolve("./secure-store.cjs");
const secureStore = require(secureStorePath);
const secrets = new Map();
secureStore.getSecret = (account) => secrets.get(account) ?? null;
secureStore.setSecret = (account, value) => secrets.set(account, value);
secureStore.deleteSecret = (account) => secrets.delete(account);
delete require.cache[require.resolve("./meta.cjs")];
const { discoverMetaAccounts, publishPageVideo } = require("./meta.cjs");
const tokenAccount = "workspace:workspace-1:meta:page-access-token:123";
const videoUrl = "https://cdn.example.com/bellamy-video.mp4";
function response(payload, ok = true, status = 200) { return { ok, status, json: async () => payload }; }
test.afterEach(() => { secrets.clear(); global.fetch = undefined; });

test("publishes an immediate Facebook Page video through /videos", async () => {
  secrets.set(tokenAccount, "page-token-test-only");
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return response({ id: "fb-video-123" }); };
  const result = await publishPageVideo("workspace-1", "123", "Caption #Bellamy", videoUrl, "idem-video-1");
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(calls[0].url, "https://graph.facebook.com/v23.0/123/videos");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(body.get("file_url"), videoUrl);
  assert.equal(body.get("description"), "Caption #Bellamy");
  assert.equal(body.get("published"), "true");
  assert.equal(body.get("scheduled_publish_time"), null);
  assert.deepEqual(result, { provider: "meta", providerJobId: "fb-video-123", providerState: "published", published: true, idempotentReplay: false, tokenBoundary: "env_file" });
});

test("publishes a scheduled Facebook Page video with official schedule fields", async () => {
  secrets.set(tokenAccount, "page-token-test-only");
  let requestBody;
  global.fetch = async (_url, options) => { requestBody = new URLSearchParams(options.body); return response({ id: "fb-video-scheduled" }); };
  const result = await publishPageVideo("workspace-1", "123", "Scheduled caption", videoUrl, "idem-video-scheduled", { published: false, scheduledPublishTime: 1770000000 });
  assert.equal(requestBody.get("file_url"), videoUrl);
  assert.equal(requestBody.get("published"), "false");
  assert.equal(requestBody.get("scheduled_publish_time"), "1770000000");
  assert.equal(result.published, false);
});

test("rejects a Facebook Page video without a public HTTPS URL before Graph access", async () => {
  secrets.set(tokenAccount, "page-token-test-only");
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return response({ id: "unexpected" }); };
  await assert.rejects(() => publishPageVideo("workspace-1", "123", "Caption", "file:///private/video.mp4", "idem-video-invalid"), /META_PAGE_VIDEO_URL_INVALID/);
  assert.equal(fetchCalls, 0);
});

test("maps an official Graph Page-video provider error to a safe error code", async () => {
  secrets.set(tokenAccount, "page-token-test-only");
  global.fetch = async () => response({ error: { message: "provider body omitted", code: 100 } }, false, 400);
  await assert.rejects(() => publishPageVideo("workspace-1", "123", "Caption", videoUrl, "idem-video-error"), /META_GRAPH_API_REJECTED_100/);
});

test("replays an idempotent Facebook Page-video result without a second Graph request", async () => {
  secrets.set(tokenAccount, "page-token-test-only");
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return response({ id: "fb-video-idempotent" }); };
  const first = await publishPageVideo("workspace-1", "123", "Caption", videoUrl, "idem-video-replay");
  const second = await publishPageVideo("workspace-1", "123", "Caption", videoUrl, "idem-video-replay");
  assert.equal(fetchCalls, 1);
  assert.equal(first.idempotentReplay, false);
  assert.equal(second.providerJobId, "fb-video-idempotent");
  assert.equal(second.idempotentReplay, true);
});

test("keeps the same Meta workspace and Page credentials inside the selected profile", async () => {
  const ownerToken = "profile:profile-a:workspace:workspace-1:meta:manual-access-token";
  const ownerPageToken = "profile:profile-a:workspace:workspace-1:meta:page-access-token:123";
  const otherProfilePageToken = "profile:profile-b:workspace:workspace-1:meta:page-access-token:123";
  secrets.set(ownerToken, "page-list-token-a");
  global.fetch = async () => response({ data: [{ id: "123", name: "Page A", access_token: "page-token-a" }] });

  await discoverMetaAccounts("workspace-1", "profile-a");

  assert.equal(secrets.get(ownerPageToken), "page-token-a");
  assert.equal(secrets.has(otherProfilePageToken), false);
});
