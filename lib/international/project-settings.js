"use strict";

const Decimal = require("decimal.js");
const crypto = require("crypto");
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
const TRANSLATIONS = Object.freeze({
  "zh-CN": {
    "shell.productName": "工程项目信息化管理云", "shell.currentProject": "当前项目", "shell.refresh": "刷新",
    "shell.profile": "个人中心", "shell.theme": "主题切换", "shell.logout": "注销", "shell.announcements": "公告信息",
    "international.title": "国际合同设置", "international.project": "当前项目", "international.back": "返回后台",
    "international.parameters": "项目参数", "international.locale": "界面语言", "international.baseCurrency": "基础币种",
    "international.standard": "证书标准", "international.moneyDigits": "金额位数", "international.retentionRate": "保留金率(%)",
    "international.retentionLimit": "保留金限额", "international.minimumCertificate": "最低证书金额",
    "international.exchangeRates": "合同汇率(JSON)", "international.currencyDigits": "币种位数(JSON)",
    "international.save": "保存项目设置", "international.calculator": "付款证书试算", "international.lines": "证书行(JSON)",
    "international.previousRetention": "上期保留金", "international.retentionRelease": "本期释放",
    "international.calculate": "计算付款证书", "international.notCalculated": "尚未计算", "international.saved": "项目设置已保存"
  },
  "en-US": {
    "shell.productName": "Construction Project Management", "shell.currentProject": "Current project", "shell.refresh": "Refresh",
    "shell.profile": "Profile", "shell.theme": "Theme", "shell.logout": "Sign out", "shell.announcements": "Announcements",
    "international.title": "International Contract Settings", "international.project": "Current project", "international.back": "Back to administration",
    "international.parameters": "Project parameters", "international.locale": "Interface language", "international.baseCurrency": "Base currency",
    "international.standard": "Certificate standard", "international.moneyDigits": "Money decimals", "international.retentionRate": "Retention rate (%)",
    "international.retentionLimit": "Retention limit", "international.minimumCertificate": "Minimum certificate amount",
    "international.exchangeRates": "Contract rates (JSON)", "international.currencyDigits": "Currency decimals (JSON)",
    "international.save": "Save project settings", "international.calculator": "Payment certificate calculator", "international.lines": "Certificate lines (JSON)",
    "international.previousRetention": "Previous retention", "international.retentionRelease": "Retention release",
    "international.calculate": "Calculate certificate", "international.notCalculated": "Not calculated", "international.saved": "Project settings saved"
  },
  "es-ES": {
    "shell.productName": "Gestión de Proyectos de Construcción", "shell.currentProject": "Proyecto actual", "shell.refresh": "Actualizar",
    "shell.profile": "Perfil", "shell.theme": "Tema", "shell.logout": "Cerrar sesión", "shell.announcements": "Avisos",
    "international.title": "Configuración de Contratos Internacionales", "international.project": "Proyecto actual", "international.back": "Volver a administración",
    "international.parameters": "Parámetros del proyecto", "international.locale": "Idioma", "international.baseCurrency": "Moneda base",
    "international.standard": "Norma del certificado", "international.moneyDigits": "Decimales monetarios", "international.retentionRate": "Tasa de retención (%)",
    "international.retentionLimit": "Límite de retención", "international.minimumCertificate": "Importe mínimo del certificado",
    "international.exchangeRates": "Tipos contractuales (JSON)", "international.currencyDigits": "Decimales por moneda (JSON)",
    "international.save": "Guardar configuración", "international.calculator": "Cálculo del certificado", "international.lines": "Líneas del certificado (JSON)",
    "international.previousRetention": "Retención anterior", "international.retentionRelease": "Liberación de retención",
    "international.calculate": "Calcular certificado", "international.notCalculated": "Sin calcular", "international.saved": "Configuración guardada"
  },
  "fr-FR": {
    "shell.productName": "Gestion de Projets de Construction", "shell.currentProject": "Projet actuel", "shell.refresh": "Actualiser",
    "shell.profile": "Profil", "shell.theme": "Thème", "shell.logout": "Se déconnecter", "shell.announcements": "Annonces",
    "international.title": "Paramètres des Contrats Internationaux", "international.project": "Projet actuel", "international.back": "Retour à l'administration",
    "international.parameters": "Paramètres du projet", "international.locale": "Langue", "international.baseCurrency": "Devise de base",
    "international.standard": "Norme du certificat", "international.moneyDigits": "Décimales monétaires", "international.retentionRate": "Taux de retenue (%)",
    "international.retentionLimit": "Plafond de retenue", "international.minimumCertificate": "Montant minimum du certificat",
    "international.exchangeRates": "Taux contractuels (JSON)", "international.currencyDigits": "Décimales par devise (JSON)",
    "international.save": "Enregistrer les paramètres", "international.calculator": "Calcul du certificat", "international.lines": "Lignes du certificat (JSON)",
    "international.previousRetention": "Retenue antérieure", "international.retentionRelease": "Libération de retenue",
    "international.calculate": "Calculer le certificat", "international.notCalculated": "Non calculé", "international.saved": "Paramètres enregistrés"
  },
  "pt-BR": {
    "shell.productName": "Gestão de Projetos de Construção", "shell.currentProject": "Projeto atual", "shell.refresh": "Atualizar",
    "shell.profile": "Perfil", "shell.theme": "Tema", "shell.logout": "Sair", "shell.announcements": "Avisos",
    "international.title": "Configurações de Contratos Internacionais", "international.project": "Projeto atual", "international.back": "Voltar à administração",
    "international.parameters": "Parâmetros do projeto", "international.locale": "Idioma", "international.baseCurrency": "Moeda base",
    "international.standard": "Padrão do certificado", "international.moneyDigits": "Casas decimais", "international.retentionRate": "Taxa de retenção (%)",
    "international.retentionLimit": "Limite de retenção", "international.minimumCertificate": "Valor mínimo do certificado",
    "international.exchangeRates": "Taxas contratuais (JSON)", "international.currencyDigits": "Decimais por moeda (JSON)",
    "international.save": "Salvar configurações", "international.calculator": "Cálculo do certificado", "international.lines": "Linhas do certificado (JSON)",
    "international.previousRetention": "Retenção anterior", "international.retentionRelease": "Liberação de retenção",
    "international.calculate": "Calcular certificado", "international.notCalculated": "Não calculado", "international.saved": "Configurações salvas"
  },
  "ar-SA": {
    "shell.productName": "إدارة مشاريع البناء", "shell.currentProject": "المشروع الحالي", "shell.refresh": "تحديث",
    "shell.profile": "الملف الشخصي", "shell.theme": "المظهر", "shell.logout": "تسجيل الخروج", "shell.announcements": "الإعلانات",
    "international.title": "إعدادات العقود الدولية", "international.project": "المشروع الحالي", "international.back": "العودة إلى الإدارة",
    "international.parameters": "إعدادات المشروع", "international.locale": "لغة الواجهة", "international.baseCurrency": "العملة الأساسية",
    "international.standard": "معيار الشهادة", "international.moneyDigits": "المنازل العشرية", "international.retentionRate": "نسبة الاستبقاء (%)",
    "international.retentionLimit": "حد الاستبقاء", "international.minimumCertificate": "الحد الأدنى للشهادة",
    "international.exchangeRates": "أسعار الصرف التعاقدية (JSON)", "international.currencyDigits": "منازل العملة (JSON)",
    "international.save": "حفظ إعدادات المشروع", "international.calculator": "حساب شهادة الدفع", "international.lines": "بنود الشهادة (JSON)",
    "international.previousRetention": "الاستبقاء السابق", "international.retentionRelease": "إفراج الاستبقاء",
    "international.calculate": "حساب الشهادة", "international.notCalculated": "لم يتم الحساب", "international.saved": "تم حفظ الإعدادات"
  }
});

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

