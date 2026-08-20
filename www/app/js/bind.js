/**
 * Abstract bind. The user attaches files / a folder / pasted text.
 * The app binds a corpus behind the scenes. Context ids never leave this module
 * except as an opaque handle the UI must not render.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooBind = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_PART_CHARS = 400000;
  var TEXT_EXT = /\.(txt|md|json|jsonl|csv|tsv|log|html|htm|xml|py|js|mjs|cjs|ts|tsx|jsx|rs|go|java|c|h|cpp|hpp|rb|php|sh|sql|ya?ml|toml|ini|css)$/i;

  function looksText(name, type) {
    if (type && /^text\//.test(type)) return true;
    if (type && /(json|xml|javascript|typescript)/.test(type)) return true;
    return TEXT_EXT.test(name || "");
  }

  function stripHtml(html) {
    return String(html || "")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim();
  }

  function fileLabel(name) {
    var s = String(name || "note");
    var slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return slash >= 0 ? s.slice(slash + 1) : s;
  }

  function itemText(item) {
    var raw = item && item.text != null ? String(item.text) : "";
    var name = fileLabel(item && item.name);
    if (/\.html?$/i.test(name)) raw = stripHtml(raw);
    return raw;
  }

  function corpusFromItems(items) {
    return (items || []).map(function (it) {
      return "===== " + fileLabel(it.name) + " =====\n" + itemText(it);
    }).filter(function (block) {
      return block.replace(/^=+.*=+\n/, "").trim().length > 0;
    }).join("\n\n");
  }

  function splitIntoParts(text, maxChars) {
    maxChars = maxChars || MAX_PART_CHARS;
    var parts = [];
    var rest = String(text || "");
    while (rest.length > maxChars) {
      var window = rest.slice(0, maxChars);
      var at = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      var end = at > maxChars * 0.5 ? at : maxChars;
      parts.push(rest.slice(0, end));
      rest = rest.slice(end).replace(/^\n+/, "");
    }
    if (rest.trim()) parts.push(rest);
    return parts;
  }

  function chipLabel(items) {
    items = items || [];
    if (!items.length) return "";
    if (items.length === 1) return items[0].name || "note";
    return items.length + " files";
  }

  function userVisibleStatus(items, ready) {
    var n = (items || []).length;
    if (!n) return "";
    if (!ready) return n === 1 ? "attaching…" : "attaching " + n + " files…";
    return n === 1 ? "attached " + (items[0].name || "note") : "attached " + n + " files";
  }

  return {
    MAX_PART_CHARS: MAX_PART_CHARS,
    looksText: looksText,
    stripHtml: stripHtml,
    fileLabel: fileLabel,
    corpusFromItems: corpusFromItems,
    splitIntoParts: splitIntoParts,
    chipLabel: chipLabel,
    userVisibleStatus: userVisibleStatus,
  };
});
