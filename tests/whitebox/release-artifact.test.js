"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const builder = require("../../scripts/release-artifact");
const verifier = require("../../scripts/verify-release-artifact");
const projectRoot = path.resolve(__dirname, "../..");
const hasGitCheckout = fs.existsSync(path.join(projectRoot, ".git"));
const hasCleanGitCheckout = hasGitCheckout && (() => {
  try {
    execFileSync("git", ["diff", "--quiet"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: projectRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

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

test("release whitelist accepts deployable sources and has stable checksums", () => {
  verifier.REQUIRED.forEach((name) => assert.doesNotThrow(() => builder.safeTrackedFile(name)));
  assert.equal(builder.safeTrackedFile("package.json").normalized, "package.json");
  assert.match(builder.sha256(Buffer.from("release")), /^[0-9a-f]{64}$/);
  assert.equal(builder.sha256(Buffer.from("release")), verifier.sha256(Buffer.from("release")));
});

test("clean Git checkout contains only allowed tracked release files", { skip: !hasCleanGitCheckout }, () => {
  const files = builder.trackedFiles();
  verifier.REQUIRED.forEach((name) => assert.ok(files.includes(name), `${name} should be tracked`));
  assert.equal(files.some((name) => builder.FORBIDDEN.some((rule) => rule.test(name))), false);
  assert.doesNotThrow(() => builder.assertTrackedTreeClean());
});
