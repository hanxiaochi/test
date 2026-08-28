"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const readExcelFile = require("read-excel-file/node");
const events = require("../../lib/international/contract-event-register");
const exporter = require("../../lib/international/contract-event-export");

function approvedEvent() {
  const state = {};
  const created = events.createEvent(state, {
    eventNo: "VO-EXPORT-001",
    eventType: "variation",
    title: "Additional foundation work",
    occurredDate: "2026-07-10",
    noticeDate: "2026-08-01",
    lateNoticeReason: "",
    currency: "USD",
    claimedAmount: "12500.75",
    claimedTimeImpactDays: 12,
    contractClause: "13.3",
    description: "Engineer instructed additional foundation work.",
    idempotencyKey: "event-export-001"
  }, { id: "event-export-1", submittedAt: "2026-08-02T00:00:00.000Z", submittedBy: "editor", submittedByUserId: 10, settingsVersion: 2, settingsSchemaVersion: 3, settingsChecksum: "c".repeat(64), noticeRule: { enabled: true, variationNoticeDays: 28, claimNoticeDays: 28, requireLateReason: true } }).record;
  const workflowApproved = { ...created, states: "已批准", workflowInstanceKey: "wf-event-export-1" };
  return events.approveRecord(workflowApproved, {
    approvedAmount: "12000.50",
    approvedTimeImpactDays: 10,
    decisionReason: "Measured against the approved instruction."
  }, { approvedAt: "2026-08-05T00:00:00.000Z", approvedBy: "engineer", approvedByUserId: 20 });
}

test("builds one localized model from a verified approved determination", () => {
  const record = approvedEvent();
  const model = exporter.contractEventModel(record, { locale: "zh-CN" });
  assert.equal(model.title, "合同事件审定单 VO-EXPORT-001");
  assert.equal(model.locale, "zh-CN");
  assert.equal(model.direction, "ltr");
  assert.ok(model.eventRows.some(([key, value]) => key === "事件类型" && value === "变更"));
  assert.ok(model.eventRows.some(([key, value]) => key === "通知截止日期" && value === "2026-08-07"));
  assert.ok(model.determinationRows.some(([key, value]) => key === "审定金额" && value === "12000.5"));
  assert.ok(model.integrityRows.some(([key, value]) => key === "审定 SHA-256" && value === record.decisionChecksum));
  assert.ok(model.integrityRows.some(([key, value]) => key === "证据文件数" && value === 0));
  assert.ok(model.integrityRows.some(([key, value]) => key === "证据清单 SHA-256" && value === record.evidenceChecksum));
  assert.ok(model.integrityRows.some(([key, value]) => key === "通知参数 SHA-256" && value === "c".repeat(64)));
  assert.equal(exporter.text(null), "");
  assert.equal(exporter.reportText("unknown", "title"), "Contract Event Determination");
  assert.equal(exporter.reportText("en-US", "unknown.key"), "unknown.key");

  const pending = {
    ...record,
    states: "待审核",
    approvedAmount: "",
    approvedTimeImpactDays: 0,
    decisionReason: "",
    approvedAt: "",
    approvedBy: "",
    approvedByUserId: 0,
    decisionChecksum: "",
    evidenceManifest: [],
    evidenceChecksum: ""
  };
  assert.throws(() => exporter.contractEventModel(pending), /approved contract event/);
  const tampered = structuredClone(record);
  tampered.approvedAmount = "99999";
  assert.throws(() => exporter.contractEventModel(tampered), /exceeds the claim|checksum mismatch/);
});

