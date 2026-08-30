"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const jquery = fs.readFileSync(path.join(ROOT, "assets", "bower_components", "jquery", "dist", "jquery.min.js"), "utf8");
const compatibility = fs.readFileSync(path.join(ROOT, "assets", "bower_components", "bootstrap", "dist", "js", "bootstrap.min.js"), "utf8");

function browserFixture() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="modal" class="modal fade" style="display:none"><button id="close-modal" data-dismiss="modal">close</button></div>
    <ul class="nav"><li class="active"><a id="tab-one" href="#one" data-toggle="tab">one</a></li><li><a id="tab-two" href="#two" data-toggle="tab">two</a></li></ul>
    <div class="tab-content"><div id="one" class="tab-pane active">one</div><div id="two" class="tab-pane">two</div></div>
    <div id="dropdown" class="dropdown"><button id="menu" data-toggle="dropdown">menu</button><ul class="dropdown-menu"><li>item</li></ul></div>
    <div id="alert" class="alert"><button id="close-alert" data-dismiss="alert">close</button></div>
  </body></html>`, { runScripts: "outside-only", url: "http://127.0.0.1/" });
  dom.window.eval(jquery);
  dom.window.eval(compatibility);
  return dom;
}

test("safe compatibility layer implements the product's modal lifecycle", () => {
  const dom = browserFixture();
  const $ = dom.window.jQuery;
  const $modal = $("#modal");
  $modal.modal({ backdrop: "static", keyboard: false });
  assert.equal($modal.hasClass("in"), true);
  assert.equal($modal.css("display"), "block");
  assert.equal($(".modal-backdrop").length, 1);
  assert.equal($(dom.window.document.body).hasClass("modal-open"), true);
  $("#close-modal").trigger("click");
  assert.equal($modal.hasClass("in"), false);
  assert.equal($modal.css("display"), "none");
  assert.equal($(".modal-backdrop").length, 0);
  dom.window.close();
});

test("safe compatibility layer switches bounded ID tabs and dropdown state", () => {
  const dom = browserFixture();
  const $ = dom.window.jQuery;
  $("#tab-two").trigger("click");
  assert.equal($("#tab-two").closest("li").hasClass("active"), true);
  assert.equal($("#two").hasClass("active"), true);
  assert.equal($("#one").hasClass("active"), false);
  $("#tab-two").attr("href", "javascript:alert(1)").trigger("click");
  assert.equal($("#two").hasClass("active"), true);

  $("#menu").trigger("click");
  assert.equal($("#dropdown").hasClass("open"), true);
  $(dom.window.document).trigger("click");
  assert.equal($("#dropdown").hasClass("open"), false);
  dom.window.close();
});

test("safe compatibility layer removes dismissible alerts", () => {
  const dom = browserFixture();
  const $ = dom.window.jQuery;
  $("#close-alert").trigger("click");
  assert.equal($("#alert").length, 0);
  dom.window.close();
});
