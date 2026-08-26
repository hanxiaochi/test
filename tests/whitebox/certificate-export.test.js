"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const readExcelFile = require("read-excel-file/node");
const register = require("../../lib/international/certificate-register");
const exporter = require("../../lib/international/certificate-export");

function certificate(locale = "zh-CN") {
  const state = {};
  return register.issueCertificate(state, {
    certificateNo: `IPC-EXPORT-${locale}`,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    applicationReference: "APP-EXPORT-001",
    remarks: "Export acceptance",
    openingBalanceReason: "",
    idempotencyKey: `ipc-export-${locale}-request`,
    calculationInput: { previousRetention: "0", previousCumulativeCertified: "0", retentionRelease: "0", lines: [{ code: "WORK-001", amount: "1000" }] },
    calculationResult: {
      locale,
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
  }, { id: `cert-export-${locale}`, issuedAt: "2026-08-01T00:00:00.000Z", issuedBy: "admin" }).record;
}

test("builds an export model only from a verified immutable certificate", () => {
  const record = certificate();
  const model = exporter.certificateModel(record);
  assert.equal(model.title, "期中付款证书 IPC-EXPORT-zh-CN");
  assert.equal(model.locale, "zh-CN");
  assert.equal(model.direction, "ltr");
  assert.equal(model.lines.length, 2);
  assert.equal(model.lines[1].generated, "是");
  assert.equal(model.lines[1].category, "价格调整");
  assert.ok(model.totals.some(([key, value]) => key === "净签证额" && value === "964.25"));
  assert.ok(model.integrity.some(([key, value]) => key === "签发 SHA-256" && value === record.issueChecksum));
  assert.deepEqual(exporter.rowsFromObject(null), []);
  assert.deepEqual(exporter.rowsFromObject([]), []);
  assert.equal(exporter.text(null), "");
  const tampered = structuredClone(record);
  tampered.calculationResult.totals.netCertified = "999.00";
  assert.throws(() => exporter.certificateModel(tampered), /checksum mismatch/);
});

test("localizes the immutable export model and XLSX for all supported certificate locales", async () => {
  const expectations = {
    "zh-CN": ["期中付款证书", "付款证书", "净签证额"],
    "en-US": ["Interim Payment Certificate", "Certificate", "Net certified"],
    "es-ES": ["Certificado de Pago Provisional", "Certificado", "Neto certificado"],
    "fr-FR": ["Certificat de Paiement Provisoire", "Certificat", "Montant net certifié"],
    "pt-BR": ["Certificado de Pagamento Provisório", "Certificado", "Líquido certificado"],
    "ar-SA": ["شهادة دفعة مرحلية", "الشهادة", "الصافي المعتمد"]
  };
  Object.entries(expectations).forEach(([locale, [title, sheet, net]]) => {
    const model = exporter.certificateModel(certificate(locale));
    assert.match(model.title, new RegExp(title));
    assert.equal(model.labels.certificate, sheet);
    assert.ok(model.totals.some(([label]) => label === net));
    assert.equal(model.direction, locale === "ar-SA" ? "rtl" : "ltr");
    assert.equal(Object.keys(model.labels).length, Object.keys(exporter.REPORT_TRANSLATIONS["en-US"]).length);
  });
  for (const [locale, [, sheet]] of Object.entries(expectations)) {
    assert.deepEqual(Object.keys(exporter.REPORT_TRANSLATIONS[locale]).sort(), Object.keys(exporter.REPORT_TRANSLATIONS["en-US"]).sort());
    const workbook = await readExcelFile(await exporter.createXlsx(certificate(locale)));
    assert.equal(workbook[0].sheet, sheet);
    assert.equal(workbook[0].data[0][0], exporter.reportText(locale, "field"));
  }
  assert.equal(exporter.reportText("unknown", "title"), "Interim Payment Certificate");
  assert.equal(exporter.reportText("en-US", "unknown.key"), "unknown.key");
});

test("creates a traceable multi-sheet XLSX snapshot", async () => {
  const record = certificate();
  const buffer = await exporter.createXlsx(record);
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  const sheets = await readExcelFile(buffer);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["付款证书", "计价明细", "金额汇总", "价格调整", "完整性校验"]);
  assert.ok(sheets[0].data.some((row) => row[0] === "证书编号" && row[1] === "IPC-EXPORT-zh-CN"));
  assert.ok(sheets[1].data.some((row) => row[0] === "WORK-001" && row[1] === "本期工程量"));
  assert.ok(sheets[2].data.some((row) => row[0] === "净签证额" && row[1] === "964.25"));
  assert.ok(sheets[3].data.some((row) => row[0] === "LABOR.现期指数" && row[1] === "110"));
  assert.ok(sheets[4].data.some((row) => row[0] === "签发 SHA-256" && row[1] === record.issueChecksum));
  const zip = await JSZip.loadAsync(buffer);
  const linesXml = await zip.file("xl/worksheets/sheet2.xml").async("string");
  assert.match(linesXml, /autoFilter/);
  assert.match(linesXml, /state="frozen"/);

  assert.deepEqual(exporter.priceAdjustmentRows(null), []);
  assert.deepEqual(exporter.priceAdjustmentRows({ factor: "1.015" }), [["factor", "1.015"]]);
});

test("creates genuine DOCX and portable PDF certificate artifacts", async () => {
  const record = certificate();
  const docx = await exporter.createDocx(record);
  assert.equal(docx.subarray(0, 2).toString("ascii"), "PK");
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /期中付款证书 IPC-EXPORT-zh-CN/);
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

test("writes Arabic labels and right-to-left layout into XLSX and DOCX", async () => {
  const record = certificate("ar-SA");
  const xlsx = await exporter.createXlsx(record);
  const sheets = await readExcelFile(xlsx);
  assert.equal(sheets[0].sheet, "الشهادة");
  assert.ok(sheets[0].data.some((row) => row[0] === "رقم الشهادة" && row[1] === "IPC-EXPORT-ar-SA"));
  const xlsxZip = await JSZip.loadAsync(xlsx);
  const sheetXml = await xlsxZip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(sheetXml, /rightToLeft="1"/);

  const docx = await exporter.createDocx(record);
  const docxZip = await JSZip.loadAsync(docx);
  const documentXml = await docxZip.file("word/document.xml").async("string");
  assert.match(documentXml, /شهادة دفعة مرحلية/);
  assert.match(documentXml, /<w:bidi\/>/);

  const pdf = await exporter.createPdf(record);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 5000);
});
