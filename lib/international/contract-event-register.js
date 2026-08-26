"use strict";

const crypto = require("crypto");
const Decimal = require("decimal.js");
const certificateRegister = require("./certificate-register");

const STORAGE_KEY = "internationalContractEvents";
const SCHEMA_VERSION = 1;
const MAX_EVENTS = 20000;
const EVENT_TYPES = new Set(["variation", "claim"]);

function cleanText(value, label, maximum, required = false) {
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > maximum || /[\x00-\x1f\x7f]/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function isoDate(value, label) {
  const result = cleanText(value, label, 10, true);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error(`${label} must be an ISO date`);
  return result;
}

function isoInstant(value, label) {
  const result = cleanText(value, label, 40, true);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) throw new Error(`${label} must be an ISO instant`);
  return result;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function nonNegativeInteger(value, label) {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0 || result > 36500) throw new Error(`${label} must be an integer from 0 to 36500`);
  return result;
}

function decimalString(value, label) {
  try {
    const result = new Decimal(value ?? 0);
    if (!result.isFinite() || result.isNegative()) throw new Error();
    return result.toSignificantDigits(20).toString();
  } catch {
    throw new Error(`${label} must be a non-negative decimal number`);
  }
}

function currencyCode(value) {
  const result = cleanText(value, "contract event currency", 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw new Error("contract event currency must be a three-letter code");
  return result;
}

function normalizedRequest(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("contract event payload must be an object");
  const eventType = cleanText(payload.eventType, "contract event type", 20, true).toLowerCase();
  if (!EVENT_TYPES.has(eventType)) throw new Error("contract event type must be variation or claim");
  const claimedAmount = decimalString(payload.claimedAmount, "contract event claimed amount");
  const claimedTimeImpactDays = nonNegativeInteger(payload.claimedTimeImpactDays, "contract event claimed time impact");
  if (new Decimal(claimedAmount).isZero() && claimedTimeImpactDays === 0) throw new Error("contract event must claim money or time");
  const idempotencyKey = cleanText(payload.idempotencyKey, "contract event idempotency key", 128, true);
  if (idempotencyKey.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) throw new Error("contract event idempotency key is invalid");
  return {
    eventType,
    title: cleanText(payload.title, "contract event title", 200, true),
    noticeDate: isoDate(payload.noticeDate, "contract event notice date"),
    currency: currencyCode(payload.currency),
    claimedAmount,
    claimedTimeImpactDays,
    description: cleanText(payload.description, "contract event description", 2000),
    contractClause: cleanText(payload.contractClause, "contract event contract clause", 100),
    idempotencyKey
  };
}

function submissionPayload(record) {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    eventNo: record.eventNo,
    supersedesEventId: record.supersedesEventId,
    request: record.request,
    submittedAt: record.submittedAt,
    submittedBy: record.submittedBy,
    submittedByUserId: record.submittedByUserId
  };
}

function decisionPayload(record) {
  return {
    eventId: record.id,
    submissionChecksum: record.submissionChecksum,
    approvedAmount: record.approvedAmount,
    approvedTimeImpactDays: record.approvedTimeImpactDays,
    decisionReason: record.decisionReason,
    approvedAt: record.approvedAt,
    approvedBy: record.approvedBy,
    approvedByUserId: record.approvedByUserId
  };
}

function records(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("contract event state is required");
  const rows = state[STORAGE_KEY];
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error("contract event register is invalid");
  return rows;
}

function eventView(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || record.schemaVersion !== SCHEMA_VERSION) throw new Error("contract event record is invalid");
  cleanText(record.id, "contract event id", 64, true);
  cleanText(record.eventNo, "contract event number", 64, true);
  cleanText(record.supersedesEventId, "superseded contract event id", 64);
  normalizedRequest(record.request);
  isoInstant(record.submittedAt, "contract event submission time");
  cleanText(record.submittedBy, "contract event submitter", 100, true);
  positiveInteger(record.submittedByUserId, "contract event submitter id");
  cleanText(record.workflowInstanceKey, "contract event workflow key", 64);
  cleanText(record.states, "contract event state", 40, true);
  if (certificateRegister.checksum(submissionPayload(record)) !== record.submissionChecksum) throw new Error("contract event submission checksum mismatch");
  const hasDecision = Boolean(record.decisionChecksum || record.approvedAt || record.approvedBy || record.approvedAmount);
  if (hasDecision) {
    const approvedAmount = decimalString(record.approvedAmount, "contract event approved amount");
    const approvedTimeImpactDays = nonNegativeInteger(record.approvedTimeImpactDays, "contract event approved time impact");
    if (new Decimal(approvedAmount).gt(record.request.claimedAmount)) throw new Error("contract event approved amount exceeds the claim");
    if (approvedTimeImpactDays > record.request.claimedTimeImpactDays) throw new Error("contract event approved time impact exceeds the claim");
    if (new Decimal(approvedAmount).isZero() && approvedTimeImpactDays === 0) throw new Error("contract event approval must grant money or time");
    cleanText(record.decisionReason, "contract event decision reason", 1000, true);
    isoInstant(record.approvedAt, "contract event approval time");
    cleanText(record.approvedBy, "contract event approver", 100, true);
    positiveInteger(record.approvedByUserId, "contract event approver id");
    if (Number(record.approvedByUserId) === Number(record.submittedByUserId)) throw new Error("contract event requires a different approver");
    if (certificateRegister.checksum(decisionPayload(record)) !== record.decisionChecksum) throw new Error("contract event decision checksum mismatch");
  }
  return JSON.parse(JSON.stringify(record));
}

