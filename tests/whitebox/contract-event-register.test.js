"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const events = require("../../lib/international/contract-event-register");

function payload(overrides = {}) {
  return {
    eventNo: "VO-001",
    eventType: "variation",
    title: "Changed foundation depth",
    occurredDate: "2026-07-10",
    noticeDate: "2026-08-01",
    currency: "usd",
    claimedAmount: "125000.50",
    claimedTimeImpactDays: 12,
    description: "Engineer instructed deeper foundations",
    lateNoticeReason: "",
    contractClause: "3.5 / 13.3",
    idempotencyKey: "event-vo-001",
    ...overrides
  };
}

function create(state, overrides = {}, metadata = {}) {
  return events.createEvent(state, payload(overrides), {
    id: "event-1",
    submittedAt: "2026-08-02T00:00:00.000Z",
    submittedBy: "editor",
    submittedByUserId: 7,
    settingsVersion: 2,
    settingsSchemaVersion: 3,
    settingsChecksum: "c".repeat(64),
    noticeRule: { enabled: true, variationNoticeDays: 28, claimNoticeDays: 28, requireLateReason: true },
    ...metadata
  });
}

test("creates, verifies, lists and replays an immutable contract event", () => {
  const state = {};
  const created = create(state);
  assert.equal(created.replay, false);
  assert.equal(created.record.request.currency, "USD");
  assert.equal(created.record.request.claimedAmount, "125000.5");
  assert.equal(created.record.schemaVersion, 3);
  assert.equal(created.record.request.noticeAssessment.status, "timely");
  assert.equal(created.record.request.noticeAssessment.deadlineDate, "2026-08-07");
  assert.equal(created.record.request.noticeAssessment.elapsedDays, 22);
  assert.equal(created.record.request.noticeAssessment.settingsChecksum, "c".repeat(64));
  assert.deepEqual(created.record.evidenceManifest, []);
  assert.equal(created.record.evidenceChecksum, "");
  assert.equal(created.record.submissionChecksum.length, 64);
  assert.deepEqual(events.findEvent(state, "VO-001"), created.record);
  assert.deepEqual(events.listEvents(state, { offset: 0, limit: 1 }), { rows: [created.record], total: 1, offset: 0, limit: 1 });
  assert.equal(create(state).replay, true);
  assert.equal(state.internationalContractEvents.length, 1);
});

test("creates a checksummed independent decision only after workflow approval", () => {
  const state = {};
  create(state);
  assert.throws(() => events.approveRecord(state.internationalContractEvents[0], { approvedAmount: "100000", approvedTimeImpactDays: 8, decisionReason: "Evaluated entitlement" }, { approvedAt: "2026-08-03T00:00:00.000Z", approvedBy: "checker", approvedByUserId: 8 }), /workflow approval/);
  state.internationalContractEvents[0].states = "已批准";
  const evidence = [
    { attachmentId: 9, originalName: "instruction.pdf", mimeType: "application/pdf", byteSize: 120, sha256: "b".repeat(64), createdAt: "2026-08-02T02:00:00.000Z", uploaderUserId: 7, remark: "Engineer instruction" },
    { attachmentId: 3, originalName: "notice.txt", mimeType: "text/plain", byteSize: 20, sha256: "a".repeat(64), createdAt: "2026-08-02T01:00:00.000Z", uploaderUserId: 7, remark: "Notice" }
  ];
  const approved = events.approveRecord(state.internationalContractEvents[0], { approvedAmount: "100000", approvedTimeImpactDays: 8, decisionReason: "Evaluated entitlement", evidenceManifest: evidence }, { approvedAt: "2026-08-03T00:00:00.000Z", approvedBy: "checker", approvedByUserId: 8 });
  assert.equal(approved.approvedAmount, "100000");
  assert.equal(approved.decisionChecksum.length, 64);
  assert.deepEqual(approved.evidenceManifest.map((item) => item.attachmentId), [3, 9]);
  assert.equal(approved.evidenceChecksum.length, 64);
  assert.equal(approved.evidenceChecksum, events.evidenceManifestChecksum([...evidence].reverse()));
  assert.equal(approved.submissionChecksum, state.internationalContractEvents[0].submissionChecksum);
  assert.throws(() => events.approveRecord(approved, { approvedAmount: "1", decisionReason: "Again" }, { approvedBy: "checker", approvedByUserId: 8 }), /already exists/);
  assert.throws(() => events.approveRecord({ ...state.internationalContractEvents[0], states: "已批准" }, { approvedAmount: "130000", decisionReason: "Too high" }, { approvedBy: "checker", approvedByUserId: 8 }), /exceeds the claim/);
  assert.throws(() => events.approveRecord({ ...state.internationalContractEvents[0], states: "已批准" }, { approvedAmount: "100", decisionReason: "Self" }, { approvedBy: "editor", approvedByUserId: 7 }), /different approver/);
  assert.throws(() => events.eventView({ ...approved, evidenceManifest: [{ ...approved.evidenceManifest[0], byteSize: 21 }, approved.evidenceManifest[1]] }), /evidence checksum mismatch/);
  assert.throws(() => events.approveRecord({ ...state.internationalContractEvents[0], states: "已批准" }, { approvedAmount: "100", decisionReason: "Malformed evidence", evidenceManifest: [{ attachmentId: 1, originalName: "bad.pdf" }] }, { approvedBy: "checker", approvedByUserId: 8 }), /evidence.*invalid/);
});

