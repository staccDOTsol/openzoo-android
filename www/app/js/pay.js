(function (root) {
  "use strict";

  var R = root.OpenZooRails;
  var W = root.OpenZooWrap;
  var S = root.OpenZooSolana;
  var walletAddress = null;
  var walletMethod = null;
  var walletPayEnabled = false;
  var billing = { key: null, tier: null, pending: false };
  var signWaiters = {};
  var wrapPromptFn = null;
  var currentPaidPath = "";
  var currentPaidOptions = {};

  function setAddress(addr) {
    walletAddress = addr || null;
  }

  function getAddress() {
    return walletAddress;
  }

  function getMethod() {
    return walletMethod;
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

  function parentCall(type, extra) {
    return new Promise(function (resolve, reject) {
      if (!root.parent || root.parent === root) {
        reject(new Error("Wallet shell is not available"));
        return;
      }
      var id = type + "-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      var timer = setTimeout(function () {
        if (signWaiters[id]) {
          delete signWaiters[id];
          reject(new Error("Wallet timed out"));
        }
      }, 120000);
      signWaiters[id] = {
        resolve: function (v) { clearTimeout(timer); resolve(v); },
        reject: function (e) { clearTimeout(timer); reject(e); },
      };
      root.parent.postMessage(Object.assign({ type: type, id: id }, extra || {}), "*");
    });
  }

  /**
   * 402 pay path: partial-sign only. Facilitator stays the fee-payer.
   * Never signAndSend a payment transaction.
   */
  function signTransaction(txB64) {
    return parentCall("wallet-sign-transaction", { transaction: txB64 });
  }

  /**
   * Wrap / top-up path: wallet may broadcast. The user is the fee-payer.
   */
  function signAndSendTransaction(txB64) {
    return parentCall("wallet-sign-and-send-transaction", { transaction: txB64 });
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
    if (data.type === "wallet-connected") {
      setAddress(data.address);
      walletMethod = data.method || "MWA";
      walletPayEnabled = true;
      root.dispatchEvent(new CustomEvent("openzoo-wallet", {
        detail: { address: data.address, method: walletMethod },
      }));
    }
    if (data.type === "wallet-disconnected") {
      setAddress(null);
      walletMethod = null;
      walletPayEnabled = false;
      root.dispatchEvent(new CustomEvent("openzoo-wallet", { detail: { address: null } }));
    }
    if (data.type === "wallet-sign-transaction-response" ||
        data.type === "wallet-sign-and-send-transaction-response") {
      var waiter = signWaiters[data.id];
      if (!waiter) return;
      delete signWaiters[data.id];
      if (data.error) waiter.reject(new Error(data.error));
      else waiter.resolve(data.signedTransaction || data.signature);
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

  function FundsError(copy) {
    this.name = "FundsError";
    this.message = copy && copy.body ? copy.body : "Need funds in Phantom";
    this.copy = copy;
  }
  FundsError.prototype = Object.create(Error.prototype);
  FundsError.prototype.constructor = FundsError;

  function WrapCanceledError() {
    this.name = "WrapCanceledError";
    this.message = "Wrap canceled";
  }
  WrapCanceledError.prototype = Object.create(Error.prototype);
  WrapCanceledError.prototype.constructor = WrapCanceledError;

  function ConnectWalletError(message) {
    this.name = "ConnectWalletError";
    this.message = message || "Connect Phantom to wrap TOKEN and send.";
  }
  ConnectWalletError.prototype = Object.create(Error.prototype);
  ConnectWalletError.prototype.constructor = ConnectWalletError;

  function setWrapPrompt(fn) {
    wrapPromptFn = fn;
  }

  function confirmWrap(decision) {
    var pending = R.loadPending402 && R.loadPending402();
    if (pending && pending.wrapConfirmed) return Promise.resolve(true);
    if (!wrapPromptFn) return Promise.resolve(true);
    return Promise.resolve(wrapPromptFn(R.wrapPromptCopy(decision)));
  }

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

  function loadDirectory() {
    var cached = R.getCachedDirectory();
    if (cached && cached.length) return Promise.resolve(cached);
    return fetch(R.SUPPORTED_URL, { headers: { accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var kinds = R.parseSupported(body);
        R.setDirectory(kinds);
        return kinds;
      });
  }

  function uniqueMints(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (m) {
      if (!m || seen[m] || R.isDrainedMint(m)) return;
      seen[m] = true;
      out.push(m);
    });
    return out;
  }

  function probeBalances(owner, accepts, kinds) {
    var twins = {};
    var underlyings = {};
    var twinMints = uniqueMints(R.solanaAccepts(accepts).map(function (a) { return a.asset; }));
    var underMints = uniqueMints(R.wrapKinds(kinds).map(function (k) {
      return k.extra.acquire.underlying.address;
    }).concat([R.PLAIN_USDC, R.PLAIN_TOKEN, R.PLAIN_LEOS]));

    function fill(map, mints) {
      return Promise.all(mints.map(function (mint) {
        return mintRawBalance(owner, mint).then(function (v) { map[mint] = v; });
      }));
    }

    return fill(twins, twinMints).then(function () {
      return fill(underlyings, underMints).then(function () {
        return { probeFailed: false, twins: twins, underlyings: underlyings };
      }).catch(function () {
        return { probeFailed: false, twins: twins, underlyings: underlyings };
      });
    }).catch(function (e) {
      return {
        probeFailed: true,
        twins: twins,
        underlyings: underlyings,
        error: String((e && e.message) || e),
      };
    });
  }

  function readBody(res) {
    return res.text().then(function (t) {
      try { return { raw: t, json: JSON.parse(t) }; }
      catch (e) { return { raw: t, json: null }; }
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

  function mintOwner(mint) {
    return rpc("getAccountInfo", [mint, { encoding: "base64" }]).then(function (info) {
      if (info && info.value && info.value.owner) return info.value.owner;
      return S.TOKEN_2022_PROGRAM;
    }).catch(function () { return S.TOKEN_2022_PROGRAM; });
  }

  function tokenAmount(account) {
    return rpc("getTokenAccountBalance", [account]).then(function (r) {
      return BigInt((r && r.value && r.value.amount) || "0");
    }).catch(function () { return 0n; });
  }

  function tokenSupply(mint) {
    return rpc("getTokenSupply", [mint]).then(function (r) {
      return BigInt((r && r.value && r.value.amount) || "0");
    });
  }

  function latestBlockhash() {
    return rpc("getLatestBlockhash", [{ commitment: "confirmed" }]).then(function (r) {
      return r && r.value && r.value.blockhash;
    });
  }

  function confirmSignature(signature, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    var deadline = Date.now() + timeoutMs;
    function once() {
      return rpc("getSignatureStatuses", [[signature]]).then(function (res) {
        var st = res && res.value && res.value[0];
        if (st) {
          if (st.err) throw new Error("top-up failed on-chain");
          if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
            return signature;
          }
        }
        if (Date.now() >= deadline) throw new Error("top-up timed out");
        return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(once);
      }).catch(function (e) {
        if (/failed on-chain|timed out/.test(e && e.message)) throw e;
        if (Date.now() >= deadline) throw new Error("top-up timed out");
        return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(once);
      });
    }
    return once();
  }

  function topUpQuotedAsset(accept, kinds, owner, need, onStage) {
    var poolHint = W.resolvePool(accept.asset, kinds);
    if (!poolHint) throw new FundsError(R.fundsCopy({ heldUnderlying: [], empty: true }));
    return mintOwner(accept.asset).then(function (wrappedProgram) {
      var pool = W.resolvePool(accept.asset, kinds, wrappedProgram);
      function attempt(n) {
        return mintRawBalance(owner, accept.asset).then(function (have) {
          var short = BigInt(need) - BigInt(have || "0");
          if (short <= 0n) return { wrapped: true };
          return Promise.all([
            tokenAmount(pool.escrow),
            tokenSupply(pool.wrapped),
            mintRawBalance(owner, pool.underlying),
          ]).then(function (pair) {
            var deposit = W.depositForShares(short, pair[0], pair[1]);
            if (BigInt(pair[2] || "0") < deposit) {
              throw new FundsError(R.fundsCopy({
                heldUnderlying: R.heldPlainNames((function () {
                  var u = {};
                  u[pool.underlying] = pair[2];
                  return u;
                })()),
                empty: BigInt(pair[2] || "0") === 0n,
                address: owner,
              }));
            }
            if (onStage) onStage("topup");
            return latestBlockhash().then(function (blockhash) {
              if (!blockhash) throw new Error("could not fetch a recent blockhash");
              var tx = W.buildWrapTx(pool, owner, deposit, blockhash, owner);
              return signAndSendTransaction(tx.base64).then(function (sig) {
                if (!sig) throw new Error("Wallet did not top up");
                return confirmSignature(sig);
              }).catch(function (e) {
                if (R.looksNoSol(e && e.message) || /lamports|blockhash|fee/i.test(e && e.message || "")) {
                  throw new FundsError(R.wrapSolCopy(owner));
                }
                throw e;
              });
            }).then(function () {
              if (n >= 2) return { wrapped: true };
              return attempt(n + 1);
            });
          });
        });
      }
      return attempt(0);
    });
  }

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

  function paymentHeaderFor(challengeJson, payer, onStage) {
    var accepts = extractAccepts(challengeJson);
    return loadDirectory().then(function (kinds) {
      return probeBalances(payer, accepts, kinds).then(function (balances) {
        var decision = R.pickRail(accepts, balances, kinds);

        function afterReady(accept) {
          return tryPayRow(accept, payer).catch(function (e) {
            if (R.looksUnderfunded(e && e.message)) {
              throw new FundsError(R.fundsCopy({
                heldUnderlying: R.heldPlainNames(balances.underlyings),
                empty: R.heldPlainNames(balances.underlyings).length === 0,
                address: payer,
              }));
            }
            throw e;
          });
        }

        if (decision.mode === "need-funds") {
          throw new FundsError(R.fundsCopy(Object.assign({}, decision, { address: payer })));
        }
        if (decision.mode === "pay") {
          return afterReady(decision.accept);
        }
        if (decision.mode === "wrap") {
          return confirmWrap(decision).then(function (ok) {
            if (!ok) throw new WrapCanceledError();
            pauseForWallet(currentPaidPath, currentPaidOptions, {
              challenge: challengeJson,
              payer: payer,
              wrapConfirmed: true,
            });
            return topUpQuotedAsset(
              decision.accept,
              kinds,
              payer,
              decision.accept.maxAmountRequired,
              onStage
            ).then(function () { return afterReady(decision.accept); });
          });
        }
        var order = decision.order || [];
        var i = 0;
        function next() {
          if (i >= order.length) throw new FundsError(R.fundsCopy({ heldUnderlying: [], empty: true, address: payer }));
          var row = order[i++];
          return tryPayRow(row.accept, payer).catch(function (e) {
            if (R.looksUnderfunded(e && e.message)) return next();
            throw e;
          });
        }
        return next();
      });
    });
  }

  function requestWalletConnect(method) {
    if (root.parent && root.parent !== root) {
      root.parent.postMessage({ type: "wallet-connect-request", method: method || "MWA" }, "*");
    }
  }

  function signOutBilling() {
    billing = { key: null, tier: null, pending: false };
    if (typeof R.setSubscriptionKey === "function") R.setSubscriptionKey(null);
    if (root.parent && root.parent !== root) {
      root.parent.postMessage({ type: "billing-sign-out" }, "*");
    }
  }

  function setWalletPayEnabled(on) {
    walletPayEnabled = !!on;
  }

  function getBilling() {
    return billing;
  }

  function SubscriptionRequiredError(message) {
    this.name = "SubscriptionRequiredError";
    this.message = message || "Subscribe with Google Play to use this app.";
  }
  SubscriptionRequiredError.prototype = Object.create(Error.prototype);
  SubscriptionRequiredError.prototype.constructor = SubscriptionRequiredError;

  function PaymentPausedError(message) {
    this.name = "PaymentPausedError";
    this.message = message || R.friendlyNetworkMessage();
  }
  PaymentPausedError.prototype = Object.create(Error.prototype);
  PaymentPausedError.prototype.constructor = PaymentPausedError;

  function pauseForWallet(path, options, extra) {
    R.savePending402(Object.assign({
      path: path,
      at: Date.now(),
      payer: walletAddress,
    }, R.persistableOptions(options), extra || {}));
  }

  function wrapNetwork(err, path, options) {
    if (err && (err.name === "FundsError" || err.name === "SubscriptionRequiredError" ||
        err.name === "ContextNotFoundError" || err.name === "PaymentPausedError" ||
        err.name === "WrapCanceledError" || err.name === "ConnectWalletError")) {
      throw err;
    }
    if (R.looksNetworkGarbage(err)) {
      pauseForWallet(path, options, { reason: "network" });
      throw new PaymentPausedError();
    }
    throw err;
  }

  function paidFetch(path, options) {
    options = options || {};
    currentPaidPath = path;
    currentPaidOptions = options;
    var payer = walletAddress;
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
      if (!payer) {
        throw new ConnectWalletError(
          billing.key
            ? "This call still asked for payment. Connect Phantom or use the local burner to wrap TOKEN and send."
            : "Connect Phantom or use the local burner (x402), or subscribe with Google Play."
        );
      }
      return readBody(res).then(function (challenge) {
        pauseForWallet(path, options, { challenge: challenge.json || {}, payer: payer });
        return paymentHeaderFor(challenge.json || {}, payer, options.onStage).then(function (header) {
          var retryHeaders = Object.assign({}, headers, { "X-PAYMENT": header });
          return fetch(R.GATEWAY + path, {
            method: options.method || "GET",
            headers: retryHeaders,
            body: options.body,
          }).then(function (retry) {
            if (retry.ok) {
              R.clearPending402();
              return retry;
            }
            return readBody(retry).then(function (failed) {
              var msg = errText((failed.json && (failed.json.error || failed.json.message)) || failed.raw || ("HTTP " + retry.status));
              if (R.looksNetworkGarbage(msg)) throw new PaymentPausedError();
              if (R.looksUnderfunded(msg)) {
                throw new FundsError(R.fundsCopy({ heldUnderlying: [], empty: true, address: payer }));
              }
              var err = new Error(msg);
              err.status = retry.status;
              err.body = failed.json;
              throw err;
            });
          });
        });
      });
    }).catch(function (e) {
      wrapNetwork(e, path, options);
    });
  }

  function resumePending402() {
    var job = R.loadPending402();
    if (!job || !job.path) return Promise.resolve(null);
    return paidFetch(job.path, {
      method: job.method,
      headers: job.headers || {},
      body: job.body,
    });
  }

  function onAppResume() {
    var job = R.loadPending402();
    if (!job) return;
    root.dispatchEvent(new CustomEvent("openzoo-402-retry", { detail: job }));
  }

  root.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || !data.type) return;
    if (data.type === "app-resume" || data.type === "app-pause") {
      if (data.type === "app-resume") onAppResume();
    }
  });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") onAppResume();
    });
    document.addEventListener("resume", onAppResume, false);
  }

  function holdingsForWallet() {
    var owner = walletAddress;
    if (!owner) return Promise.resolve(null);
    return loadDirectory().then(function (kinds) {
      return probeBalances(owner, [], kinds).then(function (b) {
        return {
          address: owner,
          usdc: b.underlyings[R.PLAIN_USDC] || "0",
          token: b.underlyings[R.PLAIN_TOKEN] || "0",
          leos: b.underlyings[R.PLAIN_LEOS] || "0",
        };
      });
    });
  }

  root.OpenZooPay = {
    setAddress: setAddress,
    getAddress: getAddress,
    getMethod: getMethod,
    requestWalletInfo: requestWalletInfo,
    requestWalletConnect: requestWalletConnect,
    disconnectWallet: disconnectWallet,
    signOutBilling: signOutBilling,
    setWalletPayEnabled: setWalletPayEnabled,
    setWrapPrompt: setWrapPrompt,
    getBilling: getBilling,
    signTransaction: signTransaction,
    signAndSendTransaction: signAndSendTransaction,
    probeBalances: probeBalances,
    loadDirectory: loadDirectory,
    paidFetch: paidFetch,
    resumePending402: resumePending402,
    holdingsForWallet: holdingsForWallet,
    FundsError: FundsError,
    ContextNotFoundError: ContextNotFoundError,
    SubscriptionRequiredError: SubscriptionRequiredError,
    PaymentPausedError: PaymentPausedError,
    WrapCanceledError: WrapCanceledError,
    ConnectWalletError: ConnectWalletError,
  };
})(typeof window !== "undefined" ? window : globalThis);
