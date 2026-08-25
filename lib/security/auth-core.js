"use strict";

const crypto = require("crypto");

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;

function normalizeAccount(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const normalized = String(password ?? "");
  if (!normalized) throw new Error("Password is required");
  const derived = crypto.scryptSync(normalized, salt, KEY_LENGTH).toString("hex");
  return `${HASH_PREFIX}$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
  const [prefix, salt, expectedHex, extra] = String(encoded || "").split("$");
  if (prefix !== HASH_PREFIX || !salt || !expectedHex || extra !== undefined) return false;
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== KEY_LENGTH || expected.toString("hex") !== expectedHex.toLowerCase()) return false;
  const actual = crypto.scryptSync(String(password ?? ""), salt, KEY_LENGTH);
  return crypto.timingSafeEqual(actual, expected);
}

function validatePasswordPolicy(password) {
  const value = String(password ?? "");
  const failures = [];
  if (value.length < 10) failures.push("密码至少需要10位");
  if (!/[A-Za-z]/.test(value)) failures.push("密码需要包含字母");
  if (!/\d/.test(value)) failures.push("密码需要包含数字");
  if (!/[^A-Za-z0-9]/.test(value)) failures.push("密码需要包含特殊字符");
  return { ok: failures.length === 0, failures };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function parseCookies(header) {
  const result = {};
  String(header || "").split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index < 1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  });
  return result;
}

function hasPermission(granted, required) {
  const permissions = new Set(Array.isArray(granted) ? granted : []);
  if (permissions.has("*")) return true;
  if (permissions.has(required)) return true;
  const [scope] = String(required || "").split(":");
  return Boolean(scope && permissions.has(`${scope}:*`));
}

module.exports = {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  hasPermission,
  normalizeAccount,
  parseCookies,
  validatePasswordPolicy,
  verifyPassword
};
