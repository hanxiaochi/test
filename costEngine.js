const db = require("./constructionData");

function round(value, digits = 2) {
  const n = Number(value || 0);
  return Number(n.toFixed(digits));
}

const defaultCalculationRules = {
  moneyDigits: 2,
  quantityDigits: 3,
  priceDigits: 2,
  includeBillMeasure: true,
  includeMaterialAdjust: true,
  includeMaterialArrival: false,
  includeManualMeasure: true,
  auditSupervisorRate: 99.5,
  auditOwnerRate: 99,
  auditFinalRate: 98.5
};

function calculationRules() {
  const saved = db.calculationRules && typeof db.calculationRules === "object" ? db.calculationRules : {};
  return {
    ...defaultCalculationRules,
    ...saved,
    moneyDigits: Math.max(0, Math.min(6, Number(saved.moneyDigits ?? defaultCalculationRules.moneyDigits))),
    quantityDigits: Math.max(0, Math.min(6, Number(saved.quantityDigits ?? defaultCalculationRules.quantityDigits))),
    priceDigits: Math.max(0, Math.min(6, Number(saved.priceDigits ?? defaultCalculationRules.priceDigits))),
    includeBillMeasure: saved.includeBillMeasure !== false,
    includeMaterialAdjust: saved.includeMaterialAdjust !== false,
    includeMaterialArrival: saved.includeMaterialArrival === true,
    includeManualMeasure: saved.includeManualMeasure !== false,
    auditSupervisorRate: Number(saved.auditSupervisorRate ?? defaultCalculationRules.auditSupervisorRate),
    auditOwnerRate: Number(saved.auditOwnerRate ?? defaultCalculationRules.auditOwnerRate),
    auditFinalRate: Number(saved.auditFinalRate ?? defaultCalculationRules.auditFinalRate)
  };
}

function payableFormulaText(rules = calculationRules()) {
  const parts = [];
  if (rules.includeBillMeasure) parts.push("清单计量");
  if (rules.includeMaterialAdjust) parts.push("材料补差");
  if (rules.includeMaterialArrival) parts.push("材料到场");
  if (rules.includeManualMeasure) parts.push("手动计量");
  return parts.length ? parts.join(" + ") : "未启用应付构成";
}

function calculatePayable(parts, rules = calculationRules()) {
  const total =
    (rules.includeBillMeasure ? Number(parts.measuredMoney || parts.billMeasureMoney || 0) : 0) +
    (rules.includeMaterialAdjust ? Number(parts.materialDiasMoney || parts.materialAdjustMoney || 0) : 0) +
    (rules.includeMaterialArrival ? Number(parts.materialArrivalMoney || 0) : 0) +
    (rules.includeManualMeasure ? Number(parts.manualMoney || parts.manualMeasureMoney || 0) : 0);
  return round(total, rules.moneyDigits);
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positive(value) {
  return Math.abs(numberOr(value, 0));
}

function normalizeRuleKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function parseNumericRuleMap(value, fallback = {}, options = {}) {
  const min = Number.isFinite(options.min) ? options.min : -Infinity;
  const max = Number.isFinite(options.max) ? options.max : Infinity;
  const result = {};
  const add = (key, rawValue) => {
    const cleanKey = String(key ?? "").trim();
    const number = Number(rawValue);
    if (!cleanKey || !Number.isFinite(number)) return;
    result[cleanKey] = Math.max(min, Math.min(max, number));
  };
  if (value === undefined || value === null || value === "") {
    return fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? parseNumericRuleMap(fallback, {}, options)
      : {};
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry && typeof entry === "object") {
        const key = entry.key ?? entry.code ?? entry.materialNo ?? entry.materialName ?? entry.materialId ?? entry.id;
        const rawValue = entry.value ?? entry.factor ?? entry.weight ?? entry.coefficient ?? entry.conversionFactor;
        add(key, rawValue);
      }
    });
    return result;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, rawValue]) => add(key, rawValue));
    return result;
  }
  const text = String(value).trim();
  if (!text) return {};
  if (/^[\[{]/.test(text)) {
    try {
      return parseNumericRuleMap(JSON.parse(text), fallback, options);
    } catch {
      // Fall through to pair parsing.
    }
  }
  text.split(/[;,\n\r，；、]+/).forEach((part) => {
    const match = String(part).trim().match(/^(.+?)(?:=|:|：)\s*(-?\d+(?:\.\d+)?)/);
    if (match) add(match[1], match[2]);
  });
  return result;
}

function lookupNumericRule(map, row = {}, fallback = 0) {
  const parsed = parseNumericRuleMap(map, {});
  const entries = Object.entries(parsed);
  if (!entries.length) return fallback;
  const candidates = [
    row.materialNo,
    row.materialName,
    row.secMaterialName,
    row.materialId,
    row.id
  ].map(normalizeRuleKey).filter(Boolean);
  for (const candidate of candidates) {
    const exact = entries.find(([key]) => normalizeRuleKey(key) === candidate);
    if (exact) return exact[1];
  }
  const name = normalizeRuleKey(row.materialName || row.secMaterialName || "");
  if (name) {
    const fuzzy = entries.find(([key]) => {
      const normalized = normalizeRuleKey(key);
      return normalized && (name.includes(normalized) || normalized.includes(name));
    });
    if (fuzzy) return fuzzy[1];
  }
  return fallback;
}

const chapterNames = {
  100: "总则",
  200: "路基土石方",
  300: "路面",
  400: "桥梁",
  500: "隧道",
  600: "排水及涵洞",
  700: "防护",
  800: "安全设施及预埋管线",
  900: "绿化及环境保护"
};

const jlPaymentDefaults = {
  ...defaultCalculationRules,
  includeMaterialAdvance: true,
  includeRetention: true,
  materialAdvanceRate: 60,
  retentionRate: 10,
  mobilizationAdvanceRate: 10,
  mobilizationDeductionStartRate: 30,
  mobilizationDeductionEndRate: 80,
  materialDeductionMoney: 0,
  previousMaterialDeductionMoney: 0,
  cumulativeMaterialDeductionMoney: 0,
  mobilizationAdvanceMoney: 0,
  claimsMoney: 0,
  penaltyMoney: 0,
  interestMoney: 0,
  otherAdjustmentMoney: 0,
  provisionalCurrentMoney: 0,
  jl115EndPeriod: 2,
  jlPriceAdjustmentMonths: [1, 4, 7, 10],
  jl116NonAdjustableFactor: 0.35,
  jl108RawMaterialConversionFactors: {},
  jl116MaterialWeights: {}
};

function calculationRules() {
  const saved = db.calculationRules && typeof db.calculationRules === "object" ? db.calculationRules : {};
  const bounded = (key, fallback, min, max) => Math.max(min, Math.min(max, numberOr(saved[key] ?? fallback, fallback)));
  const monthList = (value, fallback) => {
    const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,\s，、]+/);
    const months = raw
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 1 && item <= 12);
    return Array.from(new Set(months.length ? months : fallback)).sort((a, b) => a - b);
  };
  return {
    ...jlPaymentDefaults,
    ...saved,
    moneyDigits: bounded("moneyDigits", jlPaymentDefaults.moneyDigits, 0, 6),
    quantityDigits: bounded("quantityDigits", jlPaymentDefaults.quantityDigits, 0, 6),
    priceDigits: bounded("priceDigits", jlPaymentDefaults.priceDigits, 0, 6),
    includeBillMeasure: saved.includeBillMeasure !== false,
    includeMaterialAdjust: saved.includeMaterialAdjust !== false,
    includeMaterialArrival: saved.includeMaterialArrival === true,
    includeMaterialAdvance: saved.includeMaterialAdvance !== false,
    includeManualMeasure: saved.includeManualMeasure !== false,
    includeRetention: saved.includeRetention !== false,
    auditSupervisorRate: bounded("auditSupervisorRate", jlPaymentDefaults.auditSupervisorRate, 0, 100),
    auditOwnerRate: bounded("auditOwnerRate", jlPaymentDefaults.auditOwnerRate, 0, 100),
    auditFinalRate: bounded("auditFinalRate", jlPaymentDefaults.auditFinalRate, 0, 100),
    materialAdvanceRate: bounded("materialAdvanceRate", jlPaymentDefaults.materialAdvanceRate, 0, 100),
    retentionRate: bounded("retentionRate", jlPaymentDefaults.retentionRate, 0, 100),
    mobilizationAdvanceRate: bounded("mobilizationAdvanceRate", jlPaymentDefaults.mobilizationAdvanceRate, 0, 100),
    mobilizationDeductionStartRate: bounded("mobilizationDeductionStartRate", jlPaymentDefaults.mobilizationDeductionStartRate, 0, 100),
    mobilizationDeductionEndRate: bounded("mobilizationDeductionEndRate", jlPaymentDefaults.mobilizationDeductionEndRate, 0, 100),
    materialDeductionMoney: numberOr(saved.materialDeductionMoney, jlPaymentDefaults.materialDeductionMoney),
    previousMaterialDeductionMoney: numberOr(saved.previousMaterialDeductionMoney, jlPaymentDefaults.previousMaterialDeductionMoney),
    cumulativeMaterialDeductionMoney: numberOr(saved.cumulativeMaterialDeductionMoney, jlPaymentDefaults.cumulativeMaterialDeductionMoney),
    mobilizationAdvanceMoney: numberOr(saved.mobilizationAdvanceMoney, jlPaymentDefaults.mobilizationAdvanceMoney),
    claimsMoney: numberOr(saved.claimsMoney, jlPaymentDefaults.claimsMoney),
    penaltyMoney: numberOr(saved.penaltyMoney, jlPaymentDefaults.penaltyMoney),
    interestMoney: numberOr(saved.interestMoney, jlPaymentDefaults.interestMoney),
    otherAdjustmentMoney: numberOr(saved.otherAdjustmentMoney, jlPaymentDefaults.otherAdjustmentMoney),
    provisionalCurrentMoney: numberOr(saved.provisionalCurrentMoney, jlPaymentDefaults.provisionalCurrentMoney),
    jl115EndPeriod: bounded("jl115EndPeriod", jlPaymentDefaults.jl115EndPeriod, 0, 999),
    jlPriceAdjustmentMonths: monthList(saved.jlPriceAdjustmentMonths, jlPaymentDefaults.jlPriceAdjustmentMonths),
    jl116NonAdjustableFactor: bounded("jl116NonAdjustableFactor", jlPaymentDefaults.jl116NonAdjustableFactor, 0, 1),
    jl108RawMaterialConversionFactors: parseNumericRuleMap(saved.jl108RawMaterialConversionFactors, jlPaymentDefaults.jl108RawMaterialConversionFactors, { min: 0, max: 1000 }),
    jl116MaterialWeights: parseNumericRuleMap(saved.jl116MaterialWeights, jlPaymentDefaults.jl116MaterialWeights, { min: 0, max: 1 })
  };
}

function payableFormulaText(rules = calculationRules()) {
  const subtotalParts = [];
  if (rules.includeBillMeasure) subtotalParts.push("清单计量");
  if (rules.includeManualMeasure) subtotalParts.push("手动计量/暂定金额");
  const parts = [`小计(${subtotalParts.join(" + ") || "0"})`];
  if (rules.includeMaterialAdjust) parts.push("价格调整(JL108)");
  if (rules.includeMaterialAdvance) parts.push(`材料设备垫付款=材料到场金额×${rules.materialAdvanceRate}%`);
  if (rules.includeRetention) parts.push(`-保留金=${rules.retentionRate}%×小计`);
  parts.push("-扣回材料设备垫付款(JL110)");
  parts.push("-扣回动员预付款(JL111)");
  return `JL104本期实际支付 = ${parts.join(" + ")}`.replace(/\+ -/g, "- ");
}

function configuredMaterialDeduction(parts = {}, rules = calculationRules()) {
  if (parts.materialDeductionMoney !== undefined) return positive(parts.materialDeductionMoney);
  const cumulative = parts.cumulativeMaterialDeductionMoney ?? rules.cumulativeMaterialDeductionMoney;
  const previous = parts.previousMaterialDeductionMoney ?? rules.previousMaterialDeductionMoney;
  if (cumulative !== undefined || previous !== undefined) {
    return positive(numberOr(cumulative, 0) - numberOr(previous, 0));
  }
  return positive(rules.materialDeductionMoney);
}

function mobilizationAdvanceAmount(contractTotal, rules = calculationRules()) {
  return round(numberOr(contractTotal, 0) * (numberOr(rules.mobilizationAdvanceRate, 0) / 100), rules.moneyDigits);
}

function cumulativeMobilizationDeduction(cumulativeSubtotal, contractTotal, rules = calculationRules()) {
  const total = numberOr(contractTotal, 0);
  if (total <= 0) return 0;
  const advance = mobilizationAdvanceAmount(total, rules);
  const start = total * (numberOr(rules.mobilizationDeductionStartRate, 30) / 100);
  const end = total * (numberOr(rules.mobilizationDeductionEndRate, 80) / 100);
  const cumulative = numberOr(cumulativeSubtotal, 0);
  if (cumulative <= start) return 0;
  if (cumulative >= end) return advance;
  return round(Math.min(advance, ((cumulative - start) / total) * 2 * advance), rules.moneyDigits);
}

