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
const DEDUCTION_CATEGORIES = new Set(["advanceRepayment", "tax", "penalty", "priceAdjustmentDeduction", "otherDeduction"]);
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

function strictBoolean(value, label, fallback = false) {
  const source = value === undefined || value === null || value === "" ? fallback : value;
  if (source === true || source === false) return source;
  if (source === 1 || source === "1" || source === "true") return true;
  if (source === 0 || source === "0" || source === "false") return false;
  throw new Error(`${label} must be a boolean`);
}

function significant(value) {
  return new Decimal(value).toSignificantDigits(20).toString();
}

function normalizePriceAdjustmentRule(value = {}, current = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("price adjustment rule must be an object");
  const enabled = strictBoolean(value.enabled, "price adjustment enabled", current.enabled ?? false);
  const nonAdjustableCoefficient = nonNegative(value.nonAdjustableCoefficient, "non-adjustable coefficient", current.nonAdjustableCoefficient ?? 1);
  if (nonAdjustableCoefficient.gt(1)) throw new Error("non-adjustable coefficient must not exceed 1");
  const sourceComponents = value.components === undefined ? (current.components || []) : value.components;
  if (!Array.isArray(sourceComponents)) throw new Error("price adjustment components must be an array");
  if (sourceComponents.length > 20) throw new Error("price adjustment components must not exceed 20");
  const seen = new Set();
  const components = sourceComponents.map((component, index) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) throw new Error(`price adjustment component ${index + 1} must be an object`);
    const code = String(component.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,32}$/.test(code)) throw new Error(`price adjustment component ${index + 1} code is invalid`);
    if (seen.has(code)) throw new Error(`duplicate price adjustment component: ${code}`);
    seen.add(code);
    const label = String(component.label || code).trim();
    if (!label || label.length > 100) throw new Error(`price adjustment component ${code} label is invalid`);
    const weight = nonNegative(component.weight, `price adjustment component ${code} weight`);
    if (weight.gt(1)) throw new Error(`price adjustment component ${code} weight must not exceed 1`);
    const baseIndex = decimal(component.baseIndex, `price adjustment component ${code} base index`);
    if (!baseIndex.gt(0)) throw new Error(`price adjustment component ${code} base index must be positive`);
    return { code, label, weight: significant(weight), baseIndex: significant(baseIndex) };
  });
  if (enabled && components.length === 0) throw new Error("enabled price adjustment requires at least one component");
  const balance = components.reduce((sum, component) => sum.plus(component.weight), nonAdjustableCoefficient);
  if ((enabled || components.length > 0) && !balance.eq(1)) throw new Error("non-adjustable coefficient and component weights must total 1");
  return { enabled, nonAdjustableCoefficient: significant(nonAdjustableCoefficient), components };
}

function calculatePriceAdjustment(input = {}, rule = {}, moneyDigits = 2) {
  const normalizedRule = normalizePriceAdjustmentRule(rule);
  if (!normalizedRule.enabled) return { enabled: false, formula: "Pn = a + sum(bn * Ln/L0n)", adjustment: fixed(0, moneyDigits) };
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("price adjustment input must be an object");
  if (input.eligibleAmount === undefined || input.eligibleAmount === null || input.eligibleAmount === "") throw new Error("price adjustment eligible amount is required");
  const eligibleAmount = nonNegative(input.eligibleAmount, "price adjustment eligible amount");
  const currentIndices = input.currentIndices;
  if (!currentIndices || typeof currentIndices !== "object" || Array.isArray(currentIndices)) throw new Error("price adjustment current indices must be an object");
  const components = normalizedRule.components.map((component) => {
    const currentIndex = decimal(currentIndices[component.code], `price adjustment component ${component.code} current index`);
    if (!currentIndex.gt(0)) throw new Error(`price adjustment component ${component.code} current index must be positive`);
    const ratio = currentIndex.div(component.baseIndex);
    const weightedIndex = ratio.mul(component.weight);
    return { ...component, currentIndex: significant(currentIndex), ratio: significant(ratio), weightedIndex: significant(weightedIndex) };
  });
  const factor = components.reduce((sum, component) => sum.plus(component.weightedIndex), new Decimal(normalizedRule.nonAdjustableCoefficient));
  const adjustment = eligibleAmount.mul(factor.minus(1));
  return {
    enabled: true,
    formula: "Pn = a + sum(bn * Ln/L0n); adjustment = eligible amount * (Pn - 1)",
    eligibleAmount: fixed(eligibleAmount, moneyDigits),
    nonAdjustableCoefficient: normalizedRule.nonAdjustableCoefficient,
    components,
    factor: significant(factor),
    adjustment: fixed(adjustment, moneyDigits),
    direction: adjustment.isNegative() ? "deduction" : "addition"
  };
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
    return { code, description: String(line.description || code), category, direction, currency, amount, exchangeRate, baseAmount, generated: line.generated === true };
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
  if (input.lines !== undefined && !Array.isArray(input.lines)) throw new Error("certificate lines must be an array");
  const sourceLines = [...(input.lines || [])];
  const priceAdjustment = calculatePriceAdjustment(input.priceAdjustment || {}, configuration.priceAdjustmentRule || {}, baseDigits);
  if (priceAdjustment.enabled) {
    if (sourceLines.some((line) => line && (line.category === "priceAdjustment" || line.category === "priceAdjustmentDeduction"))) {
      throw new Error("manual price adjustment lines are not allowed when the automatic price adjustment rule is enabled");
    }
    const adjustment = new Decimal(priceAdjustment.adjustment);
    if (!adjustment.isZero()) sourceLines.push({
      code: "AUTO-PRICE-ADJUSTMENT",
      description: "Index price adjustment",
      category: adjustment.isNegative() ? "priceAdjustmentDeduction" : "priceAdjustment",
      amount: adjustment.abs().toString(),
      currency: baseCurrency,
      generated: true
    });
  }
  const lines = normalizeLines(sourceLines, options);
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
      baseAmount: fixed(line.baseAmount, baseDigits),
      generated: line.generated
    })),
    originalCurrencyTotals: [...originalTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, totals]) => ({
      currency,
      additions: fixed(totals.additions, digitsFor(currency, options)),
      deductions: fixed(totals.deductions, digitsFor(currency, options))
    })),
    priceAdjustment,
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
  calculatePriceAdjustment,
  currencyCode,
  digitsFor,
  exchangeRateFor,
  fixed,
  normalizePriceAdjustmentRule
};
