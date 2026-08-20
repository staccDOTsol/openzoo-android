(function (root) {
  "use strict";

  var R = root.OpenZooRails;
  var walletAddress = null;
  var signWaiters = {};

  function setAddress(addr) {
    walletAddress = addr || null;
  }

  function getAddress() {
    return walletAddress;
  }

  function requestWalletInfo() {
    if (root.parent && root.parent !== root) {
      root.parent.postMessage({ type: "wallet-request-info" }, "*");
    }
  }

  function disconnectWallet() {
    if (root.parent && root.parent !== root) {
      root.parent.postMessage({ type: "wallet-disconnect" }, "*");
    }
  }

  function openWrapPage() {
    if (root.parent && root.parent !== root) {
      root.parent.postMessage({ type: "open-external-url", url: R.WRAP_URL }, "*");
    } else if (typeof root.open === "function") {
      root.open(R.WRAP_URL, "_blank");
    }
  }

  /**
   * Ask the Cordova shell to MWA.signTransaction (partial sign only).
   * Never signAndSend — the gateway feePayer must complete settlement.
   */
  function signTransaction(txB64) {
    return new Promise(function (resolve, reject) {
      if (!root.parent || root.parent === root) {
        reject(new Error("Wallet shell is not available"));
        return;
      }
      var id = "tx-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      var timer = setTimeout(function () {
        if (signWaiters[id]) {
          delete signWaiters[id];
          reject(new Error("Wallet sign timed out"));
        }
      }, 120000);
      signWaiters[id] = {
        resolve: function (v) { clearTimeout(timer); resolve(v); },
        reject: function (e) { clearTimeout(timer); reject(e); },
      };
      root.parent.postMessage({
        type: "wallet-sign-transaction",
        id: id,
        transaction: txB64,
      }, "*");
    });
  }

  root.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || !data.type) return;
    if (data.type === "wallet-connected") {
      setAddress(data.address);
      root.dispatchEvent(new CustomEvent("openzoo-wallet", {
        detail: { address: data.address, method: data.method },
      }));
    }
    if (data.type === "wallet-disconnected") {
      setAddress(null);
      root.dispatchEvent(new CustomEvent("openzoo-wallet", { detail: { address: null } }));
    }
    if (data.type === "wallet-sign-transaction-response") {
      var waiter = signWaiters[data.id];
      if (!waiter) return;
      delete signWaiters[data.id];
      if (data.error) waiter.reject(new Error(data.error));
      else waiter.resolve(data.signedTransaction);
    }
  });

  function rpc(method, params) {
    var last = null;
    var chain = Promise.resolve();
    R.RPC_URLS.forEach(function (url) {
      chain = chain.then(function (hit) {
        if (hit) return hit;
        return fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
        }).then(function (res) {
          return res.json().then(function (j) {
            if (j.error) throw new Error(j.error.message || "rpc error");
            return { ok: true, result: j.result };
          });
        }).catch(function (e) {
          last = e;
          return null;
        });
      });
    });
    return chain.then(function (hit) {
      if (hit && hit.ok) return hit.result;
      throw last || new Error("RPC failed");
    });
  }

  function ContextNotFoundError() {
    this.name = "ContextNotFoundError";
    this.message = "context_not_found";
  }
  ContextNotFoundError.prototype = Object.create(Error.prototype);
  ContextNotFoundError.prototype.constructor = ContextNotFoundError;

  function mintRawBalance(owner, mint) {
    return rpc("getTokenAccountsByOwner", [
      owner,
      { mint: mint },
      { encoding: "jsonParsed" },
    ]).then(function (result) {
      var raw = BigInt(0);
      var list = (result && result.value) || [];
      for (var i = 0; i < list.length; i++) {
        var info = list[i].account && list[i].account.data && list[i].account.data.parsed &&
          list[i].account.data.parsed.info;
        var amt = info && info.tokenAmount && info.tokenAmount.amount;
        if (amt) raw += BigInt(amt);
      }
      return raw.toString();
    });
  }

  function probeBalances(owner, accepts) {
    var payable = {};
    var underlying = {};
    var specs = [];
    var seen = {};
    R.PAYABLE.forEach(function (p) {
      var live = accepts ? R.findPayableRow(accepts, p.symbol) : null;
      var mint = (live && live.asset) || p.mint;
      if (mint === R.PLAIN_USDC || seen[p.symbol]) return;
      seen[p.symbol] = true;
      specs.push({ symbol: p.symbol, mint: mint });
    });
    var payableJobs = specs.map(function (p) {
      return mintRawBalance(owner, p.mint).then(function (v) {
        payable[p.symbol] = v;
      });
    });
    return Promise.all(payableJobs).then(function () {
      var underJobs = R.UNDERLYING.map(function (u) {
        return mintRawBalance(owner, u.mint).then(function (v) {
          underlying[u.symbol] = v;
        });
      });
      return Promise.all(underJobs).then(function () {
        return { probeFailed: false, payable: payable, underlying: underlying };
      }).catch(function () {
        return { probeFailed: false, payable: payable, underlying: underlying };
      });
    }).catch(function (e) {
      return {
        probeFailed: true,
        payable: payable,
        underlying: underlying,
        error: String((e && e.message) || e),
      };
    });
  }

  function readBody(res) {
    return res.text().then(function (t) {
      try {
        return { raw: t, json: JSON.parse(t) };
      } catch (e) {
        return { raw: t, json: null };
      }
    });
  }

  function extractAccepts(json) {
    if (!json) return [];
    if (Array.isArray(json.accepts)) return json.accepts;
    if (json.accept && Array.isArray(json.accept)) return json.accept;
    return [];
  }

  function errText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function SteerError(copy) {
    this.name = "SteerError";
    this.message = copy && copy.body ? copy.body : "Need a payable token";
    this.copy = copy;
  }
  SteerError.prototype = Object.create(Error.prototype);
  SteerError.prototype.constructor = SteerError;

  function buildPayment(accept, payer) {
    return fetch(R.GATEWAY + "/v1/pay/build", {
      method: "POST",
      headers: R.gatewayHeaders(),
      body: JSON.stringify({ accept: accept, payer: payer }),
    }).then(function (res) {
      return readBody(res).then(function (body) {
        if (!res.ok) {
          throw new Error(errText((body.json && (body.json.error || body.json.message)) || body.raw || ("pay/build " + res.status)));
        }
        if (!body.json || !body.json.transaction || !body.json.envelope) {
          throw new Error("pay/build returned an unexpected body");
        }
        return body.json;
      });
    });
  }

  function tryPayRow(accept, payer) {
    return buildPayment(accept, payer).then(function (built) {
      return signTransaction(built.transaction).then(function (signed) {
        if (!signed) throw new Error("Wallet did not return a signed transaction");
        return R.encodePaymentHeader(built.envelope, signed);
      });
    });
  }

  function paymentHeaderFor(challengeJson, payer) {
    var accepts = extractAccepts(challengeJson);
    var help = challengeJson && challengeJson.help;
    return probeBalances(payer, accepts).then(function (balances) {
      var decision = R.pickRail(accepts, balances);
      if (decision.mode === "steer") {
        throw new SteerError(R.steerCopy(decision, help));
      }
      if (decision.mode === "pay") {
        return tryPayRow(decision.accept, payer).catch(function (e) {
          if (R.looksUnderfunded(e && e.message)) {
            throw new SteerError(R.steerCopy({
              mode: "steer",
              heldUnderlying: R.heldSymbols(balances.underlying),
              empty: R.heldSymbols(balances.underlying).length === 0,
            }, help));
          }
          throw e;
        });
      }
      var order = decision.order || [];
      var i = 0;
      function next() {
        if (i >= order.length) {
          throw new SteerError(R.steerCopy({
            mode: "steer",
            heldUnderlying: [],
            empty: true,
          }, help));
        }
        var row = order[i++];
        return tryPayRow(row.accept, payer).catch(function (e) {
          if (R.looksUnderfunded(e && e.message)) return next();
          throw e;
        });
      }
      return next();
    });
  }

  function paidFetch(path, options) {
    options = options || {};
    var payer = walletAddress;
    if (!payer) return Promise.reject(new Error("Connect a Phantom wallet first"));
    var headers = Object.assign(R.gatewayHeaders(), options.headers || {});

    return fetch(R.GATEWAY + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
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
      if (res.status !== 402) return res;
      return readBody(res).then(function (challenge) {
        return paymentHeaderFor(challenge.json || {}, payer).then(function (header) {
          var retryHeaders = Object.assign({}, headers, { "X-PAYMENT": header });
          return fetch(R.GATEWAY + path, {
            method: options.method || "GET",
            headers: retryHeaders,
            body: options.body,
          }).then(function (retry) {
            if (retry.ok) return retry;
            return readBody(retry).then(function (failed) {
              var msg = errText((failed.json && (failed.json.error || failed.json.message)) || failed.raw || ("HTTP " + retry.status));
              if (R.looksUnderfunded(msg)) {
                throw new SteerError(R.steerCopy({
                  mode: "steer",
                  heldUnderlying: [],
                  empty: true,
                }, challenge.json && challenge.json.help));
              }
              var err = new Error(msg);
              err.status = retry.status;
              err.body = failed.json;
              throw err;
            });
          });
        });
      });
    });
  }

  root.OpenZooPay = {
    setAddress: setAddress,
    getAddress: getAddress,
    requestWalletInfo: requestWalletInfo,
    disconnectWallet: disconnectWallet,
    signTransaction: signTransaction,
    openWrapPage: openWrapPage,
    probeBalances: probeBalances,
    paidFetch: paidFetch,
    SteerError: SteerError,
    ContextNotFoundError: ContextNotFoundError,
  };
})(typeof window !== "undefined" ? window : globalThis);
