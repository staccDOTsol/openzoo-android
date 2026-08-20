/**
 * Local disposable Ed25519 burner for Android x402.
 * Phantom MWA stays the preferred wallet. This key never leaves the phone.
 * Partial-sign only for 402 pay txs. Wrap may sign+send via RPC (user is fee-payer).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooBurner = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var STORE_KEY = "openzoo.android.burner.v1";
  var SESSION_KEY = "openzoo.android.x402.v1";
  var DISCLAIMER =
    "Local disposable key on this phone. We never custody it. We do not sell crypto. You fund it yourself.";
  var RPC_URLS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ];

  function getNacl() {
    if (root.nacl) return root.nacl;
    if (typeof nacl !== "undefined") return nacl;
    if (typeof require === "function") {
      try { return require("../vendor/nacl-fast.min.js"); } catch (e) { /* fall through */ }
    }
    return null;
  }

  function solana() {
    return root.OpenZooSolana;
  }

  function encodeB58(bytes) {
    var S = solana();
    if (S && S.encodeBase58) return S.encodeBase58(bytes);
    throw new Error("base58 encoder unavailable");
  }

  function decodeB58(str) {
    var S = solana();
    if (S && S.decodeBase58) return S.decodeBase58(str);
    throw new Error("base58 decoder unavailable");
  }

  function bytesToB64(bytes) {
    var S = solana();
    if (S && S.bytesToB64) return S.bytesToB64(bytes);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    var bin = atob(String(b64));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function readCompactU16(bytes, offset) {
    var value = 0;
    var size = 0;
    var shift = 0;
    while (size < 3) {
      var byte = bytes[offset + size];
      value |= (byte & 0x7f) << shift;
      size++;
      if ((byte & 0x80) === 0) return { value: value, size: size };
      shift += 7;
    }
    throw new Error("invalid compact-u16");
  }

  function bytesEq(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  function signerIndexInMessage(message, publicKey) {
    var off = 0;
    if ((message[0] & 0x80) !== 0) off = 1;
    var numRequiredSigs = message[off];
    off += 3;
    var nacc = readCompactU16(message, off);
    off += nacc.size;
    for (var i = 0; i < numRequiredSigs; i++) {
      var key = message.subarray(off + i * 32, off + (i + 1) * 32);
      if (bytesEq(key, publicKey)) return i;
    }
    return -1;
  }

  function partialSignTx(txBytes, secretKey) {
    var n = getNacl();
    if (!n) throw new Error("nacl unavailable");
    var keyPair = n.sign.keyPair.fromSecretKey(secretKey);
    var nsig = readCompactU16(txBytes, 0);
    var sigStart = nsig.size;
    var message = txBytes.subarray(sigStart + nsig.value * 64);
    var idx = signerIndexInMessage(message, keyPair.publicKey);
    if (idx < 0) throw new Error("This key is not a required signer on the pay/build transaction");
    var sig = n.sign.detached(message, secretKey);
    var out = new Uint8Array(txBytes);
    out.set(sig, sigStart + idx * 64);
    return out;
  }

  function readStore(storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return null;
    try { return JSON.parse(storage.getItem(STORE_KEY) || "null"); }
    catch (e) { return null; }
  }

  function writeStore(state, storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return state;
    if (!state) storage.removeItem(STORE_KEY);
    else storage.setItem(STORE_KEY, JSON.stringify(state));
    return state;
  }

  function readSession(storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(SESSION_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }

  function writeSession(state, storage) {
    storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    var next = state || {};
    if (!storage) return next;
    storage.setItem(SESSION_KEY, JSON.stringify(next));
    return next;
  }

  function hasX402Access(state) {
    state = state || readSession();
    return !!(state.chosen || state.address);
  }

  function pairFromSecretB58(secretB58) {
    var n = getNacl();
    if (!n) throw new Error("nacl unavailable");
    var secret = decodeB58(secretB58);
    var pair = n.sign.keyPair.fromSecretKey(secret);
    return {
      address: encodeB58(pair.publicKey),
      secretKey: pair.secretKey,
      publicKey: pair.publicKey,
    };
  }

  function load(storage) {
    var row = readStore(storage);
    if (!row || !row.secretB58) return null;
    var pair = pairFromSecretB58(row.secretB58);
    return {
      address: pair.address,
      method: "burner",
      secretKey: pair.secretKey,
      disclaimer: DISCLAIMER,
    };
  }

  function create(storage) {
    var n = getNacl();
    if (!n) throw new Error("nacl unavailable");
    var pair = n.sign.keyPair();
    var secretB58 = encodeB58(pair.secretKey);
    var address = encodeB58(pair.publicKey);
    writeStore({ secretB58: secretB58, address: address, createdAt: Date.now() }, storage);
    return {
      address: address,
      method: "burner",
      secretKey: pair.secretKey,
      disclaimer: DISCLAIMER,
    };
  }

  function connect(storage) {
    return load(storage) || create(storage);
  }

  function signTransaction(txB64, storage) {
    var burner = load(storage);
    if (!burner) throw new Error("No local burner key on this phone");
    var signed = partialSignTx(b64ToBytes(txB64), burner.secretKey);
    return { signedTransaction: bytesToB64(signed) };
  }

  function rpcSend(txB64, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    var last = null;
    var chain = Promise.resolve(null);
    RPC_URLS.forEach(function (url) {
      chain = chain.then(function (hit) {
        if (hit) return hit;
        return fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [txB64, { encoding: "base64", skipPreflight: false }],
          }),
        }).then(function (res) {
          return res.json().then(function (j) {
            if (j.error) throw new Error(j.error.message || "rpc error");
            return j.result;
          });
        }).catch(function (e) {
          last = e;
          return null;
        });
      });
    });
    return chain.then(function (sig) {
      if (sig) return sig;
      throw last || new Error("RPC send failed");
    });
  }

  function signAndSendTransaction(txB64, storage, fetchImpl) {
    var signed = signTransaction(txB64, storage);
    return rpcSend(signed.signedTransaction, fetchImpl).then(function (signature) {
      return { signature: signature, signedTransaction: signed.signedTransaction };
    });
  }

  return {
    STORE_KEY: STORE_KEY,
    SESSION_KEY: SESSION_KEY,
    DISCLAIMER: DISCLAIMER,
    RPC_URLS: RPC_URLS,
    readStore: readStore,
    writeStore: writeStore,
    readSession: readSession,
    writeSession: writeSession,
    hasX402Access: hasX402Access,
    load: load,
    create: create,
    connect: connect,
    signTransaction: signTransaction,
    signAndSendTransaction: signAndSendTransaction,
    partialSignTx: partialSignTx,
    rpcSend: rpcSend,
  };
});