function listEvents(state, options = {}) {
  const offset = Number(options.offset ?? 0);
  const limit = Number(options.limit ?? 50);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("contract event offset is invalid");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("contract event limit is invalid");
  const rows = records(state).map(eventView).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
}

function findEvent(state, identifier) {
  const key = cleanText(identifier, "contract event identifier", 64, true);
  const record = records(state).find((row) => row.id === key || row.eventNo === key);
  if (!record) throw new Error("contract event does not exist");
  return eventView(record);
}

function createEvent(state, payload, metadata = {}) {
  const request = normalizedRequest(payload);
  const eventNo = cleanText(payload.eventNo, "contract event number", 64, true);
  const supersedesEventId = cleanText(payload.supersedesEventId, "superseded contract event id", 64);
  const rows = records(state).map(eventView);
  const replay = rows.find((row) => row.request.idempotencyKey === request.idempotencyKey);
  if (replay) {
    if (replay.eventNo !== eventNo || replay.supersedesEventId !== supersedesEventId || certificateRegister.checksum(replay.request) !== certificateRegister.checksum(request)) throw new Error("idempotency key was already used for a different contract event");
    return { record: replay, replay: true };
  }
  if (rows.some((row) => row.eventNo === eventNo)) throw new Error("contract event number already exists");
  if (supersedesEventId) {
    const previous = rows.find((row) => row.id === supersedesEventId);
    if (!previous) throw new Error("superseded contract event does not exist");
    if (previous.states !== "已退回") throw new Error("only a returned contract event can be superseded");
    if (rows.some((row) => row.supersedesEventId === previous.id)) throw new Error("returned contract event already has a successor");
  }
  if (rows.length >= MAX_EVENTS) throw new Error("contract event register limit exceeded");
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: cleanText(metadata.id || crypto.randomUUID(), "contract event id", 64, true),
    eventNo,
    supersedesEventId,
    request,
    submittedAt: isoInstant(metadata.submittedAt || new Date().toISOString(), "contract event submission time"),
    submittedBy: cleanText(metadata.submittedBy, "contract event submitter", 100, true),
    submittedByUserId: positiveInteger(metadata.submittedByUserId, "contract event submitter id"),
    workflowInstanceKey: "",
    states: "草稿",
    approvedAmount: "",
    approvedTimeImpactDays: 0,
    decisionReason: "",
    approvedAt: "",
    approvedBy: "",
    approvedByUserId: 0,
    decisionChecksum: ""
  };
  if (rows.some((row) => row.id === record.id)) throw new Error("contract event id already exists");
  record.submissionChecksum = certificateRegister.checksum(submissionPayload(record));
  state[STORAGE_KEY] = [...records(state), record];
  return { record: eventView(record), replay: false };
}

function approveRecord(record, payload = {}, metadata = {}) {
  const current = eventView(record);
  if (current.states !== "已批准") throw new Error("contract event must complete workflow approval first");
  if (current.decisionChecksum) throw new Error("contract event decision already exists");
  const updated = {
    ...current,
    approvedAmount: decimalString(payload.approvedAmount, "contract event approved amount"),
    approvedTimeImpactDays: nonNegativeInteger(payload.approvedTimeImpactDays, "contract event approved time impact"),
    decisionReason: cleanText(payload.decisionReason, "contract event decision reason", 1000, true),
    approvedAt: isoInstant(metadata.approvedAt || new Date().toISOString(), "contract event approval time"),
    approvedBy: cleanText(metadata.approvedBy, "contract event approver", 100, true),
    approvedByUserId: positiveInteger(metadata.approvedByUserId, "contract event approver id")
  };
  updated.decisionChecksum = certificateRegister.checksum(decisionPayload(updated));
  return eventView(updated);
}

module.exports = { EVENT_TYPES, MAX_EVENTS, SCHEMA_VERSION, STORAGE_KEY, approveRecord, createEvent, eventView, findEvent, listEvents, normalizedRequest };