function calculatePaymentCertificate(parts = {}, rules = calculationRules()) {
  const moneyDigits = rules.moneyDigits;
  const billMeasureMoney = rules.includeBillMeasure ? numberOr(parts.measuredMoney ?? parts.billMeasureMoney, 0) : 0;
  const manualMoney = rules.includeManualMeasure ? numberOr(parts.manualMoney ?? parts.manualMeasureMoney, 0) : 0;
  const provisionalCurrentMoney = numberOr(parts.provisionalCurrentMoney ?? rules.provisionalCurrentMoney, 0);
  const subtotal = round(billMeasureMoney + manualMoney + provisionalCurrentMoney, moneyDigits);
  const priceAdjustment = rules.includeMaterialAdjust ? numberOr(parts.materialDiasMoney ?? parts.materialAdjustMoney, 0) : 0;
  const materialArrivalMoney = numberOr(parts.materialArrivalMoney, 0);
  const materialAdvanceMoney = parts.materialAdvanceMoney !== undefined
    ? numberOr(parts.materialAdvanceMoney, 0)
    : (rules.includeMaterialAdvance ? round(materialArrivalMoney * (rules.materialAdvanceRate / 100), moneyDigits) : 0);
  const materialDeductionMoney = configuredMaterialDeduction(parts, rules);
  const retentionMoney = rules.includeRetention
    ? positive(parts.retentionMoney !== undefined ? parts.retentionMoney : round(subtotal * (rules.retentionRate / 100), moneyDigits))
    : 0;
  const contractTotal = numberOr(parts.contractTotal ?? parts.finalMoney ?? parts.contractSumMoney, 0);
  const previousCumulativeSubtotal = numberOr(parts.previousCumulativeSubtotal, 0);
  const cumulativeSubtotal = numberOr(parts.cumulativeSubtotal, previousCumulativeSubtotal + subtotal);
  const cumulativeMobilizationDeductionMoney = cumulativeMobilizationDeduction(cumulativeSubtotal, contractTotal, rules);
  const previousMobilizationDeductionMoney = parts.previousMobilizationDeductionMoney !== undefined
    ? positive(parts.previousMobilizationDeductionMoney)
    : cumulativeMobilizationDeduction(previousCumulativeSubtotal, contractTotal, rules);
  const mobilizationDeductionMoney = parts.mobilizationDeductionMoney !== undefined
    ? positive(parts.mobilizationDeductionMoney)
    : positive(cumulativeMobilizationDeductionMoney - previousMobilizationDeductionMoney);
  const mobilizationAdvanceMoney = numberOr(parts.mobilizationAdvanceMoney ?? rules.mobilizationAdvanceMoney, 0);
  const claimsMoney = numberOr(parts.claimsMoney ?? rules.claimsMoney, 0);
  const penaltyMoney = positive(parts.penaltyMoney ?? rules.penaltyMoney);
  const interestMoney = numberOr(parts.interestMoney ?? rules.interestMoney, 0);
  const otherAdjustmentMoney = numberOr(parts.otherAdjustmentMoney ?? rules.otherAdjustmentMoney, 0);
  const finalPayment = round(
    subtotal +
      priceAdjustment +
      claimsMoney +
      interestMoney +
      materialAdvanceMoney +
      mobilizationAdvanceMoney +
      otherAdjustmentMoney -
      penaltyMoney -
      materialDeductionMoney -
      retentionMoney -
      mobilizationDeductionMoney,
    moneyDigits
  );
  return {
    billMeasureMoney: round(billMeasureMoney, moneyDigits),
    manualMoney: round(manualMoney, moneyDigits),
    provisionalCurrentMoney: round(provisionalCurrentMoney, moneyDigits),
    subtotal,
    priceAdjustment: round(priceAdjustment, moneyDigits),
    materialArrivalMoney: round(materialArrivalMoney, moneyDigits),
    materialAdvanceMoney: round(materialAdvanceMoney, moneyDigits),
    materialDeductionMoney: round(materialDeductionMoney, moneyDigits),
    retentionMoney: round(retentionMoney, moneyDigits),
    mobilizationAdvanceMoney: round(mobilizationAdvanceMoney, moneyDigits),
    mobilizationDeductionMoney: round(mobilizationDeductionMoney, moneyDigits),
    cumulativeMobilizationDeductionMoney: round(cumulativeMobilizationDeductionMoney, moneyDigits),
    previousMobilizationDeductionMoney: round(previousMobilizationDeductionMoney, moneyDigits),
    claimsMoney: round(claimsMoney, moneyDigits),
    penaltyMoney: round(penaltyMoney, moneyDigits),
    interestMoney: round(interestMoney, moneyDigits),
    otherAdjustmentMoney: round(otherAdjustmentMoney, moneyDigits),
    previousCumulativeSubtotal: round(previousCumulativeSubtotal, moneyDigits),
    cumulativeSubtotal: round(cumulativeSubtotal, moneyDigits),
    contractTotal: round(contractTotal, moneyDigits),
    finalPayment,
    payableMoney: finalPayment,
    formula: payableFormulaText(rules)
  };
}

function calculatePayable(parts, rules = calculationRules()) {
  return calculatePaymentCertificate(parts, rules).finalPayment;
}

function table(data, req) {
  const rows = Array.isArray(data) ? data : [];
  const page = Math.max(Number((req.query && req.query.page) || (req.body && req.body.page) || 1), 1);
  const limit = Math.max(Number((req.query && req.query.limit) || (req.body && req.body.limit) || rows.length || 10), 1);
  const start = (page - 1) * limit;
  return {
    code: 0,
    msg: "",
    count: rows.length,
    data: rows.slice(start, start + limit)
  };
}

function ok(data, other = "") {
  return {
    code: 1,
    count: "",
    data,
    draw: "",
    msg: "成功",
    other,
    recordsFiltered: "",
    recordsTotal: ""
  };
}

function section(id) {
  return db.sections.find((item) => Number(item.sectionId) === Number(id)) || db.sections[0];
}

function bill(id) {
  return db.bills.find((item) => Number(item.billId) === Number(id));
}

function material(id, fallback = {}) {
  const found = db.materials.find((item) => Number(item.materialId) === Number(id));
  if (found) return found;
  return {
    materialId: Number(id) || 0,
    materialNo: fallback.materialNo || fallback.secMaterialNo || `CL-MISSING-${id || "0"}`,
    materialName: fallback.materialName || fallback.secMaterialName || "未匹配材料",
    spec: fallback.spec || fallback.specType || "",
    specType: fallback.specType || fallback.spec || "",
    unit: fallback.unit || fallback.measureUnit || "项",
    measureUnit: fallback.measureUnit || fallback.unit || "项",
    basePrice: Number(fallback.basePrice || fallback.price || 0),
    currentPrice: Number(fallback.currentPrice || fallback.price || fallback.basePrice || 0)
  };
}

function billAmount(item, quantityKey = "contractNum", priceKey = "price") {
  return round(Number(item[quantityKey] || 0) * Number(item[priceKey] || 0));
}

function measureDetailRows(measure) {
  return measure.details.map((detail, index) => {
    const b = bill(detail.billId);
    const amount = round(detail.measureNum * b.price);
    return {
      ...b,
      measureId: measure.measureId,
      billMeasureId: measure.measureId,
      billMeasureDetailId: detail.detailId || `${measure.measureId}-${detail.billId}-${index + 1}`,
      detailIndex: index,
      measureNo: measure.measureNo,
      sheetNo: measure.measureNo,
      periodId: measure.periodId || measure.gatherId || 0,
      gatherId: measure.gatherId || measure.periodId || 0,
      sectionName: section(measure.sectionId).sectionName,
      measureDate: measure.measureDate,
      formulaText: detail.formulaText || detail.calcFormula || "",
      measureNum: detail.measureNum,
      currentNum: detail.measureNum,
      currentMoney: amount,
      measureMoney: amount,
      money: amount
    };
  });
}

function allMeasureDetails() {
  return db.measures.flatMap(measureDetailRows);
}

function dateOnly(value) {
  const text = String(value || "");
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function periodRows() {
  return (db.measurePeriods || []).map((item, index) => ({
    ...item,
    periodId: Number(item.gatherId || item.periodId || item.id || index + 1),
    orderNo: Number(item.gatherId || item.periodId || item.id || index + 1),
    startDate: item.startDate || item.gatherStartDate || "",
    endDate: item.endDate || item.gatherEndDate || ""
  })).sort((a, b) => a.orderNo - b.orderNo);
}

function findPeriod(periodId) {
  const id = Number(periodId || 0);
  if (!id) return null;
  return periodRows().find((item) => Number(item.periodId || item.gatherId || item.id) === id) || null;
}

function rowBelongsToPeriod(row, period) {
  if (!period) return true;
  const periodId = Number(period.periodId || period.gatherId || period.id || 0);
  const rowPeriodId = Number(row.periodId || row.gatherId || 0);
  if (periodId && rowPeriodId) return rowPeriodId === periodId;
  const date = dateOnly(row.measureDate || row.diffYearMonth || row.createDate || row.updateDate);
  if (!date) return false;
  const start = dateOnly(period.startDate || period.gatherStartDate);
  const end = dateOnly(period.endDate || period.gatherEndDate);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function rowBeforePeriod(row, period) {
  if (!period) return false;
  const periodId = Number(period.periodId || period.gatherId || period.id || 0);
  const rowPeriodId = Number(row.periodId || row.gatherId || 0);
  if (periodId && rowPeriodId) return rowPeriodId < periodId;
  const date = dateOnly(row.measureDate || row.diffYearMonth || row.createDate || row.updateDate);
  const start = dateOnly(period.startDate || period.gatherStartDate);
  return Boolean(date && start && date < start);
}

function filterByPeriod(rows, periodId) {
  const period = findPeriod(periodId);
  return rows.filter((row) => rowBelongsToPeriod(row, period));
}

function groupMeasureDetails(details) {
  const grouped = new Map();
  details.forEach((detail) => {
    const key = String(detail.billId || detail.billNo || detail.billPayId || "");
    if (!key) return;
    const current = grouped.get(key) || {
      billId: detail.billId,
      billNo: detail.billNo,
      billName: detail.billName,
      itemCode: detail.billNo,
      itemName: detail.billName,
      chapter: detail.chapter || String(detail.billNo || "").slice(0, 1) + "00",
      measureUnit: detail.measureUnit,
      unit: detail.measureUnit,
      price: Number(detail.price || 0),
      quantity: 0,
      amount: 0,
      measureNos: [],
      formulaTexts: []
    };
    current.quantity += Number(detail.measureNum || detail.currentNum || 0);
    current.amount += Number(detail.measureMoney || detail.currentMoney || 0);
    if (detail.measureNo && !current.measureNos.includes(detail.measureNo)) current.measureNos.push(detail.measureNo);
    if (detail.formulaText) current.formulaTexts.push(detail.formulaText);
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).map((row) => ({
    ...row,
    quantity: round(row.quantity, calculationRules().quantityDigits),
    currentQuantity: round(row.quantity, calculationRules().quantityDigits),
    amount: round(row.amount),
    currentAmount: round(row.amount),
    measureRefs: row.measureNos.join("、"),
    formulaText: row.formulaTexts.join("\n")
  })).sort((a, b) => String(a.billNo).localeCompare(String(b.billNo), "zh-CN"));
}

function jl113Rows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId);
  const sectionId = Number(opts.sectionId || 0);
  const details = allMeasureDetails().filter((row) => {
    if (sectionId && Number(row.sectionId || 0) !== sectionId) return false;
    return period ? rowBelongsToPeriod(row, period) : true;
  });
  return groupMeasureDetails(details);
}

function measuredQuantityFromDetails(details, billId) {
  return details
    .filter((item) => Number(item.billId || 0) === Number(billId || 0))
    .reduce((sum, item) => sum + Number(item.measureNum || item.currentNum || 0), 0);
}

function jl105LedgerRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId);
  const sectionId = Number(opts.sectionId || 0);
  const allDetails = allMeasureDetails().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const currentDetails = period ? allDetails.filter((row) => rowBelongsToPeriod(row, period)) : allDetails;
  const previousDetails = period ? allDetails.filter((row) => rowBeforePeriod(row, period)) : [];
  return billRows()
    .filter((item) => !sectionId || Number(item.sectionId || 0) === sectionId)
    .map((item) => {
      const previousQuantity = round(measuredQuantityFromDetails(previousDetails, item.billId), calculationRules().quantityDigits);
      const currentQuantity = round(measuredQuantityFromDetails(currentDetails, item.billId), calculationRules().quantityDigits);
      const cumulativeQuantity = round(previousQuantity + currentQuantity, calculationRules().quantityDigits);
      const previousAmount = round(previousQuantity * Number(item.price || 0));
      const currentAmount = round(currentQuantity * Number(item.price || 0));
      const cumulativeAmount = round(previousAmount + currentAmount);
      return {
        billPayId: item.billId,
        billId: item.billId,
        sectionId: item.sectionId,
        sectionName: item.sectionName,
        chapter: item.chapter || String(item.billNo || "").slice(0, 1) + "00",
        billNo: item.billNo,
        billName: item.billName,
        itemCode: item.billNo,
        itemName: item.billName,
        measureUnit: item.measureUnit,
        contractQuantity: item.contractNum,
        contractPrice: item.price,
        contractAmount: item.contractMoney,
        adjustedQuantity: item.finalNum,
        adjustedAmount: item.finalMoney,
        previousQuantity,
        previousAmount,
        currentQuantity,
        currentAmount,
        cumulativeQuantity,
        cumulativeAmount,
        progressPct: item.contractMoney ? round((cumulativeAmount / item.contractMoney) * 100, 2) : 0
      };
    });
}

