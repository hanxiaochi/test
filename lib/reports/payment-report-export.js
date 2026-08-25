"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require("docx");

const COLUMNS = Object.freeze([
  { key: "sectionName", label: "合同段", width: 18 },
  { key: "contractNo", label: "合同编号", width: 16 },
  { key: "contractMoney", label: "合同金额", width: 15, numeric: true },
  { key: "finalMoney", label: "最终金额", width: 15, numeric: true },
  { key: "billMeasureMoney", label: "清单计量", width: 15, numeric: true },
  { key: "materialDiasMoney", label: "材料补差", width: 15, numeric: true },
  { key: "materialArrivalMoney", label: "材料到场", width: 15, numeric: true },
  { key: "manualMoney", label: "手动计量", width: 15, numeric: true },
  { key: "materialAdvanceMoney", label: "材料垫付款", width: 15, numeric: true },
  { key: "materialDeductionMoney", label: "材料扣回", width: 15, numeric: true },
  { key: "retentionMoney", label: "保留金", width: 15, numeric: true },
  { key: "mobilizationDeductionMoney", label: "动员预付款扣回", width: 17, numeric: true },
  { key: "totalPayMoney", label: "累计支付", width: 15, numeric: true },
  { key: "payRate", label: "支付比例", width: 12, numeric: true, percent: true },
  { key: "payableFormula", label: "支付公式", width: 38 },
  { key: "arrivalRule", label: "材料到场规则", width: 38 }
]);

const MONEY_KEYS = Object.freeze(COLUMNS.filter((column) => column.numeric && !column.percent).map((column) => column.key));
const PDF_FONT_PATH = path.resolve(__dirname, "..", "..", "assets", "fonts", "NotoSansSC-VF.ttf");
const FINANCIAL_COLUMNS = Object.freeze([
  { key: "sectionName", label: "合同段", width: 112 },
  { key: "contractNo", label: "合同编号", width: 92 },
  { key: "contractMoney", label: "合同金额", width: 90, numeric: true },
  { key: "finalMoney", label: "最终金额", width: 90, numeric: true },
  { key: "billMeasureMoney", label: "清单计量", width: 90, numeric: true },
  { key: "materialDiasMoney", label: "材料补差", width: 82, numeric: true },
  { key: "materialArrivalMoney", label: "材料到场", width: 82, numeric: true },
  { key: "manualMoney", label: "手动计量", width: 82, numeric: true }
]);
const PAYMENT_COLUMNS = Object.freeze([
  { key: "sectionName", label: "合同段", width: 112 },
  { key: "contractNo", label: "合同编号", width: 92 },
  { key: "materialAdvanceMoney", label: "材料垫付款", width: 94, numeric: true },
  { key: "materialDeductionMoney", label: "材料扣回", width: 90, numeric: true },
  { key: "retentionMoney", label: "保留金", width: 82, numeric: true },
  { key: "mobilizationDeductionMoney", label: "动员预付款扣回", width: 104, numeric: true },
  { key: "totalPayMoney", label: "累计支付", width: 94, numeric: true },
  { key: "payRate", label: "支付比例", width: 78, numeric: true, percent: true }
]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((source) => COLUMNS.reduce((row, column) => {
    row[column.key] = column.numeric ? number(source[column.key]) : String(source[column.key] ?? "").trim();
    return row;
  }, {}));
}

function summarize(rows) {
  const normalized = normalizeRows(rows);
  const totals = MONEY_KEYS.reduce((result, key) => ({ ...result, [key]: normalized.reduce((sum, row) => sum + row[key], 0) }), {});
  totals.payRate = totals.finalMoney ? Number(((totals.totalPayMoney / totals.finalMoney) * 100).toFixed(2)) : 0;
  return totals;
}

function reportModel(rows, options = {}) {
  const normalized = normalizeRows(rows);
  return {
    title: String(options.title || "计量支付汇总报表").trim(),
    generatedAt: options.generatedAt ? new Date(options.generatedAt) : new Date(),
    rows: normalized,
    summary: summarize(normalized),
    columns: COLUMNS
  };
}

