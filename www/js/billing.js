/**
 * Google Play subscription billing for OpenZoo Android.
 * Source of truth: GET https://zoo.openzoo.fun/api/billing/tiers
 * Web Stripe mints keys via GET /api/billing/key?session= after /api/billing/checkout.
 * Play must mint the SAME key via POST /api/billing/play (not live yet — stub).
 * Do not open Stripe checkout as the Android primary path.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooBilling = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BILLING_ORIGIN = "https://zoo.openzoo.fun";
  var TIERS_URL = BILLING_ORIGIN + "/api/billing/tiers";
  var PLAY_EXCHANGE_URL = BILLING_ORIGIN + "/api/billing/play";
  var STRIPE_KEY_URL = BILLING_ORIGIN + "/api/billing/key";
  var PACKAGE_NAME = "fun.openzoo.android";
  var STORE_KEY = "openzoo.android.billing.v1";
  var TAGLINE = "Card first · x402 also works";
  var HIGHLIGHT_TIER = "pro";
  var HIGHLIGHT_COPY = "Most teams want this";

  var PRODUCT_IDS = {
    basic: "fun.openzoo.android.sub.basic",
    pro: "fun.openzoo.android.sub.pro",
    ultra: "fun.openzoo.android.sub.ultra",
  };

  // Live copy from GET /api/billing/tiers (2026-08-20). Used only if the API is unreachable.
  var FALLBACK_TIERS = [
    {
      id: "basic",
      name: "Basic",
      monthlyCents: 900,
      savingsSharePct: 40,
      rpm: 60,
      maxBindBytes: 33554432,
      maxTopK: 32,
      blurb: "One vault, one machine.",
    },
    {
      id: "pro",
      name: "Pro",
      monthlyCents: 2900,
      savingsSharePct: 20,
      rpm: 300,
      maxBindBytes: 536870912,
      maxTopK: 128,
      blurb: "A whole archive, and the breadth to actually read it.",
    },
    {
      id: "ultra",
      name: "Ultra",
      monthlyCents: 9900,
      savingsSharePct: 10,
      rpm: 2000,
      maxBindBytes: 8589934592,
      maxTopK: 256,
      blurb: "Agents, fleets, and corpora that do not fit anywhere else.",
    },
  ];

  function productIdFor(tierId) {
    return PRODUCT_IDS[tierId] || null;
  }

  function tierFromProductId(productId) {
    var id = String(productId || "");
    var keys = Object.keys(PRODUCT_IDS);
    for (var i = 0; i < keys.length; i++) {
      if (PRODUCT_IDS[keys[i]] === id) return keys[i];
    }
    var tail = id.split(".").pop();
    return PRODUCT_IDS[tail] ? tail : null;
  }

  function dollars(cents) {
    return "$" + (Number(cents || 0) / 100).toFixed(0) + "/mo";
  }

  function bindLabel(bytes) {
    var n = Number(bytes || 0);
    if (n >= 8589934592) return "~8GB";
    if (n >= 1073741824) return (n / 1073741824).toFixed(0) + "GB";
    if (n >= 1048576) return (n / 1048576).toFixed(0) + "MB";
    return n + "B";
  }

  function normalizeTiers(payload) {
    var list = (payload && payload.tiers) || FALLBACK_TIERS;
    return {
      tiers: list.map(function (t) {
        return {
          id: t.id,
          name: t.name,
          monthlyCents: t.monthlyCents,
          savingsSharePct: t.savingsSharePct,
          rpm: t.rpm,
          maxBindBytes: t.maxBindBytes,
          maxTopK: t.maxTopK,
          blurb: t.blurb || "",
          productId: productIdFor(t.id),
          priceLabel: dollars(t.monthlyCents),
          bindLabel: bindLabel(t.maxBindBytes),
          highlight: t.id === HIGHLIGHT_TIER ? HIGHLIGHT_COPY : "",
        };
      }),
      trialDays: payload && payload.trialDays != null ? Number(payload.trialDays) : 0,
      usageThresholdCents: payload && payload.usageThresholdCents != null
        ? Number(payload.usageThresholdCents) : 100,
      tagline: TAGLINE,
    };
  }

  function parseJsonResponse(res, raw) {
    var json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch (e) { json = null; }
    return { status: res.status, json: json, raw: raw, html: !!(raw && raw.charAt(0) === "<") };
  }

  function loadTiers(fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    return fetchImpl(TIERS_URL, { headers: { accept: "application/json" } }).then(function (res) {
      return res.text().then(function (raw) {
        var body = parseJsonResponse(res, raw);
        if (!res.ok || !body.json || !body.json.ok) throw new Error("tiers unavailable");
        return normalizeTiers(body.json);
      });
    }).catch(function () {
      return normalizeTiers({
        ok: true,
        tiers: FALLBACK_TIERS,
        trialDays: 0,
        usageThresholdCents: 100,
      });
    });
  }

  /**
   * Exchange a Play purchase for the same subscription API key Stripe mints.
   * Live web mint: GET /api/billing/key?session=<stripe checkout session>.
   * Play mint should be POST /api/billing/play — not deployed (404 HTML) as of 2026-08-20.
   */
  function exchangePlayPurchase(purchase, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    var body = {
      packageName: PACKAGE_NAME,
      productId: purchase.productId,
      purchaseToken: purchase.purchaseToken,
      orderId: purchase.orderId || "",
      tier: purchase.tier || tierFromProductId(purchase.productId),
    };
    return fetchImpl(PLAY_EXCHANGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (raw) {
        var parsed = parseJsonResponse(res, raw);
        if (parsed.json && parsed.json.key) {
          return { ok: true, key: parsed.json.key, pending: !!parsed.json.pending, purchase: body };
        }
        if (parsed.json && parsed.json.pending) {
          return { ok: true, key: null, pending: true, purchase: body };
        }
        // Endpoint missing or not JSON — do not invent a second key system.
        return {
          ok: false,
          stub: true,
          key: null,
          pending: true,
          purchase: body,
          todo: "POST /api/billing/play is not live. Backend must verify this Play purchaseToken with the Google Play Developer API and mint the same subscription API key that GET /api/billing/key?session= returns after Stripe checkout. Do not add a second key system.",
          status: parsed.status,
        };
      });
    }).catch(function (e) {
      return {
        ok: false,
        stub: true,
        key: null,
        pending: true,
        purchase: body,
        todo: "POST /api/billing/play is not live. Backend must verify this Play purchaseToken with the Google Play Developer API and mint the same subscription API key that GET /api/billing/key?session= returns after Stripe checkout. Do not add a second key system.",
        error: String((e && e.message) || e),
      };
    });
  }

  function readStore(storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(STORE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function writeStore(state, storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return state;
    storage.setItem(STORE_KEY, JSON.stringify(state || {}));
    return state;
  }

  function hasEntitlement(state) {
    state = state || {};
    return !!(state.key || (state.purchase && state.purchase.purchaseToken));
  }

  /**
   * Play purchase is the card path. x402 is the other working option.
   * Never treat a missing Play token as a lock-out.
   */
  function canEnterApp(billingState, x402State) {
    return hasEntitlement(billingState) || !!(x402State && (x402State.chosen || x402State.address));
  }

  function isStripeCheckoutUrl(url) {
    try {
      var u = new URL(url);
      return u.hostname === "checkout.stripe.com" || u.hostname.indexOf("stripe.com") !== -1;
    } catch (e) {
      return /checkout\.stripe\.com/.test(String(url || ""));
    }
  }

  return {
    BILLING_ORIGIN: BILLING_ORIGIN,
    TIERS_URL: TIERS_URL,
    PLAY_EXCHANGE_URL: PLAY_EXCHANGE_URL,
    STRIPE_KEY_URL: STRIPE_KEY_URL,
    PACKAGE_NAME: PACKAGE_NAME,
    STORE_KEY: STORE_KEY,
    TAGLINE: TAGLINE,
    HIGHLIGHT_TIER: HIGHLIGHT_TIER,
    HIGHLIGHT_COPY: HIGHLIGHT_COPY,
    PRODUCT_IDS: PRODUCT_IDS,
    FALLBACK_TIERS: FALLBACK_TIERS,
    productIdFor: productIdFor,
    tierFromProductId: tierFromProductId,
    dollars: dollars,
    bindLabel: bindLabel,
    normalizeTiers: normalizeTiers,
    loadTiers: loadTiers,
    exchangePlayPurchase: exchangePlayPurchase,
    readStore: readStore,
    writeStore: writeStore,
    hasEntitlement: hasEntitlement,
    canEnterApp: canEnterApp,
    isStripeCheckoutUrl: isStripeCheckoutUrl,
  };
});
