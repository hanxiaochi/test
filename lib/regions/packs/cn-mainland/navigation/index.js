"use strict";

module.exports = Object.freeze({
  topMenus: require("./top-menu.json").data,
  menuGroups: [
    { parentId: 2, rows: require("./menu-2.json").data },
    { parentId: 3, rows: require("./menu-3.json").data },
    { parentId: 7, rows: require("./menu-7.json").data },
    { parentId: 409, rows: require("./menu-409.json").data }
  ]
});
