"use strict";

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  return Number(numberOr(value, 0).toFixed(digits));
}

function positive(value) {
  return Math.abs(numberOr(value, 0));
}

function payableFormulaText(rules) {
  const subtotalParts = [];
  if (rules.includeBillMeasure) subtotalParts.push("清单计量");
  if (rules.includeManualMeasure) subtotalParts.push("手动计量/暂定金额");
  const parts = [`小计(${subtotalParts.join(" + ") || "0"})`];
  if (rules.includeMaterialAdjust) parts.push("价格调整(JL108)");
  if (rules.includeMaterialAdvance) parts.push(`材料设备垫付款=材料到场金额×${rules.materialAdvanceRate}%`);
  if (rules.includeRetention) parts.push(`-保留金=${rules.retentionRate}%×(小计+价格调整)`);
  parts.push("-扣回材料设备垫付款(JL110)");
  parts.push("-扣回动员预付款(JL111)");
  return `JL104本期实际支付 = ${parts.join(" + ")}`.replace(/\+ -/g, "- ");
}

function configuredMaterialDeduction(parts, rules) {
  if (parts.materialDeductionMoney !== undefined) return positive(parts.materialDeductionMoney);
  const cumulative = parts.cumulativeMaterialDeductionMoney ?? rules.cumulativeMaterialDeductionMoney;
  const previous = parts.previousMaterialDeductionMoney ?? rules.previousMaterialDeductionMoney;
  if (cumulative !== undefined || previous !== undefined) {
    return positive(numberOr(cumulative, 0) - numberOr(previous, 0));
  }
  return positive(rules.materialDeductionMoney);
}

function mobilizationAdvanceAmount(contractTotal, rules) {
  return round(numberOr(contractTotal, 0) * (numberOr(rules.mobilizationAdvanceRate, 0) / 100), rules.moneyDigits);
}

function cumulativeMobilizationDeduction(cumulativeSubtotal, contractTotal, rules) {
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

function calculatePaymentCertificate(parts = {}, rules) {
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
  const retentionBase = round(subtotal + priceAdjustment, moneyDigits);
  const retentionMoney = rules.includeRetention
    ? positive(parts.retentionMoney !== undefined ? parts.retentionMoney : round(retentionBase * (rules.retentionRate / 100), moneyDigits))
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
    subtotal + priceAdjustment + claimsMoney + interestMoney + materialAdvanceMoney +
      mobilizationAdvanceMoney + otherAdjustmentMoney - penaltyMoney -
      materialDeductionMoney - retentionMoney - mobilizationDeductionMoney,
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
    retentionBase,
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

function calculatePayable(parts, rules) {
  return calculatePaymentCertificate(parts, rules).finalPayment;
}

module.exports = {
  calculatePayable,
  calculatePaymentCertificate,
  configuredMaterialDeduction,
  cumulativeMobilizationDeduction,
  mobilizationAdvanceAmount,
  numberOr,
  payableFormulaText,
  positive,
  round
};
