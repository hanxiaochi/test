"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} = require("docx");
const contractEvents = require("./contract-event-register");

const PDF_FONT_PATH = path.resolve(__dirname, "..", "..", "assets", "fonts", "NotoSansSC-VF.ttf");
const PDF_ARABIC_FONT_PATH = path.resolve(__dirname, "..", "..", "assets", "fonts", "NotoSansArabic-VF.ttf");

const REPORT_TRANSLATIONS = Object.freeze({
  "en-US": {
    title: "Contract Event Determination", field: "Field", value: "Value", event: "Contract Event", determination: "Determination", integrity: "Integrity",
    locale: "Locale", eventNumber: "Event number", eventType: "Event type", variation: "Variation", claim: "Claim", status: "Status", approved: "Approved",
    subject: "Subject", noticeDate: "Notice date", currency: "Currency", claimedAmount: "Claimed amount", approvedAmount: "Approved amount",
    claimedTime: "Claimed time impact (days)", approvedTime: "Approved time impact (days)", contractClause: "Contract clause", description: "Description",
    submittedAt: "Submitted at", submittedBy: "Submitted by", approvedAt: "Approved at", approvedBy: "Approved by", decisionReason: "Determination reason",
    schemaVersion: "Schema version", eventId: "Event ID", supersedesEventId: "Supersedes event ID", submissionChecksum: "Submission SHA-256", decisionChecksum: "Determination SHA-256", evidenceCount: "Evidence files", evidenceChecksum: "Evidence manifest SHA-256", evidenceManifest: "Evidence manifest (canonical JSON)"
  },
  "zh-CN": {
    title: "合同事件审定单", field: "字段", value: "值", event: "合同事件", determination: "审定结果", integrity: "完整性校验",
    locale: "语言", eventNumber: "事件编号", eventType: "事件类型", variation: "变更", claim: "索赔", status: "状态", approved: "已批准",
    subject: "主题", noticeDate: "通知日期", currency: "币种", claimedAmount: "申报金额", approvedAmount: "审定金额",
    claimedTime: "申报工期影响(天)", approvedTime: "审定工期影响(天)", contractClause: "合同条款", description: "事件说明",
    submittedAt: "提交时间", submittedBy: "提交人", approvedAt: "审定时间", approvedBy: "审定人", decisionReason: "审定意见",
    schemaVersion: "结构版本", eventId: "事件 ID", supersedesEventId: "替代事件 ID", submissionChecksum: "申报 SHA-256", decisionChecksum: "审定 SHA-256", evidenceCount: "证据文件数", evidenceChecksum: "证据清单 SHA-256", evidenceManifest: "证据清单（规范 JSON）"
  },
  "es-ES": {
    title: "Determinación del Evento Contractual", field: "Campo", value: "Valor", event: "Evento Contractual", determination: "Determinación", integrity: "Integridad",
    locale: "Idioma", eventNumber: "Número de evento", eventType: "Tipo de evento", variation: "Variación", claim: "Reclamación", status: "Estado", approved: "Aprobado",
    subject: "Asunto", noticeDate: "Fecha de aviso", currency: "Moneda", claimedAmount: "Importe reclamado", approvedAmount: "Importe aprobado",
    claimedTime: "Plazo reclamado (días)", approvedTime: "Plazo aprobado (días)", contractClause: "Cláusula contractual", description: "Descripción",
    submittedAt: "Presentado el", submittedBy: "Presentado por", approvedAt: "Aprobado el", approvedBy: "Aprobado por", decisionReason: "Motivo de la determinación",
    schemaVersion: "Versión del esquema", eventId: "ID del evento", supersedesEventId: "ID del evento sustituido", submissionChecksum: "SHA-256 de la presentación", decisionChecksum: "SHA-256 de la determinación", evidenceCount: "Archivos de prueba", evidenceChecksum: "SHA-256 del manifiesto de pruebas", evidenceManifest: "Manifiesto de pruebas (JSON canónico)"
  },
  "fr-FR": {
    title: "Détermination de l'Événement Contractuel", field: "Champ", value: "Valeur", event: "Événement Contractuel", determination: "Détermination", integrity: "Intégrité",
    locale: "Langue", eventNumber: "Numéro d'événement", eventType: "Type d'événement", variation: "Variation", claim: "Réclamation", status: "Statut", approved: "Approuvé",
    subject: "Objet", noticeDate: "Date de notification", currency: "Devise", claimedAmount: "Montant réclamé", approvedAmount: "Montant approuvé",
    claimedTime: "Délai réclamé (jours)", approvedTime: "Délai approuvé (jours)", contractClause: "Clause contractuelle", description: "Description",
    submittedAt: "Soumis le", submittedBy: "Soumis par", approvedAt: "Approuvé le", approvedBy: "Approuvé par", decisionReason: "Motif de la détermination",
    schemaVersion: "Version du schéma", eventId: "ID de l'événement", supersedesEventId: "ID de l'événement remplacé", submissionChecksum: "SHA-256 de la soumission", decisionChecksum: "SHA-256 de la détermination", evidenceCount: "Fichiers de preuve", evidenceChecksum: "SHA-256 du manifeste des preuves", evidenceManifest: "Manifeste des preuves (JSON canonique)"
  },
  "pt-BR": {
    title: "Determinação do Evento Contratual", field: "Campo", value: "Valor", event: "Evento Contratual", determination: "Determinação", integrity: "Integridade",
    locale: "Idioma", eventNumber: "Número do evento", eventType: "Tipo do evento", variation: "Variação", claim: "Reivindicação", status: "Status", approved: "Aprovado",
    subject: "Assunto", noticeDate: "Data da notificação", currency: "Moeda", claimedAmount: "Valor reivindicado", approvedAmount: "Valor aprovado",
    claimedTime: "Prazo reivindicado (dias)", approvedTime: "Prazo aprovado (dias)", contractClause: "Cláusula contratual", description: "Descrição",
    submittedAt: "Enviado em", submittedBy: "Enviado por", approvedAt: "Aprovado em", approvedBy: "Aprovado por", decisionReason: "Motivo da determinação",
    schemaVersion: "Versão do esquema", eventId: "ID do evento", supersedesEventId: "ID do evento substituído", submissionChecksum: "SHA-256 do envio", decisionChecksum: "SHA-256 da determinação", evidenceCount: "Arquivos de evidência", evidenceChecksum: "SHA-256 do manifesto de evidências", evidenceManifest: "Manifesto de evidências (JSON canônico)"
  },
  "ar-SA": {
    title: "قرار الحدث التعاقدي", field: "الحقل", value: "القيمة", event: "الحدث التعاقدي", determination: "القرار", integrity: "سلامة البيانات",
    locale: "اللغة", eventNumber: "رقم الحدث", eventType: "نوع الحدث", variation: "تغيير", claim: "مطالبة", status: "الحالة", approved: "معتمد",
    subject: "الموضوع", noticeDate: "تاريخ الإشعار", currency: "العملة", claimedAmount: "المبلغ المطالب به", approvedAmount: "المبلغ المعتمد",
    claimedTime: "المدة المطالب بها (أيام)", approvedTime: "المدة المعتمدة (أيام)", contractClause: "البند التعاقدي", description: "الوصف",
    submittedAt: "تاريخ التقديم", submittedBy: "مقدم من", approvedAt: "تاريخ الاعتماد", approvedBy: "معتمد من", decisionReason: "سبب القرار",
    schemaVersion: "إصدار البنية", eventId: "معرف الحدث", supersedesEventId: "معرف الحدث المستبدل", submissionChecksum: "SHA-256 للتقديم", decisionChecksum: "SHA-256 للقرار", evidenceCount: "ملفات الأدلة", evidenceChecksum: "SHA-256 لبيان الأدلة", evidenceManifest: "بيان الأدلة (JSON معياري)"
  }
});

