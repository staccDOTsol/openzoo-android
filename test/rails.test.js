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
  const race = read("www/app/js/race.js");
  assert.doesNotMatch(pay, /walletPayEnabled|wallet-sign|wallet-connect|requestWalletConnect/);
  assert.doesNotMatch(race, /walletPayEnabled|wallet-sign|wallet-connect|requestWalletConnect|X-PAYMENT/);
  assert.doesNotMatch(shell, /connectMWA|wallet-connect-request|MWA\.signTransaction|MWA\.authorize/);
  assert.doesNotMatch(app, /showFunds|showWrapPrompt|requestWalletConnect|Connect Phantom/);
  assert.match(pay, /SubscriptionRequiredError/);
  assert.match(pay, /402/);
});

check("chat spill is Claude-CLI style: prefix bind + tail, never full+header", () => {
  const app = read("www/app/js/app.js");
  const html = read("www/app/index.html");
  const spill = read("www/app/js/spill.js");
  assert.match(html, /js\/spill\.js/);
  assert.match(spill, /full messages array/);
  assert.match(app, /prepareChat/);
  assert.match(app, /bindTranscriptPrefix/);
  assert.doesNotMatch(spill, /function spawn|PING:|childKickoff|worktree/);
});

check("cloud Agent door is zoo.openzoo.fun /api/ide/session; OCC may stay unused", () => {
  const ide = require("../www/app/js/ide.js");
  const occ = require("../www/app/js/occ.js");
  assert.strictEqual(ide.IDE_ORIGIN, R.OCC_ORIGIN);
  assert.strictEqual(ide.IDE_ORIGIN, "https://zoo.openzoo.fun");
  assert.strictEqual(ide.SESSION, "/api/ide/session");
  assert.strictEqual(R.IDE_SESSION, "/api/ide/session");
  assert.doesNotMatch(ide.SESSION, /\/api\/occ|\/occ\//);
  assert.ok(ide.isUsableKey("oz_sub_live_key"));
  assert.ok(!ide.isUsableKey("openzoo"));
  assert.strictEqual(occ.SESSIONS, "/occ/sessions");
});

check("no @solana/web3.js dependency and no :8402", () => {
  const joined = [
    "www/index.html",
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/app/js/rails.js",
    "www/app/js/bind.js",
    "www/app/js/spill.js",
    "www/app/js/race.js",
    "www/app/js/occ.js",
    "www/app/js/ide.js",
    "www/js/agent-host.js",
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
  assert.match(html, /id="raceSel"/);
  assert.match(html, /id="tierSel"/);
  assert.match(html, /id="modeToggle"/);
  assert.match(html, /id="modeChat"/);
  assert.match(html, /id="modeAgent"/);
  assert.match(html, />Chat</);
  assert.match(html, />Agent</);
  assert.doesNotMatch(html, /\/api\/occ|\/occ\/sessions\/:id\/goal|ANTHROPIC_API_KEY|node-pty/);
  assert.match(html, /#headerNewBtn\s*\{[\s\S]*?display:\s*inline-flex/);
  assert.doesNotMatch(html, /id="headerNewBtn"[^>]*class="dial"/);
  assert.doesNotMatch(html, /#headerNewBtn\s*\{\s*display:\s*none/);
  assert.match(app, /userVisibleStatus/);
  assert.doesNotMatch(app, /bound ctx|context_id\.slice|bindStatus/);
});

check("Cordova entry is the Play paywall, then iframe chat — not a wallet shell", () => {
  const cfg = read("config.xml");
  const shell = read("www/index.html");
  const chat = read("www/app/index.html");
  assert.match(cfg, /<content\s+src="index\.html"/);
  assert.match(shell, /play-paywall/);
  assert.match(shell, /js\/billing\.js/);
  assert.match(shell, /GAME_URL = 'app\/index\.html'/);
  assert.match(shell, /function launchApp/);
  assert.match(shell, /billing-ready/);
  assert.doesNotMatch(shell, /<script[^>]+(wallet|solana|wrap|nacl|pay402|clipboard)/i);
  assert.doesNotMatch(shell, /Connect Phantom|Use local burner|#advanced|OpenZooIOSWallet|btn-phantom/);
  assert.doesNotMatch(chat, /<script[^>]+(wallet|solana|wrap|nacl|pay402|clipboard)/i);
  assert.match(chat, /id="headerNewBtn"/);
  assert.match(chat, /id="sideNewBtn"/);
  assert.match(chat, /id="modeToggle"/);
  assert.match(chat, /js\/ide\.js/);
  assert.match(chat, /id="agentFrame"/);
});

check("dark launch loader stays up until chrome-ready, not models or Play", () => {
  const shell = read("www/index.html");
  const app = read("www/app/js/app.js");
  const cfg = read("config.xml");
  const bodyIdx = shell.indexOf("<body>");
  const bootIdx = shell.indexOf('id="oz-boot"');
  const logoIdx = shell.indexOf('class="logo"');
  assert.ok(bodyIdx !== -1 && bootIdx !== -1 && bootIdx > bodyIdx && bootIdx < logoIdx);
  assert.match(shell, /#oz-boot\s*\{[^}]*z-index:\s*10000/);
  assert.match(shell, /#oz-boot\s*\{[^}]*background:\s*#0a0a18/);
  assert.match(shell, /starting<span class="oz-dot">\.<\/span>/);
  assert.match(shell, /text-transform:\s*lowercase/);
  const bootOpen = shell.indexOf('<div id="oz-boot"');
  const bootClose = shell.indexOf("</div>", bootOpen);
  assert.ok(bootOpen !== -1 && bootClose !== -1);
  assert.doesNotMatch(shell.slice(bootOpen, bootClose), /<img|logo|splash/i);
  assert.doesNotMatch(shell, /cordova-plugin-splashscreen|cdv-splashscreen|navigator\.splashscreen/i);
  assert.match(cfg, /AutoHideSplashScreen"\s+value="true"/);
  assert.match(shell, /function launchApp\(\) \{\s*showBoot\(\);/);
  assert.match(shell, /bootHideTimer = setTimeout\(dismissBoot, 4000\)/);
  assert.match(shell, /setTimeout\(sendReady, 300\);\s*setTimeout\(dismissBoot, 50\)/);
  assert.match(shell, /DOMContentLoaded[\s\S]*hasEntitlement\(billingState\)\) hideBoot\(\)/);
  assert.match(shell, /data\.type === 'openzoo-chrome-ready'/);
  assert.match(app, /postMessage\(\{ type: "openzoo-chrome-ready" \}/);
  const readyAt = app.indexOf('openzoo-chrome-ready');
  const modelsAt = app.lastIndexOf("loadModels();");
  assert.ok(readyAt !== -1 && modelsAt !== -1 && readyAt < modelsAt);
  assert.ok(app.indexOf("function loadModels()") < readyAt);
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