test("schema v2 freezes an empty evidence manifest while schema v1 remains compatible", () => {
  const state = {};
  create(state);
  state.internationalContractEvents[0].states = "已批准";
  const approved = events.approveRecord(state.internationalContractEvents[0], { approvedAmount: "1", approvedTimeImpactDays: 0, decisionReason: "No supporting files", evidenceManifest: [] }, { approvedAt: "2026-08-03T00:00:00.000Z", approvedBy: "checker", approvedByUserId: 8 });
  assert.deepEqual(approved.evidenceManifest, []);
  assert.equal(approved.evidenceChecksum, events.evidenceManifestChecksum([]));

  const legacyState = {};
  create(legacyState);
  const legacy = legacyState.internationalContractEvents[0];
  legacy.schemaVersion = 1;
  delete legacy.evidenceManifest;
  delete legacy.evidenceChecksum;
  delete legacy.request.occurredDate;
  delete legacy.request.lateNoticeReason;
  delete legacy.request.noticeAssessment;
  legacy.submissionChecksum = events.recordChecksum(events.submissionPayload(legacy));
  assert.equal(events.eventView(legacy).schemaVersion, 1);
  legacy.states = "已批准";
  const legacyApproved = events.approveRecord(legacy, { approvedAmount: "1", approvedTimeImpactDays: 0, decisionReason: "Legacy determination" }, { approvedAt: "2026-08-03T00:00:00.000Z", approvedBy: "checker", approvedByUserId: 8 });
  assert.equal(legacyApproved.schemaVersion, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyApproved, "evidenceManifest"), false);

  const schemaTwoState = {};
  create(schemaTwoState, { eventNo: "VO-V2", idempotencyKey: "event-schema-v2" }, { id: "event-v2" });
  const schemaTwo = schemaTwoState.internationalContractEvents[0];
  schemaTwo.schemaVersion = 2;
  delete schemaTwo.request.occurredDate;
  delete schemaTwo.request.lateNoticeReason;
  delete schemaTwo.request.noticeAssessment;
  schemaTwo.submissionChecksum = events.recordChecksum(events.submissionPayload(schemaTwo));
  assert.equal(events.eventView(schemaTwo).schemaVersion, 2);
});

