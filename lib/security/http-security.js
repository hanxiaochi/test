"use strict";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function identityKey(identity = {}) {
  return [identity.ip, identity.tenantId, identity.account]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

function browserMutationDecision(req = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return { allowed: true, reason: "safe-method" };
  const headers = req.headers || {};
  const fetchSite = String(headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (fetchSite === "cross-site") return { allowed: false, reason: "cross-site" };
  const source = String(headers.origin || headers.referer || "").trim();
  const requestHost = String(headers.host || "").trim().toLowerCase();
  if (source) {
    try {
      const sourceHost = new URL(source).host.toLowerCase();
      if (!requestHost || sourceHost !== requestHost) return { allowed: false, reason: "origin-host" };
      return { allowed: true, reason: "same-origin" };
    } catch {
      return { allowed: false, reason: "invalid-origin" };
    }
  }
  if (fetchSite === "same-site") return { allowed: false, reason: "same-site-without-origin" };
  return { allowed: true, reason: "non-browser-client" };
}

function browserMutationGuard(req, res, next) {
  const decision = browserMutationDecision(req);
  if (decision.allowed) {
    next();
    return;
  }
  res.status(403).json({ code: 0, msg: "拒绝跨站请求", data: null, errorCode: "CROSS_SITE_REQUEST" });
}

const BLOCKED_WEB_ROOTS = new Set([
  ".git", ".github", "data", "lib", "logs", "node_modules", "releases", "scripts", "test-data", "tests", "tmp"
]);
const BLOCKED_WEB_FILES = new Set([
  ".env", ".gitignore", "constructiondata.js", "costengine.js", "package-lock.json", "package.json", "server.js"
]);

function sourceExposureDecision(value) {
  let pathname = String(value || "/").split(/[?#]/, 1)[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return { allowed: false, reason: "invalid-encoding" };
  }
  pathname = pathname.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return { allowed: true, reason: "root" };
  if (segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    return { allowed: false, reason: "hidden-or-traversal" };
  }
  if (BLOCKED_WEB_ROOTS.has(segments[0])) return { allowed: false, reason: "private-directory" };
  if (segments.length === 1 && BLOCKED_WEB_FILES.has(segments[0])) return { allowed: false, reason: "private-file" };
  return { allowed: true, reason: "public-path" };
}

function sourceExposureGuard(req, res, next) {
  const decision = sourceExposureDecision(req.originalUrl || req.url || req.path);
  if (decision.allowed) {
    next();
    return;
  }
  res.status(404).json({ code: 0, msg: "资源不存在", data: null, errorCode: "RESOURCE_NOT_FOUND" });
}

class LoginRateLimiter {
  constructor(options = {}) {
    this.maxAttempts = positiveInteger(options.maxAttempts, 10);
    this.windowMs = positiveInteger(options.windowMs, 15 * 60 * 1000);
    this.maxEntries = positiveInteger(options.maxEntries, 10000);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.entries = new Map();
  }

  prune(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt >= this.windowMs) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  status(identity) {
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(identityKey(identity));
    if (!entry) return { allowed: true, remaining: this.maxAttempts, retryAfterSeconds: 0 };
    const blocked = entry.attempts >= this.maxAttempts;
    return {
      allowed: !blocked,
      remaining: Math.max(0, this.maxAttempts - entry.attempts),
      retryAfterSeconds: blocked ? Math.max(1, Math.ceil((this.windowMs - (now - entry.startedAt)) / 1000)) : 0
    };
  }

  recordFailure(identity) {
    const now = this.now();
    this.prune(now);
    const key = identityKey(identity);
    const current = this.entries.get(key);
    const entry = current && now - current.startedAt < this.windowMs
      ? { attempts: current.attempts + 1, startedAt: current.startedAt }
      : { attempts: 1, startedAt: now };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune(now);
    return this.status(identity);
  }

  recordSuccess(identity) {
    return this.entries.delete(identityKey(identity));
  }
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const upgrade = req && req.secure ? "; upgrade-insecure-requests" : "";
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'${upgrade}`);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (req && req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-XSS-Protection", "0");
  next();
}

module.exports = {
  LoginRateLimiter,
  browserMutationDecision,
  browserMutationGuard,
  identityKey,
  positiveInteger,
  securityHeaders,
  sourceExposureDecision,
  sourceExposureGuard
};
