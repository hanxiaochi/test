"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const builder = require("../../scripts/release-artifact");
const verifier = require("../../scripts/verify-release-artifact");

test("release paths reject runtime state, secrets and archive traversal", () => {
  [
    ".env", ".env.production", "data/runtime.db", "data/security.db-wal",
    "data/attachments/object.bin", "data/system-backups/system.zip", "logs/server.log",
    "tmp/result.json", "node_modules/pkg/index.js", "releases/old.zip", ".git/config"
  ].forEach((name) => assert.throws(() => verifier.safePath(name), /forbidden/));
  ["../outside", "/absolute", "C:/absolute", "nested/../../outside"]
    .forEach((name) => assert.throws(() => verifier.safePath(name), /unsafe/));
  assert.equal(verifier.safePath("lib/regions/pack-registry.js"), "lib/regions/pack-registry.js");
});

test("tracked release whitelist contains deployable sources but not local databases", () => {
  const files = builder.trackedFiles();
  verifier.REQUIRED.forEach((name) => assert.ok(files.includes(name), `${name} should be tracked`));
  assert.equal(files.some((name) => builder.FORBIDDEN.some((rule) => rule.test(name))), false);
  assert.equal(builder.safeTrackedFile("package.json").normalized, "package.json");
  assert.match(builder.sha256(Buffer.from("release")), /^[0-9a-f]{64}$/);
  assert.equal(builder.sha256(Buffer.from("release")), verifier.sha256(Buffer.from("release")));
});
