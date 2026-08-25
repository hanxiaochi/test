"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const fidic = require("../../lib/international/fidic-core");

test("certificate totals additions, deductions, retention cap, and release", () => {
  const result = fidic.calculateCertificate({
    previousRetention: 80,
    retentionRelease: 20,
    previousCumulativeCertified: 5000,
    lines: [
      { code: "WORK", category: "work", amount: 1000, currency: "USD" },
      { code: "VO", category: "variation", amount: 100, currency: "USD" },
      { code: "ADV-REC", category: "advanceRepayment", amount: 50, currency: "USD" }
    ]
  }, { baseCurrency: "USD", retentionRate: 10, retentionLimitAmount: 200 });
  assert.deepEqual(result.totals, {
    lineAdditions: "1100.00",
    lineDeductions: "50.00",
    retentionEligibleBase: "1100.00",
    currentRetention: "110.00",
    previousRetention: "80.00",
    retentionRelease: "20.00",
    grossCertified: "1120.00",
    totalDeductions: "160.00",
    netCertified: "960.00",
    minimumCertificateAmount: "0.00",
    payableNow: "960.00",
    carriedForward: "0.00",
    previousCumulativeCertified: "5000.00",
    cumulativeCertified: "5960.00"
  });
});

test("multi-currency lines use direct, shorthand, explicit, and inverse rates", () => {
  const result = fidic.calculateCertificate({ lines: [
    { code: "USD", category: "work", amount: "100.25", currency: "USD" },
    { code: "EUR", category: "variation", amount: 10, currency: "EUR" },
    { code: "GBP", category: "claims", amount: 10, currency: "GBP" },
    { code: "AED", category: "interest", amount: 10, currency: "AED", exchangeRate: 2 },
    { code: "CNY", category: "tax", amount: 10, currency: "CNY" }
  ] }, {
    baseCurrency: "CNY",
    exchangeRates: { "USD:CNY": "7.2", EUR: 8, "CNY:GBP": 0.1 },
    retentionRate: 5
  });
  assert.equal(result.lines.find((line) => line.code === "USD").baseAmount, "721.80");
  assert.equal(result.lines.find((line) => line.code === "EUR").baseAmount, "80.00");
  assert.equal(result.lines.find((line) => line.code === "GBP").baseAmount, "100.00");
  assert.equal(result.lines.find((line) => line.code === "AED").baseAmount, "20.00");
  assert.equal(result.totals.retentionEligibleBase, "801.80");
  assert.equal(result.totals.currentRetention, "40.09");
  assert.deepEqual(result.originalCurrencyTotals.map((row) => row.currency), ["AED", "CNY", "EUR", "GBP", "USD"]);
});

test("currency digits and minimum-certificate carry forward are deterministic", () => {
  const result = fidic.calculateCertificate({ lines: [
    { code: "JP-WORK", category: "work", amount: "100.5", currency: "JPY" }
  ] }, { baseCurrency: "JPY", retentionRate: 0, minimumCertificateAmount: 200 });
  assert.equal(result.lines[0].amount, "101");
  assert.equal(result.totals.netCertified, "101");
  assert.equal(result.totals.payableNow, "0");
  assert.equal(result.totals.carriedForward, "101");
  assert.equal(fidic.fixed("1.2345", 3), "1.235");
  assert.equal(fidic.digitsFor("KWD"), 3);
  assert.equal(fidic.digitsFor("USD", { moneyDigits: 4 }), 4);
});

test("empty and negative-net certificates remain explicit", () => {
  const empty = fidic.calculateCertificate({}, { baseCurrency: "USD" });
  assert.equal(empty.totals.netCertified, "0.00");
  const negative = fidic.calculateCertificate({ lines: [
    { code: "DEDUCTION", category: "otherDeduction", amount: 25, currency: "USD" }
  ] }, { baseCurrency: "USD" });
  assert.equal(negative.totals.netCertified, "-25.00");
  assert.equal(negative.totals.payableNow, "-25.00");
});

test("invalid contracts fail closed with actionable errors", () => {
  assert.throws(() => fidic.calculateCertificate({ lines: {} }), /array/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ category: "work", amount: 1 }] }), /code is required/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: 1 }, { code: "A", category: "work", amount: 2 }] }), /duplicate/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "unknown", amount: 1 }] }), /unsupported/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: -1 }] }), /negative/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: "bad" }] }), /finite decimal/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: 1, currency: "US" }] }), /three-letter/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: 1, currency: "EUR" }] }, { baseCurrency: "USD" }), /Missing exchange rate/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: 1, currency: "EUR" }] }, { baseCurrency: "USD", exchangeRates: { EUR: 0 } }), /must be positive/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: 1, currency: "EUR" }] }, { baseCurrency: "USD", exchangeRates: { "USD:EUR": 0 } }), /must be positive/);
  assert.throws(() => fidic.calculateCertificate({ lines: [{ code: "A", category: "work", amount: 1, currency: "EUR", exchangeRate: -1 }] }, { baseCurrency: "USD" }), /must be positive/);
  assert.throws(() => fidic.calculateCertificate({ lines: [] }, { baseCurrency: "USD", retentionRate: 101 }), /exceed 100/);
  assert.throws(() => fidic.calculateCertificate({ previousRetention: 10, retentionRelease: 11 }, { baseCurrency: "USD" }), /release exceeds/);
  assert.throws(() => fidic.calculateCertificate({ lines: [] }, { baseCurrency: "USD", retentionEligibleCategories: ["tax"] }), /invalid retention/);
  assert.throws(() => fidic.digitsFor("USD", { moneyDigits: 5 }), /Invalid currency digits/);
  assert.throws(() => fidic.currencyCode("12"), /three-letter/);
});