function styleExcelSheet(sheet, model) {
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  const title = sheet.getCell(1, 1);
  title.value = model.title;
  title.font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: "FF172033" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;
  sheet.mergeCells(2, 1, 2, COLUMNS.length);
  sheet.getCell(2, 1).value = `生成时间：${model.generatedAt.toISOString()}  记录数：${model.rows.length}`;
  sheet.getCell(2, 1).font = { name: "Microsoft YaHei", size: 9, color: { argb: "FF64748B" } };
  sheet.getCell(2, 1).alignment = { horizontal: "right" };
  const header = sheet.getRow(3);
  header.values = COLUMNS.map((column) => column.label);
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } }, bottom: { style: "thin", color: { argb: "FFCBD5E1" } }, left: { style: "thin", color: { argb: "FFCBD5E1" } }, right: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });
  COLUMNS.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  sheet.views = [{ state: "frozen", ySplit: 3, xSplit: 2 }];
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 } };
}

async function createXlsx(rows, options = {}) {
  const model = reportModel(rows, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Engineering Payment Platform";
  workbook.created = model.generatedAt;
  workbook.modified = model.generatedAt;
  const sheet = workbook.addWorksheet("计量支付汇总", { properties: { defaultRowHeight: 22 } });
  styleExcelSheet(sheet, model);
  model.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.addRow(COLUMNS.map((column) => row[column.key]));
    excelRow.eachCell((cell, columnIndex) => {
      const column = COLUMNS[columnIndex - 1];
      cell.font = { name: "Microsoft YaHei", size: 9 };
      cell.alignment = { horizontal: column.numeric ? "right" : "left", vertical: "middle", wrapText: !column.numeric };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD8DEE9" } }, left: { style: "hair", color: { argb: "FFD8DEE9" } }, right: { style: "hair", color: { argb: "FFD8DEE9" } } };
      if (column.numeric) cell.numFmt = column.percent ? '0.00"%"' : '#,##0.00';
      if (rowIndex % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
  });
  const totalRow = sheet.addRow(COLUMNS.map((column, index) => {
    if (index === 0) return "合计";
    if (column.percent) return model.summary.payRate;
    return column.numeric ? model.summary[column.key] : "";
  }));
  totalRow.eachCell((cell, columnIndex) => {
    const column = COLUMNS[columnIndex - 1];
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FF0F172A" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFBF1" } };
    cell.alignment = { horizontal: column.numeric ? "right" : "center", vertical: "middle" };
    if (column.numeric) cell.numFmt = column.percent ? '0.00"%"' : '#,##0.00';
  });
  const rules = workbook.addWorksheet("口径说明");
  rules.columns = [{ width: 24 }, { width: 92 }];
  rules.mergeCells("A1:B1");
  rules.getCell("A1").value = "口径说明";
  rules.getCell("A1").font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: "FF172033" } };
  rules.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  rules.getRow(1).height = 28;
  [
    ["项目", model.title],
    ["生成时间", model.generatedAt.toISOString()],
    ["记录数", model.rows.length],
    ["支付公式", model.rows[0]?.payableFormula || ""],
    ["材料到场规则", model.rows[0]?.arrivalRule || ""],
    ["数据说明", "本文件为系统计算结果的值快照，不依赖工作簿公式重新计算。"]
  ].forEach((item) => rules.addRow(item));
  rules.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    row.height = 28;
    row.eachCell((cell, columnIndex) => {
      cell.font = { name: "Microsoft YaHei", size: 10, bold: columnIndex === 1 };
      cell.alignment = { wrapText: true, vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD8DEE9" } } };
      if (columnIndex === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFBF1" } };
    });
  });
  rules.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9, printArea: "A1:B7", margins: { left: 0.45, right: 0.45, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wordCell(value, options = {}) {
  return new TableCell({
    shading: options.header ? { fill: "0F766E" } : options.total ? { fill: "CCFBF1" } : undefined,
    margins: { top: 50, bottom: 50, left: 45, right: 45 },
    children: [new Paragraph({
      alignment: options.numeric ? AlignmentType.RIGHT : AlignmentType.CENTER,
      children: [new TextRun({ text: String(value ?? ""), bold: options.header || options.total, color: options.header ? "FFFFFF" : "172033", size: options.header ? 14 : 13, font: "Microsoft YaHei" })]
    })]
  });
}

function wordTable(columns, model) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((column) => wordCell(column.label, { header: true })) }),
      ...model.rows.map((row) => new TableRow({ children: columns.map((column) => wordCell(column.numeric ? row[column.key].toFixed(2) : row[column.key], { numeric: column.numeric })) })),
      new TableRow({ children: columns.map((column, index) => wordCell(index === 0 ? "合计" : column.numeric ? number(column.percent ? model.summary.payRate : model.summary[column.key]).toFixed(2) : "", { numeric: column.numeric, total: true })) })
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "94A3B8" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "94A3B8" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "94A3B8" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "94A3B8" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" }
    }
  });
}