test("assesses configured notice deadlines and freezes late explanations", () => {
  const onDeadline = {};
  const timely = create(onDeadline, { occurredDate: "2026-08-01", noticeDate: "2026-08-29" }).record;
  assert.equal(timely.request.noticeAssessment.status, "timely");
  assert.equal(timely.request.noticeAssessment.deadlineDate, "2026-08-29");
  assert.equal(timely.request.noticeAssessment.elapsedDays, 28);

  const lateState = {};
  const late = create(lateState, { occurredDate: "2026-08-01", noticeDate: "2026-08-30", lateNoticeReason: "Employer continued evaluating the instructed work." }).record;
  assert.equal(late.request.noticeAssessment.status, "late");
  assert.equal(late.request.noticeAssessment.elapsedDays, 29);
  assert.equal(late.request.lateNoticeReason, "Employer continued evaluating the instructed work.");
  assert.throws(() => create({}, { occurredDate: "2026-08-01", noticeDate: "2026-08-30" }), /late notice reason is required/);

  const disabled = create({}, { occurredDate: "2026-08-01", noticeDate: "2026-09-30" }, { noticeRule: { enabled: false, variationNoticeDays: 7, claimNoticeDays: 7, requireLateReason: true } }).record;
  assert.equal(disabled.request.noticeAssessment.status, "not_applicable");
  assert.equal(disabled.request.noticeAssessment.deadlineDate, "");
  const claim = create({}, { eventType: "claim", occurredDate: "2026-08-01", noticeDate: "2026-08-16" }, { noticeRule: { enabled: true, variationNoticeDays: 28, claimNoticeDays: 14, requireLateReason: false } }).record;
  assert.equal(claim.request.noticeAssessment.status, "late");
  assert.equal(claim.request.noticeAssessment.applicablePeriodDays, 14);
  assert.equal(claim.request.noticeAssessment.deadlineDate, "2026-08-15");
  assert.throws(() => create({}, { occurredDate: "2026-08-02", noticeDate: "2026-08-01" }), /notice date cannot precede/);
  assert.throws(() => create({}, { occurredDate: "bad-date" }), /occurrence date.*ISO/);
  assert.throws(() => create({}, {}, { settingsChecksum: "bad" }), /settings checksum/);
  const tampered = structuredClone(timely);
  tampered.request.noticeAssessment.deadlineDate = "2026-08-30";
  assert.throws(() => events.eventView(tampered), /notice assessment mismatch|submission checksum mismatch/);
});

test("supports one replacement only for a returned event", () => {
  const state = {};
  create(state);
  assert.throws(() => create(state, { eventNo: "VO-002", supersedesEventId: "event-1", idempotencyKey: "event-vo-002" }, { id: "event-2" }), /only a returned/);
  state.internationalContractEvents[0].states = "已退回";
  const replacement = create(state, { eventNo: "VO-002", supersedesEventId: "event-1", idempotencyKey: "event-vo-002" }, { id: "event-2", submittedAt: "2026-08-04T00:00:00.000Z" }).record;
  assert.equal(replacement.supersedesEventId, "event-1");
  assert.deepEqual(events.listEvents(state).rows.map((row) => row.id), ["event-2", "event-1"]);
  assert.throws(() => create(state, { eventNo: "VO-003", supersedesEventId: "event-1", idempotencyKey: "event-vo-003" }, { id: "event-3" }), /already has a successor/);
});

