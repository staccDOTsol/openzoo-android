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

check("defaults to openzoo/auto from the catalog, never a gemini pin", () => {
  assert.strictEqual(R.DEFAULT_MODEL, "openzoo/auto");
  assert.strictEqual(R.AUTO_MODEL, "openzoo/auto");
  const id = R.defaultModelId([
    { id: "~hidden" },
    { id: "openai/gpt-4o-mini" },
    { id: "google/gemini-3.7-flash" },
    { id: "openzoo/auto" },
  ]);
  assert.strictEqual(id, "openzoo/auto");
  assert.strictEqual(R.defaultModelId([
    { id: "openai/gpt-4o-mini" },
    { id: "google/gemini-3.7-flash" },
  ]), "openzoo/auto");
});

check("Auto emits openzoo/auto and does not call classify", () => {
  const C = require("../www/app/js/race.js");
  const plan = R.planTurn({ model: "", tier: "auto", n: 4, k: 2 });
  assert.strictEqual(plan.mode, "auto");
  assert.strictEqual(plan.model, "openzoo/auto");
  assert.strictEqual(R.shouldRace({ model: "", tier: "auto", n: 4, k: 2 }), false);
  assert.strictEqual(R.shouldRace({ model: "Auto", tier: "auto", n: 4, k: 2 }), false);
  assert.strictEqual(R.shouldRace({ model: "openzoo/auto", n: 4, k: 2 }), false);
  assert.deepStrictEqual(
    { model: R.resolveRequestModel(""), messages: [{ role: "user", content: "hi" }] },
    { model: "openzoo/auto", messages: [{ role: "user", content: "hi" }] },
  );

  let classifyCalls = 0;
  function dispatch(input, runners) {
    const p = R.planTurn(input);
    if (p.mode === "race") return runners.race();
    return runners.single({ model: p.model, messages: input.messages });
  }
  const body = dispatch(
    { model: "", tier: "auto", n: 4, k: 2, messages: [{ role: "user", content: "hi" }] },
    {
      race: function () {
        classifyCalls += 1;
        return C.runRace({
          messages: [{ role: "user", content: "hi" }],
          models: ["a", "b"],
          need: 2,
          hooks: {
            run: function (m) { return m + "-ans"; },
            classify: function () { classifyCalls += 1; return 9; },
          },
        });
      },
      single: function (req) { return req; },
    },
  );
  assert.deepStrictEqual(body, {
    model: "openzoo/auto",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.strictEqual(classifyCalls, 0);

  const app = read("www/app/js/app.js");
  assert.match(app, /planTurn/);
  assert.match(app, /mode === "race"/);
  assert.match(app, /singleTurn\(plan\.model\)/);
  assert.doesNotMatch(app, /TaskClassifier|tiny-classif|classifyPrompt/);
});

check("named models stay named; explicit band + race 2+ still races", () => {
  const named = R.planTurn({ model: "x-ai/grok-4.6", tier: "medium", n: 4, k: 2 });
  assert.strictEqual(named.mode, "single");
  assert.strictEqual(named.model, "x-ai/grok-4.6");
  assert.strictEqual(R.resolveRequestModel("x-ai/grok-4.6"), "x-ai/grok-4.6");
  const race = R.planTurn({ model: "", tier: "medium", n: 4, k: 2 });
  assert.strictEqual(race.mode, "race");
  assert.strictEqual(race.tier, "medium");
  const leftoverAuto = R.planTurn({ model: "openzoo/auto", tier: "cheap", n: 4, k: 2 });
  assert.strictEqual(leftoverAuto.mode, "race");
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
  assert.match(html, /placeholder="Auto"/);
  assert.match(html, /value="auto" selected/);
  assert.match(html, /value="openzoo\/auto"/);
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
