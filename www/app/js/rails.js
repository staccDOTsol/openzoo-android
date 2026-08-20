/**
 * Live 402 rails from GET https://x402.accrue.fund/supported.
 * Symbols and acquire steps come from that directory. The drained
 * wTOKENx mint is hidden. FXYkw… is always wTOKENx2, never wTOKENx.
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
  var SUPPORTED_URL = "https://x402.accrue.fund/supported";
  var DEFAULT_MODEL = "google/gemini-3.7-flash";
  var NAMESPACE = "stacc";

  var PLAIN_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  var PLAIN_TOKEN = "EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump";
  var PLAIN_LEOS = "5xgsnby6P9zqGK71J7H4yJLxzqPvNbC7rDZxNzjHmj7e";
  var WTOKENX2_MINT = "FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B";
  var DRAINED_WTOKENX = "Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9";
  var WRAP_PROGRAM = "FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE";

  var SYSTEM_PROMPT =
    "You are OpenZoo on a phone — the same product as the grokui desktop client, " +
    "minus a local shell. This app is chat, threads, and an attached corpus. " +
    "You cannot run shell commands, write files, read the device filesystem, or serve a local server. " +
    "Never emit RUN, WRITE, READ, or SERVE directives. If asked for those, say this phone app cannot do that.";

  var RPC_URLS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ];

  var directoryCache = { at: 0, kinds: null };
  var subscriptionKey = null;
  var PENDING_402_KEY = "openzoo.android.pending402.v1";
  var CONNECT_ORIGINS = [
    "https://zoo.openzoo.fun",
    "https://x402-tokens.fly.dev",
    "https://x402.accrue.fund",
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ];

  function setSubscriptionKey(key) {
    subscriptionKey = key || null;
    return subscriptionKey;
  }

  function getSubscriptionKey() {
    return subscriptionKey;
  }

  function asBigInt(v) {
    try { return BigInt(String(v == null ? "0" : v)); }
    catch (e) { return BigInt(0); }
  }

  function canCover(rawBalance, maxAmountRequired) {
    return asBigInt(rawBalance) >= asBigInt(maxAmountRequired);
  }

  function isSolanaNetwork(network) {
    return String(network || "").indexOf("solana:") === 0;
  }

  function isDrainedMint(mint) {
    return String(mint || "") === DRAINED_WTOKENX;
  }

  function isPlainUsdc(mint) {
    return String(mint || "") === PLAIN_USDC;
  }

  function canonicalSymbol(mint, directorySymbol, challengeSymbol) {
    if (isDrainedMint(mint)) return null;
    if (mint === WTOKENX2_MINT) return "wTOKENx2";
    if (directorySymbol && directorySymbol !== "wTOKENx") return directorySymbol;
    if (challengeSymbol && challengeSymbol !== "wTOKENx") return challengeSymbol;
    return directorySymbol || challengeSymbol || "";
  }

  function kindAsset(kind) {
    return kind && kind.extra && kind.extra.asset;
  }

  function kindSymbol(kind) {
    return kind && kind.extra && kind.extra.symbol;
  }

  function solanaKinds(kinds) {
    return (kinds || []).filter(function (k) {
      return isSolanaNetwork(k && k.network) && kindAsset(k) && !isDrainedMint(kindAsset(k));
    });
  }

  function wrapKinds(kinds) {
    return solanaKinds(kinds).filter(function (k) {
      var acq = k.extra && k.extra.acquire;
      return acq && acq.method === "spl-token-wrap" && acq.underlying && acq.underlying.address && acq.escrow;
    });
  }

  function findKindByMint(kinds, mint) {
    var list = solanaKinds(kinds);
    for (var i = 0; i < list.length; i++) {
      if (kindAsset(list[i]) === mint) return list[i];
    }
    return null;
  }

  function rowSymbol(row) {
    return row && row.extra && row.extra.symbol ? String(row.extra.symbol) : "";
  }

  function isSolanaRow(row) {
    return !!(row && isSolanaNetwork(row.network) && !isPlainUsdc(row.asset) && !isDrainedMint(row.asset));
  }

  function solanaAccepts(accepts) {
    return (accepts || []).filter(isSolanaRow);
  }

  function annotateAccepts(accepts, kinds) {
    return solanaAccepts(accepts).map(function (row) {
      var kind = findKindByMint(kinds, row.asset);
      var symbol = canonicalSymbol(row.asset, kindSymbol(kind), rowSymbol(row));
      return {
        accept: row,
        symbol: symbol,
        kind: kind,
        acquire: kind && kind.extra && kind.extra.acquire,
        billedUsd: Number(row.extra && row.extra.billedUsd),
      };
    }).filter(function (a) { return !!a.symbol; });
  }

  /**
   * Pick how to pay from live /supported + the 402 accepts[] + wallet balances.
   * balances = {
   *   twins: { [mint]: raw },
   *   underlyings: { [mint]: raw },
   *   probeFailed?: bool
   * }
   */
  function pickRail(accepts, balances, kinds) {
    var annotated = annotateAccepts(accepts, kinds);
    balances = balances || {};
    var twins = balances.twins || {};
    var underlyings = balances.underlyings || {};

    if (balances.probeFailed) {
      return {
        mode: "fallback",
        order: annotated.slice().sort(function (a, b) {
          var au = Number.isFinite(a.billedUsd) ? a.billedUsd : 1e9;
          var bu = Number.isFinite(b.billedUsd) ? b.billedUsd : 1e9;
          return au - bu;
        }),
      };
    }

    var payable = annotated.filter(function (a) {
      return canCover(twins[a.accept.asset], a.accept.maxAmountRequired);
    }).sort(function (a, b) {
      var au = Number.isFinite(a.billedUsd) ? a.billedUsd : 1e9;
      var bu = Number.isFinite(b.billedUsd) ? b.billedUsd : 1e9;
      return au - bu;
    });
    if (payable.length) {
      return { mode: "pay", symbol: payable[0].symbol, accept: payable[0].accept, annotated: payable[0] };
    }

    var useful = pickLargestUseful(annotated, underlyings, {
      twins: twins,
      depositForShares: balances.depositForShares,
      reserves: balances.reserves,
      supply: balances.supply,
    });
    if (useful) {
      return Object.assign({ mode: "wrap" }, useful);
    }

    return {
      mode: "need-funds",
      heldUnderlying: heldPlainNames(underlyings),
      empty: heldPlainNames(underlyings).length === 0,
    };
  }

  /**
   * Pick the largest held underlying that can wrap a 402.
   * Do NOT compare underlying raw to twin maxAmountRequired — $10 TOKEN
   * (6dp) is not in the same units as a wTOKENx2 quote. Gate on held > 0,
   * and on depositForShares when pool reserves/supply are provided.
   */
  function pickLargestUseful(annotated, underlyings, opts) {
    opts = opts || {};
    underlyings = underlyings || {};
    var twins = opts.twins || {};
    var depositFn = opts.depositForShares;
    var reserves = opts.reserves || {};
    var supply = opts.supply || {};
    var candidates = [];
    (annotated || []).forEach(function (a) {
      var under = a.acquire && a.acquire.underlying && a.acquire.underlying.address;
      if (!under) return;
      var held = asBigInt(underlyings[under]);
      if (held <= 0n) return;
      if (typeof depositFn === "function" && (reserves[under] != null || supply[a.accept.asset] != null)) {
        var twinHave = asBigInt(twins[a.accept.asset]);
        var need = asBigInt(a.accept.maxAmountRequired) - twinHave;
        if (need < 0n) need = 0n;
        var deposit = depositFn(need, reserves[under] || 0, supply[a.accept.asset] || 0);
        if (held < asBigInt(deposit)) return;
      }
      candidates.push({
        symbol: a.symbol,
        accept: a.accept,
        annotated: a,
        underlying: under,
        underlyingSymbol: (a.acquire.underlying && a.acquire.underlying.symbol) || heldName(under),
        underlyingRaw: String(held),
      });
    });
    candidates.sort(function (a, b) {
      return asBigInt(b.underlyingRaw) > asBigInt(a.underlyingRaw) ? 1 : -1;
    });
    return candidates[0] || null;
  }

  function wrapPromptCopy(decision) {
    var sym = (decision && decision.underlyingSymbol) || "TOKEN";
    return {
      title: "Wrap " + sym + " to send this?",
      body: "Phantom will wrap a little " + sym + " so this message can send.",
      confirm: "Wrap " + sym,
      symbol: sym,
    };
  }

  function heldName(mint) {
    if (mint === PLAIN_USDC) return "USDC";
    if (mint === PLAIN_TOKEN) return "TOKEN";
    if (mint === PLAIN_LEOS) return "LEOS";
    return "token";
  }

  function heldPlainNames(underlyings) {
    var names = [];
    underlyings = underlyings || {};
    [PLAIN_USDC, PLAIN_TOKEN, PLAIN_LEOS].forEach(function (mint) {
      if (asBigInt(underlyings[mint]) > 0n) names.push(heldName(mint));
    });
    return names;
  }

  function fundsCopy(decision) {
    var held = (decision && decision.heldUnderlying) || [];
    var which = held.length ? held : ["TOKEN", "USDC", "LEOS"];
    var body = held.length
      ? "This wallet still needs more " + held.join(" / ") + " to wrap and pay. Tap the address to copy."
      : "Send TOKEN, USDC, or LEOS to this address, then send again. Tap the address to copy.";
    return {
      title: held.length ? "Send " + held.join(" / ") : "Send TOKEN, USDC, or LEOS",
      body: body,
      address: (decision && decision.address) || "",
      which: which,
      copyable: true,
      kind: "tokens",
    };
  }

  function wrapSolCopy(address) {
    return {
      title: "Need a little SOL",
      body: "Phantom needs a little SOL for the wrap fee. Tap the address to copy.",
      address: address || "",
      copyable: true,
      kind: "sol",
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
      authorization: "Bearer " + (subscriptionKey || "openzoo"),
      "x-openzoo-namespace": NAMESPACE,
    }, extra || {});
  }

  function looksUnderfunded(text) {
    var s = String(text || "").toLowerCase();
    return /insufficient|underfund|not enough|0x1\b|custom program error: 1|simulation failed|failed_settle|insufficientfunds|insufficient funds|no token account|could not find account|account not found/.test(s);
  }

  function looksNoSol(text) {
    var s = String(text || "").toLowerCase();
    return /no sol|insufficient.*lamports|insufficient funds for (rent|fee)|need .*sol\b/.test(s);
  }

  function looksNetworkGarbage(err) {
    var s = String((err && err.message) || err || "");
    return /load failed|failed to fetch|networkerror|net::|err_internet|err_connection|err_name_not_resolved|err_timed_out|the internet connection appears|nsurlerror|webview|nserror|network request failed|the network connection was lost|offline|econnreset|ehostunreach|etimedout/i.test(s);
  }

  function friendlyNetworkMessage() {
    return "Connection dropped while the wallet was open. Finish in Phantom — this app retries when you come back.";
  }

  function persistableOptions(options) {
    options = options || {};
    var headers = {};
    var src = options.headers || {};
    Object.keys(src).forEach(function (k) {
      if (k.toLowerCase() === "x-payment") return;
      headers[k] = src[k];
    });
    return {
      method: options.method || "GET",
      headers: headers,
      body: typeof options.body === "string" ? options.body : (options.body == null ? null : JSON.stringify(options.body)),
    };
  }

  function savePending402(job, storage) {
    storage = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    if (!storage || !job) return job;
    try { storage.setItem(PENDING_402_KEY, JSON.stringify(job)); } catch (e) {}
    return job;
  }

  function loadPending402(storage) {
    storage = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    if (!storage) return null;
    try { return JSON.parse(storage.getItem(PENDING_402_KEY) || "null"); }
    catch (e) { return null; }
  }

  function clearPending402(storage) {
    storage = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    if (storage) try { storage.removeItem(PENDING_402_KEY); } catch (e) {}
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

  function setDirectory(kinds) {
    if (Array.isArray(kinds)) directoryCache = { at: Date.now(), kinds: kinds };
    return directoryCache.kinds;
  }

  function getCachedDirectory() {
    return directoryCache.kinds;
  }

  function parseSupported(body) {
    if (!body) return [];
    if (Array.isArray(body.kinds)) return body.kinds;
    if (Array.isArray(body)) return body;
    return [];
  }

  return {
    GATEWAY: GATEWAY,
    SUPPORTED_URL: SUPPORTED_URL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    NAMESPACE: NAMESPACE,
    PLAIN_USDC: PLAIN_USDC,
    PLAIN_TOKEN: PLAIN_TOKEN,
    PLAIN_LEOS: PLAIN_LEOS,
    WTOKENX2_MINT: WTOKENX2_MINT,
    DRAINED_WTOKENX: DRAINED_WTOKENX,
    WRAP_PROGRAM: WRAP_PROGRAM,
    RPC_URLS: RPC_URLS,
    asBigInt: asBigInt,
    canCover: canCover,
    isSolanaNetwork: isSolanaNetwork,
    isDrainedMint: isDrainedMint,
    isPlainUsdc: isPlainUsdc,
    isSolanaRow: isSolanaRow,
    solanaAccepts: solanaAccepts,
    canonicalSymbol: canonicalSymbol,
    solanaKinds: solanaKinds,
    wrapKinds: wrapKinds,
    findKindByMint: findKindByMint,
    annotateAccepts: annotateAccepts,
    pickRail: pickRail,
    pickLargestUseful: pickLargestUseful,
    wrapPromptCopy: wrapPromptCopy,
    heldName: heldName,
    heldPlainNames: heldPlainNames,
    fundsCopy: fundsCopy,
    wrapSolCopy: wrapSolCopy,
    looksUnderfunded: looksUnderfunded,
    looksNoSol: looksNoSol,
    looksNetworkGarbage: looksNetworkGarbage,
    friendlyNetworkMessage: friendlyNetworkMessage,
    persistableOptions: persistableOptions,
    PENDING_402_KEY: PENDING_402_KEY,
    CONNECT_ORIGINS: CONNECT_ORIGINS,
    savePending402: savePending402,
    loadPending402: loadPending402,
    clearPending402: clearPending402,
    encodePaymentHeader: encodePaymentHeader,
    decodePaymentHeader: decodePaymentHeader,
    defaultModelId: defaultModelId,
    maxTokensFor: maxTokensFor,
    bindPayload: bindPayload,
    isContextNotFound: isContextNotFound,
    gatewayHeaders: gatewayHeaders,
    setDirectory: setDirectory,
    getCachedDirectory: getCachedDirectory,
    parseSupported: parseSupported,
    setSubscriptionKey: setSubscriptionKey,
    getSubscriptionKey: getSubscriptionKey,
    kindAsset: kindAsset,
    kindSymbol: kindSymbol,
  };
});
