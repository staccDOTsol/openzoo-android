"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EMAIL = "jarettrsdunn1999@gmail.com";

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walkFiles(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "platforms") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

(function emailLivesOnlyInDebugJava() {
  const java = load("cordova-plugin-play-billing/src/android/PlayBillingPlugin.java");
  assert.match(java, /BuildConfig/);
  assert.match(java, /FLAG_DEBUGGABLE/);
  assert.match(java, /trim\(\)\.toLowerCase\(Locale\.US\)/);
  assert.ok(java.includes(EMAIL));
  assert.match(java, /if\s*\(\s*!isDebugApk\(\)\s*\)/);
  assert.match(java, /tryDevUnlock/);
  assert.match(java, /unlockStatus/);

  const ship = [
    "www/index.html",
    "www/js/billing.js",
    "www/js/clipboard.js",
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/app/js/rails.js",
    "www/app/js/occ.js",
    "www/app/js/ide.js",
    "README.md",
    "HANDOFF_OPENZOO_ANDROID.md",
    "package.json",
  ];
  for (const rel of ship) {
    assert.ok(!load(rel).includes(EMAIL), rel + " must not contain the unlock email");
  }
  console.log("ok unlock email is native debug-only");
})();

(function docsDoNotAdvertiseBypass() {
  const readme = load("README.md");
  const handoff = load("HANDOFF_OPENZOO_ANDROID.md");
  assert.doesNotMatch(readme, /dev bypass|dev unlock|sideload unlock|debug unlock/i);
  assert.doesNotMatch(handoff, /dev bypass|dev unlock|sideload unlock|debug unlock/i);
  console.log("ok docs do not advertise unlock");
})();

(function paywallStaysPlayBilling() {
  const html = load("www/index.html");
  assert.match(html, /Google Play Billing/);
  assert.match(html, /play-paywall/);
  assert.match(html, /mountDevField/);
  assert.match(html, /st\.unlocked/);
  assert.match(html, /st\.debug/);
  assert.doesNotMatch(html, /CONNECT PHANTOM/);
  assert.doesNotMatch(html, /checkout\.stripe\.com/);
  assert.doesNotMatch(html, /\/api\/billing\/checkout/);
  const pay = load("www/app/js/pay.js");
  assert.doesNotMatch(pay, /walletPayEnabled|wallet-connect|requestWalletConnect/);
  console.log("ok store UI still Play Billing; no wallet pay");
})();

(function headerNewChatStays() {
  const html = load("www/app/index.html");
  const app = load("www/app/js/app.js");
  assert.match(html, /id="headerNewBtn"/);
  assert.match(html, /id="sideNewBtn"/);
  assert.match(html, />New chat</);
  assert.match(app, /function startNewChat\(\) \{ newThread\(\); \}/);
  assert.match(app, /headerNewBtn.*startNewChat/);
  assert.match(app, /sideNewBtn/);
  assert.doesNotMatch(html, /data-copy-kind="phantom"/);
  assert.doesNotMatch(app, /copyAddress/);
  console.log("ok New chat stays; wallet copy is gone");
})();

(function pluginBridgeExposesUnlockOnlyViaNative() {
  const js = load("cordova-plugin-play-billing/www/playbilling.js");
  assert.match(js, /unlockStatus/);
  assert.match(js, /tryDevUnlock/);
  assert.ok(!js.includes(EMAIL));
  console.log("ok JS bridge has no email");
})();

(function repoWwwHasNoEmail() {
  const files = walkFiles(path.join(ROOT, "www"), []);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.ok(!text.includes(EMAIL), path.relative(ROOT, file) + " leaked email");
  }
  console.log("ok www tree has no unlock email");
})();
