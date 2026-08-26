"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const readExcelFile = require("read-excel-file/node");
const register = require("../../lib/international/certificate-register");
const exporter = require("../../lib/international/certificate-export");

function certificate() {
  const state = {};
  return register.issueCertificate(state, {
    certificateNo: "IPC-EXPORT-001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    applicationReference: "APP-EXPORT-001",
    remarks: "Export acceptance",
    openingBalanceReason: "",
    idempotencyKey: "ipc-export-001-request",
    calculationInput: { previousRetention: "0", previousCumulativeCertified: "0", retentionRelease: "0", lines: [{ code: "WORK-001", amount: "1000" }] },
    calculationResult: {
      locale: "zh-CN",
      settingsVersion: 2,
      settingsSchemaVersion: 2,
      settingsChecksum: "a".repeat(64),
      certificateStandard: "FIDIC_RED_2017",
      standard: "FIDIC-compatible IPC",
      baseCurrency: "USD",
      moneyDigits: 2,
      lines: [
        { code: "WORK-001", description: "本期工程量", category: "work", direction: "addition", currency: "USD", amount: "1000.00", exchangeRate: "1", baseAmount: "1000.00", generated: false },
        { code: "AUTO-PRICE-ADJUSTMENT", description: "Index price adjustment", category: "priceAdjustment", direction: "addition", currency: "USD", amount: "15.00", exchangeRate: "1", baseAmount: "15.00", generated: true }
      ],
      priceAdjustment: {
        enabled: true,
        formula: "Pn = a + sum(bn * Ln/L0n)",
        eligibleAmount: "1000.00",
        factor: "1.015",
        adjustment: "15.00",
        direction: "addition",
        components: [{ code: "LABOR", baseIndex: "100", currentIndex: "110", ratio: "1.1", weightedIndex: "0.55" }]
      },
      totals: {
        previousRetention: "0.00", currentRetention: "50.75", retentionRelease: "0.00", previousCumulativeCertified: "0.00",
        grossCertified: "1015.00", totalDeductions: "50.75", netCertified: "964.25", payableNow: "964.25", carriedForward: "0.00", cumulativeCertified: "964.25"
      }
    }
  }, { id: "cert-export-1", issuedAt: "2026-08-01T00:00:00.000Z", issuedBy: "admin" }).record;
}

test("builds an export model only from a verified immutable certificate", () => {
  const record = certificate();
  const model = exporter.certificateModel(record);
  assert.equal(model.title, "Interim Payment Certificate IPC-EXPORT-001");
  assert.equal(model.locale, "zh-CN");
  assert.equal(model.lines.length, 2);
  assert.equal(model.lines[1].generated, "yes");
  assert.ok(model.totals.some(([key, value]) => key === "netCertified" && value === "964.25"));
  assert.ok(model.integrity.some(([key, value]) => key === "Issue SHA-256" && value === record.issueChecksum));
  assert.deepEqual(exporter.rowsFromObject(null), []);
  assert.deepEqual(exporter.rowsFromObject([]), []);
  assert.equal(exporter.text(null), "");
  const tampered = structuredClone(record);
  tampered.calculationResult.totals.netCertified = "999.00";
  assert.throws(() => exporter.certificateModel(tampered), /checksum mismatch/);
});

test("creates a traceable multi-sheet XLSX snapshot", async () => {
  const record = certificate();
  const buffer = await exporter.createXlsx(record);
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  const sheets = await readExcelFile(buffer);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["Certificate", "Line Items", "Totals", "Price Adjustment", "Integrity"]);
  assert.ok(sheets[0].data.some((row) => row[0] === "Certificate number" && row[1] === "IPC-EXPORT-001"));
  assert.ok(sheets[1].data.some((row) => row[0] === "WORK-001" && row[1] === "本期工程量"));
  assert.ok(sheets[2].data.some((row) => row[0] === "netCertified" && row[1] === "964.25"));
  assert.ok(sheets[3].data.some((row) => row[0] === "LABOR.currentIndex" && row[1] === "110"));
  assert.ok(sheets[4].data.some((row) => row[0] === "Issue SHA-256" && row[1] === record.issueChecksum));
  const zip = await JSZip.loadAsync(buffer);
  const linesXml = await zip.file("xl/worksheets/sheet2.xml").async("string");
  assert.match(linesXml, /autoFilter/);
  assert.match(linesXml, /state="frozen"/);

  assert.deepEqual(exporter.priceAdjustmentRows(null), []);
});

test("creates genuine DOCX and portable PDF certificate artifacts", async () => {
  const record = certificate();
  const docx = await exporter.createDocx(record);
  assert.equal(docx.subarray(0, 2).toString("ascii"), "PK");
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /Interim Payment Certificate IPC-EXPORT-001/);
  assert.match(xml, /本期工程量/);
  assert.match(xml, new RegExp(record.issueChecksum));
  assert.ok((xml.match(/<w:tbl>/g) || []).length >= 5);
  assert.match(xml, /landscape/);

  const pdf = await exporter.createPdf(record);
  const source = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 5000);
  assert.match(source, /\/FontFile(?:2|3)/);
  assert.equal((source.match(/\/Type \/Page\b/g) || []).length, 1);
});