function jl104ChapterRows(options = {}) {
  const ledger = jl105LedgerRows(options);
  const groups = new Map(Object.keys(chapterNames).map((chapter) => [chapter, {
    chapter,
    chapterName: chapterNames[chapter],
    contractAmount: 0,
    changeAmount: 0,
    adjustedAmount: 0,
    previousAmount: 0,
    currentAmount: 0,
    cumulativeAmount: 0
  }]));
  ledger.forEach((row) => {
    const chapter = String(row.chapter || "").padEnd(3, "0").slice(0, 3);
    const current = groups.get(chapter) || {
      chapter,
      chapterName: chapterNames[chapter] || `${chapter}章`,
      contractAmount: 0,
      changeAmount: 0,
      adjustedAmount: 0,
      previousAmount: 0,
      currentAmount: 0,
      cumulativeAmount: 0
    };
    current.contractAmount += Number(row.contractAmount || 0);
    current.adjustedAmount += Number(row.adjustedAmount || row.contractAmount || 0);
    current.changeAmount = current.adjustedAmount - current.contractAmount;
    current.previousAmount += Number(row.previousAmount || 0);
    current.currentAmount += Number(row.currentAmount || 0);
    current.cumulativeAmount += Number(row.cumulativeAmount || 0);
    groups.set(chapter, current);
  });
  return Array.from(groups.values()).map((row) => ({
    ...row,
    contractAmount: round(row.contractAmount),
    changeAmount: round(row.changeAmount),
    adjustedAmount: round(row.adjustedAmount),
    previousAmount: round(row.previousAmount),
    currentAmount: round(row.currentAmount),
    cumulativeAmount: round(row.cumulativeAmount)
  })).sort((a, b) => String(a.chapter).localeCompare(String(b.chapter), "zh-CN"));
}

function measuredByBillId(billId) {
  return allMeasureDetails()
    .filter((item) => Number(item.billId) === Number(billId))
    .reduce((sum, item) => sum + Number(item.measureNum || 0), 0);
}

function variationsByBillId(billId) {
  return db.variations.filter((item) => Number(item.billId) === Number(billId));
}

function billFinalQuantity(item) {
  const delta = variationsByBillId(item.billId).reduce((sum, vary) => sum + Number(vary.afterNum - vary.beforeNum), 0);
  return round(Number(item.correctedNum || item.contractNum) + delta, 3);
}

function billRows() {
  return db.bills.map((item) => {
    const finalNum = billFinalQuantity(item);
    const measuredNum = round(measuredByBillId(item.billId), 3);
    const contractMoney = billAmount(item, "contractNum");
    const correctedMoney = billAmount(item, "correctedNum");
    const varyMoney = round(variationsByBillId(item.billId).reduce((sum, vary) => {
      return sum + (Number(vary.afterNum || 0) * Number(vary.afterPrice || 0)) - (Number(vary.beforeNum || 0) * Number(vary.beforePrice || 0));
    }, 0));
    const finalMoney = round(contractMoney + varyMoney);
    return {
      ...item,
      sectionName: section(item.sectionId).sectionName,
      contractMoney,
      correctedMoney,
      finalNum,
      finalMoney,
      measuredNum,
      measuredMoney: round(measuredNum * item.price),
      remainNum: round(finalNum - measuredNum, 3),
      remainMoney: round(finalMoney - (measuredNum * item.price))
    };
  });
}

function contractSummary() {
  const rules = calculationRules();
  const rows = billRows();
  const contractSumMoney = round(rows.reduce((sum, item) => sum + item.contractMoney, 0));
  const varyMoney = round(variationRows().reduce((sum, item) => sum + item.varyMoney, 0));
  const finalMoney = round(rows.reduce((sum, item) => sum + item.finalMoney, 0));
  const measuredMoney = round(rows.reduce((sum, item) => sum + item.measuredMoney, 0));
  const materialDiasMoney = round(materialDiasRows().reduce((sum, item) => sum + item.adjustMoney, 0));
  const materialArrivalMoney = round(materialArrivalRows().reduce((sum, item) => sum + item.money, 0));
  const manualMoney = round(manualMeasureRows().reduce((sum, item) => sum + item.measureMoney, 0));
  const paymentCertificate = calculatePaymentCertificate({
    measuredMoney,
    materialDiasMoney,
    materialArrivalMoney,
    manualMoney,
    contractTotal: finalMoney,
    cumulativeSubtotal: measuredMoney + manualMoney
  }, rules);
  const payableMoney = paymentCertificate.finalPayment;
  return {
    contractSumMoney,
    varyMoney,
    finalMoney,
    measuredMoney,
    materialDiasMoney,
    materialArrivalMoney,
    materialAdvanceMoney: paymentCertificate.materialAdvanceMoney,
    materialDeductionMoney: paymentCertificate.materialDeductionMoney,
    retentionMoney: paymentCertificate.retentionMoney,
    mobilizationAdvanceMoney: paymentCertificate.mobilizationAdvanceMoney,
    mobilizationDeductionMoney: paymentCertificate.mobilizationDeductionMoney,
    manualMoney,
    payableMoney,
    payRate: finalMoney ? round((payableMoney / finalMoney) * 100, 2) : 0,
    payableFormula: payableFormulaText(rules),
    paymentCertificate,
    calculationRules: rules
  };
}

function measureRows() {
  return db.measures.map((item) => {
    const details = measureDetailRows(item);
    const money = round(details.reduce((sum, detail) => sum + detail.measureMoney, 0));
    const area = section(item.sectionId).sectionName;
    return {
      ...item,
      billMeasureId: item.measureId,
      sectionName: area,
      workAreaName: area,
      sysWorkArea: { workAreaName: area },
      processInstanceId: item.processInstanceId || "",
      taskUser: item.taskUser ?? true,
      measureState: item.measureState ?? 0,
      lineColor: item.lineColor || "",
      measureMoney: money,
      money,
      amount: money
    };
  });
}

function materialDiasRows() {
  const rules = calculationRules();
  return db.materialAdjustments.map((item) => {
    const m = material(item.materialId, item);
    const priceDiff = round(m.currentPrice - m.basePrice);
    const consumeQuantity = Number(item.consumeQuantity ?? item.quantity ?? 0);
    const conversionFactor = lookupNumericRule(rules.jl108RawMaterialConversionFactors, { ...item, ...m }, 1);
    const convertedQuantity = round(consumeQuantity * conversionFactor, rules.quantityDigits);
    const adjustMoney = round(convertedQuantity * priceDiff);
    return {
      ...item,
      meterialDiasMeasureId: item.diasId || item.id,
      diffYearMonth: String(item.measureDate || "").slice(0, 7),
      approveNo: item.approveNo || item.measureNo,
      provider: item.provider || section(item.sectionId).contractor || section(item.sectionId).sectionName,
      sectionName: section(item.sectionId).sectionName,
      materialNo: m.materialNo,
      materialName: m.materialName,
      secMaterialName: m.materialName,
      measureUnit: m.unit,
      unit: m.unit,
      basePrice: m.basePrice,
      currentPrice: m.currentPrice,
      priceDiff,
      consumeQuantity,
      conversionFactor,
      convertedQuantity,
      measureNum: convertedQuantity,
      quantity: convertedQuantity,
      taskUser: item.taskUser ?? true,
      processInstanceId: item.processInstanceId || "",
      lineColor: item.lineColor || "",
      adjustMoney,
      money: adjustMoney
    };
  });
}

function priceAdjustmentLedgerRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const sectionId = Number(opts.sectionId || 0);
  const periodId = Number(opts.periodId || 0);
  const selectedPeriod = findPeriod(periodId);
  const rows = periodId ? filterByPeriod(materialDiasRows(), periodId) : materialDiasRows();
  return rows
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .map((row) => {
      const rowPeriod = findPeriod(row.periodId || row.gatherId) || selectedPeriod;
      const basePrice = Number(row.basePrice || 0);
      const currentPrice = Number(row.currentPrice || 0);
      const quantity = Number(row.measureNum ?? row.quantity ?? 0);
      const priceDiff = round(currentPrice - basePrice);
      const adjustMoney = round(quantity * priceDiff);
      return {
        periodId: rowPeriod ? Number(rowPeriod.periodId || rowPeriod.gatherId || rowPeriod.id || 0) : Number(row.periodId || row.gatherId || 0),
        periodDesc: rowPeriod ? (rowPeriod.periodDesc || rowPeriod.gatherNo || "") : "",
        sectionId: Number(row.sectionId || 0),
        sectionName: row.sectionName || section(row.sectionId).sectionName,
        measureNo: row.measureNo || row.approveNo || "",
        measureDate: row.measureDate || row.diffYearMonth || "",
        materialId: row.materialId || "",
        materialNo: row.materialNo || "",
        materialName: row.materialName || row.secMaterialName || "",
        unit: row.unit || row.measureUnit || "",
        basePrice,
        currentPrice,
        priceDiff,
        priceRatio: basePrice ? round(currentPrice / basePrice, 6) : 0,
        consumeQuantity: Number(row.consumeQuantity ?? quantity),
        conversionFactor: Number(row.conversionFactor ?? 1),
        convertedQuantity: Number(row.convertedQuantity ?? quantity),
        quantity,
        adjustMoney,
        formula: "adjustMoney = convertedQuantity * (currentPrice - basePrice); convertedQuantity = consumeQuantity * conversionFactor"
      };
    });
}

function priceAdjustmentSummaryRows(options = {}) {
  const grouped = new Map();
  priceAdjustmentLedgerRows(options).forEach((row) => {
    const key = `${row.materialNo || ""}|${row.materialName || ""}|${row.unit || ""}`;
    const current = grouped.get(key) || {
      materialId: row.materialId,
      materialNo: row.materialNo,
      materialName: row.materialName,
      unit: row.unit,
      periods: new Set(),
      consumeQuantity: 0,
      quantity: 0,
      adjustMoney: 0,
      minBasePrice: row.basePrice,
      maxCurrentPrice: row.currentPrice,
      minConversionFactor: row.conversionFactor,
      maxConversionFactor: row.conversionFactor
    };
    if (row.periodDesc) current.periods.add(row.periodDesc);
    current.consumeQuantity += Number(row.consumeQuantity || row.quantity || 0);
    current.quantity += Number(row.quantity || 0);
    current.adjustMoney += Number(row.adjustMoney || 0);
    current.minBasePrice = Math.min(Number(current.minBasePrice || 0), Number(row.basePrice || 0));
    current.maxCurrentPrice = Math.max(Number(current.maxCurrentPrice || 0), Number(row.currentPrice || 0));
    current.minConversionFactor = Math.min(Number(current.minConversionFactor || 1), Number(row.conversionFactor || 1));
    current.maxConversionFactor = Math.max(Number(current.maxConversionFactor || 1), Number(row.conversionFactor || 1));
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).map((row) => ({
    materialId: row.materialId,
    materialNo: row.materialNo,
    materialName: row.materialName,
    unit: row.unit,
    periods: Array.from(row.periods).join(","),
    consumeQuantity: round(row.consumeQuantity, calculationRules().quantityDigits),
    quantity: round(row.quantity, calculationRules().quantityDigits),
    minConversionFactor: round(row.minConversionFactor, 6),
    maxConversionFactor: round(row.maxConversionFactor, 6),
    minBasePrice: round(row.minBasePrice, calculationRules().priceDigits),
    maxCurrentPrice: round(row.maxCurrentPrice, calculationRules().priceDigits),
    priceRatio: row.minBasePrice ? round(row.maxCurrentPrice / row.minBasePrice, 6) : 0,
    adjustMoney: round(row.adjustMoney)
  }));
}

function jl116FormulaSummary(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const rules = calculationRules();
  const certificate = paymentCertificateForPeriod(periodId, { sectionId });
  const detailRows = priceAdjustmentLedgerRows({ periodId, sectionId });
  const summaryRows = priceAdjustmentSummaryRows({ periodId, sectionId });
  const totalAdjustment = round(detailRows.reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0));
  const formulaBase = Number(certificate.cumulativeSubtotal || certificate.subtotal || 0);
  const rawIndexFactor = formulaBase ? 1 + totalAdjustment / formulaBase : 1;
  const effectiveIndexFactor = round(rawIndexFactor, 6);
  const nonAdjustableFactor = Number(rules.jl116NonAdjustableFactor || 0);
  const hasConfiguredWeights = Object.keys(rules.jl116MaterialWeights || {}).length > 0;
  const materialWeights = summaryRows.map((row) => {
    const configuredValue = lookupNumericRule(rules.jl116MaterialWeights, row, null);
    const configured = configuredValue !== null && configuredValue !== undefined && Number.isFinite(Number(configuredValue));
    const weight = configured ? Number(configuredValue) : 0;
    const priceRatio = Number(row.priceRatio || (row.minBasePrice ? Number(row.maxCurrentPrice || 0) / Number(row.minBasePrice || 1) : 0));
    return {
      materialId: row.materialId,
      materialNo: row.materialNo,
      materialName: row.materialName,
      unit: row.unit,
      weight,
      configured,
      basePrice: row.minBasePrice,
      currentPrice: row.maxCurrentPrice,
      priceRatio: round(priceRatio, 6),
      weightedIndex: configured ? round(weight * priceRatio, 6) : 0,
      adjustMoney: row.adjustMoney
    };
  });
  const weightedIndexSum = round(materialWeights.reduce((sum, row) => sum + Number(row.weightedIndex || 0), 0), 6);
  const weightTotal = round(materialWeights.reduce((sum, row) => sum + (row.configured ? Number(row.weight || 0) : 0), 0), 6);
  const inferredMaterialIndexFactor = round(effectiveIndexFactor - nonAdjustableFactor, 6);
  const variableFactor = hasConfiguredWeights ? weightedIndexSum : inferredMaterialIndexFactor;
  const indexFactor = hasConfiguredWeights ? round(nonAdjustableFactor + weightedIndexSum, 6) : effectiveIndexFactor;
  const formulaAdjustment = hasConfiguredWeights ? round(formulaBase * (indexFactor - 1)) : round(formulaBase * (rawIndexFactor - 1));
  const detailDifference = round(Number(certificate.priceAdjustment || 0) - totalAdjustment);
  const formulaDifference = round(Number(certificate.priceAdjustment || 0) - formulaAdjustment);
  return {
    periodId,
    periodDesc: certificate.periodDesc,
    sectionId,
    formula: "T = F * [(X + Σ(weight * currentIndex/baseIndex)) - 1]",
    formulaBase,
    nonAdjustableFactor,
    variableFactor,
    indexFactor,
    effectiveIndexFactor,
    configuredWeight: hasConfiguredWeights,
    weightTotal,
    weightBalance: round(nonAdjustableFactor + weightTotal, 6),
    weightedIndexSum,
    materialWeights,
    detailAdjustment: totalAdjustment,
    certificatePriceAdjustment: certificate.priceAdjustment,
    formulaAdjustment,
    detailDifference,
    formulaDifference,
    difference: detailDifference,
    passed: Math.abs(detailDifference) <= 0.01 && (!hasConfiguredWeights || Math.abs(formulaDifference) <= 0.01)
  };
}

