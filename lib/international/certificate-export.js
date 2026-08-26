"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require("docx");
const certificateRegister = require("./certificate-register");

const PDF_FONT_PATH = path.resolve(__dirname, "..", "..", "assets", "fonts", "NotoSansSC-VF.ttf");
const LINE_COLUMNS = Object.freeze([
  ["code", "Code"], ["description", "Description"], ["category", "Category"], ["direction", "Direction"],
  ["currency", "Currency"], ["amount", "Original amount"], ["exchangeRate", "Exchange rate"], ["baseAmount", "Base amount"], ["generated", "Generated"]
]);

function text(value) {
  return String(value ?? "").trim();
}

function rowsFromObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).map(([key, item]) => [key, text(item)]);
}

function priceAdjustmentRows(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows = Object.entries(value).filter(([key]) => key !== "components").map(([key, item]) => [key, text(item)]);
  const components = Array.isArray(value.components) ? value.components : [];
  components.forEach((component, index) => {
    const prefix = text(component.code) || `component-${index + 1}`;
    Object.entries(component).forEach(([key, item]) => rows.push([`${prefix}.${key}`, text(item)]));
  });
  return rows;
}

function certificateModel(source) {
  const record = certificateRegister.certificateView(source);
  const result = record.calculationResult;
  const totals = rowsFromObject(result.totals);
  const lines = Array.isArray(result.lines) ? result.lines.map((line) => Object.fromEntries(LINE_COLUMNS.map(([key]) => [key, key === "generated" ? (line[key] ? "yes" : "no") : text(line[key])]))) : [];
  const priceAdjustment = result.priceAdjustment && result.priceAdjustment.enabled ? result.priceAdjustment : null;
  return {
    title: `Interim Payment Certificate ${record.certificateNo}`,
    locale: text(result.locale || "en-US"),
    record,
    metadata: [
      ["Certificate number", record.certificateNo], ["Status", record.status], ["Period start", record.periodStart], ["Period end", record.periodEnd],
      ["Application reference", record.applicationReference], ["Certificate standard", record.certificateStandard], ["Base currency", record.baseCurrency],
      ["Issued at", record.issuedAt], ["Issued by", record.issuedBy], ["Predecessor certificate", record.predecessorCertificateId || "-"],
      ["Opening balance reason", record.openingBalanceReason || "-"], ["Remarks", record.remarks || "-"]
    ],
    lines,
    totals,
    priceAdjustment,
    integrity: [
      ["Certificate schema", record.schemaVersion], ["Settings version", record.settingsVersion], ["Settings schema", record.settingsSchemaVersion],
      ["Settings SHA-256", record.settingsChecksum], ["Input SHA-256", record.calculationInputChecksum], ["Result SHA-256", record.calculationResultChecksum],
      ["Issue SHA-256", record.issueChecksum], ["Predecessor issue SHA-256", record.predecessorIssueChecksum || "-"], ["Void SHA-256", record.voidChecksum || "-"]
    ]
  };
}

function styleSheet(sheet, widths) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF075985" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex > 1 && rowIndex % 2 === 1) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } }; });
    row.eachCell((cell) => { cell.border = { bottom: { style: "hair", color: { argb: "FFCBD5E1" } } }; });
  });
}

function addPairsSheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(["Field", "Value"]);
  rows.forEach((row) => sheet.addRow(row));
  styleSheet(sheet, [30, 88]);
  sheet.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return sheet;
}