function text(value) {
  return String(value ?? "").trim();
}

function translationsFor(locale) {
  const code = Object.prototype.hasOwnProperty.call(REPORT_TRANSLATIONS, locale) ? locale : "en-US";
  return { ...REPORT_TRANSLATIONS["en-US"], ...REPORT_TRANSLATIONS[code] };
}

function reportText(locale, key) {
  return translationsFor(locale)[key] || String(key);
}

function contractEventModel(source, options = {}) {
  const record = contractEvents.eventView(source);
  if (record.states !== "已批准" || !record.decisionChecksum) throw new Error("only an approved contract event can be exported");
  const locale = Object.prototype.hasOwnProperty.call(REPORT_TRANSLATIONS, options.locale) ? options.locale : "en-US";
  const labels = translationsFor(locale);
  const t = (key) => labels[key] || key;
  return {
    title: `${t("title")} ${record.eventNo}`,
    locale,
    direction: locale === "ar-SA" ? "rtl" : "ltr",
    labels,
    record,
    eventRows: [
      [t("eventNumber"), record.eventNo], [t("eventType"), t(record.request.eventType)], [t("status"), t("approved")],
      [t("subject"), record.request.title], [t("noticeDate"), record.request.noticeDate], [t("currency"), record.request.currency],
      [t("claimedAmount"), record.request.claimedAmount], [t("claimedTime"), record.request.claimedTimeImpactDays],
      [t("contractClause"), record.request.contractClause || "-"], [t("description"), record.request.description || "-"],
      [t("submittedAt"), record.submittedAt], [t("submittedBy"), record.submittedBy]
    ],
    determinationRows: [
      [t("approvedAmount"), record.approvedAmount], [t("approvedTime"), record.approvedTimeImpactDays], [t("decisionReason"), record.decisionReason],
      [t("approvedAt"), record.approvedAt], [t("approvedBy"), record.approvedBy]
    ],
    integrityRows: [
      [t("schemaVersion"), record.schemaVersion], [t("eventId"), record.id], [t("supersedesEventId"), record.supersedesEventId || "-"],
      [t("submissionChecksum"), record.submissionChecksum], [t("decisionChecksum"), record.decisionChecksum],
      [t("evidenceCount"), (record.evidenceManifest || []).length], [t("evidenceChecksum"), record.evidenceChecksum || "-"],
      [t("evidenceManifest"), JSON.stringify(record.evidenceManifest || [])]
    ]
  };
}

