/**
 * Chat / bind client for OpenZoo Android.
 * Play Billing subscription key is the only pay path. No x402, wrap, or wallet.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooRails = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var GATEWAY = "https://x402-tokens.fly.dev";
  var AUTO_MODEL = "openzoo/auto";
  var DEFAULT_MODEL = AUTO_MODEL;
  var NAMESPACE = "stacc";
  var RACE_TIERS = { cheap: true, medium: true, expensive: true, "grok4.6": true };

  var SYSTEM_PROMPT =
    "You are OpenZoo on a phone — the same product as the grokui desktop client, " +
    "minus a local shell. This app is chat, threads, and an attached corpus. " +
    "You cannot run shell commands, write files, read the device filesystem, or serve a local server. " +
    "Never emit RUN, WRITE, READ, or SERVE directives. If asked for those, say this phone app cannot do that.";

  var subscriptionKey = null;
  var CONNECT_ORIGINS = [
    "https://zoo.openzoo.fun",
    "https://x402-tokens.fly.dev",
  ];

  function setSubscriptionKey(key) {
    subscriptionKey = key || null;
    return subscriptionKey;
  }

  function getSubscriptionKey() {
    return subscriptionKey;
  }

  function bindPayload(corpus, contextId) {
    if (contextId) return { items: [{ text: corpus }], context_id: contextId };
    return { corpus: corpus };
  }

  /** Transcript prefix append — same shape as `npx openzoo claude` / grokui. */
  function transcriptBindPayload(corpus, contextId) {
    if (contextId) return { corpus: corpus, context_id: contextId };
    return { corpus: corpus };
  }

  function isContextNotFound(status, json) {
    var code = json && json.error && json.error.code;
    return Number(status) === 404 && code === "context_not_found";
  }

  function gatewayHeaders(extra) {
    return Object.assign({
      "content-type": "application/json",
      authorization: "Bearer " + (subscriptionKey || "openzoo"),
      "x-openzoo-namespace": NAMESPACE,
    }, extra || {});
  }

  function looksNetworkGarbage(err) {
    var s = String((err && err.message) || err || "");
    return /load failed|failed to fetch|networkerror|net::|err_internet|err_connection|err_name_not_resolved|err_timed_out|the internet connection appears|nsurlerror|webview|nserror|network request failed|the network connection was lost|offline|econnreset|ehostunreach|etimedout/i.test(s);
  }

  function friendlyNetworkMessage() {
    return "Connection dropped. Try again when you are back online.";
  }

  function isAutoModel(id) {
    var s = String(id == null ? "" : id).trim();
    return !s || /^auto$/i.test(s) || s === AUTO_MODEL;
  }

  function isRaceTier(tier) {
    return !!RACE_TIERS[String(tier || "").trim()];
  }

  /**
   * Auto is one door request: { model: "openzoo/auto" }. The server classifies.
   * Named ids stay named. Race is only an explicit cheap/medium/expensive/grok4.6
   * band plus a race of 2+ — never a stand-in for Auto.
   */
  function planTurn(input) {
    input = input || {};
    var raw = String(input.model == null ? "" : input.model).trim();
    var tier = String(input.tier == null ? "" : input.tier).trim();
    var n = Number(input.n) || 0;
    var k = Number(input.k) || 1;
    if (raw && !isAutoModel(raw)) {
      return { mode: "single", model: raw };
    }
    if (isRaceTier(tier) && n >= 2) {
      return { mode: "race", tier: tier, n: n, k: k };
    }
    return { mode: "auto", model: AUTO_MODEL };
  }

  function shouldRace(input) {
    return planTurn(input).mode === "race";
  }

  function resolveRequestModel(raw) {
    var s = String(raw == null ? "" : raw).trim();
    return isAutoModel(s) ? AUTO_MODEL : s;
  }

  function defaultModelId(models) {
    var list = (models || []).filter(function (m) {
      return m && m.id && m.id.charAt(0) !== "~" && m.id.indexOf(":batch") === -1;
    });
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === AUTO_MODEL) return list[i].id;
    }
    return DEFAULT_MODEL;
  }

  function maxTokensFor(model) {
    return /deepseek|grok|thinking|fable|sonnet-5|-r1|reason/i.test(model || "") ? 16384 : 4096;
  }

  return {
    GATEWAY: GATEWAY,
    AUTO_MODEL: AUTO_MODEL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    NAMESPACE: NAMESPACE,
    CONNECT_ORIGINS: CONNECT_ORIGINS,
    bindPayload: bindPayload,
    transcriptBindPayload: transcriptBindPayload,
    isContextNotFound: isContextNotFound,
    gatewayHeaders: gatewayHeaders,
    looksNetworkGarbage: looksNetworkGarbage,
    friendlyNetworkMessage: friendlyNetworkMessage,
    defaultModelId: defaultModelId,
    isAutoModel: isAutoModel,
    isRaceTier: isRaceTier,
    planTurn: planTurn,
    shouldRace: shouldRace,
    resolveRequestModel: resolveRequestModel,
    maxTokensFor: maxTokensFor,
    setSubscriptionKey: setSubscriptionKey,
    getSubscriptionKey: getSubscriptionKey,
  };
});
