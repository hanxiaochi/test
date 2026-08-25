"use strict";

const crypto = require("crypto");

const FORMAT = "zwkjy-runtime-backup-v1";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function statePayload(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Backup state must be an object");
  return JSON.stringify(canonicalize(state));
}

function checksum(payload) {
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function createBackup(options = {}) {
  const payload = statePayload(options.state);
  const envelope = {
    format: FORMAT,
    createdAt: String(options.createdAt || new Date().toISOString()),
    createdBy: String(options.createdBy || "system"),
    tenantId: String(options.tenantId || "default"),
    projectId: String(options.projectId || "*"),
    applicationVersion: String(options.applicationVersion || "unknown"),
    checksum: checksum(payload),
    state: JSON.parse(payload)
  };
  return Buffer.from(JSON.stringify(envelope, null, 2), "utf8");
}

function validateBackup(input, options = {}) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.isBuffer(input) ? input.toString("utf8") : String(input));
  } catch {
    throw new Error("Backup file is not valid JSON");
  }
  if (!envelope || envelope.format !== FORMAT) throw new Error("Unsupported backup format");
  if (options.tenantId !== undefined && envelope.tenantId !== String(options.tenantId)) throw new Error("Backup belongs to a different tenant");
  const payload = statePayload(envelope.state);
  if (checksum(payload) !== envelope.checksum) throw new Error("Backup checksum mismatch");
  return { ...envelope, state: JSON.parse(payload) };
}

module.exports = { FORMAT, canonicalize, checksum, createBackup, statePayload, validateBackup };
