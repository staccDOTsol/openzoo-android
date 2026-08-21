"use strict";

/**
 * Live gateway + billing smoke (no wallet, no x402 settlement).
 */

const GATEWAY = "https://x402-tokens.fly.dev";

async function main() {
  const models = await (await fetch(GATEWAY + "/v1/models")).json();
  const ids = (models.data || []).map((m) => m.id);
  if (!ids.includes("openzoo/auto")) {
    throw new Error("expected openzoo/auto in /v1/models");
  }
  if (!ids.includes("google/gemini-3.7-flash")) {
    throw new Error("expected google/gemini-3.7-flash in /v1/models");
  }
  if (ids.includes("openzoo")) throw new Error("do not use a fake openzoo model id");
  const auto = (models.data || []).find((m) => m.id === "openzoo/auto");
  if (!auto || auto.owned_by !== "openzoo") {
    throw new Error("openzoo/auto must be owned_by openzoo");
  }
  console.log("ok  models (" + ids.length + ") includes openzoo/auto");

  const stats = await (await fetch(GATEWAY + "/v1/stats")).json();
  if (!stats.today || typeof stats.today.calls !== "number") {
    throw new Error("unexpected /v1/stats shape");
  }
  console.log("ok  stats today.calls=" + stats.today.calls);

  const bind = await (await fetch(GATEWAY + "/v1/hrr/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corpus: "openzoo android smoke attach" }),
  })).json();
  if (!bind.context_id) throw new Error("bind did not return context_id: " + JSON.stringify(bind));
  console.log("ok  bind (internal)");

  const S = require("../www/app/js/spill.js");
  const history = [];
  for (let i = 1; i <= 12; i++) {
    history.push({ role: "user", content: "android spill smoke ask " + i });
    history.push({ role: "assistant", content: "android spill smoke ans " + i });
  }
  const prefix = S.prefixCorpus(
    [{ role: "system", content: "sys" }].concat(history),
    1,
    history.length - 2,
  );
  const append = await (await fetch(GATEWAY + "/v1/hrr/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corpus: prefix, context_id: bind.context_id }),
  })).json();
  if (!append.context_id) throw new Error("transcript append lost context_id");
  const req = S.chatRequest({
    system: "sys",
    messages: history,
    model: "google/gemini-3.7-flash",
    maxTokens: 16,
    contextId: append.context_id,
  });
  if (!req.headers["x-hrr-context"]) throw new Error("spill request missing x-hrr-context");
  if (req.sent >= req.total) throw new Error("spill still dumps the full thread: " + req.sent + "/" + req.total);
  const body = JSON.stringify(req.payload);
  if (body.length > 4000) throw new Error("spill body too large: " + body.length);
  if (/android spill smoke ask 1\b/.test(body)) throw new Error("prefix leaked into chat POST");
  const chat = await fetch(GATEWAY + "/v1/chat/completions", {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, req.headers),
    body: body,
  });
  if (chat.status !== 402 && chat.status !== 200) {
    throw new Error("spill chat POST unexpected HTTP " + chat.status);
  }
  console.log("ok  spill tail " + req.sent + "/" + req.total + " chars=" + body.length + " http=" + chat.status);

  const billingOrigin = "https://zoo.openzoo.fun";
  const tiers = await (await fetch(billingOrigin + "/api/billing/tiers")).json();
  if (!tiers.ok || !Array.isArray(tiers.tiers)) {
    throw new Error("live /api/billing/tiers unexpected: " + JSON.stringify(tiers).slice(0, 200));
  }
  const byId = {};
  tiers.tiers.forEach((t) => { byId[t.id] = t; });
  if (byId.basic.monthlyCents !== 900 || byId.pro.monthlyCents !== 2900 || byId.ultra.monthlyCents !== 9900) {
    throw new Error("do not invent prices — live tiers drifted: " + JSON.stringify(byId));
  }
  if (byId.basic.savingsSharePct !== 40 || byId.pro.savingsSharePct !== 20 || byId.ultra.savingsSharePct !== 10) {
    throw new Error("live savings share drifted");
  }
  if (byId.basic.rpm !== 60 || byId.pro.rpm !== 300 || byId.ultra.rpm !== 2000) {
    throw new Error("live rpm drifted");
  }
  if (tiers.trialDays !== 0) throw new Error("trialDays should be 0, got " + tiers.trialDays);
  if (tiers.usageThresholdCents !== 100) {
    throw new Error("usage invoice threshold should be $1.00, got " + tiers.usageThresholdCents);
  }
  console.log("ok  live billing tiers Basic $9 / Pro $29 / Ultra $99, trialDays 0, usage $1.00");

  const play = await fetch(billingOrigin + "/api/billing/play", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      packageName: "fun.openzoo.android",
      productId: "fun.openzoo.android.sub.pro",
      purchaseToken: "smoke-no-mint",
      orderId: "smoke",
      tier: "pro",
    }),
  });
  const playRaw = await play.text();
  let playJson = null;
  try { playJson = JSON.parse(playRaw); } catch (e) { playJson = null; }
  if (play.ok && playJson && playJson.key) {
    throw new Error("did not expect a live Play key mint yet: " + playRaw.slice(0, 200));
  }
  console.log("ok  POST /api/billing/play not a live mint (" + play.status + ") — Android stubs + TODO");

  console.log("\n6 live gateway + billing checks passed");
}

main().catch((e) => {
  console.error("gateway smoke failed:", e.message || e);
  process.exit(1);
});
