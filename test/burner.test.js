"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const nacl = require(path.join(ROOT, "www/vendor/nacl-fast.min.js"));
global.nacl = nacl;
const S = require(path.join(ROOT, "www/app/js/solana-lite.js"));
global.OpenZooSolana = S;
const Burner = require(path.join(ROOT, "www/js/burner.js"));
const B = require(path.join(ROOT, "www/js/billing.js"));

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function memoryStore() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

(function createAndReload() {
  const store = memoryStore();
  const first = Burner.create(store);
  assert.ok(first.address);
  assert.strictEqual(first.method, "burner");
  assert.match(first.disclaimer, /never custody/);
  const again = Burner.load(store);
  assert.strictEqual(again.address, first.address);
  console.log("ok burner create + reload");
})();

(function sessionIsEscapeWithoutPlay() {
  const store = memoryStore();
  assert.ok(!Burner.hasX402Access(Burner.readSession(store)));
  Burner.writeSession({ chosen: true }, store);
  assert.ok(Burner.hasX402Access(Burner.readSession(store)));
  assert.ok(B.canEnterApp({}, Burner.readSession(store)));
  assert.ok(!B.canEnterApp({}, {}));
  console.log("ok x402 session enters without Play");
})();

(function partialSignPutsDetachedSig() {
  const store = memoryStore();
  const burner = Burner.create(store);
  const tx = S.compileLegacyTx(burner.address, "11111111111111111111111111111111", []);
  const signed = Burner.signTransaction(tx.base64, store);
  const raw = Buffer.from(signed.signedTransaction, "base64");
  assert.ok(raw[0] >= 1);
  var zeros = 0;
  for (var i = 1; i <= 64; i++) if (raw[i] === 0) zeros++;
  assert.ok(zeros < 64, "first signature slot must be filled");
  const nsig = raw[0];
  const message = raw.subarray(1 + nsig * 64);
  const sig = raw.subarray(1, 65);
  const pub = nacl.sign.keyPair.fromSecretKey(burner.secretKey).publicKey;
  assert.ok(nacl.sign.detached.verify(message, sig, pub));
  console.log("ok burner partial-signs pay tx");
})();

(function shellAndSettingsExposeBurner() {
  const shell = load("www/index.html");
  const app = load("www/app/index.html");
  assert.match(shell, /Use local burner/);
  assert.match(shell, /data-copy-kind="local-burner"/);
  assert.match(shell, /js\/burner\.js/);
  assert.match(shell, /vendor\/nacl-fast\.min\.js/);
  assert.match(app, /Use local burner/);
  assert.match(app, /data-copy-kind="local-burner"/);
  assert.doesNotMatch(shell + app, /https:\/\/phantom\.app\/ul\//);
  console.log("ok burner UI + no Phantom HTTPS /ul/");
})();
