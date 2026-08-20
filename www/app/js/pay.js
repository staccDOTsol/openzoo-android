/**
 * Subscription-key paid fetch. Play Billing is the only pay path.
 * A 402 is a subscribe/restore error — never a wallet / x402 / wrap prompt.
 */
(function (root) {
  "use strict";

  var R = root.OpenZooRails;
  var billing = { key: null, tier: null, pending: false };

  function ContextNotFoundError() {
    this.name = "ContextNotFoundError";
    this.message = "context_not_found";
  }
  ContextNotFoundError.prototype = Object.create(Error.prototype);
  ContextNotFoundError.prototype.constructor = ContextNotFoundError;

  function SubscriptionRequiredError(message) {
    this.name = "SubscriptionRequiredError";
    this.message = message || "Subscribe with Google Play to use this app.";
  }
  SubscriptionRequiredError.prototype = Object.create(Error.prototype);
  SubscriptionRequiredError.prototype.constructor = SubscriptionRequiredError;

  function getBilling() {
    return billing;
  }

  function signOutBilling() {
    billing = { key: null, tier: null, pending: false };
    if (typeof R.setSubscriptionKey === "function") R.setSubscriptionKey(null);
    if (root.parent && root.parent !== root) {
      root.parent.postMessage({ type: "billing-sign-out" }, "*");
    }
  }

  root.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || !data.type) return;
    if (data.type === "billing-ready") {
      billing = {
        key: data.key || null,
        tier: data.tier || null,
        pending: !!data.pending && !data.key,
      };
      if (typeof R.setSubscriptionKey === "function") R.setSubscriptionKey(billing.key);
      root.dispatchEvent(new CustomEvent("openzoo-billing", { detail: billing }));
    }
  });

  function readBody(res) {
    return res.text().then(function (t) {
      try { return { raw: t, json: JSON.parse(t) }; }
      catch (e) { return { raw: t, json: null }; }
    });
  }

  function errText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function paidFetch(path, options) {
    options = options || {};
    var headers = Object.assign(R.gatewayHeaders(), options.headers || {});

    return fetch(R.GATEWAY + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
      signal: options.signal,
    }).then(function (res) {
      if (res.status === 404) {
        return readBody(res).then(function (body) {
          if (R.isContextNotFound(res.status, body.json)) {
            throw new ContextNotFoundError();
          }
          var early = new Error(errText((body.json && (body.json.error || body.json.message)) || body.raw || "HTTP 404"));
          early.status = 404;
          early.body = body.json;
          throw early;
        });
      }
      if (res.status === 402) {
        throw new SubscriptionRequiredError(
          billing.key
            ? "This call still asked for payment. Restore your Google Play subscription."
            : "Subscribe with Google Play to use this app."
        );
      }
      if (!res.ok) {
        return readBody(res).then(function (body) {
          var msg = errText((body.json && (body.json.error || body.json.message)) || body.raw || ("HTTP " + res.status));
          var err = new Error(msg);
          err.status = res.status;
          err.body = body.json;
          throw err;
        });
      }
      return res;
    }).catch(function (e) {
      if (e && (e.name === "SubscriptionRequiredError" || e.name === "ContextNotFoundError")) throw e;
      if (e && (e.name === "AbortError" || e.code === "ABORT_ERR")) throw e;
      if (R.looksNetworkGarbage(e)) throw new Error(R.friendlyNetworkMessage());
      throw e;
    });
  }

  root.OpenZooPay = {
    getBilling: getBilling,
    signOutBilling: signOutBilling,
    paidFetch: paidFetch,
    ContextNotFoundError: ContextNotFoundError,
    SubscriptionRequiredError: SubscriptionRequiredError,
  };
})(typeof window !== "undefined" ? window : globalThis);
