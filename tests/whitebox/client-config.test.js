"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapClientConfig } = require("../../lib/client-config");

test("map client configuration is disabled when credentials are absent or incomplete", () => {
  assert.deepEqual(mapClientConfig({}), { enabled: false });
  assert.deepEqual(mapClientConfig({ APP_AMAP_KEY: "key-only" }), { enabled: false });
  assert.deepEqual(mapClientConfig({ APP_AMAP_SECURITY_CODE: "code-only" }), { enabled: false });
  assert.deepEqual(mapClientConfig({ APP_AMAP_KEY: "  ", APP_AMAP_SECURITY_CODE: "  " }), { enabled: false });
});

test("map client configuration exposes trimmed deployment credentials only when complete", () => {
  assert.deepEqual(mapClientConfig({
    APP_AMAP_KEY: " browser-key ",
    APP_AMAP_SECURITY_CODE: " browser-security-code "
  }), {
    enabled: true,
    apiKey: "browser-key",
    securityCode: "browser-security-code",
    version: "2.0"
  });
});
