"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const register = require("../../lib/international/certificate-register");

function request(overrides = {}) {
  return {
    certificateNo: "IPC-2026-001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    applicationReference: "APP-001",
    remarks: "July certificate",
    idempotencyKey: "ipc-2026-001-request",
    calculationInput: { lines: [{ code: "WORK", amount: "1000" }] },
    calculationResult: {
      settingsVersion: 2,
      settingsSchemaVersion: 2,
      settingsChecksum: "a".repeat(64),
      certificateStandard: "FIDIC_RED_2017",
      baseCurrency: "USD",
      totals: { netCertified: "950.00" }
    },
    ...overrides
  };
}

const issueMetadata = { id: "cert-1", issuedAt: "2026-08-01T00:00:00.000Z", issuedBy: "admin" };

test("issues an immutable checksummed certificate and lists exact snapshots", () => {
  const state = {};
  const result = register.issueCertificate(state, request(), issueMetadata);
  assert.equal(result.replay, false);
  assert.equal(result.record.status, "issued");
  assert.equal(result.record.calculationInputChecksum.length, 64);
  assert.equal(result.record.calculationResultChecksum.length, 64);
  assert.equal(result.record.issueChecksum.length, 64);
  assert.deepEqual(register.listCertificates(state), [result.record]);
  assert.deepEqual(register.findCertificate(state, "IPC-2026-001"), result.record);

  const second = register.issueCertificate(state, request({
    certificateNo: "IPC-2026-002",
    idempotencyKey: "ipc-2026-002-request"
  }), { id: "cert-2", issuedAt: "2026-08-02T00:00:00.000Z", issuedBy: "admin" }).record;
  assert.deepEqual(register.listCertificates(state).map((row) => row.id), [second.id, result.record.id]);
  const summaries = register.listCertificateSummaries(state, { offset: 0, limit: 1 });
  assert.equal(summaries.total, 2);
  assert.deepEqual(summaries.rows.map((row) => row.id), [second.id]);
  assert.equal(Object.prototype.hasOwnProperty.call(summaries.rows[0], "calculationResult"), false);
});

test("idempotency replays the exact request and rejects conflicting reuse", () => {
  const state = {};
  const first = register.issueCertificate(state, request(), issueMetadata);
  const replay = register.issueCertificate(state, request(), { id: "ignored", issuedAt: "2026-08-02T00:00:00.000Z", issuedBy: "other" });
  assert.equal(replay.replay, true);
  assert.equal(replay.record.id, first.record.id);
  assert.equal(state.internationalCertificates.length, 1);
  const afterSettingsChange = register.issueCertificate(state, request({
    calculationResult: { ...request().calculationResult, settingsVersion: 3, settingsChecksum: "b".repeat(64) }
  }), issueMetadata);
  assert.equal(afterSettingsChange.replay, true);
  assert.equal(afterSettingsChange.record.settingsVersion, 2);
  assert.throws(() => register.issueCertificate(state, request({ remarks: "different" }), issueMetadata), /different certificate request/);
  assert.throws(() => register.issueCertificate(state, request({ idempotencyKey: "another-request-key" }), issueMetadata), /number already exists/);
});

test("voiding preserves the issue snapshot and creates separately verified metadata", () => {
  const state = {};
  const issued = register.issueCertificate(state, request(), issueMetadata).record;
  const voided = register.voidCertificate(state, issued.id, { reason: "Superseded by corrected IPC", voidedAt: "2026-08-03T00:00:00.000Z", voidedBy: "admin" });
  assert.equal(voided.status, "voided");
  assert.equal(voided.issueChecksum, issued.issueChecksum);
  assert.equal(voided.voidChecksum.length, 64);
  assert.throws(() => register.voidCertificate(state, issued.id, { reason: "again", voidedBy: "admin" }), /already voided/);
});

