"use strict";

/**
 * Live gateway + /supported smoke (no wallet, no settlement).
 */

const GATEWAY = "https://x402-tokens.fly.dev";
const SUPPORTED = "https://x402.accrue.fund/supported";
const WTOKENX2 = "FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B";
const DRAINED = "Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9";

async function main() {
  const models = await (await fetch(GATEWAY + "/v1/models")).json();
  const ids = (models.data || []).map((m) => m.id);
  if (!ids.includes("google/gemini-3.7-flash")) {
    throw new Error("expected google/gemini-3.7-flash in /v1/models");
  }
  if (ids.includes("openzoo")) throw new Error("do not use a fake openzoo model id");
  console.log("ok  models (" + ids.length + ") includes google/gemini-3.7-flash");

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

  const supported = await (await fetch(SUPPORTED)).json();
  const kinds = supported.kinds || [];
  const sol = kinds.filter((k) => String(k.network || "").startsWith("solana:"));
  const tok = sol.find((k) => k.extra && k.extra.asset === WTOKENX2);
  if (!tok) throw new Error("live /supported missing wTOKENx2 mint FXYkw…");
  if ((tok.extra && tok.extra.symbol) !== "wTOKENx2") {
    throw new Error("live /supported must label FXYkw… as wTOKENx2, got " + (tok.extra && tok.extra.symbol));
  }
  if (sol.some((k) => k.extra && k.extra.asset === DRAINED)) {
    throw new Error("live /supported still lists drained mint Bo7xBF7…");
  }
  const acq = tok.extra.acquire;
  if (!acq || acq.method !== "spl-token-wrap" || acq.program !== "FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE") {
    throw new Error("wTOKENx2 acquire is not wrap-nav");
  }
  if (acq.authorityBump !== 254) throw new Error("wTOKENx2 bump is " + acq.authorityBump + ", want 254");
  console.log("ok  /supported wTOKENx2 wrap-nav bump 254");

  const chat = await fetch(GATEWAY + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer openzoo" },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
    }),
  });
  if (chat.status !== 402) throw new Error("expected 402, got " + chat.status);
  const challenge = await chat.json();
  const rows = (challenge.accepts || []).filter((a) => String(a.network || "").startsWith("solana:"));
  if (rows.some((a) => String(a.asset || "").indexOf("Bo7xBF7") === 0)) {
    throw new Error("stale drained mint appeared in live 402");
  }
  const liveTok = rows.find((a) => a.asset === WTOKENX2);
  if (!liveTok) throw new Error("402 missing FXYkw… mint: " + rows.map((a) => a.asset).join(","));
  const yusd = rows.find((a) => a.extra && a.extra.symbol === "yUSDCx");
  if (!yusd) throw new Error("402 missing yUSDCx");

  const built = await (await fetch(GATEWAY + "/v1/pay/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accept: yusd,
      payer: "11111111111111111111111111111111",
    }),
  })).json();
  if (!built.transaction || !built.envelope || !built.envelope.payload) {
    throw new Error("unexpected pay/build: " + JSON.stringify(built).slice(0, 300));
  }
  console.log("ok  402 rails + pay/build unsigned tx (" + built.transaction.length + " chars)");
  console.log("\n5 live gateway checks passed");
}

main().catch((e) => {
  console.error("gateway smoke failed:", e.message || e);
  process.exit(1);
});
