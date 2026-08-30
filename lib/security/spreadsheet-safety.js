"use strict";

const DANGEROUS_FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;

function neutralizeSpreadsheetFormula(value) {
  if (typeof value !== "string") return value;
  return DANGEROUS_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function neutralizeRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, neutralizeSpreadsheetFormula(value)]));
}

module.exports = { DANGEROUS_FORMULA_PREFIX, neutralizeRow, neutralizeSpreadsheetFormula };
