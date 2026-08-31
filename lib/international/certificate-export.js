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
const PDF_ARABIC_FONT_PATH = path.resolve(__dirname, "..", "..", "assets", "fonts", "NotoSansArabic-VF.ttf");
const LINE_COLUMNS = Object.freeze([
  ["code", "Code"], ["description", "Description"], ["category", "Category"], ["direction", "Direction"],
  ["currency", "Currency"], ["amount", "Original amount"], ["exchangeRate", "Exchange rate"], ["baseAmount", "Base amount"], ["generated", "Generated"]
]);

const REPORT_TRANSLATIONS = Object.freeze({
  "en-US": {
    title: "Interim Payment Certificate", field: "Field", value: "Value", report: "Report", locale: "Locale",
    certificate: "Certificate", lineItems: "Line Items", totals: "Totals", priceAdjustment: "Price Adjustment", integrity: "Integrity",
    certificateLineItems: "Certificate line items", certificateTotals: "Certificate totals", integrityTraceability: "Integrity and traceability", indexPriceAdjustment: "Index price adjustment", amount: "Amount",
    certificateNumber: "Certificate number", status: "Status", periodStart: "Period start", periodEnd: "Period end", applicationReference: "Application reference", certificateStandard: "Certificate standard", baseCurrency: "Base currency", issuedAt: "Issued at", issuedBy: "Issued by", predecessorCertificate: "Predecessor certificate", openingBalanceReason: "Opening balance reason", remarks: "Remarks",
    certificateSchema: "Certificate schema", settingsVersion: "Settings version", settingsSchema: "Settings schema", settingsChecksum: "Settings SHA-256", inputChecksum: "Input SHA-256", resultChecksum: "Result SHA-256", issueChecksum: "Issue SHA-256", predecessorIssueChecksum: "Predecessor issue SHA-256", voidChecksum: "Void SHA-256",
    yes: "Yes", no: "No", issued: "Issued", voided: "Voided", addition: "Addition", deduction: "Deduction", work: "Work", priceAdjustmentCategory: "Price adjustment",
    code: "Code", description: "Description", category: "Category", direction: "Direction", currency: "Currency", originalAmount: "Original amount", exchangeRate: "Exchange rate", baseAmount: "Base amount", generated: "Generated",
    previousRetention: "Previous retention", currentRetention: "Current retention", retentionRelease: "Retention release", previousCumulativeCertified: "Previous cumulative certified", grossCertified: "Gross certified", lineDeductions: "Line deductions", totalDeductions: "Total deductions", netCertified: "Net certified", payableNow: "Payable now", carriedForward: "Carried forward", cumulativeCertified: "Cumulative certified",
    enabled: "Enabled", formula: "Formula", eligibleAmount: "Eligible amount", factor: "Factor", adjustment: "Adjustment", components: "Components", baseIndex: "Base index", currentIndex: "Current index", ratio: "Ratio", weightedIndex: "Weighted index"
  },
  "zh-CN": {
    title: "期中付款证书", field: "字段", value: "值", report: "报表", locale: "语言",
    certificate: "付款证书", lineItems: "计价明细", totals: "金额汇总", priceAdjustment: "价格调整", integrity: "完整性校验",
    certificateLineItems: "证书计价明细", certificateTotals: "证书金额汇总", integrityTraceability: "完整性与追溯", indexPriceAdjustment: "指数价格调整", amount: "金额",
    certificateNumber: "证书编号", status: "状态", periodStart: "计量开始", periodEnd: "计量结束", applicationReference: "申请编号", certificateStandard: "证书标准", baseCurrency: "基础币种", issuedAt: "签发时间", issuedBy: "签发人", predecessorCertificate: "前序证书", openingBalanceReason: "开账余额原因", remarks: "备注",
    certificateSchema: "证书结构版本", settingsVersion: "参数版本", settingsSchema: "参数结构版本", settingsChecksum: "参数 SHA-256", inputChecksum: "输入 SHA-256", resultChecksum: "结果 SHA-256", issueChecksum: "签发 SHA-256", predecessorIssueChecksum: "前序签发 SHA-256", voidChecksum: "作废 SHA-256",
    yes: "是", no: "否", issued: "已签发", voided: "已作废", addition: "增加", deduction: "扣减", work: "工程计价", priceAdjustmentCategory: "价格调整",
    code: "编码", description: "说明", category: "类别", direction: "方向", currency: "币种", originalAmount: "原币金额", exchangeRate: "汇率", baseAmount: "本币金额", generated: "系统生成",
    previousRetention: "上期保留金", currentRetention: "本期保留金", retentionRelease: "本期释放保留金", previousCumulativeCertified: "上期累计签证额", grossCertified: "签证总额", lineDeductions: "明细扣减", totalDeductions: "扣减合计", netCertified: "净签证额", payableNow: "本期应付", carriedForward: "结转金额", cumulativeCertified: "累计签证额",
    enabled: "已启用", formula: "公式", eligibleAmount: "可调金额", factor: "调整系数", adjustment: "调整金额", components: "组成项", baseIndex: "基期指数", currentIndex: "现期指数", ratio: "指数比", weightedIndex: "加权指数"
  },
  "es-ES": {
    title: "Certificado de Pago Provisional", field: "Campo", value: "Valor", report: "Informe", locale: "Idioma",
    certificate: "Certificado", lineItems: "Partidas", totals: "Totales", priceAdjustment: "Ajuste de precios", integrity: "Integridad",
    certificateLineItems: "Partidas del certificado", certificateTotals: "Totales del certificado", integrityTraceability: "Integridad y trazabilidad", indexPriceAdjustment: "Ajuste de precios por índices", amount: "Importe",
    certificateNumber: "Número de certificado", status: "Estado", periodStart: "Inicio del período", periodEnd: "Fin del período", applicationReference: "Referencia de solicitud", certificateStandard: "Norma del certificado", baseCurrency: "Moneda base", issuedAt: "Fecha de emisión", issuedBy: "Emitido por", predecessorCertificate: "Certificado anterior", openingBalanceReason: "Motivo del saldo inicial", remarks: "Observaciones",
    certificateSchema: "Esquema del certificado", settingsVersion: "Versión de parámetros", settingsSchema: "Esquema de parámetros", settingsChecksum: "SHA-256 de parámetros", inputChecksum: "SHA-256 de entrada", resultChecksum: "SHA-256 del resultado", issueChecksum: "SHA-256 de emisión", predecessorIssueChecksum: "SHA-256 de emisión anterior", voidChecksum: "SHA-256 de anulación",
    yes: "Sí", no: "No", issued: "Emitido", voided: "Anulado", addition: "Adición", deduction: "Deducción", work: "Obra", priceAdjustmentCategory: "Ajuste de precios",
    code: "Código", description: "Descripción", category: "Categoría", direction: "Dirección", currency: "Moneda", originalAmount: "Importe original", exchangeRate: "Tipo de cambio", baseAmount: "Importe base", generated: "Generado",
    previousRetention: "Retención anterior", currentRetention: "Retención actual", retentionRelease: "Liberación de retención", previousCumulativeCertified: "Certificado acumulado anterior", grossCertified: "Bruto certificado", lineDeductions: "Deducciones de partidas", totalDeductions: "Deducciones totales", netCertified: "Neto certificado", payableNow: "Pagadero ahora", carriedForward: "Saldo trasladado", cumulativeCertified: "Certificado acumulado",
    enabled: "Activado", formula: "Fórmula", eligibleAmount: "Importe ajustable", factor: "Factor", adjustment: "Ajuste", components: "Componentes", baseIndex: "Índice base", currentIndex: "Índice actual", ratio: "Relación", weightedIndex: "Índice ponderado"
  },
  "fr-FR": {
    title: "Certificat de Paiement Provisoire", field: "Champ", value: "Valeur", report: "Rapport", locale: "Langue",
    certificate: "Certificat", lineItems: "Postes", totals: "Totaux", priceAdjustment: "Révision des prix", integrity: "Intégrité",
    certificateLineItems: "Postes du certificat", certificateTotals: "Totaux du certificat", integrityTraceability: "Intégrité et traçabilité", indexPriceAdjustment: "Révision des prix par indices", amount: "Montant",
    certificateNumber: "Numéro du certificat", status: "Statut", periodStart: "Début de période", periodEnd: "Fin de période", applicationReference: "Référence de la demande", certificateStandard: "Norme du certificat", baseCurrency: "Devise de base", issuedAt: "Date d'émission", issuedBy: "Émis par", predecessorCertificate: "Certificat précédent", openingBalanceReason: "Motif du solde d'ouverture", remarks: "Observations",
    certificateSchema: "Schéma du certificat", settingsVersion: "Version des paramètres", settingsSchema: "Schéma des paramètres", settingsChecksum: "SHA-256 des paramètres", inputChecksum: "SHA-256 des entrées", resultChecksum: "SHA-256 du résultat", issueChecksum: "SHA-256 de l'émission", predecessorIssueChecksum: "SHA-256 de l'émission précédente", voidChecksum: "SHA-256 de l'annulation",
    yes: "Oui", no: "Non", issued: "Émis", voided: "Annulé", addition: "Ajout", deduction: "Déduction", work: "Travaux", priceAdjustmentCategory: "Révision des prix",
    code: "Code", description: "Description", category: "Catégorie", direction: "Sens", currency: "Devise", originalAmount: "Montant d'origine", exchangeRate: "Taux de change", baseAmount: "Montant de base", generated: "Généré",
    previousRetention: "Retenue précédente", currentRetention: "Retenue actuelle", retentionRelease: "Libération de retenue", previousCumulativeCertified: "Cumul certifié précédent", grossCertified: "Montant brut certifié", lineDeductions: "Déductions des postes", totalDeductions: "Total des déductions", netCertified: "Montant net certifié", payableNow: "Montant payable", carriedForward: "Report", cumulativeCertified: "Cumul certifié",
    enabled: "Activé", formula: "Formule", eligibleAmount: "Montant révisable", factor: "Facteur", adjustment: "Révision", components: "Composantes", baseIndex: "Indice de base", currentIndex: "Indice courant", ratio: "Rapport", weightedIndex: "Indice pondéré"
  },
  "pt-BR": {
    title: "Certificado de Pagamento Provisório", field: "Campo", value: "Valor", report: "Relatório", locale: "Idioma",
    certificate: "Certificado", lineItems: "Itens", totals: "Totais", priceAdjustment: "Reajuste de preços", integrity: "Integridade",
    certificateLineItems: "Itens do certificado", certificateTotals: "Totais do certificado", integrityTraceability: "Integridade e rastreabilidade", indexPriceAdjustment: "Reajuste de preços por índices", amount: "Valor",
    certificateNumber: "Número do certificado", status: "Status", periodStart: "Início do período", periodEnd: "Fim do período", applicationReference: "Referência da solicitação", certificateStandard: "Padrão do certificado", baseCurrency: "Moeda base", issuedAt: "Emitido em", issuedBy: "Emitido por", predecessorCertificate: "Certificado anterior", openingBalanceReason: "Motivo do saldo inicial", remarks: "Observações",
    certificateSchema: "Esquema do certificado", settingsVersion: "Versão dos parâmetros", settingsSchema: "Esquema dos parâmetros", settingsChecksum: "SHA-256 dos parâmetros", inputChecksum: "SHA-256 da entrada", resultChecksum: "SHA-256 do resultado", issueChecksum: "SHA-256 da emissão", predecessorIssueChecksum: "SHA-256 da emissão anterior", voidChecksum: "SHA-256 da anulação",
    yes: "Sim", no: "Não", issued: "Emitido", voided: "Anulado", addition: "Adição", deduction: "Dedução", work: "Obra", priceAdjustmentCategory: "Reajuste de preços",
    code: "Código", description: "Descrição", category: "Categoria", direction: "Direção", currency: "Moeda", originalAmount: "Valor original", exchangeRate: "Taxa de câmbio", baseAmount: "Valor base", generated: "Gerado",
    previousRetention: "Retenção anterior", currentRetention: "Retenção atual", retentionRelease: "Liberação de retenção", previousCumulativeCertified: "Certificado acumulado anterior", grossCertified: "Bruto certificado", lineDeductions: "Deduções dos itens", totalDeductions: "Deduções totais", netCertified: "Líquido certificado", payableNow: "Valor a pagar", carriedForward: "Saldo transferido", cumulativeCertified: "Certificado acumulado",
    enabled: "Ativado", formula: "Fórmula", eligibleAmount: "Valor reajustável", factor: "Fator", adjustment: "Reajuste", components: "Componentes", baseIndex: "Índice base", currentIndex: "Índice atual", ratio: "Razão", weightedIndex: "Índice ponderado"
  },
  "ar-SA": {
    title: "شهادة دفعة مرحلية", field: "الحقل", value: "القيمة", report: "التقرير", locale: "اللغة",
    certificate: "الشهادة", lineItems: "بنود الدفع", totals: "الإجماليات", priceAdjustment: "تعديل الأسعار", integrity: "سلامة البيانات",
    certificateLineItems: "بنود شهادة الدفع", certificateTotals: "إجماليات الشهادة", integrityTraceability: "سلامة البيانات والتتبع", indexPriceAdjustment: "تعديل الأسعار بالمؤشرات", amount: "المبلغ",
    certificateNumber: "رقم الشهادة", status: "الحالة", periodStart: "بداية الفترة", periodEnd: "نهاية الفترة", applicationReference: "مرجع الطلب", certificateStandard: "معيار الشهادة", baseCurrency: "العملة الأساسية", issuedAt: "تاريخ الإصدار", issuedBy: "أصدرها", predecessorCertificate: "الشهادة السابقة", openingBalanceReason: "سبب الرصيد الافتتاحي", remarks: "ملاحظات",
    certificateSchema: "إصدار بنية الشهادة", settingsVersion: "إصدار الإعدادات", settingsSchema: "بنية الإعدادات", settingsChecksum: "SHA-256 للإعدادات", inputChecksum: "SHA-256 للمدخلات", resultChecksum: "SHA-256 للنتيجة", issueChecksum: "SHA-256 للإصدار", predecessorIssueChecksum: "SHA-256 للإصدار السابق", voidChecksum: "SHA-256 للإلغاء",
    yes: "نعم", no: "لا", issued: "صادرة", voided: "ملغاة", addition: "إضافة", deduction: "خصم", work: "أعمال", priceAdjustmentCategory: "تعديل الأسعار",
    code: "الرمز", description: "الوصف", category: "الفئة", direction: "الاتجاه", currency: "العملة", originalAmount: "المبلغ الأصلي", exchangeRate: "سعر الصرف", baseAmount: "المبلغ الأساسي", generated: "مولد آليا",
    previousRetention: "الاستبقاء السابق", currentRetention: "الاستبقاء الحالي", retentionRelease: "إفراج الاستبقاء", previousCumulativeCertified: "المعتمد التراكمي السابق", grossCertified: "الإجمالي المعتمد", lineDeductions: "خصومات البنود", totalDeductions: "إجمالي الخصومات", netCertified: "الصافي المعتمد", payableNow: "المستحق الآن", carriedForward: "الرصيد المرحل", cumulativeCertified: "المعتمد التراكمي",
    enabled: "مفعل", formula: "المعادلة", eligibleAmount: "المبلغ القابل للتعديل", factor: "المعامل", adjustment: "التعديل", components: "المكونات", baseIndex: "مؤشر الأساس", currentIndex: "المؤشر الحالي", ratio: "النسبة", weightedIndex: "المؤشر المرجح"
  }
});