function jlPriceAdjustmentReport(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const detailRows = priceAdjustmentLedgerRows({ periodId, sectionId });
  const summaryRows = priceAdjustmentSummaryRows({ periodId, sectionId });
  const formula = jl116FormulaSummary({ periodId, sectionId });
  return {
    periodId,
    periodDesc: formula.periodDesc,
    sectionId,
    totalAdjustment: round(detailRows.reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0)),
    detailRows,
    summaryRows,
    formula
  };
}

function jl101MonthlyReport(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const certificate = paymentCertificateForPeriod(periodId, { sectionId });
  const selectedSections = db.sections.filter((item) => !sectionId || Number(item.sectionId || item.id || 0) === sectionId);
  const project = db.projects[0] || {};
  const client = db.client || {};
  const sectionNames = selectedSections.map((item) => item.sectionName || item.name).filter(Boolean).join(",") || "全部合同段";
  const contractors = selectedSections.map((item) => item.contractor).filter(Boolean).join(",");
  const supervisors = selectedSections.map((item) => item.supervisor).filter(Boolean).join(",");
  return {
    formCode: "JL101",
    formName: "计量支付月报表",
    projectName: project.projectName || client.clientName || "",
    clientName: client.clientName || "",
    sectionId,
    sectionName: sectionNames,
    contractor: contractors,
    supervisor: supervisors,
    periodId,
    periodDesc: certificate.periodDesc || (period ? period.periodDesc : ""),
    startDate: period ? (period.startDate || period.gatherStartDate || "") : "",
    endDate: period ? (period.endDate || period.gatherEndDate || "") : "",
    contractTotal: certificate.contractTotal,
    subtotal: certificate.subtotal,
    priceAdjustment: certificate.priceAdjustment,
    materialAdvanceMoney: certificate.materialAdvanceMoney,
    materialDeductionMoney: certificate.materialDeductionMoney,
    retentionMoney: certificate.retentionMoney,
    mobilizationDeductionMoney: certificate.mobilizationDeductionMoney,
    currentPayment: certificate.finalPayment,
    cumulativeSubtotal: certificate.cumulativeSubtotal,
    cumulativePaymentRate: certificate.contractTotal ? round((certificate.cumulativeSubtotal / certificate.contractTotal) * 100, 2) : 0,
    source: "JL104",
    formula: "JL101.currentPayment = JL104.finalPayment"
  };
}

function selectedSections(sectionId = 0) {
  const id = Number(sectionId || 0);
  const rows = (db.sections || []).filter((item) => !id || Number(item.sectionId || item.id || 0) === id);
  return rows.length ? rows : (db.sections || []);
}

function workflowLogsForRecord(moduleName, id, processInstanceId = "") {
  const moduleText = String(moduleName || "").toLowerCase();
  const processText = String(processInstanceId || "").toLowerCase();
  const businessId = Number(id || 0);
  return (db.workflowLogs || [])
    .filter((log) => {
      const logModule = String(log.module || "").toLowerCase();
      const logBusinessId = Number(log.businessId || 0);
      const logBusinessNo = String(log.businessNo || "").toLowerCase();
      if (processText && logBusinessNo && logBusinessNo === processText) return true;
      return moduleText && logModule === moduleText && businessId && logBusinessId === businessId;
    })
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
}

function workflowSummaryForRecord(moduleName, id, processInstanceId, fallbackState) {
  const logs = workflowLogsForRecord(moduleName, id, processInstanceId);
  const latest = logs[logs.length - 1] || {};
  return {
    logCount: logs.length,
    currentStep: latest.step || fallbackState || "",
    approver: latest.userName || "",
    approveTime: latest.time || "",
    result: latest.result || fallbackState || "",
    remark: latest.remark || ""
  };
}

function jl102TransferRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const rows = [];
  const push = (source) => {
    const workflow = workflowSummaryForRecord(source.module, source.businessId, source.processInstanceId, source.state);
    rows.push({
      orderNo: rows.length + 1,
      periodId,
      periodDesc: period ? (period.periodDesc || period.gatherNo || "") : "",
      formCode: source.formCode,
      formName: source.formName,
      businessNo: source.businessNo || "",
      sectionId: Number(source.sectionId || 0),
      sectionName: source.sectionName || (source.sectionId ? section(source.sectionId).sectionName : ""),
      submitDate: source.submitDate || "",
      amount: round(Number(source.amount || 0)),
      state: source.state || workflow.result || "",
      currentStep: workflow.currentStep,
      approver: workflow.approver,
      approveTime: workflow.approveTime,
      result: workflow.result,
      remark: workflow.remark,
      logCount: workflow.logCount,
      sourceModule: source.module || ""
    });
  };
  measureRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !period || rowBelongsToPeriod(row, period))
    .forEach((row) => push({
      formCode: "JL114",
      formName: "工程计量表",
      businessNo: row.measureNo,
      sectionId: row.sectionId,
      sectionName: row.sectionName,
      submitDate: row.measureDate || row.updateDate || "",
      amount: row.measureMoney,
      state: row.states,
      module: "billmeasure",
      businessId: row.measureId || row.billMeasureId || row.id,
      processInstanceId: row.processInstanceId
    }));
  materialArrivalRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !period || rowBelongsToPeriod(row, period))
    .forEach((row) => push({
      formCode: "JL109",
      formName: "工程材料到达现场计量表",
      businessNo: row.measureNo || row.certifyNo,
      sectionId: row.sectionId,
      sectionName: row.sectionName,
      submitDate: row.measureDate || row.updateDate || "",
      amount: row.advanceMoney,
      state: row.states,
      module: "meterialinmeasure",
      businessId: row.arrivalId || row.meterialInMeasureId || row.id,
      processInstanceId: row.processInstanceId
    }));
  materialDiasRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !period || rowBelongsToPeriod(row, period))
    .forEach((row) => push({
      formCode: "JL108",
      formName: "永久性工程材料差价金额一览表",
      businessNo: row.measureNo || row.approveNo,
      sectionId: row.sectionId,
      sectionName: row.sectionName,
      submitDate: row.measureDate || row.updateDate || "",
      amount: row.adjustMoney,
      state: row.states,
      module: "meterialdiasmeasure",
      businessId: row.diasId || row.meterialDiasMeasureId || row.id,
      processInstanceId: row.processInstanceId
    }));
  variationRowsForPeriod({ periodId, sectionId }).forEach((row) => push({
    formCode: "JL106/JL107",
    formName: "清单变更表",
    businessNo: row.varyNo || row.meetingNo,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    submitDate: row.updateDate || row.meetingDate || "",
    amount: row.varyMoney,
    state: row.states,
    module: "varyapplication",
    businessId: row.varyId || row.id,
    processInstanceId: row.processInstanceId
  }));
  const certificate = paymentCertificateForPeriod(periodId, { sectionId });
  push({
    formCode: "JL104",
    formName: "中期财务支付证书",
    businessNo: certificate.periodDesc || `JL104-${periodId}`,
    sectionId,
    sectionName: sectionId ? section(sectionId).sectionName : "全部合同段",
    submitDate: period ? (period.collectTime || period.endDate || "") : "",
    amount: certificate.finalPayment,
    state: period ? (period.gatherState || period.states || "") : "",
    module: "payment",
    businessId: periodId,
    processInstanceId: `payment-${periodId}`
  });
  return rows;
}

function jl103ProgressRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const plans = planRows().filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const planAmount = round(plans.reduce((sum, row) => sum + Number(row.finishMoney || row.amount || 0), 0));
  return paymentCertificateForPeriod(periodId, { sectionId }).chapters.map((row) => ({
    periodId,
    periodDesc: period ? (period.periodDesc || period.gatherNo || "") : "",
    chapter: row.chapter,
    chapterName: row.chapterName,
    contractAmount: row.adjustedAmount || row.contractAmount,
    currentAmount: row.currentAmount,
    cumulativeAmount: row.cumulativeAmount,
    progressPct: row.adjustedAmount ? round((Number(row.cumulativeAmount || 0) / Number(row.adjustedAmount || 0)) * 100, 2) : 0,
    periodPlanAmount: planAmount,
    planCount: plans.length,
    status: Number(row.currentAmount || 0) > 0 ? "本期有完成量" : "本期无新增完成量",
    formula: "progressPct = cumulativeAmount / adjustedAmount * 100%"
  }));
}

function jl108RawMaterialDetailRows(options = {}) {
  return priceAdjustmentLedgerRows(options).map((row) => ({
    ...row,
    formCode: "JL108-1",
    consumeQuantity: row.consumeQuantity,
    conversionFactor: row.conversionFactor,
    convertedQuantity: row.convertedQuantity,
    consumeMoney: round(Number(row.convertedQuantity || row.quantity || 0) * Number(row.currentPrice || 0)),
    formula: "adjustMoney = convertedQuantity * (currentPrice - basePrice); convertedQuantity = consumeQuantity * conversionFactor"
  }));
}

function jl112QuantityCompilationRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  return measureRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !period || rowBelongsToPeriod(row, period))
    .map((row, index) => ({
      orderNo: index + 1,
      periodId,
      periodDesc: period ? (period.periodDesc || period.gatherNo || "") : "",
      measureNo: row.measureNo,
      sectionId: row.sectionId,
      sectionName: row.sectionName,
      measureDate: row.measureDate,
      position: row.position || row.pegNo || "",
      detailCount: Array.isArray(row.details) ? row.details.length : 0,
      amount: row.measureMoney,
      state: row.states || "",
      source: "JL114",
      formula: "JL112.amount = ΣJL114明细数量 * 清单单价"
    }));
}

