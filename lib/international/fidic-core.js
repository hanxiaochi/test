"use strict";

const Decimal = require("decimal.js");

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const ADDITION_CATEGORIES = new Set([
  "work",
  "variation",
  "priceAdjustment",
  "materialsOnSite",
  "claims",
  "advancePayment",
  "interest",
  "otherAddition"
]);
const DEDUCTION_CATEGORIES = new Set(["advanceRepayment", "tax", "penalty", "otherDeduction"]);
const DEFAULT_RETENTION_ELIGIBLE = ["work", "variation", "priceAdjustment"];
const DEFAULT_CURRENCY_DIGITS = { BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3, JPY: 0, KRW: 0, VND: 0 };

function currencyCode(value, label = "currency") {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`${label} must be a three-letter currency code`);
  return code;
}

function decimal(value, label, fallback) {
  const source = value === undefined || value === null || value === "" ? fallback : value;
  try {
    const result = new Decimal(source);
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new Error(`${label} must be a finite decimal number`);
  }
}

function nonNegative(value, label, fallback = 0) {
  const result = decimal(value, label, fallback);
  if (result.isNegative()) throw new Error(`${label} must not be negative`);
  return result;
}

function digitsFor(currency, options = {}) {
  const configured = options.currencyDigits && options.currencyDigits[currency];
  const digits = Number(configured ?? DEFAULT_CURRENCY_DIGITS[currency] ?? options.moneyDigits ?? 2);
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) throw new Error(`Invalid currency digits for ${currency}`);
  return digits;
}

function fixed(value, digits) {
  return new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits);
}

function exchangeRateFor(line, baseCurrency, rates = {}) {
  const currency = currencyCode(line.currency || baseCurrency, "line currency");
  if (currency === baseCurrency) return new Decimal(1);
  if (line.exchangeRate !== undefined && line.exchangeRate !== null && line.exchangeRate !== "") {
    const explicit = decimal(line.exchangeRate, `exchange rate ${currency}:${baseCurrency}`);
    if (!explicit.gt(0)) throw new Error(`exchange rate ${currency}:${baseCurrency} must be positive`);
    return explicit;
  }
  const directValue = rates[`${currency}:${baseCurrency}`] ?? rates[currency];
  if (directValue !== undefined) {
    const direct = decimal(directValue, `exchange rate ${currency}:${baseCurrency}`);
    if (!direct.gt(0)) throw new Error(`exchange rate ${currency}:${baseCurrency} must be positive`);
    return direct;
  }
  const inverseValue = rates[`${baseCurrency}:${currency}`];
  if (inverseValue !== undefined) {
    const inverse = decimal(inverseValue, `exchange rate ${baseCurrency}:${currency}`);
    if (!inverse.gt(0)) throw new Error(`exchange rate ${baseCurrency}:${currency} must be positive`);
    return new Decimal(1).div(inverse);
  }
  throw new Error(`Missing exchange rate ${currency}:${baseCurrency}`);
}

function normalizeLines(lines, options) {
  if (!Array.isArray(lines)) throw new Error("certificate lines must be an array");
  const seen = new Set();
  return lines.map((line, index) => {
    const code = String(line && line.code || "").trim();
    if (!code) throw new Error(`line ${index + 1} code is required`);
    if (seen.has(code)) throw new Error(`duplicate line code: ${code}`);
    seen.add(code);
    const category = String(line.category || "");
    const direction = ADDITION_CATEGORIES.has(category) ? "addition" : DEDUCTION_CATEGORIES.has(category) ? "deduction" : "";
    if (!direction) throw new Error(`unsupported certificate category: ${category}`);
    const currency = currencyCode(line.currency || options.baseCurrency, "line currency");
    const amount = nonNegative(line.amount, `line ${code} amount`);
    const exchangeRate = exchangeRateFor({ ...line, currency }, options.baseCurrency, options.exchangeRates);
    const baseAmount = amount.mul(exchangeRate);
    return { code, description: String(line.description || code), category, direction, currency, amount, exchangeRate, baseAmount };
  });
}

