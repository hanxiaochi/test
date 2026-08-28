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
    priceAdjustmentRule: { enabled: false, nonAdjustableCoefficient: "1", components: [] },
    contractEventNoticeRule: { enabled: true, variationNoticeDays: 28, claimNoticeDays: 28, requireLateReason: true },
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
    priceAdjustmentRule: {
      enabled: true,
      nonAdjustableCoefficient: "0.2",
      components: [{ code: "labor", label: "Labour", weight: "0.8", baseIndex: "100" }]
    },
    contractEventNoticeRule: { enabled: true, variationNoticeDays: 14, claimNoticeDays: 21, requireLateReason: false },
    retentionRate: "7.500",
    retentionLimitAmount: "100000.00",
    minimumCertificateAmount: 500
  });
  assert.equal(normalized.direction, "rtl");
  assert.deepEqual(normalized.exchangeRates, { EUR: "1.2", "GBP:USD": "1.3" });
  assert.deepEqual(normalized.currencyDigits, { JPY: 0, KWD: 3 });
  assert.deepEqual(normalized.priceAdjustmentRule, { enabled: true, nonAdjustableCoefficient: "0.2", components: [{ code: "LABOR", label: "Labour", weight: "0.8", baseIndex: "100" }] });
  assert.deepEqual(normalized.contractEventNoticeRule, { enabled: true, variationNoticeDays: 14, claimNoticeDays: 21, requireLateReason: false });
  assert.equal(normalized.retentionRate, "7.5");
});

test("partial updates inherit the current project settings", () => {
  const current = settings.normalizeProjectSettings({ locale: "en-US", baseCurrency: "EUR", retentionRate: 8, exchangeRates: { USD: 0.9 } });
  const updated = settings.normalizeProjectSettings({ minimumCertificateAmount: 1000 }, current);
  assert.equal(updated.locale, "en-US");
  assert.equal(updated.baseCurrency, "EUR");
  assert.deepEqual(updated.exchangeRates, { USD: "0.9" });
  assert.equal(updated.priceAdjustmentRule.enabled, false);
  assert.deepEqual(updated.contractEventNoticeRule, current.contractEventNoticeRule);
  assert.equal(updated.minimumCertificateAmount, "1000");
  assert.equal(settings.publicCatalog().locales.length, 6);
  assert.ok(settings.publicCatalog().certificateStandards.includes("FIDIC_YELLOW_2017"));
  assert.equal(settings.translate("en-US", "international.title"), "International Contract Settings");
  assert.equal(settings.translate("ar-SA", "shell.logout"), "تسجيل الخروج");
  assert.equal(settings.translate("xx", "shell.logout"), "注销");
  assert.equal(settings.translate("en-US", "unknown.key"), "unknown.key");
  assert.equal(Object.keys(settings.translationsFor("fr-FR")).length, Object.keys(settings.TRANSLATIONS["zh-CN"]).length);
  const baselineKeys = Object.keys(settings.TRANSLATIONS["zh-CN"]).sort();
  Object.values(settings.TRANSLATIONS).forEach((catalog) => assert.deepEqual(Object.keys(catalog).sort(), baselineKeys));
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
  assert.throws(() => settings.normalizeProjectSettings({ priceAdjustmentRule: { enabled: true } }), /at least one/);
  assert.throws(() => settings.normalizeProjectSettings({ contractEventNoticeRule: [] }), /notice rule must be an object/);
  assert.throws(() => settings.normalizeProjectSettings({ contractEventNoticeRule: { variationNoticeDays: 0 } }), /variation notice days.*1 to 3650/);
  assert.throws(() => settings.normalizeProjectSettings({ contractEventNoticeRule: { claimNoticeDays: 3651 } }), /claim notice days.*1 to 3650/);
  assert.throws(() => settings.normalizeProjectSettings({ contractEventNoticeRule: { requireLateReason: "yes" } }), /require late reason.*boolean/);
  assert.throws(() => settings.normalizeProjectSettings({ retentionRate: 101 }), /must not exceed/);
  assert.throws(() => settings.normalizeProjectSettings({ retentionLimitAmount: -1 }), /must not be negative/);
  assert.throws(() => settings.normalizeProjectSettings({ minimumCertificateAmount: "bad" }), /finite decimal/);
  assert.throws(() => settings.decimalString(Infinity, "value"), /finite decimal/);
  assert.equal(settings.optionalDecimalString(null, "value", "10"), "");
});