async function createXlsx(source) {
  const model = certificateModel(source);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Engineering Payment Platform";
  workbook.created = new Date(model.record.issuedAt);
  workbook.modified = new Date(model.record.issuedAt);
  workbook.subject = model.record.issueChecksum;
  addPairsSheet(workbook, "Certificate", [["Report", model.title], ["Locale", model.locale], ...model.metadata]);
  const lines = workbook.addWorksheet("Line Items");
  lines.addRow(LINE_COLUMNS.map(([, label]) => label));
  model.lines.forEach((line) => lines.addRow(LINE_COLUMNS.map(([key]) => line[key])));
  styleSheet(lines, [18, 34, 22, 14, 12, 18, 18, 18, 12]);
  lines.autoFilter = { from: "A1", to: `I${Math.max(1, model.lines.length + 1)}` };
  addPairsSheet(workbook, "Totals", model.totals);
  if (model.priceAdjustment) addPairsSheet(workbook, "Price Adjustment", priceAdjustmentRows(model.priceAdjustment));
  addPairsSheet(workbook, "Integrity", model.integrity);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wordCell(value, header = false) {
  return new TableCell({
    shading: header ? { fill: "075985" } : undefined,
    margins: { top: 70, bottom: 70, left: 80, right: 80 },
    children: [new Paragraph({ children: [new TextRun({ text: text(value), bold: header, color: header ? "FFFFFF" : "0F172A", font: "Arial", size: 18 })] })]
  });
}

function wordTable(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: headers.map((value) => wordCell(value, true)) }), ...rows.map((row) => new TableRow({ children: row.map((value) => wordCell(value)) }))],
    borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((key) => [key, { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" }]))
  });
}

function heading(value) {
  return new Paragraph({ spacing: { before: 220, after: 100 }, children: [new TextRun({ text: value, bold: true, size: 24, color: "075985", font: "Arial" })] });
}

async function createDocx(source) {
  const model = certificateModel(source);
  const sections = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: model.title, bold: true, size: 32, font: "Arial", color: "0F172A" })] }),
    wordTable(["Field", "Value"], [["Locale", model.locale], ...model.metadata]),
    heading("Certificate line items"),
    wordTable(LINE_COLUMNS.map(([, label]) => label), model.lines.map((line) => LINE_COLUMNS.map(([key]) => line[key]))),
    heading("Certificate totals"), wordTable(["Total", `Amount (${model.record.baseCurrency})`], model.totals),
    heading("Integrity and traceability"), wordTable(["Field", "Value"], model.integrity)
  ];
  if (model.priceAdjustment) sections.splice(sections.length - 2, 0, heading("Index price adjustment"), wordTable(["Field", "Value"], priceAdjustmentRows(model.priceAdjustment)));
  const document = new Document({
    creator: "Engineering Payment Platform",
    title: model.title,
    description: `Immutable certificate ${model.record.issueChecksum}`,
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 480, right: 360, bottom: 480, left: 360 } } }, children: sections }]
  });
  return Packer.toBuffer(document);
}

function pdfTable(doc, headingText, rows) {
  doc.fillColor("#075985").fontSize(12).text(headingText, { underline: true });
  doc.moveDown(0.35).fillColor("#0f172a").fontSize(8.5);
  rows.forEach(([label, value]) => {
    if (doc.y > doc.page.height - 55) doc.addPage();
    doc.fillColor("#475569").text(`${text(label)}:`, { continued: true }).fillColor("#0f172a").text(` ${text(value)}`);
  });
  doc.moveDown(0.7);
}

async function createPdf(source) {
  const model = certificateModel(source);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 38, right: 38, bottom: 38, left: 38 }, info: { Title: model.title, Subject: model.record.issueChecksum, CreationDate: new Date(model.record.issuedAt), ModDate: new Date(model.record.issuedAt) } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.registerFont("Report", PDF_FONT_PATH).font("Report");
    doc.fillColor("#0f172a").fontSize(17).text(model.title, { align: "center" }).moveDown();
    pdfTable(doc, "Certificate", [["Locale", model.locale], ...model.metadata]);
    pdfTable(doc, "Certificate line items", model.lines.map((line) => [line.code, `${line.description} | ${line.category} | ${line.direction} | ${line.amount} ${line.currency} = ${line.baseAmount} ${model.record.baseCurrency}`]));
    pdfTable(doc, "Certificate totals", model.totals);
    if (model.priceAdjustment) pdfTable(doc, "Index price adjustment", priceAdjustmentRows(model.priceAdjustment));
    pdfTable(doc, "Integrity and traceability", model.integrity);
    doc.end();
  });
}

module.exports = { LINE_COLUMNS, certificateModel, createDocx, createPdf, createXlsx, priceAdjustmentRows, rowsFromObject, text };