function reportTranslations(locale) {
  const code = Object.prototype.hasOwnProperty.call(REPORT_TRANSLATIONS, locale) ? locale : "en-US";
  return { ...REPORT_TRANSLATIONS["en-US"], ...REPORT_TRANSLATIONS[code] };
}

function reportText(locale, key) {
  return reportTranslations(locale)[key] || String(key);
}

function text(value) {
  return String(value ?? "").trim();
}

function rowsFromObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).map(([key, item]) => [key, text(item)]);
}

function priceAdjustmentRows(value, translate = (key) => key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows = Object.entries(value).filter(([key]) => key !== "components").map(([key, item]) => [translate(key), text(item)]);
  const components = Array.isArray(value.components) ? value.components : [];
  components.forEach((component, index) => {
    const prefix = text(component.code) || `component-${index + 1}`;
    Object.entries(component).forEach(([key, item]) => rows.push([`${prefix}.${translate(key)}`, text(item)]));
  });
  return rows;
}

function certificateModel(source) {
  const record = certificateRegister.certificateView(source);
  const result = record.calculationResult;
  const locale = text(result.locale || "en-US");
  const t = (key) => reportText(locale, key);
  const totals = rowsFromObject(result.totals).map(([key, value]) => [t(key), value]);
  const translatedValue = (key, value) => key === "generated" ? t(value ? "yes" : "no") : (["category", "direction"].includes(key) ? t(value === "priceAdjustment" ? "priceAdjustmentCategory" : value) : text(value));
  const lines = Array.isArray(result.lines) ? result.lines.map((line) => Object.fromEntries(LINE_COLUMNS.map(([key]) => [key, translatedValue(key, line[key])]))) : [];
  const priceAdjustment = result.priceAdjustment && result.priceAdjustment.enabled ? result.priceAdjustment : null;
  return {
    title: `${t("title")} ${record.certificateNo}`,
    locale,
    direction: locale === "ar-SA" ? "rtl" : "ltr",
    labels: reportTranslations(locale),
    columns: LINE_COLUMNS.map(([key]) => [key, t(key === "amount" ? "originalAmount" : key)]),
    record,
    metadata: [
      [t("certificateNumber"), record.certificateNo], [t("status"), t(record.status)], [t("periodStart"), record.periodStart], [t("periodEnd"), record.periodEnd],
      [t("applicationReference"), record.applicationReference], [t("certificateStandard"), record.certificateStandard], [t("baseCurrency"), record.baseCurrency],
      [t("issuedAt"), record.issuedAt], [t("issuedBy"), record.issuedBy], [t("predecessorCertificate"), record.predecessorCertificateId || "-"],
      [t("openingBalanceReason"), record.openingBalanceReason || "-"], [t("remarks"), record.remarks || "-"]
    ],
    lines,
    totals,
    priceAdjustment,
    integrity: [
      [t("certificateSchema"), record.schemaVersion], [t("settingsVersion"), record.settingsVersion], [t("settingsSchema"), record.settingsSchemaVersion],
      [t("settingsChecksum"), record.settingsChecksum], [t("inputChecksum"), record.calculationInputChecksum], [t("resultChecksum"), record.calculationResultChecksum],
      [t("issueChecksum"), record.issueChecksum], [t("predecessorIssueChecksum"), record.predecessorIssueChecksum || "-"], [t("voidChecksum"), record.voidChecksum || "-"]
    ]
  };
}

