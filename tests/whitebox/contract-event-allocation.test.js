"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const allocations = require("../../lib/international/contract-event-allocation");
const applications = require("../../lib/international/certificate-application");
const certificates = require("../../lib/international/certificate-register");
const events = require("../../lib/international/contract-event-register");

function approvedEvent(state, overrides = {}) {
  const created = events.createEvent(state, {
    eventNo: "VO-001",
    eventType: "variation",
    title: "Foundation variation",
    noticeDate: "2026-08-01",
    currency: "USD",
    claimedAmount: "1000",
    claimedTimeImpactDays: 5,
    description: "Changed foundation",
    contractClause: "13.3",
    idempotencyKey: "allocation-event-001",
    ...overrides
  }, { id: "event-1", submittedAt: "2026-08-02T00:00:00.000Z", submittedBy: "editor", submittedByUserId: 7 });
  state.internationalContractEvents[0].states = "已批准";
  state.internationalContractEvents[0] = events.approveRecord(state.internationalContractEvents[0], {
    approvedAmount: overrides.approvedAmount || "1000",
    approvedTimeImpactDays: 4,
    decisionReason: "Independent evaluation"
  }, { approvedAt: "2026-08-03T00:00:00.000Z", approvedBy: "checker", approvedByUserId: 8 });
  return events.findEvent(state, created.record.id);
}

function line(event, amount, overrides = {}) {
  return {
    code: `EVENT-${amount}`,
    description: event.request.title,
    category: event.request.eventType === "variation" ? "variation" : "claims",
    amount: String(amount),
    currency: event.request.currency,
    contractEventId: event.id,
    contractEventDecisionChecksum: event.decisionChecksum,
    ...overrides
  };
}

function certificateRequest(event, amount, overrides = {}) {
  const certificateNo = overrides.certificateNo || "IPC-ALLOC-001";
  const calculationInput = { previousRetention: "0", previousCumulativeCertified: "0", retentionRelease: "0", lines: [line(event, amount)] };
  return {
    certificateNo,
    periodStart: overrides.periodStart || "2026-08-01",
    periodEnd: overrides.periodEnd || "2026-08-31",
    applicationReference: "APP-ALLOC-001",
    remarks: "Allocation regression",
    openingBalanceReason: "",
    idempotencyKey: overrides.idempotencyKey || `${certificateNo.toLowerCase()}-request`,
    calculationInput,
    calculationResult: {
      locale: "en-US",
      settingsVersion: 1,
      settingsSchemaVersion: 2,
      settingsChecksum: "a".repeat(64),
      certificateStandard: "FIDIC_RED_2017",
      baseCurrency: "USD",
      moneyDigits: 2,
      lines: calculationInput.lines,
      totals: { previousRetention: "0.00", currentRetention: "0.00", retentionRelease: "0.00", previousCumulativeCertified: "0.00", cumulativeCertified: String(amount), netCertified: String(amount) }
    }
  };
}

function pendingApplication(state, event, amount) {
  const created = applications.createApplication(state, { applicationNo: "APP-ALLOC-001", certificateRequest: certificateRequest(event, amount) }, { id: "application-1", submittedAt: "2026-09-01T00:00:00.000Z", submittedBy: "editor", submittedByUserId: 7 }).record;
  state.internationalCertificateApplications[0].states = "待审核";
  return applications.findApplication(state, created.id);
}

test("validates approved event bindings and reports remaining entitlement", () => {
  const state = {};
  const event = approvedEvent(state);
  const result = allocations.validateCertificateEventAllocations(state, certificateRequest(event, 400));
  assert.equal(result.count, 1);
  assert.deepEqual(result.bindings[0], {
    eventId: "event-1", eventNo: "VO-001", eventType: "variation", decisionChecksum: event.decisionChecksum,
    currency: "USD", approvedAmount: "1000", reservedAmount: "0", issuedAmount: "0", requestedAmount: "400", remainingAfterRequest: "600"
  });
  assert.deepEqual(allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ code: "WORK", category: "work", amount: "1", currency: "USD" }] } }), { bindings: [], count: 0 });
});

test("pending and approved applications reserve entitlement without double counting issued links", () => {
  const state = {};
  const event = approvedEvent(state);
  const application = pendingApplication(state, event, 600);
  assert.deepEqual(Object.fromEntries(Object.entries(allocations.eventUsage(state, event.id)).map(([key, value]) => [key, value.toString()])), { reserved: "600", issued: "0", used: "600" });
  assert.throws(() => allocations.validateCertificateEventAllocations(state, certificateRequest(event, 401, { certificateNo: "IPC-ALLOC-002", idempotencyKey: "ipc-alloc-002-request" })), /remaining approved amount 400/);
  assert.equal(allocations.validateCertificateEventAllocations(state, certificateRequest(event, 400, { certificateNo: "IPC-ALLOC-002", idempotencyKey: "ipc-alloc-002-request" })).bindings[0].remainingAfterRequest, "0");

  state.internationalCertificateApplications[0].states = "已批准";
  const issued = certificates.issueCertificate(state, application.request, { id: "certificate-1", issuedAt: "2026-09-02T00:00:00.000Z", issuedBy: "checker" }).record;
  applications.markIssued(state, application.id, issued);
  const usage = allocations.eventUsage(state, event.id);
  assert.equal(usage.reserved.toString(), "0");
  assert.equal(usage.issued.toString(), "600");
  assert.equal(usage.used.toString(), "600");
  assert.equal(allocations.eventUsage(state, event.id, { excludeApplicationId: application.id }).used.toString(), "0", "excluding a linked application must also exclude its certificate path");

  certificates.voidCertificate(state, issued.id, { reason: "Replace certificate", voidedAt: "2026-09-03T00:00:00.000Z", voidedBy: "checker" });
  assert.equal(allocations.eventUsage(state, event.id).used.toString(), "0");
});

