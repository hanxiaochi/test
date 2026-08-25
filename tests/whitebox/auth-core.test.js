"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const auth = require("../../lib/security/auth-core");

test("accounts are normalized consistently", () => {
  assert.equal(auth.normalizeAccount("  Admin.User "), "admin.user");
  assert.equal(auth.normalizeAccount(null), "");
});

test("password hashes verify without storing plaintext", () => {
  const encoded = auth.hashPassword("Correct-Horse-42", "00112233445566778899aabbccddeeff");
  assert.match(encoded, /^scrypt\$/);
  assert.doesNotMatch(encoded, /Correct-Horse-42/);
  assert.equal(auth.verifyPassword("Correct-Horse-42", encoded), true);
  assert.equal(auth.verifyPassword("wrong", encoded), false);
  assert.match(auth.hashPassword("Generated-Salt-42"), /^scrypt\$[a-f0-9]{32}\$/);
  assert.equal(auth.verifyPassword("anything", "invalid"), false);
  assert.equal(auth.verifyPassword("anything", "other$salt$00"), false);
  assert.equal(auth.verifyPassword("anything", "scrypt$$00"), false);
  assert.equal(auth.verifyPassword("anything", "scrypt$salt$"), false);
  assert.equal(auth.verifyPassword("anything", "scrypt$salt$00$extra"), false);
  assert.equal(auth.verifyPassword("anything", "scrypt$salt$zz"), false);
  assert.equal(auth.verifyPassword(null, encoded), false);
  assert.throws(() => auth.hashPassword(""), /required/);
  assert.throws(() => auth.hashPassword(null), /required/);
});

test("password policy reports every missing requirement", () => {
  const weak = auth.validatePasswordPolicy("short");
  assert.equal(weak.ok, false);
  assert.equal(weak.failures.length, 3);
  assert.equal(auth.validatePasswordPolicy(null).failures.length, 4);
  assert.equal(auth.validatePasswordPolicy("1234567890!").failures.length, 1);
  assert.equal(auth.validatePasswordPolicy("abcdefghij!").failures.length, 1);
  assert.equal(auth.validatePasswordPolicy("Abcdefghij1").failures.length, 1);
  assert.deepEqual(auth.validatePasswordPolicy("Long-Password-42"), { ok: true, failures: [] });
});

test("session tokens are random and persisted only as hashes", () => {
  const first = auth.createSessionToken();
  const second = auth.createSessionToken();
  assert.notEqual(first, second);
  assert.equal(auth.hashSessionToken(first), auth.hashSessionToken(first));
  assert.notEqual(auth.hashSessionToken(first), first);
  assert.equal(auth.hashSessionToken(null).length, 64);
});

test("cookie parsing handles encoding, malformed values, and equals signs", () => {
  assert.deepEqual(auth.parseCookies("a=1; name=%E5%BC%A0%E4%B8%89; token=a=b; bad=%E0%A4%A"), {
    a: "1",
    name: "张三",
    token: "a=b",
    bad: "%E0%A4%A"
  });
  assert.deepEqual(auth.parseCookies("missing; =empty"), {});
  assert.deepEqual(auth.parseCookies("  =empty"), {});
  assert.deepEqual(auth.parseCookies(null), {});
});

test("permissions support exact, scope wildcard, and global wildcard grants", () => {
  assert.equal(auth.hasPermission(["payment:read"], "payment:read"), true);
  assert.equal(auth.hasPermission(["payment:*"], "payment:approve"), true);
  assert.equal(auth.hasPermission(["*"], "admin:users"), true);
  assert.equal(auth.hasPermission(["payment:read"], "payment:write"), false);
  assert.equal(auth.hasPermission([], ""), false);
  assert.equal(auth.hasPermission(null, "payment:read"), false);
  assert.equal(auth.hasPermission(["other:*"], null), false);
});
