"use strict";

const crypto = require("crypto");
const certificateRegister = require("./certificate-register");

const STORAGE_KEY = "internationalCertificateApplications";
const SCHEMA_VERSION = 1;
const MAX_APPLICATIONS = 10000;

function cleanText(value, label, maximum, required = false) {
  const result = String(value ?? "").trim();
  if ((required && !result) || result.length > maximum || /[\x00-\x1f\x7f]/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function isoInstant(value, label) {
  const result = cleanText(value, label, 40, true);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) throw new Error(`${label} must be an ISO instant`);
  return result;
}

function submissionPayload(record) {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    applicationNo: record.applicationNo,
    supersedesApplicationId: record.supersedesApplicationId,
    request: record.request,
    submittedAt: record.submittedAt,
    submittedBy: record.submittedBy,
    submittedByUserId: record.submittedByUserId
  };
}

function issueLinkPayload(record) {
  return {
    submissionChecksum: record.submissionChecksum,
    certificateId: record.certificateId,
    certificateNo: record.certificateNo,
    certificateIssueChecksum: record.certificateIssueChecksum,
    issuedAt: record.issuedAt,
    issuedBy: record.issuedBy
  };
}

function applicationView(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || Number(record.schemaVersion) !== SCHEMA_VERSION) throw new Error("certificate application record is invalid");
  cleanText(record.id, "certificate application id", 64, true);
  cleanText(record.applicationNo, "certificate application number", 64, true);
  cleanText(record.supersedesApplicationId, "superseded application id", 64);
  const normalized = certificateRegister.normalizedRequest(record.request);
  if (certificateRegister.checksum(normalized) !== certificateRegister.checksum(record.request)) throw new Error("certificate application request is not normalized");
  isoInstant(record.submittedAt, "certificate application submission time");
  cleanText(record.submittedBy, "certificate application submitter", 100, true);
  positiveInteger(record.submittedByUserId, "certificate application submitter id");
  if (certificateRegister.checksum(submissionPayload(record)) !== record.submissionChecksum) throw new Error("certificate application submission checksum mismatch");
  cleanText(record.workflowInstanceKey, "certificate application workflow key", 64);
  cleanText(record.states, "certificate application state", 40, true);
  const linked = Boolean(record.certificateId || record.certificateNo || record.certificateIssueChecksum || record.issuedAt || record.issuedBy || record.issueLinkChecksum);
  if (linked) {
    cleanText(record.certificateId, "linked certificate id", 64, true);
    cleanText(record.certificateNo, "linked certificate number", 64, true);
    if (!/^[a-f0-9]{64}$/.test(cleanText(record.certificateIssueChecksum, "linked certificate checksum", 64, true))) throw new Error("linked certificate checksum is invalid");
    isoInstant(record.issuedAt, "linked certificate issue time");
    cleanText(record.issuedBy, "linked certificate issuer", 100, true);
    if (certificateRegister.checksum(issueLinkPayload(record)) !== record.issueLinkChecksum) throw new Error("certificate application issue link checksum mismatch");
  }
  return JSON.parse(JSON.stringify(record));
}

function records(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("certificate application state is required");
  const rows = state[STORAGE_KEY];
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error("certificate application register is invalid");
  return rows;
}

function listApplications(state, options = {}) {
  const offset = Number(options.offset ?? 0);
  const limit = Number(options.limit ?? 50);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("certificate application list offset is invalid");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("certificate application list limit is invalid");
  const rows = records(state).map(applicationView).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
}

function findApplication(state, identifier) {
  const key = cleanText(identifier, "certificate application identifier", 64, true);
  const record = records(state).find((row) => row.id === key || row.applicationNo === key);
  if (!record) throw new Error("certificate application does not exist");
  return applicationView(record);
}

function createApplication(state, payload, metadata = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("certificate application payload must be an object");
  const normalizedRequest = certificateRegister.normalizedRequest(payload.certificateRequest);
  const applicationNo = cleanText(payload.applicationNo, "certificate application number", 64, true);
  const supersedesApplicationId = cleanText(payload.supersedesApplicationId, "superseded application id", 64);
  const rows = records(state).map(applicationView);
  const replay = rows.find((row) => row.request.idempotencyKey === normalizedRequest.idempotencyKey);
  if (replay) {
    if (replay.applicationNo !== applicationNo || replay.supersedesApplicationId !== supersedesApplicationId || certificateRegister.checksum(replay.request) !== certificateRegister.checksum(normalizedRequest)) throw new Error("idempotency key was already used for a different certificate application");
    return { record: replay, replay: true };
  }
  const request = certificateRegister.validateCertificateRequest(state, normalizedRequest);
  if (rows.some((row) => row.applicationNo === applicationNo)) throw new Error("certificate application number already exists");
  if (supersedesApplicationId) {
    const previous = rows.find((row) => row.id === supersedesApplicationId);
    if (!previous) throw new Error("superseded certificate application does not exist");
    if (previous.certificateId) throw new Error("an issued certificate application cannot be superseded");
  }
  if (rows.some((row) => row.request.certificateNo === request.certificateNo && !row.certificateId && row.id !== supersedesApplicationId)) throw new Error("an open application already uses this certificate number");
  if (rows.length >= MAX_APPLICATIONS) throw new Error("certificate application register limit exceeded");
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: cleanText(metadata.id || crypto.randomUUID(), "certificate application id", 64, true),
    applicationNo,
    supersedesApplicationId,
    request,
    submittedAt: isoInstant(metadata.submittedAt || new Date().toISOString(), "certificate application submission time"),
    submittedBy: cleanText(metadata.submittedBy, "certificate application submitter", 100, true),
    submittedByUserId: positiveInteger(metadata.submittedByUserId, "certificate application submitter id"),
    workflowInstanceKey: "",
    states: "草稿",
    certificateId: "",
    certificateNo: "",
    certificateIssueChecksum: "",
    issuedAt: "",
    issuedBy: "",
    issueLinkChecksum: ""
  };
  if (rows.some((row) => row.id === record.id)) throw new Error("certificate application id already exists");
  record.submissionChecksum = certificateRegister.checksum(submissionPayload(record));
  state[STORAGE_KEY] = [...records(state), record];
  return { record: applicationView(record), replay: false };
}

function markIssued(state, identifier, certificate) {
  const application = findApplication(state, identifier);
  const issued = certificateRegister.certificateView(certificate);
  if (application.certificateId) {
    if (application.certificateId !== issued.id || application.certificateIssueChecksum !== issued.issueChecksum) throw new Error("certificate application is already linked to another certificate");
    return application;
  }
  const issuedRequest = certificateRegister.normalizedRequest(issued);
  if (certificateRegister.checksum(issuedRequest) !== certificateRegister.checksum(application.request)) throw new Error("issued certificate does not match the approved application");
  const updated = {
    ...application,
    certificateId: issued.id,
    certificateNo: issued.certificateNo,
    certificateIssueChecksum: issued.issueChecksum,
    issuedAt: issued.issuedAt,
    issuedBy: issued.issuedBy
  };
  updated.issueLinkChecksum = certificateRegister.checksum(issueLinkPayload(updated));
  state[STORAGE_KEY] = records(state).map((row) => row.id === updated.id ? updated : row);
  return applicationView(updated);
}

module.exports = {
  MAX_APPLICATIONS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  applicationView,
  createApplication,
  findApplication,
  listApplications,
  markIssued
};
