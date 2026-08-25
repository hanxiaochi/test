"use strict";

const Decimal = require("decimal.js");
const { currencyCode } = require("./fidic-core");

const LOCALES = Object.freeze({
  "zh-CN": { name: "简体中文", direction: "ltr" },
  "en-US": { name: "English", direction: "ltr" },
  "es-ES": { name: "Español", direction: "ltr" },
  "fr-FR": { name: "Français", direction: "ltr" },
  "pt-BR": { name: "Português", direction: "ltr" },
  "ar-SA": { name: "العربية", direction: "rtl" }
});
const CERTIFICATE_STANDARDS = Object.freeze([
  "FIDIC_RED_2017",
  "FIDIC_YELLOW_2017",
  "FIDIC_SILVER_2017",
  "CUSTOM_IPC"
]);

function decimalString(value, label, fallback = "0", maximum) {
  const source = value === undefined || value === null || value === "" ? fallback : value;
  let result;
  try {
    result = new Decimal(source);
  } catch {
    throw new Error(`${label} must be a finite decimal number`);
  }
  if (!result.isFinite()) throw new Error(`${label} must be a finite decimal number`);
  if (result.isNegative()) throw new Error(`${label} must not be negative`);
  if (maximum !== undefined && result.gt(maximum)) throw new Error(`${label} must not exceed ${maximum}`);
  return result.toSignificantDigits(20).toString();
}

function integerDigits(value, label, fallback = 2) {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 0 || result > 4) throw new Error(`${label} must be an integer from 0 to 4`);
  return result;
}

function optionalDecimalString(value, label, fallback = "") {
  const source = value === undefined ? fallback : value;
  if (source === null || source === "") return "";
  return decimalString(source, label);
}

function normalizeExchangeRates(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("exchange rates must be an object");
  return Object.fromEntries(Object.entries(value).map(([rawKey, rawValue]) => {
    const parts = String(rawKey || "").trim().toUpperCase().split(":");
    if (parts.length < 1 || parts.length > 2) throw new Error(`invalid exchange rate key: ${rawKey}`);
    const key = parts.map((part) => currencyCode(part, "exchange rate currency")).join(":");
    const rate = decimalString(rawValue, `exchange rate ${key}`);
    if (new Decimal(rate).lte(0)) throw new Error(`exchange rate ${key} must be positive`);
    return [key, rate];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeCurrencyDigits(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("currency digits must be an object");
  return Object.fromEntries(Object.entries(value).map(([rawCurrency, rawDigits]) => {
    const currency = currencyCode(rawCurrency, "currency digits code");
    return [currency, integerDigits(rawDigits, `currency digits ${currency}`)];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeProjectSettings(input = {}, current = {}) {
  const locale = String(input.locale ?? current.locale ?? "zh-CN");
  if (!LOCALES[locale]) throw new Error(`unsupported locale: ${locale}`);
  const baseCurrency = currencyCode(input.baseCurrency ?? current.baseCurrency ?? "CNY", "base currency");
  const certificateStandard = String(input.certificateStandard ?? current.certificateStandard ?? "FIDIC_RED_2017");
  if (!CERTIFICATE_STANDARDS.includes(certificateStandard)) throw new Error(`unsupported certificate standard: ${certificateStandard}`);
  return {
    locale,
    direction: LOCALES[locale].direction,
    baseCurrency,
    certificateStandard,
    moneyDigits: integerDigits(input.moneyDigits, "money digits", current.moneyDigits ?? 2),
    exchangeRates: normalizeExchangeRates(input.exchangeRates ?? current.exchangeRates ?? {}),
    currencyDigits: normalizeCurrencyDigits(input.currencyDigits ?? current.currencyDigits ?? {}),
    retentionRate: decimalString(input.retentionRate, "retention rate", current.retentionRate ?? "10", 100),
    retentionLimitAmount: optionalDecimalString(input.retentionLimitAmount, "retention limit amount", current.retentionLimitAmount ?? ""),
    minimumCertificateAmount: decimalString(input.minimumCertificateAmount, "minimum certificate amount", current.minimumCertificateAmount ?? "0")
  };
}

function publicCatalog() {
  return {
    locales: Object.entries(LOCALES).map(([code, item]) => ({ code, ...item })),
    certificateStandards: [...CERTIFICATE_STANDARDS]
  };
}

module.exports = {
  CERTIFICATE_STANDARDS,
  LOCALES,
  decimalString,
  integerDigits,
  normalizeCurrencyDigits,
  normalizeExchangeRates,
  normalizeProjectSettings,
  optionalDecimalString,
  publicCatalog
};