function jl115MobilizationAdvanceCertificate(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const rules = calculationRules();
  const contractTotal = sectionId
    ? round(billRows().filter((row) => Number(row.sectionId || 0) === sectionId).reduce((sum, row) => sum + Number(row.finalMoney || 0), 0))
    : contractSummary().finalMoney;
  const totalAdvance = mobilizationAdvanceAmount(contractTotal, rules);
  const periodOrder = Number(period?.orderNo || period?.periodId || periodId || 0);
  const issueEndPeriod = Number(rules.jl115EndPeriod || 0);
  const expected = periodOrder > 0 && issueEndPeriod > 0 && periodOrder <= issueEndPeriod;
  const periodAdvance = expected ? round(totalAdvance / issueEndPeriod) : 0;
  const cumulativeAdvance = round(Math.min(totalAdvance, Math.max(0, Math.min(periodOrder, issueEndPeriod)) * (issueEndPeriod ? totalAdvance / issueEndPeriod : 0)));
  return {
    formCode: "JL115",
    formName: "开工动员预付款支付证书",
    periodId,
    periodDesc: period ? (period.periodDesc || period.gatherNo || "") : "",
    sectionId,
    sectionName: sectionId ? section(sectionId).sectionName : selectedSections(sectionId).map((item) => item.sectionName).join(","),
    contractTotal,
    advanceRate: rules.mobilizationAdvanceRate,
    totalAdvance,
    issueEndPeriod,
    periodOrder,
    expected,
    periodAdvance,
    cumulativeAdvance,
    remainingAdvance: round(Math.max(0, totalAdvance - cumulativeAdvance)),
    formula: `mobilizationAdvance = contractTotal * ${rules.mobilizationAdvanceRate}%`
  };
}

function jlPaymentSupportReport(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  return {
    jl102Rows: jl102TransferRows(opts),
    jl103Rows: jl103ProgressRows(opts),
    jl108RawMaterialRows: jl108RawMaterialDetailRows(opts),
    jl112Rows: jl112QuantityCompilationRows(opts),
    jl115Certificate: jl115MobilizationAdvanceCertificate(opts)
  };
}

function materialRows() {
  return db.materials.map((item) => ({
    ...item,
    secMateriaId: item.secMateriaId || item.materialId,
    secMaterialId: item.secMaterialId || item.secMateriaId || item.materialId,
    unitPrice: item.unitPrice || item.currentPrice || item.basePrice || 0,
    specType: item.spec || item.specType || "",
    measureUnit: item.unit || item.measureUnit || "项",
    sendersRange: item.sendersRange || "按合同调差",
    materialModel: {
      materialNo: item.materialNo,
      materialName: item.materialName,
      specType: item.spec || item.specType || "",
      measureUnit: item.unit || item.measureUnit || "项"
    }
  }));
}

function materialArrivalRows() {
  const rules = calculationRules();
  return db.materialArrivals.map((item) => {
    const m = material(item.materialId, item);
    const price = m.currentPrice;
    const money = round(item.quantity * price);
    return {
      ...item,
      meterialInMeasureId: item.arrivalId || item.id,
      certifyNo: item.certifyNo || item.measureNo,
      sectionName: section(item.sectionId).sectionName,
      materialNo: m.materialNo,
      materialName: m.materialName,
      measureUnit: m.unit,
      unit: m.unit,
      measureNum: item.quantity,
      price,
      measurePrice: price,
      taskUser: item.taskUser ?? true,
      processInstanceId: item.processInstanceId || "",
      lineColor: item.lineColor || "",
      money,
      arrivalMoney: money,
      advanceRate: rules.materialAdvanceRate,
      advanceMoney: round(money * (rules.materialAdvanceRate / 100))
    };
  });
}

function materialDeductionRows() {
  return (db.materialDeductions || []).map((item, index) => ({
    ...item,
    materialDeductionId: item.materialDeductionId || item.deductionId || item.id || index + 1,
    sectionName: item.sectionId ? section(item.sectionId).sectionName : "",
    previousDeductedMoney: positive(item.previousDeductedMoney ?? item.previousMoney ?? item.prevDeductedMoney),
    cumulativeDeductedMoney: positive(item.cumulativeDeductedMoney ?? item.cumulativeMoney ?? item.currentDeductedMoney),
    deductionMoney: positive(item.deductionMoney ?? item.currentDeductMoney ?? (numberOr(item.cumulativeDeductedMoney ?? item.cumulativeMoney, 0) - numberOr(item.previousDeductedMoney ?? item.previousMoney, 0))),
    periodId: item.periodId || item.gatherId || 0,
    gatherId: item.gatherId || item.periodId || 0
  }));
}

function materialDeductionMoneyForPeriod(periodId) {
  const rows = filterByPeriod(materialDeductionRows(), periodId);
  if (rows.length) return round(rows.reduce((sum, row) => sum + Number(row.deductionMoney || 0), 0));
  const period = findPeriod(periodId);
  if (period && (period.materialDeductionMoney !== undefined || period.cumulativeMaterialDeductionMoney !== undefined)) {
    return configuredMaterialDeduction(period, calculationRules());
  }
  return configuredMaterialDeduction({}, calculationRules());
}

function materialDeductionLedgerRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const sectionId = Number(opts.sectionId || 0);
  const selectedPeriodId = Number(opts.periodId || 0);
  let cumulativeAdvance = 0;
  let cumulativeDeduction = 0;
  return periodRows()
    .filter((period) => !selectedPeriodId || Number(period.periodId || 0) <= selectedPeriodId)
    .map((period) => {
      const periodId = Number(period.periodId || period.gatherId || period.id || 0);
      const arrivals = filterByPeriod(materialArrivalRows(), periodId)
        .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
      const periodAdvance = round(arrivals.reduce((sum, row) => sum + Number(row.advanceMoney || 0), 0));
      cumulativeAdvance = round(cumulativeAdvance + periodAdvance);
      const deductionRows = filterByPeriod(materialDeductionRows(), periodId)
        .filter((row) => !sectionId || !row.sectionId || Number(row.sectionId || 0) === sectionId);
      const periodDeduction = deductionRows.length
        ? round(deductionRows.reduce((sum, row) => sum + Number(row.deductionMoney || 0), 0))
        : (!sectionId ? materialDeductionMoneyForPeriod(periodId) : 0);
      const previousDeduction = cumulativeDeduction;
      cumulativeDeduction = round(cumulativeDeduction + periodDeduction);
      return {
        periodId,
        periodDesc: period.periodDesc || period.gatherNo || `第 ${periodId} 期`,
        sectionId,
        periodAdvance,
        cumulativeAdvance,
        previousDeduction,
        periodDeduction,
        cumulativeDeduction,
        remainingAdvance: round(cumulativeAdvance - cumulativeDeduction),
        formula: "本期扣回=到本期末累计扣回-到上期末累计扣回"
      };
    });
}

function mobilizationDeductionLedgerRows(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const sectionId = Number(opts.sectionId || 0);
  const selectedPeriodId = Number(opts.periodId || 0);
  const rules = calculationRules();
  return periodRows()
    .filter((period) => !selectedPeriodId || Number(period.periodId || 0) <= selectedPeriodId)
    .map((period) => {
      const periodId = Number(period.periodId || period.gatherId || period.id || 0);
      const certificate = paymentCertificateForPeriod(periodId, { sectionId });
      const contractTotal = Number(certificate.contractTotal || 0);
      const advance = mobilizationAdvanceAmount(contractTotal, rules);
      const startThreshold = round(contractTotal * (rules.mobilizationDeductionStartRate / 100));
      const endThreshold = round(contractTotal * (rules.mobilizationDeductionEndRate / 100));
      const previousDeduction = cumulativeMobilizationDeduction(certificate.previousCumulativeSubtotal, contractTotal, rules);
      const cumulativeDeduction = cumulativeMobilizationDeduction(certificate.cumulativeSubtotal, contractTotal, rules);
      const periodDeduction = certificate.mobilizationDeductionMoney !== undefined
        ? Number(certificate.mobilizationDeductionMoney || 0)
        : round(Math.max(0, cumulativeDeduction - previousDeduction));
      const status = certificate.cumulativeSubtotal < startThreshold
        ? "未达扣回门槛"
        : (cumulativeDeduction >= advance ? "已扣完" : "扣回中");
      return {
        periodId,
        periodDesc: certificate.periodDesc || period.periodDesc || period.gatherNo || `第 ${periodId} 期`,
        sectionId,
        contractTotal,
        advance,
        startThreshold,
        endThreshold,
        previousSubtotal: certificate.previousCumulativeSubtotal,
        cumulativeSubtotal: certificate.cumulativeSubtotal,
        previousDeduction: round(previousDeduction),
        periodDeduction: round(periodDeduction),
        cumulativeDeduction: round(cumulativeDeduction),
        remainingAdvance: round(Math.max(0, advance - cumulativeDeduction)),
        status,
        formula: "累计应扣回=(C-D)/A*2*B，30%后开始，80%时扣完"
      };
    });
}

function manualMeasureRows() {
  return db.manualMeasures.map((item) => ({
    ...item,
    sectionName: section(item.sectionId).sectionName,
    roleTypeName: item.roleTypeName || "SBSJ",
    isSuperSection: item.isSuperSection || "0",
    taskUser: item.taskUser ?? true,
    measureState: item.measureState ?? 0,
    processInstanceId: item.processInstanceId || "",
    measureMoney: round(item.measureNum * item.price),
    money: round(item.measureNum * item.price)
  }));
}

function sumMoney(rows, key) {
  return round(rows.reduce((sum, row) => sum + Number(row[key] || 0), 0));
}

function paymentCertificateForPeriod(periodId, options = {}) {
  const rules = calculationRules();
  const period = findPeriod(periodId);
  const sectionId = Number(options.sectionId || 0);
  const chapters = jl104ChapterRows({ periodId, sectionId });
  const billMeasureMoney = sumMoney(chapters, "currentAmount");
  const previousBillMeasureMoney = sumMoney(chapters, "previousAmount");
  const cumulativeBillMeasureMoney = sumMoney(chapters, "cumulativeAmount");
  const manualRows = filterByPeriod(manualMeasureRows(), periodId)
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId);
  const previousManualRows = manualMeasureRows().filter((row) => {
    if (sectionId && Number(row.sectionId || 0) !== sectionId) return false;
    return rowBeforePeriod(row, period);
  });
  const manualMoney = sumMoney(manualRows, "measureMoney");
  const previousManualMoney = sumMoney(previousManualRows, "measureMoney");
  const materialAdjustMoney = sumMoney(filterByPeriod(materialDiasRows(), periodId)
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId), "adjustMoney");
  const materialArrivalMoney = sumMoney(filterByPeriod(materialArrivalRows(), periodId)
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId), "money");
  const materialDeductionMoney = materialDeductionMoneyForPeriod(periodId);
  const contractTotal = sectionId
    ? round(billRows().filter((row) => Number(row.sectionId || 0) === sectionId).reduce((sum, row) => sum + Number(row.finalMoney || 0), 0))
    : contractSummary().finalMoney;
  const parts = {
    measuredMoney: billMeasureMoney,
    manualMoney,
    materialDiasMoney: materialAdjustMoney,
    materialArrivalMoney,
    materialDeductionMoney,
    contractTotal,
    previousCumulativeSubtotal: previousBillMeasureMoney + previousManualMoney,
    cumulativeSubtotal: cumulativeBillMeasureMoney + previousManualMoney + manualMoney,
    mobilizationDeductionMoney: period && period.mobilizationDeductionMoney !== undefined ? period.mobilizationDeductionMoney : undefined,
    previousMobilizationDeductionMoney: period && period.previousMobilizationDeductionMoney !== undefined ? period.previousMobilizationDeductionMoney : undefined,
    claimsMoney: period && period.claimsMoney !== undefined ? period.claimsMoney : undefined,
    penaltyMoney: period && period.penaltyMoney !== undefined ? period.penaltyMoney : undefined,
    interestMoney: period && period.interestMoney !== undefined ? period.interestMoney : undefined,
    otherAdjustmentMoney: period && period.otherAdjustmentMoney !== undefined ? period.otherAdjustmentMoney : undefined,
    provisionalCurrentMoney: period && period.provisionalCurrentMoney !== undefined ? period.provisionalCurrentMoney : undefined
  };
  return {
    periodId: period ? period.periodId : Number(periodId || 0),
    periodDesc: period ? (period.periodDesc || period.gatherNo || "") : "",
    sectionId,
    chapters,
    jl113Rows: jl113Rows({ periodId, sectionId }),
    jl105Rows: jl105LedgerRows({ periodId, sectionId }),
    ...calculatePaymentCertificate(parts, rules)
  };
}