function styleSheet(sheet, widths, rtl = false) {
  sheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: rtl }];
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

function addPairsSheet(workbook, name, rows, labels, rtl) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow([labels.field, labels.value]);
  rows.forEach((row) => sheet.addRow(row));
  styleSheet(sheet, [30, 88], rtl);
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
  const rtl = model.direction === "rtl";
  addPairsSheet(workbook, model.labels.certificate, [[model.labels.report, model.title], [model.labels.locale, model.locale], ...model.metadata], model.labels, rtl);
  const lines = workbook.addWorksheet(model.labels.lineItems);
  lines.addRow(model.columns.map(([, label]) => label));
  model.lines.forEach((line) => lines.addRow(model.columns.map(([key]) => line[key])));
  styleSheet(lines, [18, 34, 22, 14, 12, 18, 18, 18, 12], rtl);
  lines.autoFilter = { from: "A1", to: `I${Math.max(1, model.lines.length + 1)}` };
  addPairsSheet(workbook, model.labels.totals, model.totals, model.labels, rtl);
  if (model.priceAdjustment) addPairsSheet(workbook, model.labels.priceAdjustment, priceAdjustmentRows(model.priceAdjustment, (key) => model.labels[key] || key), model.labels, rtl);
  addPairsSheet(workbook, model.labels.integrity, model.integrity, model.labels, rtl);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function wordCell(value, header = false, rtl = false) {
  return new TableCell({
    shading: header ? { fill: "075985" } : undefined,
    margins: { top: 70, bottom: 70, left: 80, right: 80 },
    children: [new Paragraph({ bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: text(value), bold: header, color: header ? "FFFFFF" : "0F172A", font: "Arial", size: 18 })] })]
  });
}

