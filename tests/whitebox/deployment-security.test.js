"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertServerDeployment,
  deploymentSecurityPolicy,
  isLoopbackHost,
  normalizeHost,
  normalizedBoolean
} = require("../../lib/security/deployment-security");

test("local development binds to loopback and does not pretend to be production", () => {
  const policy = deploymentSecurityPolicy({});
  assert.equal(policy.host, "127.0.0.1");
  assert.equal(policy.publicBinding, false);
  assert.equal(policy.production, false);
  assert.equal(policy.requireStrongBootstrap, false);
  assert.equal(assertServerDeployment(policy), policy);
});

test("host and boolean inputs are normalized without accepting path-like values", () => {
  assert.equal(normalizeHost(" LOCALHOST "), "localhost");
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(normalizedBoolean(" TRUE "), true);
  assert.equal(normalizedBoolean("1"), false);
  assert.throws(() => normalizeHost("127.0.0.1/evil"), /APP_HOST is invalid/);
});

test("external binding requires a strong bootstrap and production requires HTTPS proxy controls", () => {
  const externalWeak = deploymentSecurityPolicy({ APP_HOST: "0.0.0.0", APP_BOOTSTRAP_PASSWORD: "000000" });
  assert.equal(externalWeak.publicBinding, true);
  assert.equal(externalWeak.requireStrongBootstrap, true);
  assert.equal(externalWeak.bootstrapPasswordStrong, false);

  const production = deploymentSecurityPolicy({
    NODE_ENV: "production",
    APP_HOST: "127.0.0.1",
    APP_BOOTSTRAP_PASSWORD: "Bootstrap-Admin-42!",
    APP_COOKIE_SECURE: "true",
    APP_TRUST_PROXY: "1"
  });
  assert.equal(production.bootstrapPasswordStrong, true);
  assert.doesNotThrow(() => assertServerDeployment(production));
  assert.throws(
    () => assertServerDeployment(deploymentSecurityPolicy({ NODE_ENV: "production", APP_TRUST_PROXY: "1" })),
    /APP_COOKIE_SECURE=true/
  );
  assert.throws(
    () => assertServerDeployment(deploymentSecurityPolicy({ NODE_ENV: "production", APP_COOKIE_SECURE: "true" })),
    /APP_TRUST_PROXY/
  );
});