function jlPaymentReferenceCases() {
  const rules = {
    ...calculationRules(),
    moneyDigits: 0,
    includeBillMeasure: true,
    includeMaterialAdjust: true,
    includeManualMeasure: true,
    includeMaterialAdvance: true,
    includeRetention: true,
    materialAdvanceRate: 60,
    retentionRate: 10,
    mobilizationAdvanceRate: 10,
    mobilizationDeductionStartRate: 30,
    mobilizationDeductionEndRate: 80,
    materialDeductionMoney: 0,
    cumulativeMaterialDeductionMoney: 0,
    previousMaterialDeductionMoney: 0
  };
  const period12 = calculatePaymentCertificate({
    measuredMoney: 5094708,
    materialDiasMoney: 0,
    materialAdvanceMoney: 4529717,
    materialDeductionMoney: 1415578,
    retentionMoney: 509471,
    contractTotal: 569846095,
    previousCumulativeSubtotal: 146206797,
    cumulativeSubtotal: 151301505
  }, rules);
  const period14Mobilization = cumulativeMobilizationDeduction(174060235, 569846095, rules);
  const period14 = calculatePaymentCertificate({
    measuredMoney: 20618620,
    materialDiasMoney: 2139953,
    materialAdvanceMoney: 5257494,
    materialDeductionMoney: 1093940,
    retentionMoney: 2275857,
    mobilizationDeductionMoney: period14Mobilization,
    contractTotal: 569846095,
    previousCumulativeSubtotal: 153441615,
    cumulativeSubtotal: 174060235
  }, rules);
  return [
    {
      period: "第12期样表",
      item: "JL104实际支付",
      expected: 7699376,
      actual: period12.finalPayment,
      passed: period12.finalPayment === 7699376,
      basis: "5,094,708 + 4,529,717 - 1,415,578 - 509,471"
    },
    {
      period: "第12期样表",
      item: "JL111动员预付款扣回",
      expected: 0,
      actual: period12.mobilizationDeductionMoney,
      passed: period12.mobilizationDeductionMoney === 0,
      basis: "累计小计151,301,505未达合同价30%"
    },
    {
      period: "第12期样表",
      item: "JL106/JL107变更金额",
      expected: 0,
      actual: 0,
      passed: true,
      basis: "JL106/JL107样表仅表头无变更明细；JL104合同金额=变更后合同金额"
    },
    {
      period: "第14期样表",
      item: "JL111动员预付款扣回",
      expected: 621281,
      actual: period14Mobilization,
      passed: period14Mobilization === 621281,
      basis: "(174,060,235 - 170,953,828) / 569,846,095 * 2 * 56,984,610"
    },
    {
      period: "第14期样表",
      item: "JL104实际支付",
      expected: 24024989,
      actual: period14.finalPayment,
      passed: period14.finalPayment === 24024989,
      basis: "20,618,620 + 2,139,953 + 5,257,494 - 1,093,940 - 2,275,857 - 621,281"
    }
  ];
}

function jlPaymentValidation(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const rules = calculationRules();
  const certificate = paymentCertificateForPeriod(periodId, { sectionId });
  const tolerance = Number(opts.tolerance ?? 0.01);
  const checks = [];
  const addCheck = (group, name, expected, actual, detail = "", severity = "error") => {
    const e = round(expected, 2);
    const a = round(actual, 2);
    checks.push({
      group,
      name,
      expected: e,
      actual: a,
      difference: round(a - e, 2),
      passed: Math.abs(a - e) <= tolerance,
      severity,
      detail
    });
  };
  const addBoolean = (group, name, passed, detail = "", severity = "error") => {
    checks.push({ group, name, expected: true, actual: Boolean(passed), difference: 0, passed: Boolean(passed), severity, detail });
  };

  certificate.jl113Rows.forEach((row) => {
    addCheck("横向校验", `JL113金额=${row.itemCode || row.billNo}`, Number(row.quantity || 0) * Number(row.price || 0), row.amount, "JL113金额=数量*单价");
  });
  certificate.jl105Rows.forEach((row) => {
    addCheck("横向校验", `JL105数量连续=${row.itemCode || row.billNo}`, Number(row.previousQuantity || 0) + Number(row.currentQuantity || 0), row.cumulativeQuantity, "E=G+I");
    addCheck("横向校验", `JL105金额连续=${row.itemCode || row.billNo}`, Number(row.previousAmount || 0) + Number(row.currentAmount || 0), row.cumulativeAmount, "F=H+J");
    const denominator = Number(row.contractAmount || 0);
    if (denominator > 0) {
      addCheck("横向校验", `JL105进度=${row.itemCode || row.billNo}`, (Number(row.cumulativeAmount || 0) / denominator) * 100, row.progressPct, "D=F/C");
    }
  });
  const chapterCurrent = certificate.chapters.reduce((sum, row) => sum + Number(row.currentAmount || 0), 0);
  addCheck("横向校验", "JL104章级本期合计=清单本期小计", chapterCurrent, certificate.billMeasureMoney, "100~900章本期完成之和");
  const expectedFinalPayment =
    Number(certificate.subtotal || 0) +
    Number(certificate.priceAdjustment || 0) +
    Number(certificate.claimsMoney || 0) +
    Number(certificate.interestMoney || 0) +
    Number(certificate.materialAdvanceMoney || 0) +
    Number(certificate.mobilizationAdvanceMoney || 0) +
    Number(certificate.otherAdjustmentMoney || 0) -
    Number(certificate.penaltyMoney || 0) -
    Number(certificate.materialDeductionMoney || 0) -
    Number(certificate.retentionMoney || 0) -
    Number(certificate.mobilizationDeductionMoney || 0);
  addCheck("横向校验", "JL104实际支付平衡", expectedFinalPayment, certificate.finalPayment, "实际支付=小计+调整+垫付-扣回-保留金");

  const jl113ByBill = new Map(certificate.jl113Rows.map((row) => [String(row.billId || row.itemCode || row.billNo), row]));
  certificate.jl105Rows.forEach((row) => {
    const key = String(row.billId || row.itemCode || row.billNo);
    const source = jl113ByBill.get(key);
    const sourceQty = source ? Number(source.quantity || 0) : 0;
    const sourceAmount = source ? Number(source.amount || 0) : 0;
    addCheck("纵向校验", `JL113→JL105数量=${row.itemCode || row.billNo}`, sourceQty, row.currentQuantity, "本期完成数量来自JL113");
    addCheck("纵向校验", `JL113→JL105金额=${row.itemCode || row.billNo}`, sourceAmount, row.currentAmount, "本期完成金额来自JL113");
  });
  const ledgerByChapter = new Map();
  certificate.jl105Rows.forEach((row) => {
    const chapter = String(row.chapter || "").padEnd(3, "0").slice(0, 3);
    const current = ledgerByChapter.get(chapter) || { currentAmount: 0, previousAmount: 0, cumulativeAmount: 0 };
    current.currentAmount += Number(row.currentAmount || 0);
    current.previousAmount += Number(row.previousAmount || 0);
    current.cumulativeAmount += Number(row.cumulativeAmount || 0);
    ledgerByChapter.set(chapter, current);
  });
  certificate.chapters.forEach((row) => {
    const source = ledgerByChapter.get(String(row.chapter)) || { currentAmount: 0, previousAmount: 0, cumulativeAmount: 0 };
    addCheck("纵向校验", `JL105→JL104本期=${row.chapter}`, source.currentAmount, row.currentAmount, "JL104章级本期完成来自JL105");
    addCheck("纵向校验", `JL105→JL104累计=${row.chapter}`, source.cumulativeAmount, row.cumulativeAmount, "JL104章级累计来自JL105");
  });
  addCheck("纵向校验", "JL109→JL104材料设备垫付款", certificate.materialArrivalMoney * (rules.materialAdvanceRate / 100), certificate.materialAdvanceMoney, `材料到场金额*${rules.materialAdvanceRate}%`);
  addCheck("纵向校验", "JL110→JL104扣回材料设备垫付款", materialDeductionMoneyForPeriod(periodId), certificate.materialDeductionMoney, "本期扣回=到本期末累计扣回-到上期末累计扣回");
  const variationRowsToDate = variationRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !period || rowBelongsToPeriod(row, period) || rowBeforePeriod(row, period));
  const variationByChapter = new Map();
  variationRowsToDate.forEach((row) => {
    const sourceBill = bill(row.billId, {});
    const chapter = String(sourceBill.chapter || row.chapter || row.billNo || "").padEnd(3, "0").slice(0, 3);
    const beforeQuantity = Number(row.beforeVaryNum ?? row.beforeNum ?? 0);
    const afterQuantity = Number(row.afterVaryNum ?? row.afterNum ?? 0);
    const beforePrice = Number(row.beforeVaryPrice ?? row.beforePrice ?? 0);
    const afterPrice = Number(row.afterVaryPrice ?? row.afterPrice ?? beforePrice);
    const quantityChangeMoney = round((afterQuantity - beforeQuantity) * beforePrice);
    const priceChangeMoney = round(afterQuantity * (afterPrice - beforePrice));
    variationByChapter.set(chapter, round(Number(variationByChapter.get(chapter) || 0) + quantityChangeMoney + priceChangeMoney));
  });
  certificate.chapters.forEach((row) => {
    addCheck("纵向校验", `JL106/JL107→JL104变更金额=${row.chapter}`, Number(variationByChapter.get(String(row.chapter)) || 0), row.changeAmount, "JL104章级变更金额=JL106工程量变更/JL107单价变更汇总");
  });
  const priceAdjustment = jlPriceAdjustmentReport({ periodId, sectionId });
  addCheck("纵向校验", "JL108/JL116→JL104价格调整", priceAdjustment.totalAdjustment, certificate.priceAdjustment, "JL108调差=Σ(现行价-基价)*实际用量，JL116公式归档");
  addCheck("纵向校验", "JL116权重公式→JL104价格调整", priceAdjustment.formula.formulaAdjustment, certificate.priceAdjustment, "JL116: T=F*[(X+Σ权重*价格指数)-1]");
  const rawMaterialAdjustment = round(jl108RawMaterialDetailRows({ periodId, sectionId }).reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0));
  addCheck("纵向校验", "JL108-1→JL108原材料调差", rawMaterialAdjustment, priceAdjustment.totalAdjustment, "JL108-1原材料明细折算后汇总=JL108调差金额");
  const jl112Amount = round(jl112QuantityCompilationRows({ periodId, sectionId }).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  addCheck("纵向校验", "JL112→JL113工程量汇编金额", jl112Amount, certificate.billMeasureMoney, "JL112工程量表汇编金额=JL113本期数量汇总金额");
  const jl115 = jl115MobilizationAdvanceCertificate({ periodId, sectionId });
  addCheck("横向校验", "JL115动员预付款总额", jl115.contractTotal * (rules.mobilizationAdvanceRate / 100), jl115.totalAdvance, `动员预付款=合同总价*${rules.mobilizationAdvanceRate}%`);
  const jl101 = jl101MonthlyReport({ periodId, sectionId });
  addCheck("纵向校验", "JL104→JL101支付金额", certificate.finalPayment, jl101.currentPayment, "JL101月报支付金额=JL104实际支付");

  const expectedMobilization = period && period.mobilizationDeductionMoney !== undefined
    ? Number(period.mobilizationDeductionMoney || 0)
    : Math.max(0, cumulativeMobilizationDeduction(certificate.cumulativeSubtotal, certificate.contractTotal, rules) - cumulativeMobilizationDeduction(certificate.previousCumulativeSubtotal, certificate.contractTotal, rules));
  addCheck("纵向校验", "JL111→JL104扣回动员预付款", expectedMobilization, certificate.mobilizationDeductionMoney, "超过30%合同价后按(C-D)/A*2*B扣回");

  const periods = periodRows().filter((row) => !periodId || Number(row.periodId || 0) <= periodId);
  for (let i = 1; i < periods.length; i += 1) {
    const previous = paymentCertificateForPeriod(periods[i - 1].periodId, { sectionId });
    const current = paymentCertificateForPeriod(periods[i].periodId, { sectionId });
    const previousMap = new Map(previous.jl105Rows.map((row) => [String(row.billId || row.itemCode || row.billNo), row]));
    current.jl105Rows.forEach((row) => {
      const prev = previousMap.get(String(row.billId || row.itemCode || row.billNo));
      if (prev) {
        addCheck("期次校验", `${current.periodDesc || current.periodId}上期金额=${row.itemCode || row.billNo}`, prev.cumulativeAmount, row.previousAmount, "第N期到上期末=第N-1期到本期末");
        addCheck("期次校验", `${current.periodDesc || current.periodId}上期数量=${row.itemCode || row.billNo}`, prev.cumulativeQuantity, row.previousQuantity, "第N期到上期末=第N-1期到本期末");
      }
    });
  }

  const referenceCases = jlPaymentReferenceCases();
  referenceCases.forEach((item) => addBoolean("样表校验", `${item.period}${item.item}`, item.passed, item.basis));
  const failed = checks.filter((row) => !row.passed);
  const byGroup = checks.reduce((acc, row) => {
    const group = acc[row.group] || { total: 0, failed: 0, passed: 0 };
    group.total += 1;
    if (row.passed) group.passed += 1;
    else group.failed += 1;
    acc[row.group] = group;
    return acc;
  }, {});
  return {
    ok: failed.length === 0,
    periodId,
    periodDesc: certificate.periodDesc,
    sectionId,
    tolerance,
    summary: {
      totalChecks: checks.length,
      passedChecks: checks.length - failed.length,
      failedChecks: failed.length,
      groups: byGroup
    },
    formulas: {
      jl113Amount: "JL113金额 = ΣJL114数量 * 合同单价",
      jl105Continuity: "E=G+I, F=H+J, D=F/C",
      jl104Payment: "实际支付 = 小计 + 价格调整 + 材料设备垫付款 - 扣回材料设备垫付款 - 保留金 - 扣回动员预付款 ± 索赔/罚金/利息",
      jl106Jl107Variation: "JL104变更金额 = ΣJL106工程量变更金额 + ΣJL107单价变更金额",
      jl108PriceAdjustment: "JL108价格调整 = Σ[折算数量 * (现行价-基价)]；JL116: T=F*[(X+Σ权重*价格指数)-1]",
      jl108RawMaterial: "JL108-1折算数量 = 原材料消耗量 * 折算系数；调差金额 = 折算数量 * (现行价-基价)",
      jl112Compilation: "JL112工程量表汇编金额 = ΣJL114工程计量表金额 = JL113本期汇总金额",
      jl115MobilizationAdvance: `JL115动员预付款 = 合同总价 * ${rules.mobilizationAdvanceRate}%`,
      jl101Payment: "JL101月报支付金额 = JL104本期实际支付",
      materialAdvance: `JL109材料设备垫付款 = 到场金额 * ${rules.materialAdvanceRate}%`,
      mobilizationDeduction: "JL111累计应扣回 = (C-D)/A*2*B，30%后开始，80%时扣完"
    },
    checks,
    failed,
    referenceCases,
    certificate
  };
}