async function createDocx(rows, options = {}) {
  const model = reportModel(rows, options);
  const document = new Document({
    creator: "Engineering Payment Platform",
    title: model.title,
    description: "计量支付系统计算结果导出",
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 360, right: 300, bottom: 360, left: 300 }
        }
      },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: model.title, bold: true, size: 32, font: "Microsoft YaHei" })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `生成时间：${model.generatedAt.toISOString()}  记录数：${model.rows.length}`, size: 16, color: "64748B", font: "Microsoft YaHei" })] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "计量与合同金额", bold: true, size: 20, color: "0F766E", font: "Microsoft YaHei" })] }),
        wordTable(FINANCIAL_COLUMNS, model),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "支付与扣回", bold: true, size: 20, color: "0F766E", font: "Microsoft YaHei" })] }),
        wordTable(PAYMENT_COLUMNS, model),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "口径说明", bold: true, size: 20, color: "0F766E", font: "Microsoft YaHei" })] }),
        new Paragraph({ children: [new TextRun({ text: `支付公式：${model.rows[0]?.payableFormula || "未配置"}`, size: 17, font: "Microsoft YaHei" })] }),
        new Paragraph({ children: [new TextRun({ text: `材料到场规则：${model.rows[0]?.arrivalRule || "未配置"}`, size: 17, font: "Microsoft YaHei" })] }),
        new Paragraph({ children: [new TextRun({ text: "数据说明：本文件为系统计算结果的值快照，不依赖文档公式重新计算。", size: 16, color: "64748B", font: "Microsoft YaHei" })] })
      ]
    }]
  });
  return Packer.toBuffer(document);
}

function pdfValue(row, column) {
  if (!column.numeric) return row[column.key];
  const value = number(row[column.key]).toFixed(2);
  return column.percent ? `${value}%` : value;
}