test("keeps schema v2 determinations exportable without invented notice fields", () => {
  const legacy = structuredClone(approvedEvent());
  legacy.schemaVersion = 2;
  delete legacy.request.occurredDate;
  delete legacy.request.lateNoticeReason;
  delete legacy.request.noticeAssessment;
  legacy.submissionChecksum = events.recordChecksum(events.submissionPayload(legacy));
  legacy.decisionChecksum = events.recordChecksum(events.decisionPayload(legacy));
  const model = exporter.contractEventModel(legacy, { locale: "en-US" });
  assert.equal(model.record.schemaVersion, 2);
  assert.equal(model.eventRows.some(([key]) => key === "Occurrence date"), false);
  assert.equal(model.integrityRows.some(([key]) => key === "Notice settings SHA-256"), false);
});

test("localizes every supported report with complete labels", () => {
  const titles = {
    "en-US": "Contract Event Determination",
    "zh-CN": "合同事件审定单",
    "es-ES": "Determinación del Evento Contractual",
    "fr-FR": "Détermination de l'Événement Contractuel",
    "pt-BR": "Determinação do Evento Contratual",
    "ar-SA": "قرار الحدث التعاقدي"
  };
  const englishKeys = Object.keys(exporter.REPORT_TRANSLATIONS["en-US"]).sort();
  Object.entries(titles).forEach(([locale, title]) => {
    assert.deepEqual(Object.keys(exporter.REPORT_TRANSLATIONS[locale]).sort(), englishKeys);
    const model = exporter.contractEventModel(approvedEvent(), { locale });
    assert.match(model.title, new RegExp(title));
    assert.equal(model.direction, locale === "ar-SA" ? "rtl" : "ltr");
  });
});

test("creates traceable XLSX, DOCX, and PDF determinations", async () => {
  const record = approvedEvent();
  const xlsx = await exporter.createXlsx(record, { locale: "zh-CN" });
  assert.equal(xlsx.subarray(0, 2).toString("ascii"), "PK");
  const workbook = await readExcelFile(xlsx);
  assert.deepEqual(workbook.map((sheet) => sheet.sheet), ["合同事件", "审定结果", "完整性校验"]);
  assert.ok(workbook[0].data.some((row) => row[0] === "事件编号" && row[1] === "VO-EXPORT-001"));
  assert.ok(workbook[1].data.some((row) => row[0] === "审定金额" && row[1] === "12000.5"));
  assert.ok(workbook[2].data.some((row) => row[0] === "审定 SHA-256" && row[1] === record.decisionChecksum));
  const xlsxZip = await JSZip.loadAsync(xlsx);
  assert.match(await xlsxZip.file("xl/worksheets/sheet1.xml").async("string"), /state="frozen"/);

  const docx = await exporter.createDocx(record, { locale: "zh-CN" });
  const docxZip = await JSZip.loadAsync(docx);
  const documentXml = await docxZip.file("word/document.xml").async("string");
  assert.match(documentXml, /合同事件审定单 VO-EXPORT-001/);
  assert.match(documentXml, /Additional foundation work/);
  assert.match(documentXml, new RegExp(record.decisionChecksum));
  assert.ok((documentXml.match(/<w:tbl>/g) || []).length >= 3);

  const pdf = await exporter.createPdf(record, { locale: "zh-CN" });
  const source = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 5000);
  assert.match(source, /\/FontFile(?:2|3)/);
});

test("writes Arabic labels and right-to-left layout", async () => {
  const record = approvedEvent();
  const xlsx = await exporter.createXlsx(record, { locale: "ar-SA" });
  const workbook = await readExcelFile(xlsx);
  assert.equal(workbook[0].sheet, "الحدث التعاقدي");
  const xlsxZip = await JSZip.loadAsync(xlsx);
  assert.match(await xlsxZip.file("xl/worksheets/sheet1.xml").async("string"), /rightToLeft="1"/);

  const docx = await exporter.createDocx(record, { locale: "ar-SA" });
  const docxZip = await JSZip.loadAsync(docx);
  const documentXml = await docxZip.file("word/document.xml").async("string");
  assert.match(documentXml, /قرار الحدث التعاقدي/);
  assert.match(documentXml, /<w:bidi\/>/);

  const pdf = await exporter.createPdf(record, { locale: "ar-SA" });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 5000);
});
