"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { costCalculatorPageHtml } = require("../../lib/regions/packs/cn-mainland/pages/cost-calculator-page");

test("domestic cost calculator renders every calculation input and backend integration", () => {
  const page = costCalculatorPageHtml();
  const fields = [
    "billNo", "billName", "quantity", "price", "measureNum",
    "varyNo", "beforeNum", "beforePrice", "afterNum", "afterPrice",
    "materialNo", "materialName", "materialQuantity", "basePrice", "currentPrice", "arrivalQuantity",
    "manualBillNo", "manualBillName", "manualQuantity", "manualPrice"
  ];
  fields.forEach((name) => assert.match(page, new RegExp(`name=["']${name}["']`)));

  [
    "/api/cost/calculate",
    "/api/cost/bills?page=1&limit=10000",
    "/vary_measure/list?page=1&limit=10000",
    "/meterialdiasmeasure/meterial_dias_measure_list?page=1&limit=10000",
    "/meterialInMeasure/meterial_in_measure_list?page=1&limit=10000",
    "/manualMeasure/detail_list?page=1&limit=10000"
  ].forEach((endpoint) => assert.ok(page.includes(endpoint), `missing endpoint ${endpoint}`));

  ["cost-calculator-form", "cost-calculator-result", "cost-calculator-ledger", "calc-run", "calc-ledger"]
    .forEach((id) => assert.match(page, new RegExp(`id=["']${id}["']`)));
  assert.match(page, /materialAdjustments/);
  assert.match(page, /materialArrivals/);
  assert.match(page, /manualMeasures/);
});
