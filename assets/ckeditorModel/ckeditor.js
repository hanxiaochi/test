(function(window){
  if (window.CKEDITOR) return;
  var instances = {};
  window.CKEDITOR = {
    instances: instances,
    replace: function(id) {
      var element = typeof id === "string" ? document.getElementById(id) : id;
      var name = element && (element.id || element.name) || String(id || "editor");
      var instance = {
        name: name,
        element: element,
        getData: function() {
          return element ? element.value || element.innerHTML || "" : "";
        },
        setData: function(value) {
          if (!element) return;
          if ("value" in element) element.value = value || "";
          else element.innerHTML = value || "";
        },
        updateElement: function() {}
      };
      instances[name] = instance;
      return instance;
    }
  };
})(window);