test("tampering with input, result, issue, or void metadata fails closed", () => {
  const makeState = () => {
    const state = {};
    register.issueCertificate(state, request(), issueMetadata);
    return state;
  };
  const input = makeState();
  input.internationalCertificates[0].calculationInput.lines[0].amount = "9999";
  assert.throws(() => register.listCertificates(input), /input checksum mismatch/);
  const result = makeState();
  result.internationalCertificates[0].calculationResult.totals.netCertified = "1.00";
  assert.throws(() => register.listCertificates(result), /result checksum mismatch/);
  const issue = makeState();
  issue.internationalCertificates[0].certificateNo = "CHANGED";
  assert.throws(() => register.listCertificates(issue), /issue checksum mismatch/);
  const issuedVoidMetadata = makeState();
  issuedVoidMetadata.internationalCertificates[0].voidReason = "Invalid";
  assert.throws(() => register.listCertificates(issuedVoidMetadata), /issue checksum mismatch|invalid void metadata/);
  const voided = makeState();
  register.voidCertificate(voided, "cert-1", { reason: "Reason", voidedAt: "2026-08-03T00:00:00.000Z", voidedBy: "admin" });
  voided.internationalCertificates[0].voidReason = "Changed";
  assert.throws(() => register.listCertificates(voided), /void checksum mismatch/);
});

test("invalid issue and state contracts are rejected without mutation", () => {
  const invalids = [
    [{}, /number/],
    [{ certificateNo: "X", periodStart: "bad" }, /period start/],
    [request({ periodStart: "2026-02-31" }), /period start/],
    [request({ periodStart: "2026-08-02", periodEnd: "2026-08-01" }), /must not precede/],
    [request({ idempotencyKey: "short" }), /idempotency/],
    [request({ calculationInput: [] }), /must be an object/],
    [request({ calculationResult: { totals: {} } }), /settings version/],
    [request({ calculationResult: { ...request().calculationResult, settingsChecksum: "bad" } }), /settings checksum/],
    [request({ calculationResult: { ...request().calculationResult, baseCurrency: "12" } }), /base currency/],
    [request({ calculationResult: { ...request().calculationResult, totals: [] } }), /totals/]
  ];
  invalids.forEach(([payload, pattern]) => {
    const state = {};
    assert.throws(() => register.issueCertificate(state, payload, issueMetadata), pattern);
    assert.deepEqual(state, {});
  });
  assert.throws(() => register.listCertificates({ internationalCertificates: {} }), /register is invalid/);
  assert.throws(() => register.listCertificateSummaries({}, { offset: -1 }), /offset/);
  assert.throws(() => register.listCertificateSummaries({}, { limit: 101 }), /limit/);
  assert.throws(() => register.listCertificates(null), /state is required/);
  assert.throws(() => register.certificateView(null), /record is invalid/);
  assert.throws(() => register.certificateView({ schemaVersion: 2 }), /unsupported/);
  assert.throws(() => register.findCertificate({}, "missing"), /does not exist/);
  assert.throws(() => register.voidCertificate({}, "missing", { reason: "Reason", voidedBy: "admin" }), /does not exist/);

  const badStatus = {};
  register.issueCertificate(badStatus, request(), issueMetadata);
  badStatus.internationalCertificates[0].status = "draft";
  assert.throws(() => register.listCertificates(badStatus), /status is invalid|issue checksum mismatch/);
});

test("canonical checksums are key-order independent and reject non-JSON values", () => {
  assert.equal(register.checksum({ b: 2, a: 1 }), register.checksum({ a: 1, b: 2 }));
  assert.throws(() => register.checksum({ value: Number.NaN }), /non-finite/);
  assert.throws(() => register.checksum({ value: undefined }), /undefined/);
  assert.throws(() => register.normalizedRequest(request({ calculationInput: new Date() })), /JSON values only/);
  let nested = {};
  for (let index = 0; index < 52; index += 1) nested = { child: nested };
  assert.throws(() => register.checksum(nested), /nesting exceeds/);

  const state = {};
  const generated = register.issueCertificate(state, request(), { issuedBy: "admin" }).record;
  assert.match(generated.id, /^[0-9a-f-]{36}$/);
  assert.match(generated.issuedAt, /^\d{4}-\d{2}-\d{2}T/);
});