function translationsFor(locale) {
  const code = LOCALES[locale] ? locale : "zh-CN";
  return { ...TRANSLATIONS["zh-CN"], ...TRANSLATIONS[code] };
}

function translate(locale, key) {
  return translationsFor(locale)[key] || String(key);
}

function settingsChecksum(settings) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeProjectSettings(settings)), "utf8").digest("hex");
}

function versionView(entry) {
  if (!entry || settingsChecksum(entry.settings) !== entry.checksum) throw new Error("international settings version checksum mismatch");
  return JSON.parse(JSON.stringify(entry));
}

function settingsHistory(state) {
  const rows = Array.isArray(state && state.internationalSettingsVersions) ? state.internationalSettingsVersions : [];
  return rows.map(versionView).sort((a, b) => b.version - a.version);
}

function activeSettingsVersion(state) {
  const active = settingsHistory(state).find((entry) => entry.status === "active");
  if (!active) return { version: 0, status: "legacy", settings: normalizeProjectSettings(state && state.internationalSettings || {}), checksum: settingsChecksum(state && state.internationalSettings || {}) };
  return active;
}

function createSettingsVersion(state, input, metadata = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("international settings state is required");
  const reason = String(metadata.changeReason || "").trim();
  if (!reason || reason.length > 500) throw new Error("international settings change reason is required and must not exceed 500 characters");
  const settings = normalizeProjectSettings(input, activeSettingsVersion(state).settings);
  const rows = settingsHistory(state);
  if (rows.length >= 1000) throw new Error("international settings version limit exceeded");
  const now = String(metadata.createdAt || new Date().toISOString());
  rows.forEach((entry) => { if (entry.status === "active") entry.status = "retired"; });
  const entry = { version: rows.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0) + 1, status: "active", settings, checksum: settingsChecksum(settings), changeReason: reason, createdBy: metadata.createdBy ?? null, createdAt: now, activatedAt: now };
  state.internationalSettingsVersions = [...rows, entry].sort((a, b) => a.version - b.version);
  state.internationalSettings = settings;
  return versionView(entry);
}

function activateSettingsVersion(state, version, metadata = {}) {
  const reason = String(metadata.changeReason || "").trim();
  if (!reason || reason.length > 500) throw new Error("international settings activation reason is required and must not exceed 500 characters");
  const rows = settingsHistory(state);
  const selected = rows.find((entry) => entry.version === Number(version));
  if (!selected) throw new Error("international settings version does not exist");
  const now = String(metadata.activatedAt || new Date().toISOString());
  rows.forEach((entry) => { entry.status = entry.version === selected.version ? "active" : "retired"; });
  selected.activatedAt = now;
  selected.activatedBy = metadata.activatedBy ?? null;
  selected.activationReason = reason;
  state.internationalSettingsVersions = rows.sort((a, b) => a.version - b.version);
  state.internationalSettings = JSON.parse(JSON.stringify(selected.settings));
  return versionView(selected);
}

module.exports = {
  CERTIFICATE_STANDARDS,
  LOCALES,
  TRANSLATIONS,
  decimalString,
  integerDigits,
  normalizeCurrencyDigits,
  normalizeExchangeRates,
  normalizeProjectSettings,
  optionalDecimalString,
  publicCatalog,
  translate,
  translationsFor,
  activeSettingsVersion,
  activateSettingsVersion,
  createSettingsVersion,
  settingsChecksum,
  settingsHistory
};