function styleSheet(sheet, rtl) {
  sheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: rtl }];
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 88;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF075985" } };
  });
  sheet.eachRow((row, rowIndex) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true, horizontal: rtl ? "right" : "left" };
      cell.border = { bottom: { style: "hair", color: { argb: "FFCBD5E1" } } };
      if (rowIndex > 1 && rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
    });
  });
}

function addSheet(workbook, name, rows, labels, rtl) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow([labels.field, labels.value]);
  rows.forEach((row) => sheet.addRow(row));
  styleSheet(sheet, rtl);
}

async function createXlsx(source, options = {}) {
  const model = contractEventModel(source, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Engineering Payment Platform";
  workbook.created = new Date(model.record.approvedAt);
  workbook.modified = new Date(model.record.approvedAt);
  workbook.subject = model.record.decisionChecksum;
  const rtl = model.direction === "rtl";
  addSheet(workbook, model.labels.event, [[model.labels.locale, model.locale], ...model.eventRows], model.labels, rtl);
  addSheet(workbook, model.labels.determination, model.determinationRows, model.labels, rtl);
  addSheet(workbook, model.labels.integrity, model.integrityRows, model.labels, rtl);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wordCell(value, header, rtl) {
  return new TableCell({
    shading: header ? { fill: "075985" } : undefined,
    margins: { top: 70, bottom: 70, left: 80, right: 80 },
    children: [new Paragraph({ bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: text(value), bold: header, color: header ? "FFFFFF" : "0F172A", font: "Arial", size: 18 })] })]
  });
}

function wordTable(headers, rows, rtl) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: headers.map((value) => wordCell(value, true, rtl)) }), ...rows.map((row) => new TableRow({ children: row.map((value) => wordCell(value, false, rtl)) }))],
    borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((key) => [key, { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" }]))
  });
}

function heading(value, rtl) {
  return new Paragraph({ bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { before: 220, after: 100 }, children: [new TextRun({ text: value, bold: true, size: 24, color: "075985", font: "Arial" })] });
}

async function createDocx(source, options = {}) {
  const model = contractEventModel(source, options);
  const rtl = model.direction === "rtl";
  const document = new Document({
    creator: "Engineering Payment Platform",
    title: model.title,
    description: `Immutable contract event determination ${model.record.decisionChecksum}`,
    sections: [{ properties: { page: { margin: { top: 600, right: 600, bottom: 600, left: 600 } } }, children: [
      new Paragraph({ bidirectional: rtl, alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: model.title, bold: true, size: 32, font: "Arial", color: "0F172A" })] }),
      wordTable([model.labels.field, model.labels.value], [[model.labels.locale, model.locale], ...model.eventRows], rtl),
      heading(model.labels.determination, rtl), wordTable([model.labels.field, model.labels.value], model.determinationRows, rtl),
      heading(model.labels.integrity, rtl), wordTable([model.labels.field, model.labels.value], model.integrityRows, rtl)
    ] }]
  });
  return Packer.toBuffer(document);
}

function pdfRows(doc, headingText, rows, rtl) {
  const align = rtl ? "right" : "left";
  doc.fillColor("#075985").fontSize(12).text(headingText, { underline: true, align });
  doc.moveDown(0.35).fillColor("#0f172a").fontSize(8.5);
  rows.forEach(([label, value]) => {
    if (doc.y > doc.page.height - 55) doc.addPage();
    doc.text(`${text(label)}: ${text(value)}`, { align });
  });
  doc.moveDown(0.7);
}

async function createPdf(source, options = {}) {
  const model = contractEventModel(source, options);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 38, right: 38, bottom: 38, left: 38 }, info: { Title: model.title, Subject: model.record.decisionChecksum, CreationDate: new Date(model.record.approvedAt), ModDate: new Date(model.record.approvedAt) } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const rtl = model.direction === "rtl";
    doc.registerFont("Report", rtl ? PDF_ARABIC_FONT_PATH : PDF_FONT_PATH).font("Report");
    doc.fillColor("#0f172a").fontSize(17).text(rtl ? model.labels.title : model.title, { align: "center" });
    if (rtl) doc.fontSize(11).text(model.record.eventNo, { align: "center" });
    doc.moveDown();
    pdfRows(doc, model.labels.event, [[model.labels.locale, model.locale], ...model.eventRows], rtl);
    pdfRows(doc, model.labels.determination, model.determinationRows, rtl);
    pdfRows(doc, model.labels.integrity, model.integrityRows, rtl);
    doc.end();
  });
}

module.exports = { REPORT_TRANSLATIONS, contractEventModel, createDocx, createPdf, createXlsx, reportText, text, translationsFor };
