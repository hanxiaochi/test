(function () {
  var VERSION = "local-content-loader-20260618-4";
  window.__ZWKJY_LOCAL_LOADER_VERSION__ = VERSION;

  function contentBox() {
    return document.querySelector(".lay-zw-content-page");
  }

  function workPositionBox() {
    return document.querySelector(".workPositionDiv");
  }

  function setContent(html) {
    var box = contentBox();
    if (box) box.innerHTML = html;
  }

  function loadWorkPosition(href) {
    var box = workPositionBox();
    if (!box) return;
    fetch("/position/chose_page?href=" + encodeURIComponent(href) + "&timestamp=" + Date.now(), { cache: "no-store" })
      .then(function (res) { return res.text(); })
      .then(function (html) { box.innerHTML = html; })
      .catch(function () {});
  }

  function loadLocalPage(href) {
    if (!href) href = "main";
    loadWorkPosition(href);
    setContent('<div style="padding:16px;color:#64748b;">页面加载中...</div>');
    var url = href + (href.indexOf("?") > -1 ? "&" : "?") + "_local_v=" + Date.now();
    fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then(function (html) { setContent(html); })
      .catch(function (err) {
        setContent('<div style="margin:12px;padding:16px;background:#fff;border:1px solid #fecaca;color:#b91c1c;">页面加载失败：' + href + "，状态：" + err.message + "</div>");
      });
  }

  window.zwkjyLoadLocalPage = loadLocalPage;

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-one-page]") : null;
    if (!target) return;
    var href = target.getAttribute("data-one-page");
    if (!href || target.getAttribute("target") === "_blank") return;
    event.preventDefault();
    event.stopPropagation();
    if (location.hash !== "#/" + href) location.hash = "/" + href;
    loadLocalPage(href);
  }, true);

  window.addEventListener("hashchange", function () {
    var parts = location.href.split("#/");
    if (parts.length >= 2) loadLocalPage(parts.pop());
  });

  setTimeout(function () {
    var box = contentBox();
    if (box && box.innerText.trim().length < 8) {
      var parts = location.href.split("#/");
      loadLocalPage(parts.length >= 2 ? parts.pop() : "main");
    }
  }, 1200);
})();
