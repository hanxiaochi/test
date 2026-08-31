(function (factory) {
  if (typeof define === "function" && define.amd) {
    define(["jquery"], factory);
  } else {
    factory(window.jQuery || window.$);
  }
}(function ($) {
  if (!$) return;

  function rowId($row) {
    return $row.data("tt-id") || $row.attr("data-tt-id");
  }

  function parentId($row) {
    return $row.data("tt-parent-id") || $row.attr("data-tt-parent-id");
  }

  function childrenOf($table, id) {
    return $table.find("tr").filter(function () {
      return String(parentId($(this))) === String(id);
    });
  }

  function setVisible($table, id, visible) {
    childrenOf($table, id).each(function () {
      var $child = $(this);
      $child.toggle(visible);
      if (!visible) {
        setVisible($table, rowId($child), false);
        $child.removeClass("expanded").addClass("collapsed");
      }
    });
  }

  $.fn.treetable = function (command) {
    return this.each(function () {
      var $table = $(this);
      if (command === "destroy") {
        $table.removeClass("treetable");
        $table.find("span.indenter").remove();
        $table.find("tr").show().removeClass("branch collapsed expanded");
        return;
      }

      $table.addClass("treetable");
      $table.find("tr").each(function () {
        var $row = $(this);
        var id = rowId($row);
        if (!id) return;
        var level = 0;
        var pid = parentId($row);
        while (pid) {
          level += 1;
          var $parent = $table.find("tr[data-tt-id='" + pid + "']");
          pid = parentId($parent);
        }
        var hasChildren = childrenOf($table, id).length > 0;
        $row.toggleClass("branch", hasChildren).addClass(hasChildren ? "expanded" : "leaf");
        var $cell = $row.children("td").first();
        if (!$cell.children("span.indenter").length) {
          var $indenter = $("<span class=\"indenter\"></span>").css("padding-left", (level * 18) + "px");
          if (hasChildren) {
            $("<a href=\"#\" aria-label=\"toggle\"></a>").appendTo($indenter).on("click", function (event) {
              event.preventDefault();
              var expanded = $row.hasClass("expanded");
              $row.toggleClass("expanded", !expanded).toggleClass("collapsed", expanded);
              setVisible($table, id, !expanded);
            });
          }
          $cell.prepend($indenter);
        }
      });
    });
  };
}));
