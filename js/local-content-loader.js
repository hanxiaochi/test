(function () {
  var VERSION = "local-content-loader-20260618-9";
  var lastHref = "";
  var activeSeq = 0;

  window.__APP_LOCAL_LOADER_VERSION__ = VERSION;
  document.documentElement.setAttribute("data-local-loader-version", VERSION);

  function normalizeHref(href) {
    href = String(href || "main").trim();
    href = href.replace(/^#\//, "").replace(/^\//, "");
    if (href.indexOf(location.origin + "/") === 0) href = href.slice(location.origin.length + 1);
    href = href.replace(/^\//, "");
    return href || "main";
  }

  function contentBox() {
    return document.querySelector(".lay-zw-content-page");
  }

  function workPositionBox() {
    return document.querySelector(".workPositionDiv");
  }

  function currentHref() {
    var parts = location.href.split("#/");
    return parts.length >= 2 ? normalizeHref(parts.pop()) : "main";
  }

  function runInlineScripts(box) {
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll("script"), function (script) {
      var replacement = document.createElement("script");
      Array.prototype.forEach.call(script.attributes, function (attr) {
        replacement.setAttribute(attr.name, attr.value);
      });
      replacement.text = script.text || script.textContent || "";
      script.parentNode.replaceChild(replacement, script);
    });
  }

  function renderLayuiWidgets() {
    if (!window.layui) return;
    try {
      window.layui.use(["form", "element"], function () {
        if (window.layui.form && window.layui.form.render) window.layui.form.render();
        if (window.layui.element && window.layui.element.render) window.layui.element.render();
      });
    } catch (error) {}
  }

  function setContent(html) {
    var box = contentBox();
    if (!box) return false;
    box.innerHTML = html;
    runInlineScripts(box);
    renderLayuiWidgets();
    return true;
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
    var box = contentBox();
    var currentText = (box && box.innerText || "").trim();
    if (!options.force && href === lastHref && currentText.length > 8) return;

    lastHref = href;
    var seq = ++activeSeq;
    document.documentElement.setAttribute("data-local-active-href", href);
    loadWorkPosition(href);

    if (!setContent('<div style="padding:16px;color:#64748b;">Loading page...</div>')) {
      scheduleEnsure(120);
      return;
    }

    var url = href + (href.indexOf("?") > -1 ? "&" : "?") + "_local_v=" + Date.now();
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
        setContent(
          '<div style="margin:12px;padding:16px;background:#fff;border:1px solid #fecaca;color:#b91c1c;">Page failed: ' +
          href + ", status: " + err.message + "</div>"
        );
      });
  }

  function shouldShellLoad(rawHref) {
    if (!rawHref) return false;
    var href = String(rawHref).trim();
    if (!href || href === "#" || /^javascript:/i.test(href) || /^(mailto|tel):/i.test(href)) return false;
    if (/^https?:\/\//i.test(href) && href.indexOf(location.origin + "/") !== 0) return false;
    href = normalizeHref(href);
    if (/^(api|dologin|loginout|assets|js|css|img|images|fonts)\//i.test(href)) return false;
    if (/(^|\/)(export|download|downLoad|downLoadZipFile|reportViewSecurity)/i.test(href)) return false;
    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|zip|xlsx?|csv|pdf)(\?|$)/i.test(href)) return false;
    return true;
  }

  function navigateShell(rawHref, options) {
    var href = normalizeHref(rawHref);
    if (!shouldShellLoad(href)) return false;
    document.documentElement.setAttribute("data-local-last-nav", href);
    var nextHash = "#/" + href;
    if (location.hash !== nextHash) {
      location.hash = "/" + href;
    } else {
      loadLocalPage(href, { force: true });
    }
    return true;
  }

  function hrefFromInlineLocation(code, element) {
    var match = String(code || "").match(/location\.href\s*=\s*([^;]+)/);
    if (!match) return "";
    try {
      return Function("return (" + match[1] + ");").call(element);
    } catch (error) {
      return "";
    }
  }

  function shellReload() {
    loadLocalPage(currentHref(), { force: true });
  }

  function ensureContent() {
    var box = contentBox();
    if (!box) {
      scheduleEnsure(150);
      return;
    }
    var text = (box.innerText || "").trim();
    var loading = /Loading page/i.test(text);
    if (text.length < 8 || loading) {
      loadLocalPage(currentHref(), { force: true });
    }
  }

  function scheduleEnsure(delay) {
    window.setTimeout(ensureContent, delay);
  }

  window.appLoadLocalPage = loadLocalPage;
  window.appNavigateLocal = navigateShell;
  window.appReloadCurrentContent = shellReload;

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var dataPage = event.target && event.target.closest ? event.target.closest("[data-one-page]") : null;
    if (dataPage) {
      var dataHref = dataPage.getAttribute("data-one-page");
      if (dataHref && dataPage.getAttribute("target") !== "_blank" && shouldShellLoad(dataHref)) {
        event.preventDefault();
        event.stopPropagation();
        navigateShell(dataHref);
        return;
      }
    }

    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (link && !link.hasAttribute("download") && link.getAttribute("target") !== "_blank" && !link.hasAttribute("data-post")) {
      var href = link.getAttribute("href");
      if (shouldShellLoad(href)) {
        event.preventDefault();
        event.stopPropagation();
        navigateShell(href);
        return;
      }
    }

    var locationButton = event.target && event.target.closest ? event.target.closest("[onclick*=\"location.href\"]") : null;
    if (locationButton) {
      var inlineHref = hrefFromInlineLocation(locationButton.getAttribute("onclick"), locationButton);
      if (shouldShellLoad(inlineHref)) {
        event.preventDefault();
        event.stopPropagation();
        navigateShell(inlineHref);
      }
    }
  }, true);

  document.addEventListener("change", function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var code = target.getAttribute("onchange");
    if (!code || code.indexOf("location.href") === -1) return;
    var href = hrefFromInlineLocation(code, target);
    if (shouldShellLoad(href)) {
      event.preventDefault();
      event.stopPropagation();
      navigateShell(href);
    }
  }, true);

  window.addEventListener("hashchange", function () {
    loadLocalPage(currentHref(), { force: true });
  });

  document.addEventListener("DOMContentLoaded", function () {
    ensureContent();
    [150, 600, 1500, 3000].forEach(scheduleEnsure);
  });

  [100, 600, 1500, 3000].forEach(scheduleEnsure);
})();