function calculateCertificate(input = {}, configuration = {}) {
  const baseCurrency = currencyCode(configuration.baseCurrency || input.baseCurrency || "USD", "base currency");
  const options = {
    baseCurrency,
    moneyDigits: configuration.moneyDigits,
    currencyDigits: configuration.currencyDigits || {},
    exchangeRates: configuration.exchangeRates || input.exchangeRates || {}
  };
  const baseDigits = digitsFor(baseCurrency, options);
  const lines = normalizeLines(input.lines || [], options);
  const retentionEligible = new Set(configuration.retentionEligibleCategories || DEFAULT_RETENTION_ELIGIBLE);
  for (const category of retentionEligible) {
    if (!ADDITION_CATEGORIES.has(category)) throw new Error(`invalid retention eligible category: ${category}`);
  }

  const lineAdditions = lines.filter((line) => line.direction === "addition").reduce((sum, line) => sum.plus(line.baseAmount), new Decimal(0));
  const lineDeductions = lines.filter((line) => line.direction === "deduction").reduce((sum, line) => sum.plus(line.baseAmount), new Decimal(0));
  const retentionEligibleBase = lines.filter((line) => retentionEligible.has(line.category)).reduce((sum, line) => sum.plus(line.baseAmount), new Decimal(0));
  const retentionRate = nonNegative(configuration.retentionRate, "retention rate", 0);
  if (retentionRate.gt(100)) throw new Error("retention rate must not exceed 100");
  const previousRetention = nonNegative(input.previousRetention, "previous retention", 0);
  const uncappedRetention = retentionEligibleBase.mul(retentionRate).div(100);
  let currentRetention = uncappedRetention;
  if (configuration.retentionLimitAmount !== undefined && configuration.retentionLimitAmount !== null && configuration.retentionLimitAmount !== "") {
    const retentionLimit = nonNegative(configuration.retentionLimitAmount, "retention limit amount");
    currentRetention = Decimal.min(uncappedRetention, Decimal.max(0, retentionLimit.minus(previousRetention)));
  }
  const retentionRelease = nonNegative(input.retentionRelease, "retention release", 0);
  if (retentionRelease.gt(previousRetention.plus(currentRetention))) throw new Error("retention release exceeds retained amount");

  const grossCertified = lineAdditions.plus(retentionRelease);
  const totalDeductions = lineDeductions.plus(currentRetention);
  const netCertified = grossCertified.minus(totalDeductions);
  const minimumCertificateAmount = nonNegative(configuration.minimumCertificateAmount, "minimum certificate amount", 0);
  const payableNow = netCertified.isPositive() && netCertified.lt(minimumCertificateAmount) ? new Decimal(0) : netCertified;
  const carriedForward = payableNow.isZero() ? netCertified : new Decimal(0);
  const previousCumulativeCertified = decimal(input.previousCumulativeCertified, "previous cumulative certified", 0);
  const cumulativeCertified = previousCumulativeCertified.plus(netCertified);

  const originalTotals = new Map();
  for (const line of lines) {
    const current = originalTotals.get(line.currency) || { additions: new Decimal(0), deductions: new Decimal(0) };
    current[line.direction === "addition" ? "additions" : "deductions"] = current[line.direction === "addition" ? "additions" : "deductions"].plus(line.amount);
    originalTotals.set(line.currency, current);
  }

  return {
    standard: "FIDIC-compatible IPC",
    baseCurrency,
    moneyDigits: baseDigits,
    lines: lines.map((line) => ({
      code: line.code,
      description: line.description,
      category: line.category,
      direction: line.direction,
      currency: line.currency,
      amount: fixed(line.amount, digitsFor(line.currency, options)),
      exchangeRate: line.exchangeRate.toSignificantDigits(20).toString(),
      baseAmount: fixed(line.baseAmount, baseDigits)
    })),
    originalCurrencyTotals: [...originalTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, totals]) => ({
      currency,
      additions: fixed(totals.additions, digitsFor(currency, options)),
      deductions: fixed(totals.deductions, digitsFor(currency, options))
    })),
    totals: {
      lineAdditions: fixed(lineAdditions, baseDigits),
      lineDeductions: fixed(lineDeductions, baseDigits),
      retentionEligibleBase: fixed(retentionEligibleBase, baseDigits),
      currentRetention: fixed(currentRetention, baseDigits),
      previousRetention: fixed(previousRetention, baseDigits),
      retentionRelease: fixed(retentionRelease, baseDigits),
      grossCertified: fixed(grossCertified, baseDigits),
      totalDeductions: fixed(totalDeductions, baseDigits),
      netCertified: fixed(netCertified, baseDigits),
      minimumCertificateAmount: fixed(minimumCertificateAmount, baseDigits),
      payableNow: fixed(payableNow, baseDigits),
      carriedForward: fixed(carriedForward, baseDigits),
      previousCumulativeCertified: fixed(previousCumulativeCertified, baseDigits),
      cumulativeCertified: fixed(cumulativeCertified, baseDigits)
    }
  };
}

module.exports = {
  ADDITION_CATEGORIES,
  DEDUCTION_CATEGORIES,
  calculateCertificate,
  currencyCode,
  digitsFor,
  exchangeRateFor,
  fixed
};
