"use strict";

const Decimal = require("decimal.js");
const applications = require("./certificate-application");
const certificates = require("./certificate-register");
const contractEvents = require("./contract-event-register");

const EVENT_CATEGORIES = new Set(["variation", "claims"]);

function decimal(value, label) {
  try {
    const result = new Decimal(value);
    if (!result.isFinite() || result.isNegative()) throw new Error();
    return result;
  } catch {
    throw new Error(`${label} must be a non-negative decimal number`);
  }
}

function eventReference(line, index, options = {}) {
  const category = String(line && line.category || "");
  const eventId = String(line && line.contractEventId || "").trim();
  const decisionChecksum = String(line && line.contractEventDecisionChecksum || "").trim().toLowerCase();
  if (!EVENT_CATEGORIES.has(category)) {
    if (eventId || decisionChecksum) throw new Error(`certificate line ${index + 1} cannot reference a contract event`);
    return null;
  }
  if (!eventId && !decisionChecksum && options.allowUnbound === true) return null;
  if (!eventId || eventId.length > 64) throw new Error(`certificate line ${index + 1} requires an approved contract event`);
  if (!/^[a-f0-9]{64}$/.test(decisionChecksum)) throw new Error(`certificate line ${index + 1} contract event decision checksum is invalid`);
  const amount = decimal(line.amount, `certificate line ${index + 1} amount`);
  if (amount.isZero()) throw new Error(`certificate line ${index + 1} contract event amount must be positive`);
  return { category, eventId, decisionChecksum, amount, currency: String(line.currency || "").trim().toUpperCase() };
}

function requestLines(request) {
  const lines = request && request.calculationInput && request.calculationInput.lines;
  if (!Array.isArray(lines)) throw new Error("certificate calculation lines are required for contract event allocation");
  return lines;
}

function applicationRows(state) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = applications.listApplications(state, { offset, limit: 100 });
    rows.push(...page.rows);
    if (rows.length >= page.total) return rows;
  }
}

function referencedAmount(request, eventId, options = {}) {
  return requestLines(request).reduce((sum, line, index) => {
    const reference = eventReference(line, index, options);
    return reference && reference.eventId === eventId ? sum.plus(reference.amount) : sum;
  }, new Decimal(0));
}

function eventUsage(state, eventId, options = {}) {
  const excludeApplicationId = String(options.excludeApplicationId || "");
  const certificateRows = certificates.listCertificates(state);
  const certificatesById = new Map(certificateRows.map((record) => [record.id, record]));
  const linkedCertificateIds = new Set();
  let reserved = new Decimal(0);
  let issued = new Decimal(0);
  applicationRows(state).forEach((application) => {
    if (application.id === excludeApplicationId) {
      if (application.certificateId) linkedCertificateIds.add(application.certificateId);
      return;
    }
    if (!["待审核", "已批准"].includes(application.states)) return;
    const amount = referencedAmount(application.request, eventId, { allowUnbound: true });
    if (amount.isZero()) return;
    if (!application.certificateId) {
      reserved = reserved.plus(amount);
      return;
    }
    linkedCertificateIds.add(application.certificateId);
    const certificate = certificatesById.get(application.certificateId);
    if (certificate && certificate.status === "issued") issued = issued.plus(amount);
  });
  certificateRows.forEach((certificate) => {
    if (certificate.status !== "issued" || linkedCertificateIds.has(certificate.id)) return;
    issued = issued.plus(referencedAmount(certificate, eventId, { allowUnbound: true }));
  });
  return { reserved, issued, used: reserved.plus(issued) };
}

function validateCertificateEventAllocations(state, request, options = {}) {
  const lines = requestLines(request);
  const references = lines.map((line, index) => eventReference(line, index)).filter(Boolean);
  const seen = new Set();
  const bindings = references.map((reference) => {
    if (seen.has(reference.eventId)) throw new Error(`contract event ${reference.eventId} is referenced more than once in the certificate`);
    seen.add(reference.eventId);
    const event = contractEvents.findEvent(state, reference.eventId);
    if (event.states !== "已批准" || !event.decisionChecksum) throw new Error(`contract event ${event.eventNo} is not approved`);
    if (event.decisionChecksum !== reference.decisionChecksum) throw new Error(`contract event ${event.eventNo} decision checksum does not match`);
    const expectedCategory = event.request.eventType === "variation" ? "variation" : "claims";
    if (reference.category !== expectedCategory) throw new Error(`contract event ${event.eventNo} must use certificate category ${expectedCategory}`);
    if (reference.currency !== event.request.currency) throw new Error(`contract event ${event.eventNo} must use currency ${event.request.currency}`);
    const usage = eventUsage(state, event.id, options);
    const approved = decimal(event.approvedAmount, `contract event ${event.eventNo} approved amount`);
    const remaining = approved.minus(usage.used);
    if (reference.amount.gt(remaining)) throw new Error(`contract event ${event.eventNo} exceeds the remaining approved amount ${remaining.toString()} ${event.request.currency}`);
    return {
      eventId: event.id,
      eventNo: event.eventNo,
      eventType: event.request.eventType,
      decisionChecksum: event.decisionChecksum,
      currency: event.request.currency,
      approvedAmount: approved.toString(),
      reservedAmount: usage.reserved.toString(),
      issuedAmount: usage.issued.toString(),
      requestedAmount: reference.amount.toString(),
      remainingAfterRequest: remaining.minus(reference.amount).toString()
    };
  });
  return { bindings, count: bindings.length };
}

module.exports = { EVENT_CATEGORIES, eventReference, eventUsage, validateCertificateEventAllocations };