function wordTable(headers, rows, rtl = false) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: headers.map((value) => wordCell(value, true, rtl)) }), ...rows.map((row) => new TableRow({ children: row.map((value) => wordCell(value, false, rtl)) }))],
    borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((key) => [key, { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" }]))
  });
}

function heading(value, rtl = false) {
  return new Paragraph({ bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { before: 220, after: 100 }, children: [new TextRun({ text: value, bold: true, size: 24, color: "075985", font: "Arial" })] });
}

async function createDocx(source) {
  const model = certificateModel(source);
  const rtl = model.direction === "rtl";
  const sections = [
    new Paragraph({ bidirectional: rtl, alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: model.title, bold: true, size: 32, font: "Arial", color: "0F172A" })] }),
    wordTable([model.labels.field, model.labels.value], [[model.labels.locale, model.locale], ...model.metadata], rtl),
    heading(model.labels.certificateLineItems, rtl),
    wordTable(model.columns.map(([, label]) => label), model.lines.map((line) => model.columns.map(([key]) => line[key])), rtl),
    heading(model.labels.certificateTotals, rtl), wordTable([model.labels.totals, `${model.labels.amount} (${model.record.baseCurrency})`], model.totals, rtl),
    heading(model.labels.integrityTraceability, rtl), wordTable([model.labels.field, model.labels.value], model.integrity, rtl)
  ];
  if (model.priceAdjustment) sections.splice(sections.length - 2, 0, heading(model.labels.indexPriceAdjustment, rtl), wordTable([model.labels.field, model.labels.value], priceAdjustmentRows(model.priceAdjustment, (key) => model.labels[key] || key), rtl));
  const document = new Document({
    creator: "Engineering Payment Platform",
    title: model.title,
    description: `Immutable certificate ${model.record.issueChecksum}`,
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 480, right: 360, bottom: 480, left: 360 } } }, children: sections }]
  });
  return Packer.toBuffer(document);
}

