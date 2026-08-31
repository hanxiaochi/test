"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const applications = require("../../lib/international/certificate-application");
const certificates = require("../../lib/international/certificate-register");

function certificateRequest(overrides = {}) {
  return {
    certificateNo: "IPC-APP-001",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    applicationReference: "PAYAPP-001",
    remarks: "August application",
    openingBalanceReason: "",
    idempotencyKey: "ipc-app-001-request",
    calculationInput: { previousRetention: "0", previousCumulativeCertified: "0", retentionRelease: "0", lines: [{ code: "WORK", amount: "1000" }] },
    calculationResult: {
      locale: "en-US",
      settingsVersion: 2,
      settingsSchemaVersion: 2,
      settingsChecksum: "a".repeat(64),
      certificateStandard: "FIDIC_RED_2017",
      baseCurrency: "USD",
      moneyDigits: 2,
      totals: { previousRetention: "0.00", currentRetention: "50.00", retentionRelease: "0.00", previousCumulativeCertified: "0.00", cumulativeCertified: "950.00", netCertified: "950.00" }
    },
    ...overrides
  };
}

function submit(state, overrides = {}, metadata = {}) {
  return applications.createApplication(state, {
    applicationNo: "PAYAPP-001",
    certificateRequest: certificateRequest(),
    ...overrides
  }, {
    id: "application-1",
    submittedAt: "2026-09-01T00:00:00.000Z",
    submittedBy: "editor",
    submittedByUserId: 7,
    ...metadata
  });
}

test("creates, verifies, lists and replays an immutable certificate application", () => {
  const state = {};
  const created = submit(state);
  assert.equal(created.replay, false);
  assert.equal(created.record.states, "草稿");
  assert.equal(created.record.submissionChecksum.length, 64);
  assert.equal(created.record.request.calculationResult.settingsVersion, 2);
  assert.deepEqual(applications.findApplication(state, "PAYAPP-001"), created.record);
  assert.deepEqual(applications.listApplications(state, { offset: 0, limit: 1 }), { rows: [created.record], total: 1, offset: 0, limit: 1 });
  const replay = submit(state, {}, { id: "ignored", submittedBy: "other", submittedByUserId: 8 });
  assert.equal(replay.replay, true);
  assert.equal(replay.record.id, "application-1");
  assert.equal(state.internationalCertificateApplications.length, 1);
});

test("links only the exact issued certificate and keeps the submission checksum immutable", () => {
  const state = {};
  const application = submit(state).record;
  const issued = certificates.issueCertificate(state, application.request, { id: "certificate-1", issuedAt: "2026-09-02T00:00:00.000Z", issuedBy: "approver" }).record;
  const linked = applications.markIssued(state, application.id, issued);
  assert.equal(linked.certificateId, issued.id);
  assert.equal(linked.certificateIssueChecksum, issued.issueChecksum);
  assert.equal(linked.issueLinkChecksum.length, 64);
  assert.equal(linked.submissionChecksum, application.submissionChecksum);
  assert.deepEqual(applications.markIssued(state, application.id, issued), linked);
  assert.equal(submit(state).replay, true, "an issued application should remain idempotently replayable");

  const anotherState = {};
  const another = submit(anotherState).record;
  const different = certificates.issueCertificate({}, certificateRequest({ certificateNo: "IPC-DIFFERENT", idempotencyKey: "ipc-different-request" }), { id: "different", issuedAt: "2026-09-02T00:00:00.000Z", issuedBy: "approver" }).record;
  assert.throws(() => applications.markIssued(state, application.id, different), /already linked to another certificate/);
  assert.throws(() => applications.markIssued(anotherState, another.id, different), /does not match/);
  anotherState.internationalCertificateApplications[0].certificateId = "partial";
  assert.throws(() => applications.findApplication(anotherState, another.id), /linked certificate number is invalid/);
});

test("superseding and uniqueness rules reject ambiguous open applications", () => {
  const state = {};
  submit(state);
  assert.throws(() => submit(state, { applicationNo: "PAYAPP-CHANGED" }), /idempotency key.*different/);
  assert.throws(() => submit(state, { certificateRequest: certificateRequest({ idempotencyKey: "ipc-app-duplicate-number" }) }, { id: "application-2" }), /application number already exists/);
  assert.throws(() => submit(state, { applicationNo: "PAYAPP-002", certificateRequest: certificateRequest({ idempotencyKey: "ipc-app-open-number" }) }, { id: "application-2" }), /open application/);
  assert.throws(() => submit(state, { applicationNo: "PAYAPP-002", supersedesApplicationId: "missing", certificateRequest: certificateRequest({ idempotencyKey: "ipc-app-missing-parent" }) }, { id: "application-2" }), /does not exist/);
  const replacement = submit(state, {
    applicationNo: "PAYAPP-002",
    supersedesApplicationId: "application-1",
    certificateRequest: certificateRequest({ idempotencyKey: "ipc-app-replacement" })
  }, { id: "application-2", submittedAt: "2026-09-03T00:00:00.000Z" }).record;
  assert.equal(replacement.supersedesApplicationId, "application-1");
  assert.deepEqual(applications.listApplications(state).rows.map((row) => row.id), ["application-2", "application-1"]);
  assert.throws(() => applications.createApplication(state, { applicationNo: "PAYAPP-003", certificateRequest: certificateRequest({ certificateNo: "IPC-APP-003", idempotencyKey: "ipc-app-id-collision" }) }, { id: "application-2", submittedBy: "editor", submittedByUserId: 7 }), /id already exists/);
});

test("tampering and malformed state fail closed", () => {
  assert.throws(() => applications.createApplication({}, null), /payload must be an object/);
  assert.throws(() => submit({}, {}, { submittedByUserId: 0 }), /positive integer/);
  assert.throws(() => applications.listApplications(null), /state is required/);
  assert.throws(() => applications.listApplications({ internationalCertificateApplications: {} }), /register is invalid/);
  assert.throws(() => applications.listApplications({}, { offset: -1 }), /offset is invalid/);
  assert.throws(() => applications.listApplications({}, { limit: 101 }), /limit is invalid/);
  assert.throws(() => applications.findApplication({}, "missing"), /does not exist/);

  const state = {};
  submit(state);
  state.internationalCertificateApplications[0].request.remarks = "tampered";
  assert.throws(() => applications.findApplication(state, "application-1"), /submission checksum mismatch/);
  const invalid = { internationalCertificateApplications: [{ schemaVersion: 99 }] };
  assert.throws(() => applications.listApplications(invalid), /record is invalid/);
});
