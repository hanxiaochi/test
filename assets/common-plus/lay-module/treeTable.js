layui.define(["table"], function (exports) {
  var table = layui.table;
  var instances = {};

  function normalize(options) {
    options = options || {};
    var elem = options.elem || options.id || "#treeTable";
    var id = options.id || String(elem).replace(/^#/, "");
    var parsed = {};
    for (var key in options) parsed[key] = options[key];
    parsed.elem = elem;
    parsed.id = id;
    if (!parsed.page && parsed.page !== false) parsed.page = true;
    if (parsed.tree && parsed.tree.pidName && parsed.where && !parsed.where.pidName) {
      parsed.where.pidName = parsed.tree.pidName;
    }
    return parsed;
  }

  function render(options) {
    var parsed = normalize(options);
    instances[parsed.id] = parsed;
    return table.render(parsed);
  }

  var api = {
    init: render,
    render: render,
    reload: function (id, options) {
      var parsed = instances[id] || { id: id, elem: "#" + id };
      var merged = {};
      for (var key in parsed) merged[key] = parsed[key];
      for (var opt in (options || {})) merged[opt] = options[opt];
      instances[id] = merged;
      return table.reload(id, merged);
    },
    checkStatus: function (id) {
      return table.checkStatus(id);
    },
    expandAll: function () {},
    foldAll: function () {},
    getData: function (id) {
      var status = table.cache && table.cache[id];
      return status || [];
    }
  };

  exports("treeTable", api);
});
