"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const service = require("../../lib/import-export/measure-import-service");

const bills = [
  { billId: 1, billNo: "101-1", billName: "路基工程", sectionId: 101, measureUnit: "m3", price: 12.5 },
  { billId: 2, billNo: "202-1", billName: "桥梁一标", sectionId: 101, measureUnit: "m", price: 20 },
  { billId: 3, billNo: "202-1", billName: "桥梁二标", sectionId: 102, measureUnit: "m", price: 25 }
];

function csv(lines) {
  return Buffer.from(`\uFEFF${lines.join("\n")}`, "utf8");
}

async function workbookBuffer(rows, options = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName || "计量导入");
  rows.forEach((row) => sheet.addRow(row));
  if (options.extraSheet) workbook.addWorksheet(options.extraSheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("normalizes aliases, validates rows and calculates source values", async () => {
  assert.equal(service.normalizeHeader(), "");
  assert.equal(service.normalizeHeader(" 本期-计量_数量 "), "本期计量数量");
  assert.deepEqual(service.limits({ maxBytes: "123", maxRows: 2, maxSheets: 1 }), { maxBytes: 123, maxRows: 2, maxSheets: 1 });
  assert.deepEqual(service.limits({ maxBytes: 0, maxRows: "x", maxSheets: -1 }), service.DEFAULT_LIMITS);
  assert.deepEqual(service.mapHeaders(["清单编号", "quantity", "合同段ID"]), ["billNo", "measureNum", "sectionId"]);
  const result = await service.parseMeasureImport({
    fileName: "计量.csv",
    buffer: csv(["清单编号,本期计量数量,合同段ID,工期ID,计量日期,计量部位", "101-1,2.5,101,2,2026-08-26,K1+000", ",,,,,"]),
    bills
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.equal(result.valid, 1);
  assert.equal(result.rows[0].billId, 1);
  assert.equal(result.rows[0].measureNum, 2.5);
  assert.equal(result.rows[0].money, 31.25);
  assert.equal(result.rows[0].measureDate, "2026-08-26");
  assert.equal(result.rows[0].position, "K1+000");
  assert.equal(service.scalarCellValue(null), "");
  assert.equal(service.scalarCellValue(undefined), "");
  assert.equal(service.scalarCellValue(new Date(Date.UTC(2026, 0, 2))), "2026-01-02");
  assert.equal(service.scalarCellValue({ richText: [{ text: "清单" }, { text: "编号" }] }), "清单编号");
  assert.equal(service.scalarCellValue({ richText: [{}, { text: "编号" }] }), "编号");
  assert.equal(service.scalarCellValue({ text: "101-1" }), "101-1");
  assert.equal(service.scalarCellValue({ result: 2 }), 2);
  assert.throws(() => service.scalarCellValue({ sharedFormula: "A1" }), (error) => error.code === "MEASURE_IMPORT_FORMULA_REJECTED");
  assert.throws(() => service.scalarCellValue({ unsupported: true }), (error) => error.code === "MEASURE_IMPORT_CELL_INVALID");
  assert.deepEqual(service.rowsFromMatrix([["billNo", "measureNum", "ignored"], ["101-1", 1, "x"], ["", "", ""]], "S1"), [
    { raw: { billNo: "101-1", measureNum: 1 }, sourceRow: 2, sheetName: "S1" }
  ]);
  assert.throws(() => service.rowsFromMatrix([], "S1"), (error) => error.code === "MEASURE_IMPORT_HEADER_REQUIRED");
  assert.throws(() => service.rowsFromMatrix(null, "S1"), (error) => error.code === "MEASURE_IMPORT_HEADER_REQUIRED");
});

test("rejects unsafe file names, types, size, encoding and malformed CSV", async () => {
  for (const fileName of ["", "../x.csv", "folder/x.csv", "bad\0.csv"]) {
    await assert.rejects(() => service.parseMeasureImport({ fileName, buffer: Buffer.from("x"), bills }), /文件名/);
  }
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.xls", buffer: Buffer.from("x"), bills }), (error) => error.code === "MEASURE_IMPORT_TYPE_INVALID");
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.csv", buffer: Buffer.alloc(0), bills }), (error) => error.code === "MEASURE_IMPORT_EMPTY");
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.csv", buffer: "not-a-buffer", bills }), (error) => error.code === "MEASURE_IMPORT_EMPTY");
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.csv", buffer: Buffer.from("123"), maxBytes: 2, bills }), (error) => error.status === 413);
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.csv", buffer: Buffer.from([0xff]), bills }), (error) => error.code === "MEASURE_IMPORT_CSV_ENCODING");
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.csv", buffer: csv(["清单编号,计量数量", '"unterminated,2']), bills }), (error) => error.code === "MEASURE_IMPORT_CSV_MALFORMED");
  await assert.rejects(() => service.parseMeasureImport({ fileName: "x.csv", buffer: csv(["清单编号", "101-1"]), bills }), (error) => error.code === "MEASURE_IMPORT_HEADER_REQUIRED");
  assert.throws(() => service.mapHeaders(["billNo", "清单编号", "measureNum"]), (error) => error.code === "MEASURE_IMPORT_DUPLICATE_HEADER");
});

test("reports every business validation failure without inventing values", async () => {
  const result = await service.parseMeasureImport({
    fileName: "invalid.csv",
    buffer: csv([
      "billNo,measureNum,sectionId,periodId,measureDate",
      "UNKNOWN,3,101,2,2026-08-26",
      "101-1,0,101,abc,2026-02-30",
      "101-1,abc,101,2,2026/08/26",
      "202-1,2,,2,2026-08-26",
      "202-1,2,999,2,2026-08-26"
    ]),
    bills
  });
  assert.equal(result.ok, false);
  assert.equal(result.total, 5);
  assert.equal(result.invalid, 5);
  const codes = new Set(result.errors.map((error) => error.code));
  for (const code of ["unknown_bill", "positive_number", "positive_integer", "invalid_date", "duplicate_bill", "ambiguous_bill", "bill_section_mismatch"]) assert.ok(codes.has(code), code);
  assert.equal(result.rows[0].billId, null);
  assert.equal(result.rows[0].money, 0);
  assert.match(service.errorReportCsv(result), /unknown_bill/);

  const resolved = await service.parseMeasureImport({
    fileName: "resolved.csv",
    buffer: csv(["清单编号,计量数量,合同段ID,计量日期", '202-1,"1,000",102,not-a-date']),
    bills
  });
  assert.equal(resolved.rows[0].billId, 3);
  assert.equal(resolved.rows[0].measureNum, 1000);
  assert.ok(resolved.errors.some((error) => error.code === "invalid_date"));

  const blankRequired = await service.parseMeasureImport({ fileName: "blank.csv", buffer: csv(["billNo,measureNum", ",1"]), bills });
  assert.ok(blankRequired.errors.some((error) => error.code === "required"));
});

test("parses safe XLSX and rejects formulas, excessive sheets and rows", async () => {
  const safe = await workbookBuffer([
    ["清单编号", "计量数量", "合同段ID", "计量日期"],
    ["101-1", 4, 101, new Date(Date.UTC(2026, 7, 26))]
  ]);
  const parsed = await service.parseMeasureImport({ fileName: "safe.xlsx", buffer: safe, bills });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows[0].money, 50);

  const formula = await workbookBuffer([["billNo", "measureNum"], ["101-1", { formula: "1+1", result: 2 }]]);
  await assert.rejects(() => service.parseMeasureImport({ fileName: "formula.xlsx", buffer: formula, bills }), (error) => error.code === "MEASURE_IMPORT_FORMULA_REJECTED");

  const sheets = await workbookBuffer([["billNo", "measureNum"], ["101-1", 1]], { extraSheet: "extra" });
  await assert.rejects(() => service.parseMeasureImport({ fileName: "sheets.xlsx", buffer: sheets, maxSheets: 1, bills }), (error) => error.code === "MEASURE_IMPORT_TOO_MANY_SHEETS");

  await assert.rejects(() => service.parseMeasureImport({ fileName: "rows.csv", buffer: csv(["billNo,measureNum", "101-1,1", "202-1,2"]), maxRows: 1, bills }), (error) => error.code === "MEASURE_IMPORT_TOO_MANY_ROWS");
});

test("rejects malformed, macro and external-link XLSX structures", async () => {
  await assert.rejects(() => service.parseMeasureImport({ fileName: "bad.xlsx", buffer: Buffer.from("PK\x03\x04broken"), bills }), (error) => error.code === "MEASURE_IMPORT_XLSX_MALFORMED");

  const macro = new JSZip();
  macro.file("xl/vbaProject.bin", "macro");
  const macroBuffer = await macro.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => service.parseMeasureImport({ fileName: "macro.xlsx", buffer: macroBuffer, bills }), (error) => error.code === "MEASURE_IMPORT_MACRO_REJECTED");

  const external = new JSZip();
  external.file("xl/externalLinks/externalLink1.xml", "<x/>");
  const externalBuffer = await external.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => service.parseMeasureImport({ fileName: "external.xlsx", buffer: externalBuffer, bills }), (error) => error.code === "MEASURE_IMPORT_EXTERNAL_LINK_REJECTED");

  const relationship = new JSZip();
  relationship.file("xl/_rels/workbook.xml.rels", '<Relationship Target="https://example.invalid/book.xlsx" TargetMode="External"/>');
  const relationshipBuffer = await relationship.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => service.assertSafeWorkbook(relationshipBuffer), (error) => error.code === "MEASURE_IMPORT_EXTERNAL_LINK_REJECTED");

  const validZipButNotWorkbook = new JSZip();
  validZipButNotWorkbook.file("placeholder.txt", "not an office workbook");
  const invalidWorkbook = await validZipButNotWorkbook.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => service.parseMeasureImport({ fileName: "invalid-workbook.xlsx", buffer: invalidWorkbook, bills }), (error) => error.code === "MEASURE_IMPORT_XLSX_MALFORMED");
});

test("template and empty imports produce actionable output", async () => {
  const template = service.templateCsv();
  assert.ok(template.startsWith("\uFEFF"));
  assert.match(template, /清单编号/);
  const result = await service.parseMeasureImport({ fileName: "empty.csv", buffer: csv(["billNo,measureNum"]), bills });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "empty_data");
  assert.match(service.errorReportCsv(result), /empty_data/);
});
