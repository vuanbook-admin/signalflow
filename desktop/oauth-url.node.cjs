const test = require("node:test");
const assert = require("node:assert/strict");
const { filterOAuthCallbackUrls } = require("./oauth-url.cjs");

test("forwards only SignalFlow OAuth callbacks from a process command line", () => {
  const urls = filterOAuthCallbackUrls([
    "SignalFlow",
    "--flag",
    "signalflow://oauth/callback?code=approved-code&state=state-123",
    "https://example.com/oauth/callback?code=attacker",
    "signalflow://other/callback?code=wrong-host",
  ]);

  assert.deepEqual(urls, ["signalflow://oauth/callback?code=approved-code&state=state-123"]);
});

test("accepts the callback host/path forms handled by the renderer", () => {
  assert.deepEqual(filterOAuthCallbackUrls([
    "signalflow://oauth/callback?code=one&state=a",
    "signalflow:/oauth/callback?code=two&state=b",
  ]), [
    "signalflow://oauth/callback?code=one&state=a",
    "signalflow:/oauth/callback?code=two&state=b",
  ]);
});

test("forwards only the exact HTTPS localhost callback used by Meta OAuth", () => {
  assert.deepEqual(filterOAuthCallbackUrls([
    "https://localhost/oauth/callback?code=approved-code&state=state-123",
    "http://localhost/oauth/callback?code=attacker",
    "https://localhost:8788/oauth/callback?code=attacker",
    "https://example.com/oauth/callback?code=attacker",
  ]), ["https://localhost/oauth/callback?code=approved-code&state=state-123"]);
});
