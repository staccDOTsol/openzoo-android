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
  var WRAP_URL = "https://x402.accrue.fund/start";
  var DEFAULT_MODEL = "google/gemini-3.7-flash";

  // Chat only. Do not claim RUN / WRITE / READ / SERVE — those need a desktop shell.
  var SYSTEM_PROMPT =
    "You are OpenZoo on Android. This app is chat only: conversation, an optional bound corpus, and public stats. " +
    "You cannot run shell commands, write files, read the device filesystem, or serve a local server. " +
    "Never emit RUN, WRITE, READ, or SERVE directives. If asked for those, say this phone app cannot do that.";

  var NAMESPACE = "stacc";
  var PLAIN_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  // Known-good live mints (2026-08-20). Prefer the live 402 accepts[] row's
  // asset over these so a stale catalog mint cannot win.
  var PAYABLE = [
    { symbol: "yUSDCx", mint: "6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv", decimals: 6 },
    { symbol: "wTOKENx", mint: "FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B", decimals: 6 },
    { symbol: "wLEOSx", mint: "3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35", decimals: 9 },
  ];

  // Underlying assets a user might hold. Plain USDC is NEVER an accepts[] row;
  // /v1/pay/build does not wrap.
  var UNDERLYING = [
    { symbol: "USDC", mint: PLAIN_USDC, twin: "yUSDCx" },
    { symbol: "TOKEN", mint: "EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump", twin: "wTOKENx" },
    { symbol: "LEOS", mint: "5xgsnby6P9zqGK71J7H4yJLxzqPvNbC7rDZxNzjHmj7e", twin: "wLEOSx" },
  ];

  var RPC_URLS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ];

  function isPlainUsdcRow(row) {
    return !!(row && row.asset === PLAIN_USDC);
  }

  function isSolanaRow(row) {
    return !!(row && String(row.network || "").indexOf("solana:") === 0);
  }

  function solanaAccepts(accepts) {
    return (accepts || []).filter(function (row) {
      return isSolanaRow(row) && !isPlainUsdcRow(row);
    });
  }

  function rowSymbol(row) {
    if (!row) return "";
    if (row.extra && row.extra.symbol) return String(row.extra.symbol);
    return "";
  }

  function findPayableRow(accepts, symbol) {
    var spec = null;
    for (var i = 0; i < PAYABLE.length; i++) {
      if (PAYABLE[i].symbol === symbol) spec = PAYABLE[i];
    }
    var rows = accepts || [];
    var bySymbol = null;
    var byMint = null;
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      if (!isSolanaRow(row) || isPlainUsdcRow(row)) continue;
      if (rowSymbol(row) === symbol) bySymbol = row;
      if (spec && row.asset === spec.mint) byMint = row;
    }
    // Live extra.symbol wins so a stale catalog mint (e.g. old wTOKENx) is ignored.
    return bySymbol || byMint;
  }

  function asBigInt(v) {
    try {
      return BigInt(String(v == null ? "0" : v));
    } catch (e) {
      return BigInt(0);
    }
  }

  function canCover(rawBalance, maxAmountRequired) {
    return asBigInt(rawBalance) >= asBigInt(maxAmountRequired);
  }

  /**
   * Pick a Solana rail the wallet can actually pay.
   * balances = { payable: { yUSDCx: "raw" }, underlying: { USDC: "raw" }, probeFailed?: bool }
   */
  function pickRail(accepts, balances) {
    var sol = solanaAccepts(accepts);
    balances = balances || {};
    var payable = balances.payable || {};
    var underlying = balances.underlying || {};

    if (balances.probeFailed) {
      var order = [];
      for (var i = 0; i < PAYABLE.length; i++) {
        var row = findPayableRow(sol, PAYABLE[i].symbol);
        if (row) order.push({ symbol: PAYABLE[i].symbol, accept: row });
      }
      return { mode: "fallback", order: order };
    }

    for (var j = 0; j < PAYABLE.length; j++) {
      var spec = PAYABLE[j];
      var accept = findPayableRow(sol, spec.symbol);
      if (!accept) continue;
      if (canCover(payable[spec.symbol], accept.maxAmountRequired)) {
        return { mode: "pay", symbol: spec.symbol, accept: accept };
      }
    }

    var held = [];
    for (var k = 0; k < UNDERLYING.length; k++) {
      var u = UNDERLYING[k];
      if (asBigInt(underlying[u.symbol]) > BigInt(0)) held.push(u.symbol);
    }
    return {
      mode: "steer",
      heldUnderlying: held,
      empty: held.length === 0,
    };
  }

  function heldSymbols(underlying) {
    var held = [];
    underlying = underlying || {};
    for (var k = 0; k < UNDERLYING.length; k++) {
      var sym = UNDERLYING[k].symbol;
      if (asBigInt(underlying[sym]) > BigInt(0)) held.push(sym);
    }
    return held;
  }

  function steerCopy(decision, helpText) {
    var wrap = WRAP_URL;
    var body =
      "This app pays with USDC on Solana. If your Phantom wallet only has regular USDC, open " +
      wrap +
      " to wrap it, then come back. The app cannot wrap for you.";
    var extras = [];
    var held = (decision && decision.heldUnderlying) || [];
    if (held.indexOf("TOKEN") !== -1) {
      extras.push("You also have TOKEN here — that needs the same wrap step before it can pay.");
    }
    if (held.indexOf("LEOS") !== -1) {
      extras.push("You also have LEOS here — that needs the same wrap step before it can pay.");
    }
    if (decision && decision.empty && helpText) extras.push(String(helpText));
    if (extras.length) body = body + "\n\n" + extras.join("\n\n");
    return {
      title: "Need USDC on Solana",
      body: body,
      wrapUrl: wrap,
      help: decision && decision.empty ? String(helpText || "") : "",
    };
  }

  function bindPayload(corpus, contextId) {
    if (contextId) return { items: [{ text: corpus }], context_id: contextId };
    return { corpus: corpus };
  }

  function isContextNotFound(status, json) {
    var code = json && json.error && json.error.code;
    return Number(status) === 404 && code === "context_not_found";
  }

  function gatewayHeaders(extra) {
    return Object.assign({
      "content-type": "application/json",
      authorization: "Bearer openzoo",
      "x-openzoo-namespace": NAMESPACE,
    }, extra || {});
  }

  function looksUnderfunded(text) {
    var s = String(text || "").toLowerCase();
    return /insufficient|underfund|not enough|0x1\b|custom program error: 1|simulation failed|failed_settle|insufficientfunds|insufficient funds|no token account|could not find account|account not found/.test(s);
  }

  function encodePaymentHeader(envelope, signedTxB64) {
    var payload = Object.assign({}, (envelope && envelope.payload) || {}, {
      transaction: signedTxB64,
    });
    var body = Object.assign({}, envelope || {}, { payload: payload });
    var json = JSON.stringify(body);
    if (typeof btoa === "function") return btoa(json);
    return Buffer.from(json, "utf8").toString("base64");
  }

  function decodePaymentHeader(b64) {
    var json = typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  }

  function defaultModelId(models) {
    var list = (models || []).filter(function (m) {
      return m && m.id && m.id.charAt(0) !== "~" && m.id.indexOf(":batch") === -1;
    });
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === DEFAULT_MODEL) return list[i].id;
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j].id.indexOf("gemini") !== -1) return list[j].id;
    }
    return list[0] ? list[0].id : DEFAULT_MODEL;
  }

  function maxTokensFor(model) {
    return /deepseek|grok|thinking|fable|sonnet-5|-r1|reason/i.test(model || "") ? 16384 : 4096;
  }

  return {
    GATEWAY: GATEWAY,
    WRAP_URL: WRAP_URL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    NAMESPACE: NAMESPACE,
    PLAIN_USDC: PLAIN_USDC,
    PAYABLE: PAYABLE,
    UNDERLYING: UNDERLYING,
    RPC_URLS: RPC_URLS,
    isSolanaRow: isSolanaRow,
    solanaAccepts: solanaAccepts,
    findPayableRow: findPayableRow,
    canCover: canCover,
    pickRail: pickRail,
    heldSymbols: heldSymbols,
    steerCopy: steerCopy,
    looksUnderfunded: looksUnderfunded,
    encodePaymentHeader: encodePaymentHeader,
    decodePaymentHeader: decodePaymentHeader,
    defaultModelId: defaultModelId,
    maxTokensFor: maxTokensFor,
    bindPayload: bindPayload,
    isContextNotFound: isContextNotFound,
    gatewayHeaders: gatewayHeaders,
    isPlainUsdcRow: isPlainUsdcRow,
  };
});
