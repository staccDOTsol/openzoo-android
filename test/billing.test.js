"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const B = require(path.join(ROOT, "www/js/billing.js"));

function load(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function tier(id) {
  return B.FALLBACK_TIERS.find((t) => t.id === id);
}

(function productIds() {
  assert.strictEqual(B.PRODUCT_IDS.basic, "fun.openzoo.android.sub.basic");
  assert.strictEqual(B.PRODUCT_IDS.pro, "fun.openzoo.android.sub.pro");
  assert.strictEqual(B.PRODUCT_IDS.ultra, "fun.openzoo.android.sub.ultra");
  assert.strictEqual(B.PACKAGE_NAME, "fun.openzoo.android");
  assert.strictEqual(B.productIdFor("pro"), "fun.openzoo.android.sub.pro");
  assert.strictEqual(B.tierFromProductId("fun.openzoo.android.sub.ultra"), "ultra");
  console.log("ok product ids");
})();

(function fallbackTiersMatchSubscriptionsPage() {
  const basic = tier("basic");
  const pro = tier("pro");
  const ultra = tier("ultra");

  assert.strictEqual(basic.monthlyCents, 900);
  assert.strictEqual(basic.savingsSharePct, 40);
  assert.strictEqual(basic.rpm, 60);
  assert.strictEqual(basic.maxBindBytes, 32 * 1024 * 1024);
  assert.strictEqual(basic.maxTopK, 32);

  assert.strictEqual(pro.monthlyCents, 2900);
  assert.strictEqual(pro.savingsSharePct, 20);
  assert.strictEqual(pro.rpm, 300);
  assert.strictEqual(pro.maxBindBytes, 512 * 1024 * 1024);
  assert.strictEqual(pro.maxTopK, 128);

  assert.strictEqual(ultra.monthlyCents, 9900);
  assert.strictEqual(ultra.savingsSharePct, 10);
  assert.strictEqual(ultra.rpm, 2000);
  assert.strictEqual(ultra.maxBindBytes, 8 * 1024 * 1024 * 1024);
  assert.strictEqual(ultra.maxTopK, 256);

  const model = B.normalizeTiers({
    ok: true,
    tiers: B.FALLBACK_TIERS,
    trialDays: 0,
    usageThresholdCents: 100,
  });
  assert.strictEqual(model.trialDays, 0);
  assert.strictEqual(model.usageThresholdCents, 100);
  assert.strictEqual(model.tagline, "Card first · x402 also works");
  assert.strictEqual(model.tiers.find((t) => t.id === "pro").highlight, "Most teams want this");
  assert.strictEqual(model.tiers.find((t) => t.id === "basic").priceLabel, "$9/mo");
  assert.strictEqual(model.tiers.find((t) => t.id === "pro").priceLabel, "$29/mo");
  assert.strictEqual(model.tiers.find((t) => t.id === "ultra").priceLabel, "$99/mo");
  assert.strictEqual(model.tiers.find((t) => t.id === "ultra").bindLabel, "~8GB");
  console.log("ok fallback tiers match zoo.openzoo.fun/subscriptions");
})();

(function stripeCheckoutBlocked() {
  assert.ok(B.isStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_123"));
  assert.ok(!B.isStripeCheckoutUrl("https://zoo.openzoo.fun/subscriptions"));
  console.log("ok stripe checkout detector");
})();

(function paywallLeadsWithPlayThenX402() {
  const html = load("www/index.html");
  assert.ok(html.includes("Card first · x402 also works"));
  assert.ok(html.includes("Most teams want this"));
  assert.ok(html.includes("js/billing.js"));
  assert.ok(html.includes("Restore purchases"));
  assert.ok(html.includes("Google Play"));
  assert.ok(html.includes("Continue with x402"));
  assert.ok(html.includes("Use local burner"));
  assert.ok(html.includes('data-component="play-paywall"'));
  assert.ok(html.includes('data-component="x402-pay"'));
  assert.ok(html.indexOf("play-paywall") < html.indexOf("x402-pay"));
  assert.ok(!html.includes("checkout.stripe.com"));
  assert.ok(!html.includes("/api/billing/checkout"));
  assert.ok(!html.includes("InAppBrowser"));
  assert.ok(!html.includes("https://phantom.app/ul/"));
  console.log("ok paywall leads with Play Billing, x402 escape under it");
})();

(function playPluginPresent() {
  const xml = load("cordova-plugin-play-billing/plugin.xml");
  assert.ok(xml.includes("com.android.billingclient:billing:6.2.1"));
  assert.ok(xml.includes("com.android.vending.BILLING"));
  assert.ok(xml.includes("fun.openzoo.android.sub."));
  const java = load("cordova-plugin-play-billing/src/android/PlayBillingPlugin.java");
  assert.ok(java.includes("BillingClient"));
  assert.ok(java.includes("launchBillingFlow"));
  assert.ok(java.includes("queryPurchasesAsync"));
  const js = load("cordova-plugin-play-billing/www/playbilling.js");
  assert.ok(js.includes("fun.openzoo.android.sub.basic"));
  const pkg = JSON.parse(load("package.json"));
  assert.ok(pkg.cordova.plugins["cordova-plugin-play-billing"]);
  console.log("ok Play Billing plugin");
})();

(function grokuiKeepsX402Working() {
  const html = load("www/app/index.html");
  assert.ok(html.includes("Settings"));
  assert.ok(html.includes("x402 / wallet"));
  assert.ok(html.includes("Use local burner"));
  assert.ok(html.includes('data-component="new-chat"'));
  const js = load("www/app/js/app.js");
  assert.ok(js.includes("requestWalletConnect"));
  assert.ok(js.includes("signOutBilling"));
  assert.ok(js.includes("sideNewBtn"));
  assert.match(js, /headerNewBtn/);
  const pay = load("www/app/js/pay.js");
  assert.ok(pay.includes("ConnectWalletError"));
  assert.ok(!/throw new SubscriptionRequiredError/.test(pay));
  const shell = load("www/index.html");
  assert.ok(shell.includes("canEnterApp"));
  assert.ok(shell.includes("enterViaX402"));
  console.log("ok grokui Play-first with working x402 escape");
})();

(function entitlementFromPurchaseToken() {
  assert.ok(B.hasEntitlement({ purchase: { purchaseToken: "GPA.TEST" } }));
  assert.ok(B.hasEntitlement({ key: "oz_live_test" }));
  assert.ok(!B.hasEntitlement({}));
  assert.ok(B.canEnterApp({ purchase: { purchaseToken: "GPA.TEST" } }, {}));
  assert.ok(B.canEnterApp({}, { chosen: true }));
  assert.ok(B.canEnterApp({}, { address: "So1anaBurner1111111111111111111111111111111" }));
  assert.ok(!B.canEnterApp({}, {}));
  console.log("ok entitlement");
})();

(async function exchangeStubsWhenPlayRouteMissing() {
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => "<html>Not Found</html>"
  });
  try {
    const out = await B.exchangePlayPurchase({
      productId: B.PRODUCT_IDS.pro,
      purchaseToken: "GPA.TEST-TOKEN",
      orderId: "GPA.TEST-ORDER",
      tier: "pro"
    });
    assert.strictEqual(out.pending, true);
    assert.strictEqual(out.stub, true);
    assert.ok(out.todo.includes("Google Play Developer API"));
    assert.ok(out.todo.includes("/api/billing/key"));
    assert.ok(out.todo.includes("do not invent a second key system") || out.todo.includes("Do not add a second key system"));
  } finally {
    global.fetch = origFetch;
  }
  console.log("ok play exchange stubs on 404");
})().then(async function exchangeUsesMintedKeyWhenBackendReady() {
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ key: "oz_sub_test_key" })
  });
  try {
    const out = await B.exchangePlayPurchase({
      productId: B.PRODUCT_IDS.basic,
      purchaseToken: "GPA.OK",
      tier: "basic"
    });
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.key, "oz_sub_test_key");
    assert.ok(!out.stub);
  } finally {
    global.fetch = origFetch;
  }
  console.log("ok play exchange uses same key shape as Stripe mint");
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