test("legacy unlinked issued certificates count and returned applications release reservations", () => {
  const state = {};
  const event = approvedEvent(state);
  const request = certificateRequest(event, 250);
  certificates.issueCertificate(state, request, { id: "legacy-certificate", issuedAt: "2026-09-02T00:00:00.000Z", issuedBy: "checker" });
  assert.equal(allocations.eventUsage(state, event.id).issued.toString(), "250");

  const secondState = {};
  const secondEvent = approvedEvent(secondState);
  pendingApplication(secondState, secondEvent, 300);
  secondState.internationalCertificateApplications[0].states = "已退回";
  assert.equal(allocations.eventUsage(secondState, secondEvent.id).used.toString(), "0");
});

test("pre-upgrade unbound variation rows do not block new event allocations", () => {
  const state = {};
  const event = approvedEvent(state);
  const legacyRequest = certificateRequest(event, 250, { certificateNo: "IPC-PRE-UPGRADE", idempotencyKey: "ipc-pre-upgrade-request" });
  legacyRequest.calculationInput.lines.forEach((item) => {
    delete item.contractEventId;
    delete item.contractEventDecisionChecksum;
  });
  legacyRequest.calculationResult.lines.forEach((item) => {
    delete item.contractEventId;
    delete item.contractEventDecisionChecksum;
  });
  certificates.issueCertificate(state, legacyRequest, { id: "pre-upgrade-certificate", issuedAt: "2026-07-01T00:00:00.000Z", issuedBy: "legacy" });

  assert.equal(allocations.eventUsage(state, event.id).used.toString(), "0");
  assert.equal(allocations.validateCertificateEventAllocations(state, certificateRequest(event, 100)).bindings[0].remainingAfterRequest, "900");
});

test("invalid, unapproved, mismatched and duplicated references fail closed", () => {
  const state = {};
  const event = approvedEvent(state);
  const request = certificateRequest(event, 100);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ code: "VO", category: "variation", amount: "1", currency: "USD" }] } }), /requires an approved contract event/);
  assert.equal(allocations.eventReference({ code: "LEGACY", category: "variation", amount: "1", currency: "USD" }, 0, { allowUnbound: true }), null);
  assert.throws(() => allocations.eventReference({ code: "PARTIAL", category: "variation", amount: "1", currency: "USD", contractEventId: event.id }, 0, { allowUnbound: true }), /checksum is invalid/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ code: "WORK", category: "work", amount: "1", currency: "USD", contractEventId: event.id, contractEventDecisionChecksum: event.decisionChecksum }] } }), /cannot reference/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, 1), contractEventDecisionChecksum: "bad" }] } }), /checksum is invalid/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, 0) }] } }), /must be positive/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, -1) }] } }), /non-negative decimal/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, "bad") }] } }), /non-negative decimal/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, 1), contractEventId: "x".repeat(65) }] } }), /requires an approved/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [line(event, 1), { ...line(event, 2), code: "SECOND" }] } }), /more than once/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, 1), category: "claims" }] } }), /category variation/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, 1), currency: "EUR" }] } }), /currency USD/);
  assert.throws(() => allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [{ ...line(event, 1), contractEventDecisionChecksum: "0".repeat(64) }] } }), /does not match/);
  state.internationalContractEvents[0].states = "已退回";
  assert.throws(() => allocations.validateCertificateEventAllocations(state, request), /not approved/);
  assert.throws(() => allocations.validateCertificateEventAllocations({}, { calculationInput: {} }), /lines are required/);
  assert.deepEqual(allocations.validateCertificateEventAllocations(state, { calculationInput: { lines: [null] } }), { bindings: [], count: 0 });
});

test("claim events map only to the claims category and current applications can be excluded", () => {
  const state = {};
  const event = approvedEvent(state, { eventNo: "CL-001", eventType: "claim", idempotencyKey: "allocation-claim-001" });
  const application = pendingApplication(state, event, 300);
  assert.equal(allocations.eventUsage(state, event.id).used.toString(), "300");
  assert.equal(allocations.eventUsage(state, event.id, { excludeApplicationId: application.id }).used.toString(), "0");
  assert.equal(allocations.validateCertificateEventAllocations(state, certificateRequest(event, 100), { excludeApplicationId: application.id }).bindings[0].eventType, "claim");
});
