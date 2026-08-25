"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const settings = require("../../lib/international/project-settings");

test("defaults and project overrides normalize deterministically", () => {
  assert.deepEqual(settings.normalizeProjectSettings(), {
    locale: "zh-CN",
    direction: "ltr",
    baseCurrency: "CNY",
    certificateStandard: "FIDIC_RED_2017",
    moneyDigits: 2,
    exchangeRates: {},
    currencyDigits: {},
    retentionRate: "10",
    retentionLimitAmount: "",
    minimumCertificateAmount: "0"
  });
  const normalized = settings.normalizeProjectSettings({
    locale: "ar-SA",
    baseCurrency: "usd",
    certificateStandard: "CUSTOM_IPC",
    moneyDigits: 3,
    exchangeRates: { eur: "1.2", "gbp:usd": "1.3" },
    currencyDigits: { jpy: 0, kwd: 3 },
    retentionRate: "7.500",
    retentionLimitAmount: "100000.00",
    minimumCertificateAmount: 500
  });
  assert.equal(normalized.direction, "rtl");
  assert.deepEqual(normalized.exchangeRates, { EUR: "1.2", "GBP:USD": "1.3" });
  assert.deepEqual(normalized.currencyDigits, { JPY: 0, KWD: 3 });
  assert.equal(normalized.retentionRate, "7.5");
});

test("partial updates inherit the current project settings", () => {
  const current = settings.normalizeProjectSettings({ locale: "en-US", baseCurrency: "EUR", retentionRate: 8, exchangeRates: { USD: 0.9 } });
  const updated = settings.normalizeProjectSettings({ minimumCertificateAmount: 1000 }, current);
  assert.equal(updated.locale, "en-US");
  assert.equal(updated.baseCurrency, "EUR");
  assert.deepEqual(updated.exchangeRates, { USD: "0.9" });
  assert.equal(updated.minimumCertificateAmount, "1000");
  assert.equal(settings.publicCatalog().locales.length, 6);
  assert.ok(settings.publicCatalog().certificateStandards.includes("FIDIC_YELLOW_2017"));
});

test("invalid settings fail closed", () => {
  assert.throws(() => settings.normalizeProjectSettings({ locale: "xx" }), /unsupported locale/);
  assert.throws(() => settings.normalizeProjectSettings({ certificateStandard: "UNKNOWN" }), /unsupported certificate/);
  assert.throws(() => settings.normalizeProjectSettings({ moneyDigits: 5 }), /integer from 0 to 4/);
  assert.throws(() => settings.normalizeProjectSettings({ exchangeRates: [] }), /must be an object/);
  assert.throws(() => settings.normalizeProjectSettings({ exchangeRates: { "USD:CNY:EUR": 1 } }), /invalid exchange rate key/);
  assert.throws(() => settings.normalizeProjectSettings({ exchangeRates: { US: 1 } }), /three-letter/);
  assert.throws(() => settings.normalizeProjectSettings({ exchangeRates: { USD: 0 } }), /must be positive/);
  assert.throws(() => settings.normalizeProjectSettings({ currencyDigits: [] }), /must be an object/);
  assert.throws(() => settings.normalizeProjectSettings({ currencyDigits: { USD: 1.5 } }), /integer from 0 to 4/);
  assert.throws(() => settings.normalizeProjectSettings({ retentionRate: 101 }), /must not exceed/);
  assert.throws(() => settings.normalizeProjectSettings({ retentionLimitAmount: -1 }), /must not be negative/);
  assert.throws(() => settings.normalizeProjectSettings({ minimumCertificateAmount: "bad" }), /finite decimal/);
  assert.throws(() => settings.decimalString(Infinity, "value"), /finite decimal/);
  assert.equal(settings.optionalDecimalString(null, "value", "10"), "");
});
