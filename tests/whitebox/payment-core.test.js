"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const payment = require("../../lib/payment-core");

function rules(overrides = {}) {
  return {
    moneyDigits: 2,
    includeBillMeasure: true,
    includeManualMeasure: true,
    includeMaterialAdjust: true,
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
    ...overrides
  };
}

test("numeric helpers normalize invalid input and signs", () => {
  assert.equal(payment.numberOr("12.5"), 12.5);
  assert.equal(payment.numberOr("bad", 7), 7);
  assert.equal(payment.round("1.236", 2), 1.24);
  assert.equal(payment.round(undefined), 0);
  assert.equal(payment.positive(-9), 9);
});

test("formula text reflects enabled calculation branches", () => {
  const full = payment.payableFormulaText(rules());
  assert.match(full, /清单计量/);
  assert.match(full, /手动计量/);
  assert.match(full, /价格调整/);
  assert.match(full, /材料设备垫付款/);
  assert.match(full, /保留金/);

  const minimal = payment.payableFormulaText(rules({
    includeBillMeasure: false,
    includeManualMeasure: false,
    includeMaterialAdjust: false,
    includeMaterialAdvance: false,
    includeRetention: false
  }));
  assert.match(minimal, /小计\(0\)/);
  assert.doesNotMatch(minimal, /价格调整/);
  assert.doesNotMatch(minimal, /保留金/);
});

test("material deduction precedence covers explicit, cumulative, and configured values", () => {
  assert.equal(payment.configuredMaterialDeduction({ materialDeductionMoney: -80 }, rules()), 80);
  assert.equal(payment.configuredMaterialDeduction({ cumulativeMaterialDeductionMoney: 500, previousMaterialDeductionMoney: 350 }, rules()), 150);
  assert.equal(payment.configuredMaterialDeduction({}, { materialDeductionMoney: -25 }), 25);
});

test("mobilization deduction covers invalid, start, linear, and completion ranges", () => {
  const config = rules();
  assert.equal(payment.mobilizationAdvanceAmount(1000, config), 100);
  assert.equal(payment.cumulativeMobilizationDeduction(500, 0, config), 0);
  assert.equal(payment.cumulativeMobilizationDeduction(300, 1000, config), 0);
  assert.equal(payment.cumulativeMobilizationDeduction(550, 1000, config), 50);
  assert.equal(payment.cumulativeMobilizationDeduction(800, 1000, config), 100);
});

test("certificate computes the complete JL104 payment chain", () => {
  const result = payment.calculatePaymentCertificate({
    measuredMoney: 1000,
    manualMoney: 100,
    provisionalCurrentMoney: 50,
    materialDiasMoney: 200,
    materialArrivalMoney: 500,
    cumulativeMaterialDeductionMoney: 100,
    previousMaterialDeductionMoney: 40,
    contractTotal: 10000,
    previousCumulativeSubtotal: 2000,
    cumulativeSubtotal: 4000,
    mobilizationAdvanceMoney: 500,
    claimsMoney: 30,
    penaltyMoney: -20,
    interestMoney: 10,
    otherAdjustmentMoney: -5
  }, rules());

  assert.deepEqual({
    subtotal: result.subtotal,
    priceAdjustment: result.priceAdjustment,
    materialAdvanceMoney: result.materialAdvanceMoney,
    materialDeductionMoney: result.materialDeductionMoney,
    retentionBase: result.retentionBase,
    retentionMoney: result.retentionMoney,
    mobilizationDeductionMoney: result.mobilizationDeductionMoney,
    finalPayment: result.finalPayment
  }, {
    subtotal: 1150,
    priceAdjustment: 200,
    materialAdvanceMoney: 300,
    materialDeductionMoney: 60,
    retentionBase: 1350,
    retentionMoney: 135,
    mobilizationDeductionMoney: 200,
    finalPayment: 1770
  });
  assert.equal(result.payableMoney, result.finalPayment);
});

test("certificate honors explicit overrides and disabled branches", () => {
  const config = rules({
    includeBillMeasure: false,
    includeManualMeasure: false,
    includeMaterialAdjust: false,
    includeMaterialAdvance: false,
    includeRetention: false,
    provisionalCurrentMoney: 25,
    claimsMoney: 5,
    penaltyMoney: 3,
    interestMoney: 2,
    otherAdjustmentMoney: 1,
    mobilizationAdvanceMoney: 4
  });
  const result = payment.calculatePaymentCertificate({
    billMeasureMoney: 999,
    manualMeasureMoney: 999,
    materialAdjustMoney: 999,
    materialArrivalMoney: 999,
    materialAdvanceMoney: 12,
    materialDeductionMoney: 7,
    retentionMoney: 50,
    finalMoney: 1000,
    previousCumulativeSubtotal: 200,
    mobilizationDeductionMoney: -6
  }, config);

  assert.equal(result.billMeasureMoney, 0);
  assert.equal(result.manualMoney, 0);
  assert.equal(result.priceAdjustment, 0);
  assert.equal(result.materialAdvanceMoney, 12);
  assert.equal(result.retentionMoney, 0);
  assert.equal(result.mobilizationDeductionMoney, 6);
  assert.equal(result.finalPayment, 33);
  assert.equal(payment.calculatePayable({ provisionalCurrentMoney: 10 }, rules({ includeRetention: false })), 10);
});

test("certificate accepts aliases, explicit retention, and calculated previous recovery", () => {
  const config = rules({ moneyDigits: 0, cumulativeMaterialDeductionMoney: undefined, previousMaterialDeductionMoney: undefined, materialDeductionMoney: 10 });
  const result = payment.calculatePaymentCertificate({
    billMeasureMoney: "100",
    manualMeasureMoney: "20",
    materialAdjustMoney: "30",
    retentionMoney: -12,
    contractSumMoney: 1000,
    previousCumulativeSubtotal: 400,
    cumulativeSubtotal: 600,
    previousMobilizationDeductionMoney: -10
  }, config);
  assert.equal(result.materialDeductionMoney, 10);
  assert.equal(result.retentionMoney, 12);
  assert.equal(result.previousMobilizationDeductionMoney, 10);
  assert.equal(result.cumulativeMobilizationDeductionMoney, 60);
  assert.equal(result.mobilizationDeductionMoney, 50);
  assert.equal(result.finalPayment, 78);
});
