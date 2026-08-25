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

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("X-XSS-Protection", "0");
  next();
}

module.exports = { LoginRateLimiter, identityKey, positiveInteger, securityHeaders };