function createPdf(rows, options = {}) {
  const model = reportModel(rows, options);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 34, right: 34, bottom: 40, left: 34 },
      bufferPages: true,
      info: { Title: model.title, Author: "Engineering Payment Platform", Subject: "计量支付系统计算结果导出", CreationDate: model.generatedAt }
    });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.registerFont("report", PDF_FONT_PATH);
    doc.font("report");

    const pageBottom = () => doc.page.height - doc.page.margins.bottom;
    const drawPageHeader = (continuation = false) => {
      doc.fillColor("#172033").fontSize(continuation ? 11 : 16).text(model.title, { align: "center" });
      doc.moveDown(0.25).fillColor("#64748B").fontSize(7.5).text(`生成时间：${model.generatedAt.toISOString()}  记录数：${model.rows.length}`, { align: "right" });
      doc.moveDown(0.6);
    };
    const drawSection = (label) => {
      doc.fillColor("#0F766E").fontSize(10).text(label);
      doc.moveDown(0.35);
    };
    const drawTable = (label, columns) => {
      const left = doc.page.margins.left;
      const headerHeight = 25;
      const rowHeight = 21;
      const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
      const drawHeader = () => {
        const rowY = doc.y;
        let x = left;
        columns.forEach((column) => {
          doc.rect(x, rowY, column.width, headerHeight).fillAndStroke("#0F766E", "#CBD5E1");
          doc.fillColor("#FFFFFF").fontSize(6.7).text(column.label, x + 3, rowY + 6, { width: column.width - 6, height: headerHeight - 8, align: "center", ellipsis: true });
          x += column.width;
        });
        doc.x = left;
        doc.y = rowY + headerHeight;
      };
      const ensureSpace = () => {
        if (doc.y + rowHeight <= pageBottom()) return;
        doc.addPage();
        drawPageHeader(true);
        drawSection(`${label}（续）`);
        drawHeader();
      };
      drawSection(label);
      drawHeader();
      model.rows.forEach((row, rowIndex) => {
        ensureSpace();
        const rowY = doc.y;
        let x = left;
        columns.forEach((column) => {
          const fill = rowIndex % 2 ? "#F8FAFC" : "#FFFFFF";
          doc.rect(x, rowY, column.width, rowHeight).fillAndStroke(fill, "#D8DEE9");
          doc.fillColor("#172033").fontSize(6.5).text(pdfValue(row, column), x + 3, rowY + 6, { width: column.width - 6, height: rowHeight - 8, align: column.numeric ? "right" : "left", ellipsis: true, lineBreak: false });
          x += column.width;
        });
        doc.x = left;
        doc.y = rowY + rowHeight;
      });
      ensureSpace();
      const totalY = doc.y;
      let x = left;
      columns.forEach((column, index) => {
        const value = index === 0 ? "合计" : column.numeric ? pdfValue(model.summary, column) : "";
        doc.rect(x, totalY, column.width, rowHeight).fillAndStroke("#CCFBF1", "#94A3B8");
        doc.fillColor("#0F172A").fontSize(6.8).text(value, x + 3, totalY + 6, { width: column.width - 6, height: rowHeight - 8, align: column.numeric ? "right" : "center", ellipsis: true, lineBreak: false });
        x += column.width;
      });
      doc.x = left;
      doc.y = totalY + rowHeight;
      doc.moveDown(0.8);
      doc.strokeColor("#CBD5E1").moveTo(left, doc.y).lineTo(left + tableWidth, doc.y).stroke();
      doc.moveDown(0.6);
    };
    const drawRule = (label, value) => {
      const left = doc.page.margins.left;
      const width = doc.page.width - left - doc.page.margins.right;
      const text = `${label}：${value || "未配置"}`;
      doc.fontSize(8);
      const height = Math.max(28, doc.heightOfString(text, { width: width - 16 }) + 14);
      if (doc.y + height > pageBottom()) {
        doc.addPage();
        drawPageHeader(true);
        drawSection("口径说明（续）");
      }
      const ruleY = doc.y;
      doc.roundedRect(left, ruleY, width, height, 3).fillAndStroke("#F8FAFC", "#CBD5E1");
      doc.fillColor("#172033").fontSize(8).text(text, left + 8, ruleY + 7, { width: width - 16 });
      doc.x = left;
      doc.y = ruleY + height + 8;
    };

    drawPageHeader();
    drawTable("计量与合同金额", FINANCIAL_COLUMNS);
    drawTable("支付与扣回", PAYMENT_COLUMNS);
    drawSection("口径说明");
    drawRule("支付公式", model.rows[0]?.payableFormula);
    drawRule("材料到场规则", model.rows[0]?.arrivalRule);
    drawRule("数据说明", "本文件为系统计算结果的值快照，不依赖 PDF 阅读器重新计算。");

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index);
      doc.fillColor("#64748B").fontSize(7).text(`第 ${index + 1} / ${pages.count} 页`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 18, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "right", lineBreak: false });
    }
    doc.end();
  });
}

function pdfLines(rows, options = {}) {
  const model = reportModel(rows, options);
  const summary = model.summary;
  const lines = [
    `记录数：${model.rows.length}`,
    `合同金额合计：${summary.contractMoney.toFixed(2)}；最终金额合计：${summary.finalMoney.toFixed(2)}；累计支付合计：${summary.totalPayMoney.toFixed(2)}；支付比例：${summary.payRate.toFixed(2)}%`,
    `支付公式：${model.rows[0]?.payableFormula || ""}`,
    `材料到场规则：${model.rows[0]?.arrivalRule || ""}`,
    ""
  ];
  model.rows.forEach((row, index) => lines.push(`${index + 1}. ${row.sectionName} | ${row.contractNo} | 合同=${row.contractMoney.toFixed(2)} | 最终=${row.finalMoney.toFixed(2)} | 清单计量=${row.billMeasureMoney.toFixed(2)} | 材料补差=${row.materialDiasMoney.toFixed(2)} | 材料到场=${row.materialArrivalMoney.toFixed(2)} | 手动计量=${row.manualMoney.toFixed(2)} | 累计支付=${row.totalPayMoney.toFixed(2)} | ${row.payRate.toFixed(2)}%`));
  return { title: model.title, lines, model };
}

module.exports = { COLUMNS, FINANCIAL_COLUMNS, MONEY_KEYS, PAYMENT_COLUMNS, createDocx, createPdf, createXlsx, normalizeRows, number, pdfLines, reportModel, summarize };