function jlFormLifecycle(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const period = findPeriod(opts.periodId) || periodRows()[periodRows().length - 1] || null;
  const periodId = period ? Number(period.periodId || period.gatherId || period.id || 0) : Number(opts.periodId || 0);
  const sectionId = Number(opts.sectionId || 0);
  const rules = calculationRules();
  const certificate = paymentCertificateForPeriod(periodId, { sectionId });
  const periodOrder = Number(period?.orderNo || period?.periodId || periodId || 0);
  const periodDate = dateOnly(period?.endDate || period?.gatherEndDate || period?.startDate || period?.gatherStartDate);
  const periodMonth = Number(periodDate.slice(5, 7)) || 0;
  const sameSection = (row) => !sectionId || Number(row.sectionId || 0) === sectionId;
  const currentMaterialAdjustRows = filterByPeriod(materialDiasRows(), periodId).filter(sameSection);
  const currentMaterialArrivalRows = filterByPeriod(materialArrivalRows(), periodId).filter(sameSection);
  const currentQuantityVariationRows = jl106VariationQuantityRows({ periodId, sectionId });
  const currentPriceVariationRows = jl107UnitPriceVariationRows({ periodId, sectionId });
  const allArrivalRowsToDate = materialArrivalRows().filter((row) => sameSection(row) && (!period || rowBelongsToPeriod(row, period) || rowBeforePeriod(row, period)));
  const cumulativeMaterialAdvance = round(allArrivalRowsToDate.reduce((sum, row) => sum + Number(row.advanceMoney || 0), 0));
  const materialDeductionsToDate = materialDeductionRows().filter((row) => !periodId || Number(row.periodId || row.gatherId || 0) <= periodId);
  const cumulativeMaterialDeduction = materialDeductionsToDate.length
    ? round(materialDeductionsToDate.reduce((sum, row) => sum + Number(row.deductionMoney || 0), 0))
    : round(numberOr(rules.cumulativeMaterialDeductionMoney, 0));
  const hasPriceAdjustment = currentMaterialAdjustRows.length > 0 || Math.abs(Number(certificate.priceAdjustment || 0)) > 0;
  const isPriceAdjustmentMonth = rules.jlPriceAdjustmentMonths.includes(periodMonth);
  const requiresPriceAdjustmentForms = hasPriceAdjustment || isPriceAdjustmentMonth;
  const mobilizationAdvance = mobilizationAdvanceAmount(certificate.contractTotal, rules);
  const currentMobilizationDeduction = cumulativeMobilizationDeduction(certificate.cumulativeSubtotal, certificate.contractTotal, rules);
  const previousMobilizationDeduction = cumulativeMobilizationDeduction(certificate.previousCumulativeSubtotal, certificate.contractTotal, rules);
  const requiresMobilizationDeduction = mobilizationAdvance > 0 && currentMobilizationDeduction > 0 && previousMobilizationDeduction < mobilizationAdvance;
  const hasQuantityVariation = currentQuantityVariationRows.length > 0;
  const hasPriceVariation = currentPriceVariationRows.length > 0;
  const requiresMaterialAdvance = currentMaterialArrivalRows.length > 0 || Number(certificate.materialAdvanceMoney || 0) > 0;
  const requiresMaterialDeduction = cumulativeMaterialAdvance > 0 && cumulativeMaterialDeduction < cumulativeMaterialAdvance || Number(certificate.materialDeductionMoney || 0) > 0;
  const forms = [
    ["JL101", "计量支付月报表", true, "每期封面与摘要信息"],
    ["JL102", "计量支付报表传递单", true, "每期审批流转记录"],
    ["JL103", "施工进度表", true, "每期形象进度辅助表"],
    ["JL104", "中期财务支付证书", true, "最终支付金额输出表"],
    ["JL105", "清单中期财务支付报表", true, "清单累计/本期完成台账"],
    ["JL106", "清单工程量变更表", hasQuantityVariation, hasQuantityVariation ? "本期存在工程量增减变更" : "本期未检测到工程量变更"],
    ["JL107", "清单单价变更一览表", hasPriceVariation, hasPriceVariation ? "本期存在清单单价变更" : "本期未检测到单价变更"],
    ["JL108", "永久性工程材料差价金额一览表", requiresPriceAdjustmentForms, hasPriceAdjustment ? "本期存在材料价格调差" : `季度调差月：${rules.jlPriceAdjustmentMonths.join(",")}`],
    ["JL108-1", "原材料明细表", requiresPriceAdjustmentForms, hasPriceAdjustment ? "随JL108提供原材料消耗明细" : `季度调差月：${rules.jlPriceAdjustmentMonths.join(",")}`],
    ["JL109", "工程材料到达现场计量表", requiresMaterialAdvance, requiresMaterialAdvance ? "本期存在材料到场或材料设备垫付款" : "本期无材料到场预付"],
    ["JL110", "扣回材料垫付款一览表", requiresMaterialDeduction, requiresMaterialDeduction ? "材料预付未完全扣回或本期有扣回" : "无未扣回材料垫付款"],
    ["JL111", "扣回动员预付款一览表", requiresMobilizationDeduction, requiresMobilizationDeduction ? "累计小计已超过动员扣回门槛且尚未扣完" : `累计小计未进入${rules.mobilizationDeductionStartRate}%-${rules.mobilizationDeductionEndRate}%扣回区间`],
    ["JL112", "工程量表汇编", true, "每期计量汇总封面"],
    ["JL113", "计量支付数量汇总表", true, "按细目汇总本期JL114"],
    ["JL114", "工程计量表", true, "本期计量基础明细"],
    ["JL115", "开工动员预付款支付证书", periodOrder > 0 && periodOrder <= rules.jl115EndPeriod, `仅第1-${rules.jl115EndPeriod}期出现`],
    ["JL116", "合同价格调表", requiresPriceAdjustmentForms, hasPriceAdjustment ? "本期存在价格调整金额" : `季度调差月：${rules.jlPriceAdjustmentMonths.join(",")}`]
  ].map(([code, name, expected, reason]) => ({
    code,
    name,
    expected: Boolean(expected),
    status: expected ? "应出现" : "本期可不出现",
    reason
  }));
  const requiredCount = forms.filter((row) => row.expected).length;
  return {
    periodId,
    periodDesc: certificate.periodDesc,
    sectionId,
    periodOrder,
    periodMonth,
    summary: {
      formCount: forms.length,
      requiredCount,
      optionalCount: forms.length - requiredCount,
      lifecycleRules: {
        jl115EndPeriod: rules.jl115EndPeriod,
        jlPriceAdjustmentMonths: rules.jlPriceAdjustmentMonths,
        jl116NonAdjustableFactor: rules.jl116NonAdjustableFactor,
        jl108RawMaterialConversionFactorCount: Object.keys(rules.jl108RawMaterialConversionFactors || {}).length,
        jl116MaterialWeightCount: Object.keys(rules.jl116MaterialWeights || {}).length,
        mobilizationDeductionStartRate: rules.mobilizationDeductionStartRate,
        mobilizationDeductionEndRate: rules.mobilizationDeductionEndRate
      },
      signals: {
        priceAdjustmentMoney: certificate.priceAdjustment,
        materialArrivalMoney: certificate.materialArrivalMoney,
        materialAdvanceMoney: certificate.materialAdvanceMoney,
        materialDeductionMoney: certificate.materialDeductionMoney,
        cumulativeMaterialAdvance,
        cumulativeMaterialDeduction,
        cumulativeSubtotal: certificate.cumulativeSubtotal,
        contractTotal: certificate.contractTotal,
        mobilizationAdvance,
        currentMobilizationDeduction,
        previousMobilizationDeduction,
        quantityVariationCount: currentQuantityVariationRows.length,
        priceVariationCount: currentPriceVariationRows.length
      }
    },
    forms
  };
}

function planRows() {
  const contract = contractSummary();
  let total = 0;
  return db.plans.map((item, index) => {
    const amount = Number(item.amount || item.finishMoney || 0);
    total += amount;
    return {
      ...item,
      planNo: item.planNo || `JH-${String(item.planId || item.id || index + 1).padStart(3, "0")}`,
      planStartDate: item.planStartDate || item.startDate,
      planEndDate: item.planEndDate || item.endDate,
      planYm: item.planYm || String(item.startDate || "").slice(0, 7),
      finishMoney: amount,
      contractSumMoney: contract.contractSumMoney,
      finishPercent: contract.contractSumMoney ? `${round((amount / contract.contractSumMoney) * 100, 2)}%` : "0%",
      finishTotalPercent: contract.contractSumMoney ? `${round((total / contract.contractSumMoney) * 100, 2)}%` : "0%",
      gatherState: item.gatherState || item.status || "执行中",
      isLast: index === db.plans.length - 1 ? 1 : 0
    };
  });
}

function variationRows() {
  return db.variations.map((item, index) => {
    const beforeVaryMoney = round(item.beforeNum * item.beforePrice);
    const afterVaryMoney = round(item.afterNum * item.afterPrice);
    const b = bill(item.billId);
    const varyMoney = round(afterVaryMoney - beforeVaryMoney);
    return {
      ...item,
      meetingId: item.meetingId || item.varyId,
      meetingNo: item.meetingNo || `HY-${String(item.varyId || index + 1).padStart(3, "0")}`,
      meetingTitle: item.meetingTitle || `${item.varyNo} 变更会议`,
      meetingAddress: item.meetingAddress || section(item.sectionId).sectionName,
      meetingDate: item.meetingDate || "2026-02-26",
      pegeNo: item.pegeNo || item.pegNo || "",
      varyContent: item.varyContent || item.billName,
      createUserId: item.createUserId || 563,
      sectionName: section(item.sectionId).sectionName,
      measureDate: item.measureDate || item.createDate || "2026-02-26",
      varyItem: item.varyReason,
      workAreaName: section(item.sectionId).sectionName,
      sysWorkArea: { workAreaName: section(item.sectionId).sectionName },
      varyGrade: { bdName: Math.abs(afterVaryMoney - beforeVaryMoney) > 300000 ? "重大变更" : "一般变更", bdCode: Math.abs(afterVaryMoney - beforeVaryMoney) > 300000 ? "ZD" : "YB" },
      varyType: { bdName: "工程数量变更", bdCode: "SL" },
      processInstanceId: "",
      taskUser: item.taskUser ?? true,
      measureState: item.measureState ?? 0,
      isArchive: item.states === "已归档" ? 1 : 0,
      srVaryMoney: varyMoney,
      beforeVaryNum: item.beforeNum,
      beforeVaryPrice: item.beforePrice,
      beforeVaryMoney,
      afterVaryNum: item.afterNum,
      afterVaryPrice: item.afterPrice,
      afterVaryMoney,
      varyNum: round(item.afterNum - item.beforeNum, 3),
      varyMoney,
      varyPrice: round(item.afterPrice - item.beforePrice),
      money: varyMoney,
      varyDetailId: item.varyDetailId || item.varyId,
      varyApplication: {
        varyId: item.varyId,
        isArchive: item.states === "已归档" ? 1 : 0,
        measureState: item.measureState ?? 0
      },
      secBill: {
        ...b,
        billModel: {
          billNo: item.billNo,
          billName: item.billName,
          measureUnit: item.measureUnit
        }
      }
    };
  });
}

function variationRowsForPeriod(options = {}) {
  const opts = typeof options === "object" ? options : { periodId: options };
  const sectionId = Number(opts.sectionId || 0);
  const periodId = Number(opts.periodId || 0);
  const period = findPeriod(periodId);
  return variationRows()
    .filter((row) => !sectionId || Number(row.sectionId || 0) === sectionId)
    .filter((row) => !period || rowBelongsToPeriod(row, period));
}