test("international settings versions are immutable, checksummed and reactivatable", () => {
  const state = { internationalSettings: settings.normalizeProjectSettings() };
  assert.equal(settings.activeSettingsVersion(state).version, 0);
  const first = settings.createSettingsVersion(state, { locale: "en-US", baseCurrency: "USD" }, { changeReason: "Contract award", createdBy: 7, createdAt: "2026-01-01T00:00:00.000Z" });
  const second = settings.createSettingsVersion(state, { exchangeRates: { EUR: "1.2" } }, { changeReason: "Engineer rate notice", createdBy: 8, createdAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(first.version, 1); assert.equal(first.schemaVersion, 3); assert.equal(second.version, 2); assert.equal(settings.settingsHistory(state)[1].status, "retired");
  assert.equal(settings.activeSettingsVersion(state).settings.exchangeRates.EUR, "1.2");
  const restored = settings.activateSettingsVersion(state, 1, { changeReason: "Engineer correction", activatedBy: 9, activatedAt: "2026-03-01T00:00:00.000Z" });
  assert.equal(restored.status, "active"); assert.equal(state.internationalSettings.locale, "en-US");
  assert.equal(restored.activationReason, "Engineer correction"); assert.equal(restored.activatedBy, 9);
  assert.throws(() => settings.activateSettingsVersion(state, 99, { changeReason: "Missing version" }), /does not exist/);
  state.internationalSettingsVersions[0].settings.locale = "fr-FR";
  assert.throws(() => settings.settingsHistory(state), /checksum mismatch/);
});

test("international version validation fails closed without partial mutation", () => {
  assert.throws(() => settings.createSettingsVersion(null, {}, { changeReason: "x" }), /state is required/);
  const state = {};
  assert.throws(() => settings.createSettingsVersion(state, {}, {}), /change reason/);
  assert.equal(state.internationalSettingsVersions, undefined);
  assert.throws(() => settings.activateSettingsVersion(state, 1), /activation reason/);
  assert.throws(() => settings.createSettingsVersion(state, {}, { changeReason: "x".repeat(501) }), /500/);
  state.internationalSettingsVersions = Array.from({ length: 1000 }, (_, index) => ({ version: index + 1, schemaVersion: 2, status: "retired", settings: settings.normalizeProjectSettings(), checksum: settings.settingsChecksum({}, 2), changeReason: "x", createdBy: null, createdAt: "x", activatedAt: "x" }));
  assert.throws(() => settings.createSettingsVersion(state, {}, { changeReason: "limit" }), /version limit/);
});

test("legacy version checksums remain valid after the schema gains new defaults", () => {
  const legacySettings = settings.normalizeProjectSettings({ locale: "en-US" });
  delete legacySettings.priceAdjustmentRule;
  const state = { internationalSettingsVersions: [{ version: 1, status: "active", settings: legacySettings, checksum: settings.settingsChecksum(legacySettings, 1), changeReason: "legacy", createdBy: null, createdAt: "x", activatedAt: "x" }] };
  const active = settings.activeSettingsVersion(state);
  assert.equal(active.schemaVersion, 1);
  assert.deepEqual(active.settings.priceAdjustmentRule, { enabled: false, nonAdjustableCoefficient: "1", components: [] });
  assert.deepEqual(active.settings.contractEventNoticeRule, { enabled: true, variationNoticeDays: 28, claimNoticeDays: 28, requireLateReason: true });
  const schemaTwo = settings.normalizeProjectSettings({ locale: "fr-FR", contractEventNoticeRule: { variationNoticeDays: 7 } });
  const schemaTwoChecksum = settings.settingsChecksum(schemaTwo, 2);
  schemaTwo.contractEventNoticeRule.variationNoticeDays = 99;
  assert.equal(settings.settingsChecksum(schemaTwo, 2), schemaTwoChecksum);
  assert.throws(() => settings.settingsChecksum({}, 4), /unsupported.*schema/);
});
