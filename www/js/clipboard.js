/**
 * Address copy helpers. Native path is Android ClipboardManager via the
 * Cordova plugin — never rely on navigator.clipboard (dead in WebView).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooCopy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function toastLabel(kind) {
    var k = String(kind || "").toLowerCase();
    if (k === "burner" || k === "local-burner" || k === "local burner") {
      return "copied local burner";
    }
    return "copied";
  }

  function execCommandCopy(text) {
    if (typeof document === "undefined") return false;
    var el = document.createElement("textarea");
    el.value = String(text || "");
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, el.value.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(el);
    return ok;
  }

  /**
   * Copy text. Prefer native Cordova ClipboardManager, then execCommand.
   * Do not use navigator.clipboard as the primary path.
   */
  function copyText(text, nativeCopy) {
    var value = String(text || "");
    if (!value) return Promise.reject(new Error("nothing to copy"));
    if (typeof nativeCopy === "function") {
      return Promise.resolve(nativeCopy(value)).then(function () { return true; });
    }
    if (typeof document !== "undefined" && execCommandCopy(value)) {
      return Promise.resolve(true);
    }
    return Promise.reject(new Error("clipboard unavailable"));
  }

  return {
    toastLabel: toastLabel,
    execCommandCopy: execCommandCopy,
    copyText: copyText,
  };
});
