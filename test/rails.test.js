"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("../www/app/js/rails.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok  " + name);
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

check("bind payload stays internal", () => {
  assert.deepStrictEqual(R.bindPayload("hello"), { corpus: "hello" });
  assert.deepStrictEqual(R.bindPayload("hello", "ctx_1"), {
    items: [{ text: "hello" }],
    context_id: "ctx_1",
  });
  assert.ok(R.isContextNotFound(404, { error: { code: "context_not_found" } }));
});

check("namespace header is unsigned stacc", () => {
  const h = R.gatewayHeaders({ "x-hrr-context": "ctx" });
  assert.strictEqual(h["x-openzoo-namespace"], "stacc");
});

check("defaults to google/gemini-3.7-flash, never a fake openzoo id", () => {
  const id = R.defaultModelId([
    { id: "~hidden" },
    { id: "openai/gpt-4o-mini" },
    { id: "google/gemini-3.7-flash" },
  ]);
  assert.strictEqual(id, "google/gemini-3.7-flash");
});

check("system prompt does not claim RUN/WRITE/READ/SERVE", () => {
  assert.match(R.SYSTEM_PROMPT, /phone/i);
  assert.match(R.SYSTEM_PROMPT, /Never emit RUN, WRITE, READ, or SERVE/);
});

check("first-run is Play paywall, not a wallet or Stripe", () => {
  const shell = read("www/index.html");
  assert.match(shell, /Subscription keys · no x402/);
  assert.match(shell, /Most teams want this/);
  assert.match(shell, /Restore purchases/);
  assert.match(shell, /play-paywall/);
  assert.doesNotMatch(shell, /CONNECT PHANTOM|Connect Phantom|connectMWA|MWA\./);
  assert.doesNotMatch(shell, /checkout\.stripe\.com/);
  assert.doesNotMatch(shell, /\/api\/billing\/checkout/);
  assert.doesNotMatch(shell, /jarettrsdunn1999@gmail\.com/);
});

check("no wallet / wrap / x402 pay path in shipped JS", () => {
  const pay = read("www/app/js/pay.js");
  const shell = read("www/index.html");
  const app = read("www/app/js/app.js");
  assert.doesNotMatch(pay, /walletPayEnabled|wallet-sign|wallet-connect|requestWalletConnect/);
  assert.doesNotMatch(shell, /connectMWA|wallet-connect-request|MWA\.signTransaction|MWA\.authorize/);
  assert.doesNotMatch(app, /showFunds|showWrapPrompt|requestWalletConnect|Connect Phantom/);
  assert.match(pay, /SubscriptionRequiredError/);
  assert.match(pay, /402/);
});

check("no @solana/web3.js dependency and no :8402", () => {
  const joined = [
    "www/index.html",
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/app/js/rails.js",
    "www/app/js/bind.js",
    "www/js/clipboard.js",
    "www/js/billing.js",
  ].map(read).join("\n");
  assert.doesNotMatch(joined, /@solana\/web3\.js|@solana\/spl-token/);
  assert.doesNotMatch(joined, /:8402/);
  assert.doesNotMatch(joined, /\/v1\/session/);
  assert.doesNotMatch(joined, /wrap\.js|solana-lite\.js/);
});

check("UI never shows context ids, /v1/bind, hashes, or wallet chrome", () => {
  const html = read("www/app/index.html");
  const app = read("www/app/js/app.js");
  assert.doesNotMatch(html, /context_id|\/v1\/hrr\/bind|bind hash|yUSDCx|wTOKENx|wLEOSx|wrap-nav/);
  assert.doesNotMatch(html, /teach the zoo|bind it|x-hrr-context/);
  assert.doesNotMatch(html, /Connect Phantom|Need funds in Phantom|Wrap TOKEN|#walletOverlay|#fundsOverlay|#wrapOverlay/);
  assert.match(html, /Attach files/);
  assert.match(html, /Attach folder/);
  assert.match(html, /Paste text/);
  assert.match(html, /id="headerNewBtn"/);
  assert.match(html, /id="sideNewBtn"/);
  assert.match(html, />New chat</);
  assert.match(html, /#headerNewBtn\s*\{[\s\S]*?display:\s*inline-flex/);
  assert.doesNotMatch(html, /id="headerNewBtn"[^>]*class="dial"/);
  assert.doesNotMatch(html, /#headerNewBtn\s*\{\s*display:\s*none/);
  assert.match(app, /userVisibleStatus/);
  assert.doesNotMatch(app, /bound ctx|context_id\.slice|bindStatus/);
});

check("widget id is fun.openzoo.android; Cordova stays; MWA is gone", () => {
  const cfg = read("config.xml");
  const pkg = JSON.parse(read("package.json"));
  const shell = read("www/index.html");
  assert.match(cfg, /id="fun\.openzoo\.android"/);
  assert.match(cfg, /<name>OpenZoo<\/name>/);
  assert.strictEqual(pkg.name, "fun.openzoo.android");
  assert.ok(!pkg.cordova.plugins["cordova-plugin-mwa"]);
  assert.doesNotMatch(cfg + shell, /fun\.openzoo\.seeker|fun\.openzoo\.psg1|SwiftUI|phantom\.app\/ul\/v1|solana-wallet:\/\/|phantom:\/\/v1/);
  assert.match(shell, /cordova\.js/);
  assert.doesNotMatch(shell, /MWA\.authorize/);
  assert.ok(!fs.existsSync(path.join(__dirname, "../cordova-plugin-mwa")));
  assert.ok(!fs.existsSync(path.join(__dirname, "../www/app/js/wrap.js")));
  assert.ok(!fs.existsSync(path.join(__dirname, "../www/app/js/solana-lite.js")));
});

console.log("\n" + passed + " checks passed");