test("invalid input and tampering fail closed", () => {
  assert.throws(() => events.createEvent({}, null), /payload must be an object/);
  assert.throws(() => events.createEvent({}, []), /payload must be an object/);
  assert.throws(() => create({}, { eventType: "other" }), /variation or claim/);
  assert.throws(() => create({}, { claimedAmount: 0, claimedTimeImpactDays: 0 }), /claim money or time/);
  assert.throws(() => create({}, { claimedAmount: -1 }), /non-negative decimal/);
  assert.throws(() => create({}, { claimedAmount: "not-money" }), /non-negative decimal/);
  assert.throws(() => create({}, { claimedAmount: "Infinity" }), /non-negative decimal/);
  assert.throws(() => create({}, { claimedTimeImpactDays: -1 }), /0 to 36500/);
  assert.throws(() => create({}, { claimedTimeImpactDays: 36501 }), /0 to 36500/);
  assert.throws(() => create({}, { claimedTimeImpactDays: 1.5 }), /0 to 36500/);
  assert.throws(() => create({}, { currency: "US" }), /three-letter/);
  assert.throws(() => create({}, { currency: "USDX" }), /currency is invalid/);
  assert.throws(() => create({}, { noticeDate: "2026-02-30" }), /ISO date/);
  assert.throws(() => create({}, { title: "x".repeat(201) }), /title is invalid/);
  assert.throws(() => create({}, { description: "bad\u0000text" }), /description is invalid/);
  assert.throws(() => create({}, { idempotencyKey: "short" }), /idempotency key is invalid/);
  assert.throws(() => create({}, { idempotencyKey: "event key with spaces" }), /idempotency key is invalid/);
  assert.throws(() => create({}, {}, { submittedAt: "bad-time" }), /ISO instant/);
  assert.throws(() => create({}, {}, { submittedByUserId: 0 }), /positive integer/);
  assert.throws(() => events.listEvents(null), /state is required/);
  assert.throws(() => events.listEvents({}, { offset: -1 }), /offset/);
  assert.throws(() => events.listEvents({}, { limit: 101 }), /limit/);
  assert.throws(() => events.findEvent({}, "missing"), /does not exist/);
  assert.throws(() => events.eventView({ schemaVersion: 99 }), /record is invalid/);
  const state = {};
  create(state);
  assert.throws(() => create(state, { title: "changed" }), /idempotency key.*different/);
  assert.throws(() => create(state, { eventNo: "VO-001", idempotencyKey: "event-duplicate-number" }, { id: "event-2" }), /number already exists/);
  assert.throws(() => create(state, { eventNo: "VO-002", supersedesEventId: "missing", idempotencyKey: "event-missing-parent" }, { id: "event-2" }), /does not exist/);
  assert.throws(() => create(state, { eventNo: "VO-002", idempotencyKey: "event-id-collision" }, { id: "event-1" }), /id already exists/);
  state.internationalContractEvents[0].request.title = "tampered";
  assert.throws(() => events.findEvent(state, "event-1"), /checksum mismatch/);
  assert.throws(() => events.listEvents({ internationalContractEvents: {} }), /register is invalid/);
});

test("approved records reject malformed or tampered decisions", () => {
  const state = {};
  create(state);
  state.internationalContractEvents[0].states = "已批准";
  const approved = events.approveRecord(state.internationalContractEvents[0], { approvedAmount: "100000", approvedTimeImpactDays: 8, decisionReason: "Evaluated entitlement" }, { approvedAt: "2026-08-03T00:00:00.000Z", approvedBy: "checker", approvedByUserId: 8 });
  assert.deepEqual(events.eventView(approved), approved);
  assert.throws(() => events.approveRecord(state.internationalContractEvents[0], { approvedAmount: 0, approvedTimeImpactDays: 0, decisionReason: "Nothing" }, { approvedBy: "checker", approvedByUserId: 8 }), /grant money or time/);
  assert.throws(() => events.approveRecord(state.internationalContractEvents[0], { approvedAmount: 1, approvedTimeImpactDays: 13, decisionReason: "Too much time" }, { approvedBy: "checker", approvedByUserId: 8 }), /time impact exceeds/);
  assert.throws(() => events.approveRecord(state.internationalContractEvents[0], { approvedAmount: 1, approvedTimeImpactDays: 1, decisionReason: "" }, { approvedBy: "checker", approvedByUserId: 8 }), /decision reason is invalid/);
  assert.throws(() => events.eventView({ ...approved, decisionChecksum: "0".repeat(64) }), /decision checksum mismatch/);
  assert.throws(() => events.eventView({ ...approved, approvedByUserId: 7 }), /different approver/);
  assert.throws(() => events.eventView({ ...approved, approvedAmount: "130000" }), /exceeds the claim/);
  assert.throws(() => events.eventView({ ...approved, approvedTimeImpactDays: 13 }), /time impact exceeds/);
});
