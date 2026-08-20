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
  assert.strictEqual(C.toastLabel("phantom"), "copied");
  assert.strictEqual(C.toastLabel(), "copied");
  assert.strictEqual(C.toastLabel("burner"), "copied local burner");
  assert.strictEqual(C.toastLabel("local-burner"), "copied local burner");
  assert.strictEqual(C.toastLabel("local burner"), "copied local burner");
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
  assert.match(html, /user-select:\s*text/);
  assert.match(html, /id="toast"/);
  assert.match(html, /data-copy-kind="phantom"/);
  const app = load("www/app/js/app.js");
  assert.match(app, /copyAddress/);
  assert.match(app, /clipboard-copy/);
  console.log("ok native clipboard + selectable address");
})();

(function networkGarbageHidden() {
  assert.ok(R.looksNetworkGarbage("Load failed"));
  assert.ok(R.looksNetworkGarbage(new Error("Failed to fetch")));
  assert.ok(R.looksNetworkGarbage("net::ERR_INTERNET_DISCONNECTED"));
  assert.ok(!R.looksNetworkGarbage("Need funds in Phantom"));
  assert.match(R.friendlyNetworkMessage(), /retries when you come back/);
  assert.doesNotMatch(R.friendlyNetworkMessage(), /Load failed|net::|Failed to fetch/);
  console.log("ok network garbage sanitized");
})();

(function pending402Persists() {
  const store = {
    data: {},
    setItem: function (k, v) { this.data[k] = v; },
    getItem: function (k) { return this.data[k] || null; },
    removeItem: function (k) { delete this.data[k]; },
  };
  R.savePending402({ path: "/v1/chat/completions", method: "POST", body: "{}" }, store);
  const job = R.loadPending402(store);
  assert.strictEqual(job.path, "/v1/chat/completions");
  R.clearPending402(store);
  assert.strictEqual(R.loadPending402(store), null);
  const pay = load("www/app/js/pay.js");
  assert.match(pay, /savePending402/);
  assert.match(pay, /PaymentPausedError/);
  assert.match(pay, /app-resume/);
  const shell = load("www/index.html");
  assert.match(shell, /notifyApp\('app-resume'\)/);
  console.log("ok 402 persists across resume");
})();

(function cspListsRealOrigins() {
  const app = load("www/app/index.html");
  const shell = load("www/index.html");
  R.CONNECT_ORIGINS.forEach(function (origin) {
    assert.ok(app.includes(origin), "app CSP missing " + origin);
    assert.ok(shell.includes(origin), "shell CSP missing " + origin);
  });
  console.log("ok CSP connect-src includes gateway + RPCs");
})();

(function noPhantomHttpsUl() {
  const files = [
    "www/index.html",
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/js/billing.js",
    "cordova-plugin-mwa/src/android/MWAPlugin.java",
    "cordova-plugin-mwa/www/mwa.js",
    "config.xml",
  ];
  const joined = files.map(load).join("\n");
  assert.doesNotMatch(joined, /https:\/\/phantom\.app\/ul\//);
  assert.doesNotMatch(joined, /phantom:\/\/ul\//);
  const cfg = load("config.xml");
  assert.match(cfg, /phantom:\/\/v1\//);
  assert.match(load("cordova-plugin-mwa/src/android/MWAPlugin.java"), /MWA only/);
  console.log("ok no Phantom HTTPS /ul/ path; custom scheme is phantom://v1/");
})();
