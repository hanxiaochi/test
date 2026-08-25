"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const readExcelFile = require("read-excel-file/node");
const reportExport = require("../../lib/reports/payment-report-export");

const generatedAt = "2026-08-26T00:00:00.000Z";
const rows = [
  {
    sectionName: "第一合同段",
    contractNo: "HT-01",
    contractMoney: 1000,
    finalMoney: 1200,
    billMeasureMoney: 300,
    materialDiasMoney: 20,
    materialArrivalMoney: 30,
    manualMoney: 10,
    materialAdvanceMoney: 8,
    materialDeductionMoney: 4,
    retentionMoney: 12,
    mobilizationDeductionMoney: 6,
    totalPayMoney: 346,
    payRate: 28.833,
    payableFormula: "清单计量 + 材料补差 + 手动计量",
    arrivalRule: "JL109材料到场按预付率形成材料设备垫付款"
  },
  {
    sectionName: "第二合同段",
    contractNo: "HT-02",
    contractMoney: "invalid",
    finalMoney: 800,
    totalPayMoney: 200,
    payRate: 25
  }
];

test("normalizes report rows and computes a deterministic summary", () => {
  assert.equal(reportExport.number("12.5"), 12.5);
  assert.equal(reportExport.number("invalid"), 0);
  assert.deepEqual(reportExport.normalizeRows(null), []);
  const normalized = reportExport.normalizeRows(rows);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[1].contractMoney, 0);
  assert.equal(normalized[1].materialDiasMoney, 0);
  assert.equal(normalized[1].payableFormula, "");
  const summary = reportExport.summarize(rows);
  assert.equal(summary.contractMoney, 1000);
  assert.equal(summary.finalMoney, 2000);
  assert.equal(summary.totalPayMoney, 546);
  assert.equal(summary.payRate, 27.3);
  assert.equal(reportExport.summarize([]).payRate, 0);
  const model = reportExport.reportModel(rows, { title: " 验收报表 ", generatedAt });
  assert.equal(model.title, "验收报表");
  assert.equal(model.generatedAt.toISOString(), generatedAt);
  assert.equal(reportExport.reportModel([], {}).title, "计量支付汇总报表");
});

test("creates a genuine styled XLSX with values, totals and rule sheet", async () => {
  const buffer = await reportExport.createXlsx(rows, { title: "验收报表", generatedAt });
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  const sheets = await readExcelFile(buffer);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["计量支付汇总", "口径说明"]);
  const data = sheets[0].data;
  assert.equal(data[0][0], "验收报表");
  assert.ok(data[2].includes("合同段") && data[2].includes("累计支付") && data[2].includes("支付公式"));
  assert.ok(data.some((row) => row[0] === "第一合同段" && row[1] === "HT-01"));
  assert.equal(data[data.length - 1][0], "合计");
  assert.equal(data[data.length - 1][12], 546);
  const zip = await JSZip.loadAsync(buffer);
  const worksheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(worksheetXml, /autoFilter/);
  assert.match(worksheetXml, /pane[^>]+state="frozen"/);
});

test("creates a genuine DOCX package with Chinese report content", async () => {
  const buffer = await reportExport.createDocx(rows, { title: "验收报表", generatedAt });
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  const zip = await JSZip.loadAsync(buffer);
  for (const name of ["[Content_Types].xml", "word/document.xml", "word/styles.xml"]) assert.ok(zip.file(name), name);
  const documentXml = await zip.file("word/document.xml").async("string");
  assert.match(documentXml, /验收报表/);
  assert.match(documentXml, /第一合同段/);
  assert.match(documentXml, /JL109材料到场按预付率形成材料设备垫付款/);
  assert.equal((documentXml.match(/<w:tbl>/g) || []).length, 2);
  assert.match(documentXml, /计量与合同金额/);
  assert.match(documentXml, /支付与扣回/);
  assert.match(documentXml, /口径说明/);
  assert.match(documentXml, /landscape/);
});

test("creates a portable PDF with an embedded CJK font and paginated tables", async () => {
  const manyRows = Array.from({ length: 42 }, (_, index) => ({
    ...rows[index % rows.length],
    sectionName: `第${index + 1}合同段`,
    contractNo: `HT-${String(index + 1).padStart(2, "0")}`
  }));
  const buffer = await reportExport.createPdf(manyRows, { title: "验收报表", generatedAt });
  assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(buffer.length > 20000, "PDF should contain the embedded CJK font subset");
  assert.match(buffer.toString("latin1"), /\/FontFile(?:2|3)/);
  assert.ok((buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 2);

  const empty = await reportExport.createPdf([], { generatedAt });
  assert.equal(empty.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(empty.toString("latin1"), /\/FontFile(?:2|3)/);
  assert.equal((empty.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1, "a short report should not gain a blank footer page");
});

test("builds PDF lines from the same normalized values", () => {
  const result = reportExport.pdfLines(rows, { title: "验收报表", generatedAt });
  assert.equal(result.title, "验收报表");
  assert.ok(result.lines.some((line) => line.includes("累计支付合计：546.00")));
  assert.ok(result.lines.some((line) => line.includes("第一合同段") && line.includes("累计支付=346.00")));
  const empty = reportExport.pdfLines([], { generatedAt });
  assert.equal(empty.model.rows.length, 0);
  assert.equal(empty.model.summary.payRate, 0);
});
