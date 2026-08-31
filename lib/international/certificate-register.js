"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");

const STORAGE_KEY = "internationalCertificates";
const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const MAX_CERTIFICATES = 10000;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function cleanText(value, label, maximum, required = false) {
  const text = String(value ?? "").trim();
  if ((required && !text) || text.length > maximum || /[\x00-\x1f\x7f]/.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function isoDate(value, label) {
  const text = cleanText(value, label, 10, true);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be an ISO date`);
  }
  return text;
}

function isoInstant(value, label) {
  const text = cleanText(value, label, 40, true);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) throw new Error(`${label} must be an ISO instant`);
  return text;
}

function canonical(value, depth = 0) {
  if (depth > 50) throw new Error("certificate snapshot nesting exceeds the limit");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("certificate snapshot contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("certificate snapshot must contain JSON values only");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new Error("certificate snapshot must not contain undefined values");
    return [key, canonical(value[key], depth + 1)];
  }));
}

function snapshot(value, label) {
  const normalized = canonical(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new Error(`${label} must be an object`);
  const body = JSON.stringify(normalized);
  if (Buffer.byteLength(body, "utf8") > MAX_SNAPSHOT_BYTES) throw new Error(`${label} exceeds the size limit`);
  return JSON.parse(body);
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

function strictPositiveInteger(value, label, allowZero = false) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (allowZero ? number < 0 : number < 1)) throw new Error(`${label} must be a positive integer`);
  return number;
}

function finiteDecimal(value, label) {
  try {
    const number = new Decimal(value);
    if (!number.isFinite()) throw new Error();
    return number;
  } catch {
    throw new Error(`${label} must be a finite decimal number`);
  }
}

function normalizedRequest(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("certificate issue payload must be an object");
  const certificateNo = cleanText(payload.certificateNo, "certificate number", 64, true);
  const periodStart = isoDate(payload.periodStart, "period start");
  const periodEnd = isoDate(payload.periodEnd, "period end");
  if (periodEnd < periodStart) throw new Error("period end must not precede period start");
  const idempotencyKey = cleanText(payload.idempotencyKey, "idempotency key", 128, true);
  if (idempotencyKey.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) throw new Error("idempotency key is invalid");
  const calculationInput = snapshot(payload.calculationInput, "calculation input");
  const calculationResult = snapshot(payload.calculationResult, "calculation result");
  const settingsVersion = strictPositiveInteger(calculationResult.settingsVersion, "settings version", true);
  const settingsSchemaVersion = strictPositiveInteger(calculationResult.settingsSchemaVersion, "settings schema version");
  const settingsChecksum = cleanText(calculationResult.settingsChecksum, "settings checksum", 64, true).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(settingsChecksum)) throw new Error("settings checksum is invalid");
  const baseCurrency = cleanText(calculationResult.baseCurrency, "base currency", 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(baseCurrency)) throw new Error("base currency is invalid");
  if (!calculationResult.totals || typeof calculationResult.totals !== "object" || Array.isArray(calculationResult.totals)) {
    throw new Error("calculation result totals are required");
  }
  const continuityInputs = [
    ["previousRetention", "previousRetention", "previous retention"],
    ["previousCumulativeCertified", "previousCumulativeCertified", "previous cumulative certified"],
    ["retentionRelease", "retentionRelease", "retention release"]
  ];
  continuityInputs.forEach(([inputKey, totalKey, label]) => {
    const inputValue = finiteDecimal(calculationInput[inputKey] ?? 0, `${label} input`);
    const resultValue = finiteDecimal(calculationResult.totals[totalKey], `${label} result`);
    if (!inputValue.eq(resultValue)) throw new Error(`${label} input does not match the calculation result`);
  });
  return {
    certificateNo,
    periodStart,
    periodEnd,
    applicationReference: cleanText(payload.applicationReference, "application reference", 100),
    remarks: cleanText(payload.remarks, "certificate remarks", 500),
    openingBalanceReason: cleanText(payload.openingBalanceReason, "opening balance reason", 500),
    idempotencyKey,
    calculationInput,
    calculationInputChecksum: checksum(calculationInput),
    calculationResult,
    calculationResultChecksum: checksum(calculationResult),
    settingsVersion,
    settingsSchemaVersion,
    settingsChecksum,
    certificateStandard: cleanText(calculationResult.certificateStandard, "certificate standard", 64, true),
    baseCurrency
  };
}

function immutableIssuePayload(record) {
  const payload = {
    schemaVersion: record.schemaVersion,
    id: record.id,
    certificateNo: record.certificateNo,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    applicationReference: record.applicationReference,
    remarks: record.remarks,
    idempotencyKey: record.idempotencyKey,
    calculationInput: record.calculationInput,
    calculationInputChecksum: record.calculationInputChecksum,
    calculationResult: record.calculationResult,
    calculationResultChecksum: record.calculationResultChecksum,
    settingsVersion: record.settingsVersion,
    settingsSchemaVersion: record.settingsSchemaVersion,
    settingsChecksum: record.settingsChecksum,
    certificateStandard: record.certificateStandard,
    baseCurrency: record.baseCurrency,
    requestChecksum: record.requestChecksum,
    issuedAt: record.issuedAt,
    issuedBy: record.issuedBy
  };
  if (Number(record.schemaVersion) >= 2) Object.assign(payload, {
    predecessorCertificateId: record.predecessorCertificateId,
    predecessorIssueChecksum: record.predecessorIssueChecksum,
    closingRetention: record.closingRetention,
    openingBalanceReason: record.openingBalanceReason
  });
  return payload;
}

function idempotencyPayload(request) {
  return {
    certificateNo: request.certificateNo,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    applicationReference: request.applicationReference,
    remarks: request.remarks,
    openingBalanceReason: request.openingBalanceReason,
    idempotencyKey: request.idempotencyKey,
    calculationInput: request.calculationInput,
    calculationInputChecksum: request.calculationInputChecksum
  };
}

function voidPayload(record) {
  return {
    issueChecksum: record.issueChecksum,
    status: record.status,
    voidedAt: record.voidedAt,
    voidedBy: record.voidedBy,
    voidReason: record.voidReason
  };
}

function certificateView(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("certificate record is invalid");
  if (![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].includes(Number(record.schemaVersion))) throw new Error("unsupported certificate record schema version");
  if (checksum(record.calculationInput) !== record.calculationInputChecksum) throw new Error("certificate input checksum mismatch");
  if (checksum(record.calculationResult) !== record.calculationResultChecksum) throw new Error("certificate result checksum mismatch");
  if (checksum(immutableIssuePayload(record)) !== record.issueChecksum) throw new Error("certificate issue checksum mismatch");
  if (Number(record.schemaVersion) >= 2) {
    cleanText(record.predecessorCertificateId, "predecessor certificate id", 64);
    const predecessorChecksum = cleanText(record.predecessorIssueChecksum, "predecessor issue checksum", 64);
    if (predecessorChecksum && !/^[a-f0-9]{64}$/.test(predecessorChecksum)) throw new Error("predecessor issue checksum is invalid");
    finiteDecimal(record.closingRetention, "closing retention");
    cleanText(record.openingBalanceReason, "opening balance reason", 500);
    if (Boolean(record.predecessorCertificateId) !== Boolean(predecessorChecksum)) throw new Error("predecessor certificate trace is incomplete");
  }
  if (record.status === "issued") {
    if (record.voidedAt || record.voidedBy || record.voidReason || record.voidChecksum) throw new Error("issued certificate contains invalid void metadata");
  } else if (record.status === "voided") {
    isoInstant(record.voidedAt, "certificate void time");
    cleanText(record.voidedBy, "certificate void actor", 100, true);
    cleanText(record.voidReason, "certificate void reason", 500, true);
    if (checksum(voidPayload(record)) !== record.voidChecksum) throw new Error("certificate void checksum mismatch");
  } else {
    throw new Error("certificate status is invalid");
  }
  return JSON.parse(JSON.stringify(record));
}

function records(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("certificate state is required");
  const value = state[STORAGE_KEY];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("certificate register is invalid");
  return value;
}

function listCertificates(state) {
  return records(state).map(certificateView).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id.localeCompare(a.id));
}

function certificateSummary(record) {
  const view = certificateView(record);
  return {
    id: view.id,
    certificateNo: view.certificateNo,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
    applicationReference: view.applicationReference,
    remarks: view.remarks,
    status: view.status,
    netCertified: view.calculationResult.totals.netCertified,
    baseCurrency: view.baseCurrency,
    settingsVersion: view.settingsVersion,
    settingsSchemaVersion: view.settingsSchemaVersion,
    settingsChecksum: view.settingsChecksum,
    issuedAt: view.issuedAt,
    issuedBy: view.issuedBy,
    issueChecksum: view.issueChecksum,
    predecessorCertificateId: view.predecessorCertificateId || "",
    predecessorIssueChecksum: view.predecessorIssueChecksum || "",
    closingRetention: view.closingRetention || closingRetentionFor(view),
    cumulativeCertified: view.calculationResult.totals.cumulativeCertified,
    voidedAt: view.voidedAt,
    voidedBy: view.voidedBy,
    voidReason: view.voidReason,
    voidChecksum: view.voidChecksum
  };
}

function closingRetentionFor(record) {
  const totals = record && record.calculationResult && record.calculationResult.totals;
  if (!totals) throw new Error("certificate retention totals are required");
  const previous = finiteDecimal(totals.previousRetention, "previous retention");
  const current = finiteDecimal(totals.currentRetention, "current retention");
  const release = finiteDecimal(totals.retentionRelease, "retention release");
  const digits = Number(record.calculationResult.moneyDigits ?? 2);
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) throw new Error("certificate money digits are invalid");
  return previous.plus(current).minus(release).toFixed(digits);
}

function continuityFor(state, request) {
  const active = listCertificates(state).filter((record) => record.status === "issued");
  const latest = active[0] || null;
  const previousRetention = finiteDecimal(request.calculationResult.totals.previousRetention, "previous retention");
  const previousCumulative = finiteDecimal(request.calculationResult.totals.previousCumulativeCertified, "previous cumulative certified");
  if (!latest) {
    if ((!previousRetention.isZero() || !previousCumulative.isZero()) && !request.openingBalanceReason) {
      throw new Error("opening balance reason is required for a non-zero first certificate balance");
    }
    return { predecessorCertificateId: "", predecessorIssueChecksum: "", openingBalanceReason: request.openingBalanceReason };
  }
  if (request.openingBalanceReason) throw new Error("opening balance reason is only allowed for the first active certificate");
  if (request.periodStart <= latest.periodEnd) throw new Error("certificate period must start after the latest active certificate");
  if (request.baseCurrency !== latest.baseCurrency) throw new Error("certificate base currency must match the predecessor certificate");
  const expectedRetention = finiteDecimal(latest.closingRetention || closingRetentionFor(latest), "predecessor closing retention");
  const expectedCumulative = finiteDecimal(latest.calculationResult.totals.cumulativeCertified, "predecessor cumulative certified");
  if (!previousRetention.eq(expectedRetention)) throw new Error(`previous retention must equal predecessor closing retention ${expectedRetention.toString()}`);
  if (!previousCumulative.eq(expectedCumulative)) throw new Error(`previous cumulative certified must equal predecessor cumulative certified ${expectedCumulative.toString()}`);
  return { predecessorCertificateId: latest.id, predecessorIssueChecksum: latest.issueChecksum, openingBalanceReason: "" };
}

function validateCertificateRequest(state, payload) {
  const request = normalizedRequest(payload);
  continuityFor(state, request);
  return JSON.parse(JSON.stringify(request));
}

function listCertificateSummaries(state, options = {}) {
  const offset = Number(options.offset ?? 0);
  const limit = Number(options.limit ?? 50);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("certificate list offset is invalid");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("certificate list limit is invalid");
  const source = records(state).slice().sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  return { rows: source.slice(offset, offset + limit).map(certificateSummary), total: source.length, offset, limit };
}

function issueCertificate(state, payload, metadata = {}) {
  const request = normalizedRequest(payload);
  const requestChecksum = checksum(idempotencyPayload(request));
  const rows = listCertificates(state);
  const replay = rows.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (replay) {
    if (replay.requestChecksum !== requestChecksum) throw new Error("idempotency key was already used for a different certificate request");
    return { record: replay, replay: true };
  }
  if (rows.some((row) => row.certificateNo === request.certificateNo)) throw new Error("certificate number already exists");
  if (rows.length >= MAX_CERTIFICATES) throw new Error("certificate register limit exceeded");
  const continuity = continuityFor(state, request);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: cleanText(metadata.id || crypto.randomUUID(), "certificate id", 64, true),
    ...request,
    ...continuity,
    requestChecksum,
    issuedAt: isoInstant(metadata.issuedAt || new Date().toISOString(), "certificate issue time"),
    issuedBy: cleanText(metadata.issuedBy, "certificate issue actor", 100, true),
    closingRetention: "",
    status: "issued",
    voidedAt: "",
    voidedBy: "",
    voidReason: "",
    voidChecksum: ""
  };
  record.closingRetention = closingRetentionFor(record);
  record.issueChecksum = checksum(immutableIssuePayload(record));
  state[STORAGE_KEY] = [...records(state), record];
  return { record: certificateView(record), replay: false };
}

function findCertificate(state, identifier) {
  const key = cleanText(identifier, "certificate identifier", 64, true);
  const record = listCertificates(state).find((row) => row.id === key || row.certificateNo === key);
  if (!record) throw new Error("certificate does not exist");
  return record;
}

function voidCertificate(state, identifier, metadata = {}) {
  const existing = findCertificate(state, identifier);
  if (existing.status !== "issued") throw new Error("certificate is already voided");
  if (listCertificates(state).some((record) => record.status === "issued" && record.predecessorCertificateId === existing.id)) {
    throw new Error("certificate has an active successor and cannot be voided first");
  }
  const reason = cleanText(metadata.reason, "certificate void reason", 500, true);
  const rows = records(state);
  const index = rows.findIndex((row) => row.id === existing.id);
  const updated = {
    ...existing,
    status: "voided",
    voidedAt: isoInstant(metadata.voidedAt || new Date().toISOString(), "certificate void time"),
    voidedBy: cleanText(metadata.voidedBy, "certificate void actor", 100, true),
    voidReason: reason
  };
  updated.voidChecksum = checksum(voidPayload(updated));
  state[STORAGE_KEY] = rows.map((row, rowIndex) => rowIndex === index ? updated : row);
  return certificateView(updated);
}

module.exports = {
  MAX_CERTIFICATES,
  SCHEMA_VERSION,
  STORAGE_KEY,
  certificateView,
  closingRetentionFor,
  checksum,
  findCertificate,
  issueCertificate,
  listCertificateSummaries,
  listCertificates,
  validateCertificateRequest,
  normalizedRequest,
  voidCertificate
};