function pdfTable(doc, headingText, rows, rtl = false) {
  const align = rtl ? "right" : "left";
  doc.fillColor("#075985").fontSize(12).text(headingText, { underline: true, align });
  doc.moveDown(0.35).fillColor("#0f172a").fontSize(8.5);
  rows.forEach(([label, value]) => {
    if (doc.y > doc.page.height - 55) doc.addPage();
    if (!rtl) {
      doc.fillColor("#0f172a").text(`${text(label)}: ${text(value)}`, { align });
      return;
    }
    const x = doc.page.margins.left;
    const available = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gap = 10;
    const labelWidth = Math.min(150, available * 0.32);
    const valueWidth = available - labelWidth - gap;
    const labelOptions = { width: labelWidth, align: "right" };
    const valueOptions = { width: valueWidth, align: "right" };
    const rowHeight = Math.max(doc.heightOfString(text(label), labelOptions), doc.heightOfString(text(value), valueOptions));
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const rowY = doc.y;
    doc.fillColor("#475569").text(text(label), x + valueWidth + gap, rowY, labelOptions);
    doc.fillColor("#0f172a").text(text(value), x, rowY, valueOptions);
    doc.y = rowY + rowHeight + 3;
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
    const rtl = model.direction === "rtl";
    doc.registerFont("Report", rtl ? PDF_ARABIC_FONT_PATH : PDF_FONT_PATH).font("Report");
    doc.fillColor("#0f172a").fontSize(17).text(rtl ? model.labels.title : model.title, { align: "center" });
    if (rtl) doc.fontSize(11).text(model.record.certificateNo, { align: "center" });
    doc.moveDown();
    pdfTable(doc, model.labels.certificate, [[model.labels.locale, model.locale], ...model.metadata], rtl);
    pdfTable(doc, model.labels.certificateLineItems, model.lines.map((line) => [line.code, rtl ? `${line.description}\n${line.category} | ${line.direction}\n${line.amount} ${line.currency} = ${line.baseAmount} ${model.record.baseCurrency}` : `${line.description} | ${line.category} | ${line.direction} | ${line.amount} ${line.currency} = ${line.baseAmount} ${model.record.baseCurrency}`]), rtl);
    pdfTable(doc, model.labels.certificateTotals, model.totals, rtl);
    if (model.priceAdjustment) pdfTable(doc, model.labels.indexPriceAdjustment, priceAdjustmentRows(model.priceAdjustment, (key) => model.labels[key] || key), rtl);
    pdfTable(doc, model.labels.integrityTraceability, model.integrity, rtl);
    doc.end();
  });
}

module.exports = { LINE_COLUMNS, REPORT_TRANSLATIONS, certificateModel, createDocx, createPdf, createXlsx, priceAdjustmentRows, reportText, reportTranslations, rowsFromObject, text };
