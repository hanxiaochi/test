"use strict";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function integer(value, label, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error(`${label} is invalid`);
  return result;
}

function localized(value, label) {
  const source = object(value, label);
  const result = {
    "zh-CN": String(source["zh-CN"] || "").trim(),
    "en-US": String(source["en-US"] || "").trim()
  };
  if (!result["zh-CN"] || !result["en-US"]) throw new Error(`${label} requires zh-CN and en-US`);
  return result;
}

function normalizeMenuItem(value, label) {
  const source = object(value, label);
  const resourceId = integer(source.resourceId, `${label} resource id`, 1);
  const parentId = integer(source.parentId, `${label} parent id`);
  const order = integer(source.order, `${label} order`);
  const resourceCode = String(source.resourceCode || "").trim();
  const resourceUrl = String(source.resourceUrl || "").trim();
  const menuIcon = String(source.menuIcon || "layui-icon layui-icon-template-1").trim();
  const resourceNo = String(source.resourceNo || "model").trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(resourceCode)) throw new Error(`${label} resource code is invalid`);
  if (resourceUrl.startsWith("/") || resourceUrl.includes("?") || resourceUrl.includes("#") || resourceUrl.includes("//")) throw new Error(`${label} resource URL is invalid`);
  if (!menuIcon || !/^(root|model)$/.test(resourceNo)) throw new Error(`${label} presentation is invalid`);
  const children = Array.isArray(source.children)
    ? source.children.map((item, index) => normalizeMenuItem(item, `${label} child ${index + 1}`))
    : [];
  if (children.some((item) => item.parentId !== resourceId)) throw new Error(`${label} child parent id is invalid`);
  const ids = children.flatMap(menuResourceIds);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate child resources`);
  return {
    resourceId,
    parentId,
    order,
    resourceCode,
    name: localized(source.name, `${label} name`),
    description: localized(source.description, `${label} description`),
    resourceUrl,
    menuIcon,
    resourceNo,
    children
  };
}

function menuResourceIds(item) {
  return [item.resourceId, ...item.children.flatMap(menuResourceIds)];
}

function normalizeLegacyMenuRow(value, label, expectedParentId) {
  const source = object(value, label);
  const resourceId = integer(source.resourceId, `${label} resource id`, 1);
  const parentId = source.parentId === "" && expectedParentId === 0
    ? 0
    : integer(source.parentId, `${label} parent id`);
  if (expectedParentId !== undefined && parentId !== expectedParentId) throw new Error(`${label} parent id is invalid`);
  const resourceName = String(source.resourceName || "").trim();
  const resourceUrl = String(source.resourceUrl || "").trim();
  if (!resourceName) throw new Error(`${label} resource name is required`);
  const urlParts = resourceUrl.split("?");
  const validPath = /^[A-Za-z0-9_./:-]*$/.test(urlParts[0]);
  const validQuery = urlParts.length === 1 || (urlParts.length === 2 && /^[A-Za-z0-9_.~%=&-]+$/.test(urlParts[1]));
  if (resourceUrl.startsWith("/") || resourceUrl.includes("#") || resourceUrl.includes("//") || !validPath || !validQuery) throw new Error(`${label} resource URL is invalid`);
  if (source.sysBusinessResources !== "" && !Array.isArray(source.sysBusinessResources)) throw new Error(`${label} children are invalid`);
  const children = Array.isArray(source.sysBusinessResources)
    ? source.sysBusinessResources.map((item, index) => normalizeLegacyMenuRow(item, `${label} child ${index + 1}`, resourceId))
    : source.sysBusinessResources;
  const row = JSON.parse(JSON.stringify(source));
  row.resourceId = resourceId;
  row.parentId = parentId;
  row.resourceName = resourceName;
  row.resourceUrl = resourceUrl;
  row.sysBusinessResources = children;
  return row;
}

function legacyMenuResourceIds(item) {
  const children = Array.isArray(item.sysBusinessResources) ? item.sysBusinessResources : [];
  return [item.resourceId, ...children.flatMap(legacyMenuResourceIds)];
}

function selectLocale(value) {
  return value === "en-US" ? "en-US" : "zh-CN";
}

function legacyMenuRow(item, locale = "zh-CN", level = 0) {
  const selectedLocale = selectLocale(locale);
  return {
    appImageUrl: "",
    appPageUrl: "",
    controllerDes: "",
    flagFlow: 1,
    isShow: 1,
    menuIcon: item.menuIcon,
    parentId: item.parentId,
    refreshType: 1,
    resourceCode: item.resourceCode,
    resourceDes: item.description[selectedLocale],
    resourceId: item.resourceId,
    resourceLevel: level,
    resourceName: item.name[selectedLocale],
    resourceNo: item.resourceNo,
    resourceUrl: item.resourceUrl,
    sysBusinessResources: item.children.slice().sort((a, b) => a.order - b.order || a.resourceId - b.resourceId).map((child) => legacyMenuRow(child, selectedLocale, level + 1)),
    sysIdentityResources: ""
  };
}

function assembleMenu(items, parentId, locale = "zh-CN") {
  const target = integer(parentId, "region menu parent id");
  return items
    .filter((item) => item.parentId === target)
    .slice()
    .sort((a, b) => a.order - b.order || a.resourceId - b.resourceId)
    .map((item) => legacyMenuRow(item, locale));
}

module.exports = { assembleMenu, legacyMenuResourceIds, legacyMenuRow, menuResourceIds, normalizeLegacyMenuRow, normalizeMenuItem, selectLocale };
