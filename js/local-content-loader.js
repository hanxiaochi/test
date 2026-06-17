(function () {
  var VERSION = "local-content-loader-20260618-5";
  var lastHref = "";
  var activeSeq = 0;
  window.__ZWKJY_LOCAL_LOADER_VERSION__ = VERSION;

  function normalizeHref(href) {
    href = String(href || "main").trim();
    href = href.replace(/^#\//, "").replace(/^\//, "");
    return href || "main";
  }

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

  function loadLocalPage(href, options) {
    href = normalizeHref(href);
    options = options || {};
    var now = Date.now();
    var currentText = (contentBox() && contentBox().innerText || "").trim();
    if (!options.force && href === lastHref && currentText.length > 8) return;
    lastHref = href;
    var seq = ++activeSeq;

    loadWorkPosition(href);
    setContent('<div style="padding:16px;color:#64748b;">页面加载中...</div>');
    var url = href + (href.indexOf("?") > -1 ? "&" : "?") + "_local_v=" + now;
    fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then(function (html) {
        if (seq !== activeSeq) return;
        setContent(html);
      })
      .catch(function (err) {
        if (seq !== activeSeq) return;
        setContent('<div style="margin:12px;padding:16px;background:#fff;border:1px solid #fecaca;color:#b91c1c;">页面加载失败：' + href + '，状态：' + err.message + '</div>');
      });
  }

  function hrefFromHash() {
    var parts = location.href.split("#/");
    return parts.length >= 2 ? normalizeHref(parts.pop()) : "main";
  }

  window.zwkjyLoadLocalPage = loadLocalPage;

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-one-page]") : null;
    if (!target) return;
    var href = normalizeHref(target.getAttribute("data-one-page"));
    if (!href || target.getAttribute("target") === "_blank") return;
    event.preventDefault();
    event.stopPropagation();
    var nextHash = "#/" + href;
    if (location.hash !== nextHash) {
      location.hash = "/" + href;
    } else {
      loadLocalPage(href, { force: true });
    }
  }, true);

  window.addEventListener("hashchange", function () {
    loadLocalPage(hrefFromHash(), { force: true });
  });

  setTimeout(function () {
    var box = contentBox();
    if (box && box.innerText.trim().length < 8) {
      loadLocalPage(hrefFromHash(), { force: true });
    }
  }, 600);
})();
