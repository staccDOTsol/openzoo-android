/**
 * Full-bleed Agent surface for Play Android.
 *
 * Prefers Cordova InAppBrowser (no nested WebView scroll).
 * Falls back to #agentFrame: position fixed, inset 0, viewport-fit=cover.
 * Never a second composer. Never Stripe / x402 / ANTHROPIC_API_KEY.
 * Only loads an https URL the caller already got from /api/ide/session.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooAgentHost = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var IAB_FEATURES =
    "location=no,zoom=no,hidden=no,toolbar=no,hardwareback=yes,fullscreen=yes,shouldPauseOnSuspend=no";

  var iabRef = null;
  var openedUrl = "";
  var onExit = null;

  function doc() {
    return (root && root.document) || (typeof document !== "undefined" ? document : null);
  }

  function inAppBrowserApi() {
    var w = root || (typeof window !== "undefined" ? window : null);
    if (w && w.cordova && w.cordova.InAppBrowser && typeof w.cordova.InAppBrowser.open === "function") {
      return w.cordova.InAppBrowser;
    }
    if (w && w.InAppBrowser && typeof w.InAppBrowser.open === "function") return w.InAppBrowser;
    return null;
  }

  function hasInAppBrowser() {
    return !!inAppBrowserApi();
  }

  function frameEl() {
    var d = doc();
    return d ? d.getElementById("agentFrame") : null;
  }

  function exitEl() {
    var d = doc();
    return d ? d.getElementById("agentExit") : null;
  }

  function setOpenClass(on) {
    var d = doc();
    if (!d || !d.body) return;
    d.documentElement.classList.toggle("agent-open", !!on);
    d.body.classList.toggle("agent-open", !!on);
    var game = d.getElementById("game");
    if (game) {
      game.setAttribute("aria-hidden", on ? "true" : "false");
      game.style.visibility = on ? "hidden" : "";
      game.style.pointerEvents = on ? "none" : "";
    }
    var exit = exitEl();
    if (exit) exit.hidden = !on;
  }

  function isHttpsUrl(value) {
    var raw = String(value || "").trim();
    if (!raw) return false;
    try {
      var u = new URL(raw);
      return u.protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  function clearFrame() {
    var frame = frameEl();
    if (!frame) return;
    frame.removeAttribute("src");
    try { frame.src = "about:blank"; } catch (e) { /* ignore */ }
    frame.hidden = true;
    frame.classList.remove("show");
  }

  function closeIab() {
    if (iabRef && typeof iabRef.close === "function") {
      try { iabRef.close(); } catch (e) { /* ignore */ }
    }
    iabRef = null;
  }

  function close() {
    var url = openedUrl;
    openedUrl = "";
    closeIab();
    clearFrame();
    setOpenClass(false);
    return url;
  }

  function open(url, opts) {
    opts = opts || {};
    if (!isHttpsUrl(url)) return "";
    if (openedUrl === url && (iabRef || (frameEl() && !frameEl().hidden))) return hasInAppBrowser() ? "iab" : "frame";
    close();
    openedUrl = url;
    onExit = typeof opts.onExit === "function" ? opts.onExit : null;

    var iab = inAppBrowserApi();
    if (iab) {
      iabRef = iab.open(url, "_blank", IAB_FEATURES);
      if (iabRef && typeof iabRef.addEventListener === "function") {
        iabRef.addEventListener("exit", function () {
          iabRef = null;
          openedUrl = "";
          setOpenClass(false);
          if (onExit) onExit();
        });
      }
      setOpenClass(true);
      var exit = exitEl();
      if (exit) exit.hidden = true;
      return "iab";
    }

    var frame = frameEl();
    if (!frame) return "";
    frame.hidden = false;
    frame.classList.add("show");
    if (frame.getAttribute("src") !== url) frame.src = url;
    setOpenClass(true);
    return "frame";
  }

  return {
    IAB_FEATURES: IAB_FEATURES,
    hasInAppBrowser: hasInAppBrowser,
    isHttpsUrl: isHttpsUrl,
    open: open,
    close: close,
  };
});
