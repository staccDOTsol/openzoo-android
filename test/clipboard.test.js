"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "www/js/clipboard.js"));
const R = require(path.join(ROOT, "www/app/js/rails.js"));

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

(function toastLabels() {
  assert.strictEqual(C.toastLabel(), "copied");
  assert.strictEqual(C.toastLabel("anything"), "copied");
  const js = load("www/js/clipboard.js");
  assert.doesNotMatch(js, /copied local burner|phantom|burner/);
  console.log("ok clipboard toast labels");
})();

(function nativePreferredOverNavigator() {
  const js = load("www/js/clipboard.js");
  assert.match(js, /ClipboardManager|never rely on navigator\.clipboard|Do not use navigator\.clipboard/);
  assert.doesNotMatch(js, /navigator\.clipboard\.writeText/);
  const plugin = load("cordova-plugin-openzoo-clipboard/src/android/OpenZooClipboardPlugin.java");
  assert.match(plugin, /ClipboardManager/);
  assert.match(plugin, /setPrimaryClip/);
  const html = load("www/app/index.html");
  assert.doesNotMatch(html, /data-copy-kind/);
  const app = load("www/app/js/app.js");
  assert.doesNotMatch(app, /copyAddress|data-copy-kind/);
  console.log("ok native clipboard stays; address copy chrome is gone");
})();

(function networkGarbageHidden() {
  assert.ok(R.looksNetworkGarbage("Load failed"));
  assert.ok(R.looksNetworkGarbage(new Error("Failed to fetch")));
  assert.ok(R.looksNetworkGarbage("net::ERR_INTERNET_DISCONNECTED"));
  assert.ok(!R.looksNetworkGarbage("Subscribe with Google Play"));
  assert.match(R.friendlyNetworkMessage(), /Try again/);
  assert.doesNotMatch(R.friendlyNetworkMessage(), /Load failed|net::|Failed to fetch|Phantom|wallet/);
  console.log("ok network garbage sanitized");
})();

(function cspListsRealOrigins() {
  const app = load("www/app/index.html");
  const shell = load("www/index.html");
  R.CONNECT_ORIGINS.forEach(function (origin) {
    assert.ok(app.includes(origin), "app CSP missing " + origin);
    assert.ok(shell.includes(origin), "shell CSP missing " + origin);
  });
  assert.doesNotMatch(app + shell, /x402\.accrue\.fund|api\.mainnet-beta\.solana\.com|solana-rpc\.publicnode\.com/);
  console.log("ok CSP connect-src is zoo + gateway only");
})();

(function noPhantomOrMwa() {
  const files = [
    "www/index.html",
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/js/billing.js",
    "config.xml",
  ];
  const joined = files.map(load).join("\n");
  assert.doesNotMatch(joined, /https:\/\/phantom\.app\/ul\//);
  assert.doesNotMatch(joined, /phantom:\/\/ul\//);
  assert.doesNotMatch(joined, /phantom:\/\/v1\//);
  assert.doesNotMatch(joined, /solana-wallet:\/\//);
  assert.doesNotMatch(joined, /MWA\.(authorize|signTransaction|signAndSendTransaction)/);
  console.log("ok no Phantom / MWA pay path");
})();