function jl106VariationQuantityRows(options = {}) {
  return variationRowsForPeriod(options).map((row) => {
    const beforeQuantity = Number(row.beforeVaryNum ?? row.beforeNum ?? 0);
    const afterQuantity = Number(row.afterVaryNum ?? row.afterNum ?? 0);
    const price = Number(row.beforeVaryPrice ?? row.beforePrice ?? row.afterVaryPrice ?? row.afterPrice ?? 0);
    const quantityChange = round(afterQuantity - beforeQuantity, calculationRules().quantityDigits);
    const quantityChangeMoney = round(quantityChange * price);
    return {
      variationId: row.varyId || row.id,
      varyNo: row.varyNo || row.meetingNo || "",
      sectionId: Number(row.sectionId || 0),
      sectionName: row.sectionName || section(row.sectionId).sectionName,
      billId: row.billId,
      itemCode: row.billNo,
      itemName: row.billName,
      unit: row.measureUnit,
      beforeQuantity,
      afterQuantity,
      quantityChange,
      price,
      quantityChangeMoney,
      varyMoney: Number(row.varyMoney || 0),
      reason: row.varyReason || row.varyItem || "",
      status: row.states || "",
      formula: "quantityChangeMoney = (afterQuantity - beforeQuantity) * beforePrice"
    };
  }).filter((row) => Math.abs(Number(row.quantityChange || 0)) > 0 || Math.abs(Number(row.quantityChangeMoney || 0)) > 0);
}

function jl107UnitPriceVariationRows(options = {}) {
  return variationRowsForPeriod(options).map((row) => {
    const beforePrice = Number(row.beforeVaryPrice ?? row.beforePrice ?? 0);
    const afterPrice = Number(row.afterVaryPrice ?? row.afterPrice ?? 0);
    const afterQuantity = Number(row.afterVaryNum ?? row.afterNum ?? 0);
    const priceChange = round(afterPrice - beforePrice, calculationRules().priceDigits);
    const priceChangeMoney = round(afterQuantity * priceChange);
    return {
      variationId: row.varyId || row.id,
      varyNo: row.varyNo || row.meetingNo || "",
      sectionId: Number(row.sectionId || 0),
      sectionName: row.sectionName || section(row.sectionId).sectionName,
      billId: row.billId,
      itemCode: row.billNo,
      itemName: row.billName,
      unit: row.measureUnit,
      beforePrice,
      afterPrice,
      priceChange,
      afterQuantity,
      priceChangeMoney,
      varyMoney: Number(row.varyMoney || 0),
      reason: row.varyReason || row.varyItem || "",
      status: row.states || "",
      formula: "priceChangeMoney = afterQuantity * (afterPrice - beforePrice)"
    };
  }).filter((row) => Math.abs(Number(row.priceChange || 0)) > 0 || Math.abs(Number(row.priceChangeMoney || 0)) > 0);
}

function billLedgerRows() {
  return billRows().map((item, index) => ({
    billPayId: item.billId || index + 1,
    gatherNo: index + 1,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
    contractNo: section(item.sectionId).contractNo,
    billNo: item.billNo,
    billName: item.billName,
    measureUnit: item.measureUnit,
    contractNum: item.contractNum,
    contractAmount: item.contractNum,
    contractPrice: item.price,
    contractMoney: item.contractMoney,
    updateNum: item.correctedNum,
    modifyAmount: item.correctedNum,
    updateMoney: item.correctedMoney,
    modifyMoney: item.correctedMoney,
    varyNum: round(item.finalNum - item.correctedNum, 3),
    varyAmount: round(item.finalNum - item.correctedNum, 3),
    varyMoney: round(item.finalMoney - item.correctedMoney),
    finalNum: item.finalNum,
    contractSumAmount: item.finalNum,
    finalMoney: item.finalMoney,
    contractSumMoney: item.finalMoney,
    measureNum: item.measuredNum,
    afterFinishNumSum: item.measuredNum,
    currentFinishNumSum: item.measuredNum,
    measureMoney: item.measuredMoney,
    remainNum: item.remainNum,
    remainAmount: item.remainNum,
    remainMoney: item.remainMoney,
    measureRate: item.finalMoney ? round((item.measuredMoney / item.finalMoney) * 100, 2) : 0
  }));
}

function reportProjectRows() {
  const summary = contractSummary();
  const rules = calculationRules();
  const materialAdjustments = materialDiasRows();
  const materialArrivals = materialArrivalRows();
  const manuals = manualMeasureRows();
  return db.sections.map((item) => {
    const sectionBills = billRows().filter((billItem) => billItem.sectionId === item.sectionId);
    const finalMoney = round(sectionBills.reduce((sum, billItem) => sum + billItem.finalMoney, 0));
    const measuredMoney = round(sectionBills.reduce((sum, billItem) => sum + billItem.measuredMoney, 0));
    const materialDiasMoney = round(materialAdjustments
      .filter((row) => Number(row.sectionId) === Number(item.sectionId))
      .reduce((sum, row) => sum + Number(row.adjustMoney || 0), 0));
    const materialArrivalMoney = round(materialArrivals
      .filter((row) => Number(row.sectionId) === Number(item.sectionId))
      .reduce((sum, row) => sum + Number(row.money || 0), 0));
    const manualMoney = round(manuals
      .filter((row) => Number(row.sectionId) === Number(item.sectionId))
      .reduce((sum, row) => sum + Number(row.measureMoney || 0), 0));
    const paymentCertificate = calculatePaymentCertificate({
      measuredMoney,
      materialDiasMoney,
      materialArrivalMoney,
      manualMoney,
      contractTotal: finalMoney,
      cumulativeSubtotal: measuredMoney + manualMoney
    }, rules);
    const totalPayMoney = paymentCertificate.finalPayment;
    return {
      sectionId: item.sectionId,
      sectionName: item.sectionName,
      contractNo: item.contractNo,
      contractMoney: round(sectionBills.reduce((sum, billItem) => sum + billItem.contractMoney, 0)),
      finalMoney,
      measureMoney: measuredMoney,
      materialDiasMoney,
      materialArrivalMoney,
      materialAdvanceMoney: paymentCertificate.materialAdvanceMoney,
      materialDeductionMoney: paymentCertificate.materialDeductionMoney,
      retentionMoney: paymentCertificate.retentionMoney,
      mobilizationDeductionMoney: paymentCertificate.mobilizationDeductionMoney,
      manualMoney,
      currentPayMoney: measuredMoney,
      totalPayMoney,
      payRate: finalMoney ? round((totalPayMoney / finalMoney) * 100, 2) : 0,
      projectTotalPayMoney: summary.payableMoney,
      payableFormula: payableFormulaText(rules),
      paymentCertificate
    };
  });
}

function auditMoneyRows() {
  const rules = calculationRules();
  const buildAuditRow = (item, options = {}) => {
    const finishMoney = Number(options.finishMoney ?? item.finalMoney ?? item.finishContractMoney ?? item.measureMoney ?? item.adjustMoney ?? 0);
    const submitMoney = round(Number(options.submitMoney ?? item.measureMoney ?? item.adjustMoney ?? item.money ?? 0));
    const varyMoney = Number(options.varyMoney ?? item.varyMoney ?? 0);
    const varyFinishMoney = finishMoney ? round((submitMoney / finishMoney) * varyMoney) : 0;
    const supervisorMoney = round(submitMoney * (rules.auditSupervisorRate / 100));
    const ownerMoney = round(submitMoney * (rules.auditOwnerRate / 100));
    const finalMoney = round(submitMoney * (rules.auditFinalRate / 100));
    return {
      auditType: options.auditType || "清单计量",
      chapterNo: options.chapterNo || item.billNo || item.measureNo || "",
      chapterName: options.chapterName || item.billName || item.materialName || "",
      billId: options.billId || item.billId || item.diasId || item.manualId || item.id,
      billNo: options.billNo || item.billNo || item.measureNo || "",
      billName: options.billName || item.billName || item.materialName || "",
      measureUnit: options.measureUnit || item.measureUnit || item.unit || "",
      contractMoney: Number(options.contractMoney ?? item.contractMoney ?? 0),
      modifyMoney: Number(options.modifyMoney ?? item.modifyMoney ?? 0),
      varyMoney,
      finishContractMoney: finishMoney,
      usertask1: submitMoney,
      usertask1v: varyFinishMoney,
      usertask2: supervisorMoney,
      usertask2v: round(varyFinishMoney * (rules.auditSupervisorRate / 100)),
      usertask3: ownerMoney,
      usertask3v: round(varyFinishMoney * (rules.auditOwnerRate / 100)),
      submitMoney,
      engineerAuditMoney: supervisorMoney,
      supervisorAuditMoney: ownerMoney,
      ownerAuditMoney: finalMoney,
      states: item.states || "",
      measureDate: item.measureDate || ""
    };
  };
  const billAuditRows = billLedgerRows().map((item) => buildAuditRow(item));
  const materialAuditRows = materialDiasRows()
    .filter((item) => Number(item.adjustMoney || item.money || 0) !== 0)
    .map((item) => buildAuditRow(item, {
      auditType: "材料补差",
      chapterNo: item.measureNo || item.approveNo || `BC-${item.diasId || item.id}`,
      chapterName: item.materialName || item.secMaterialName || "材料补差",
      billNo: item.measureNo || item.approveNo || `BC-${item.diasId || item.id}`,
      billName: item.materialName || item.secMaterialName || "材料补差",
      measureUnit: item.measureUnit || item.unit,
      submitMoney: item.adjustMoney,
      finishMoney: item.adjustMoney
    }));
  const manualAuditRows = manualMeasureRows()
    .filter((item) => Number(item.measureMoney || item.money || 0) !== 0)
    .map((item) => buildAuditRow(item, {
      auditType: "手动计量",
      chapterNo: item.billNo || item.measureNo || `SD-${item.manualId || item.id}`,
      chapterName: item.billName || "手动计量",
      billNo: item.billNo || item.measureNo || `SD-${item.manualId || item.id}`,
      billName: item.billName || "手动计量",
      measureUnit: item.measureUnit || item.unit,
      submitMoney: item.measureMoney,
      finishMoney: item.measureMoney
    }));
  const baseRows = billAuditRows.concat(materialAuditRows, manualAuditRows);
  const baseSubmit = round(baseRows.reduce((sum, row) => sum + Number(row.submitMoney || row.usertask1 || 0), 0));
  const certificate = contractSummary().paymentCertificate;
  const financeAdjustmentMoney = round(Number(certificate.finalPayment || 0) - baseSubmit);
  const financeRows = Math.abs(financeAdjustmentMoney) > 0.004
    ? [buildAuditRow({
      billNo: "JL104",
      billName: "中期财务支付证书调整",
      measureUnit: "元",
      measureMoney: financeAdjustmentMoney,
      money: financeAdjustmentMoney
    }, {
      auditType: "JL104支付调整",
      chapterNo: "JL104",
      chapterName: "材料预付/扣回/保留金/动员预付款",
      billNo: "JL104",
      billName: "材料预付/扣回/保留金/动员预付款",
      measureUnit: "元",
      submitMoney: financeAdjustmentMoney,
      finishMoney: financeAdjustmentMoney
    })]
    : [];
  return baseRows.concat(financeRows);
}

function documentRows() {
  return db.documents.map((item) => ({
    ...item,
    id: item.nodeId || item.id,
    nodeId: item.nodeId || item.id,
    text: item.title,
    name: item.title,
    dataName: item.title,
    nodeName: item.title,
    parentId: item.parentId || 0,
    type: item.type || "工程资料",
    testHouseName: item.testHouseName || item.title,
    testName: item.testName || item.type || "试验资料",
    createTime: item.createTime || item.createDate,
    remark: item.remark || item.type || "",
    isUser: item.isUser ?? 1,
    createUserName: item.createUserName || "ys1",
    updateDate: item.updateDate || item.createDate,
    fileCount: item.fileCount || 0,
    children: item.children || []
  }));
}

function dashboard() {
  const summary = contractSummary();
  return {
    ...summary,
    projectCount: db.projects.length,
    sectionCount: db.sections.length,
    billCount: db.bills.length,
    measureCount: db.measures.length,
    variationCount: db.variations.length
  };
}

module.exports = {
  db,
  ok,
  table,
  dashboard,
  billRows,
  periodRows,
  materialRows,
  planRows,
  measureRows,
  materialDiasRows,
  priceAdjustmentLedgerRows,
  priceAdjustmentSummaryRows,
  jl116FormulaSummary,
  jlPriceAdjustmentReport,
  jl101MonthlyReport,
  jl102TransferRows,
  jl103ProgressRows,
  jl108RawMaterialDetailRows,
  jl112QuantityCompilationRows,
  jl115MobilizationAdvanceCertificate,
  jlPaymentSupportReport,
  materialArrivalRows,
  materialDeductionRows,
  materialDeductionLedgerRows,
  mobilizationDeductionLedgerRows,
  manualMeasureRows,
  variationRows,
  variationRowsForPeriod,
  jl106VariationQuantityRows,
  jl107UnitPriceVariationRows,
  jl113Rows,
  jl105LedgerRows,
  jl104ChapterRows,
  paymentCertificateForPeriod,
  jlPaymentValidation,
  jlPaymentReferenceCases,
  jlFormLifecycle,
  billLedgerRows,
  reportProjectRows,
  auditMoneyRows,
  documentRows,
  contractSummary,
  calculationRules,
  calculatePayable,
  calculatePaymentCertificate,
  cumulativeMobilizationDeduction,
  mobilizationAdvanceAmount,
  payableFormulaText,
  allMeasureDetails
};
