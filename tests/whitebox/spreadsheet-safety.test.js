"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { neutralizeRow, neutralizeSpreadsheetFormula } = require("../../lib/security/spreadsheet-safety");

test("spreadsheet formulas are neutralized without converting real numeric values", () => {
  ["=1+1", "+cmd", "-cmd", "@SUM(A1)", " \t=HYPERLINK(\"https://evil.example\")"]
    .forEach((value) => assert.equal(neutralizeSpreadsheetFormula(value), `'${value}`));
  assert.equal(neutralizeSpreadsheetFormula("ordinary text"), "ordinary text");
  assert.equal(neutralizeSpreadsheetFormula(-42), -42);
  assert.deepEqual(neutralizeRow({ text: "=cmd", number: -1 }), { text: "'=cmd", number: -1 });
});
