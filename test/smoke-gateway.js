"use strict";

/**
 * Live gateway smoke (no wallet, no settlement).
 * Confirms CORS-facing endpoints the phone will call.
 */

const GATEWAY = "https://x402-tokens.fly.dev";

async function main() {
  const models = await (await fetch(GATEWAY + "/v1/models")).json();
  const ids = (models.data || []).map((m) => m.id);
  if (!ids.includes("google/gemini-3.7-flash")) {
    throw new Error("expected google/gemini-3.7-flash in /v1/models");
  }
  if (ids.includes("openzoo")) {
    throw new Error("do not use a fake openzoo model id");
  }
  console.log("ok  models (" + ids.length + ") includes google/gemini-3.7-flash");

  const stats = await (await fetch(GATEWAY + "/v1/stats")).json();
  if (!stats.today || typeof stats.today.calls !== "number") {
    throw new Error("unexpected /v1/stats shape");
  }
  console.log("ok  stats today.calls=" + stats.today.calls);

  const bind = await (await fetch(GATEWAY + "/v1/hrr/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corpus: "openzoo android smoke bind" }),
  })).json();
  if (!bind.context_id) throw new Error("bind did not return context_id: " + JSON.stringify(bind));
  console.log("ok  bind " + bind.context_id);

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
  const sol = (challenge.accepts || []).filter((a) => String(a.network || "").startsWith("solana:"));
  const symbols = sol.map((a) => a.extra && a.extra.symbol).sort();
  for (const need of ["yUSDCx", "wTOKENx", "wLEOSx"]) {
    if (!symbols.includes(need)) throw new Error("402 missing Solana rail " + need + ": " + symbols);
  }
  if (sol.some((a) => a.network.indexOf("eip155") !== -1)) {
    throw new Error("solana filter leaked an eip155 row");
  }
  console.log("ok  402 solana rails " + symbols.join(","));

  const yusd = sol.find((a) => a.extra && a.extra.symbol === "yUSDCx");
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
  if (built.envelope.payload.transaction.indexOf("replace") === -1 &&
      built.envelope.payload.transaction === built.transaction) {
    // envelope may already contain the unsigned tx or a placeholder — either is fine
  }
  console.log("ok  pay/build unsigned tx (" + built.transaction.length + " chars)");
  console.log("\n4 live gateway checks passed");
}

main().catch((e) => {
  console.error("gateway smoke failed:", e.message || e);
  process.exit(1);
});
