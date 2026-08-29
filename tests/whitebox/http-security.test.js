"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { LoginRateLimiter, browserMutationDecision, browserMutationGuard, identityKey, positiveInteger, securityHeaders } = require("../../lib/security/http-security");

test("positive integers and login identities are normalized", () => {
  assert.equal(positiveInteger("5", 9), 5);
  assert.equal(positiveInteger(0, 9), 9);
  assert.equal(positiveInteger(1.5, 9), 9);
  assert.equal(identityKey({ ip: " 127.0.0.1 ", tenantId: "Default", account: " Admin " }), "127.0.0.1|default|admin");
  assert.equal(identityKey(), "||");
});

test("failed logins are limited per normalized identity and expose retry time", () => {
  let now = 1000;
  const limiter = new LoginRateLimiter({ maxAttempts: 2, windowMs: 5000, now: () => now });
  const identity = { ip: "127.0.0.1", tenantId: "default", account: "Admin" };
  assert.deepEqual(limiter.status(identity), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.recordFailure(identity), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.recordFailure({ ...identity, account: "admin" }), { allowed: false, remaining: 0, retryAfterSeconds: 5 });
  now += 1250;
  assert.deepEqual(limiter.status(identity), { allowed: false, remaining: 0, retryAfterSeconds: 4 });
  assert.equal(limiter.status({ ...identity, account: "other" }).allowed, true);
  now = 6000;
  assert.deepEqual(limiter.status(identity), { allowed: true, remaining: 2, retryAfterSeconds: 0 });
});

test("successful login clears failures and bounded storage evicts oldest entries", () => {
  let now = 0;
  const limiter = new LoginRateLimiter({ maxAttempts: 3, windowMs: 100, maxEntries: 2, now: () => now });
  const first = { account: "first" };
  limiter.recordFailure(first);
  limiter.recordFailure({ account: "second" });
  limiter.recordFailure({ account: "third" });
  assert.equal(limiter.entries.size, 2);
  assert.equal(limiter.entries.has(identityKey(first)), false);
  assert.equal(limiter.recordSuccess({ account: "second" }), true);
  assert.equal(limiter.recordSuccess({ account: "second" }), false);
  now = 101;
  limiter.prune();
  assert.equal(limiter.entries.size, 0);
});

test("invalid limiter options fall back to safe defaults", () => {
  const limiter = new LoginRateLimiter({ maxAttempts: -1, windowMs: "bad", maxEntries: 0, now: "bad" });
  assert.equal(limiter.maxAttempts, 10);
  assert.equal(limiter.windowMs, 15 * 60 * 1000);
  assert.equal(limiter.maxEntries, 10000);
  assert.equal(typeof limiter.now, "function");
});

test("security middleware sets compatible baseline headers", () => {
  const headers = {};
  let nextCalls = 0;
  securityHeaders({ secure: false }, { setHeader(name, value) { headers[name] = value; } }, () => { nextCalls += 1; });
  assert.deepEqual(headers, {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-XSS-Protection": "0"
  });
  assert.equal(nextCalls, 1);
  securityHeaders({ secure: true }, { setHeader(name, value) { headers[name] = value; } }, () => {});
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
});

test("browser mutation decisions reject cross-origin evidence without blocking API clients", () => {
  assert.deepEqual(browserMutationDecision({ method: "GET" }), { allowed: true, reason: "safe-method" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: {} }), { allowed: true, reason: "non-browser-client" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { host: "erp.example.com", origin: "https://erp.example.com" } }), { allowed: true, reason: "same-origin" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { host: "erp.example.com", referer: "https://erp.example.com/form" } }), { allowed: true, reason: "same-origin" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { host: "erp.example.com", origin: "https://evil.example" } }), { allowed: false, reason: "origin-host" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { host: "erp.example.com", origin: "not a url" } }), { allowed: false, reason: "invalid-origin" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { host: "erp.example.com", origin: "https://erp.example.com", "sec-fetch-site": "cross-site" } }), { allowed: false, reason: "cross-site" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { host: "erp.example.com", "sec-fetch-site": "same-site" } }), { allowed: false, reason: "same-site-without-origin" });
  assert.deepEqual(browserMutationDecision({ method: "POST", headers: { origin: "https://erp.example.com" } }), { allowed: false, reason: "origin-host" });
});

test("browser mutation middleware forwards accepted requests and rejects denied ones", () => {
  let nextCalls = 0;
  browserMutationGuard({ method: "POST", headers: {} }, {}, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  let statusCode;
  let responseBody;
  browserMutationGuard(
    { method: "POST", headers: { host: "localhost:3100", origin: "https://evil.example" } },
    { status(code) { statusCode = code; return this; }, json(body) { responseBody = body; } },
    () => { nextCalls += 1; }
  );
  assert.equal(nextCalls, 1);
  assert.equal(statusCode, 403);
  assert.equal(responseBody.errorCode, "CROSS_SITE_REQUEST");
});
