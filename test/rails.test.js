"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("../www/app/js/rails.js");

const WTOKENX2 = "FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B";
const DRAINED = "Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9";
const YUSDCX = "6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv";
const WLEOSX = "3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35";

const KINDS = [
  {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    extra: { asset: R.PLAIN_USDC, symbol: "USDC", decimals: 6 },
  },
  {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    extra: {
      asset: YUSDCX,
      symbol: "yUSDCx",
      decimals: 6,
      acquire: {
        method: "spl-token-wrap",
        program: R.WRAP_PROGRAM,
        underlying: { address: R.PLAIN_USDC, symbol: "USDC", decimals: 6, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        escrow: "2qLm8aCvn6gQVUFeQ7EC5J62Y95gFzc3vReHzD5d5Gj2",
        mintAuthority: "EBGYMEEEPKu7szPUbnbp2h63azY9Sj9GR4MA2Ms6Quoi",
      },
    },
  },
  {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    extra: {
      asset: WTOKENX2,
      symbol: "wTOKENx2",
      decimals: 6,
      acquire: {
        method: "spl-token-wrap",
        program: R.WRAP_PROGRAM,
        underlying: { address: R.PLAIN_TOKEN, symbol: "TOKEN", decimals: 6, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
        escrow: "2ZFYUDiYbtJ8czCPnd6Wjbeo1Yg1LLJ9JkGPMeuZkKyh",
        mintAuthority: "2SFdjJoRyWfXvXghAjahDgmaZPrAr5WqqCr8KquAtZVM",
        authorityBump: 254,
      },
    },
  },
  {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    extra: {
      asset: WLEOSX,
      symbol: "wLEOSx",
      decimals: 9,
      acquire: {
        method: "spl-token-wrap",
        program: R.WRAP_PROGRAM,
        underlying: { address: R.PLAIN_LEOS, symbol: "LEOS", decimals: 9, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        escrow: "62kjFPGb2RnPXfShFdeYuvyN72hg5EC4N8UVkuN1RiMc",
        mintAuthority: "3Fj3FCty8DJZTrEdW5dYLgEfbVNATDixj9gVWWxuvz8J",
        authorityBump: 255,
      },
    },
  },
  {
    network: "eip155:8453",
    extra: { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
  },
];

const ACCEPTS = [
  {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: YUSDCX,
    maxAmountRequired: "7051",
    extra: { symbol: "yUSDCx", decimals: 6, billedUsd: 0.007 },
  },
  {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    maxAmountRequired: "7036",
    extra: { symbol: "USDC", decimals: 6 },
  },
  {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: WTOKENX2,
    maxAmountRequired: "33545783",
    extra: { symbol: "wTOKENx", decimals: 6, billedUsd: 0.007 },
  },
  {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: WLEOSX,
    maxAmountRequired: "46679017404",
    extra: { symbol: "wLEOSx", decimals: 9, billedUsd: 0.007 },
  },
];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok  " + name);
}

check("filters eip155 and drained / plain USDC rows", () => {
  const withJunk = ACCEPTS.concat([{
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: DRAINED,
    maxAmountRequired: "1",
    extra: { symbol: "wTOKENx" },
  }, {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: R.PLAIN_USDC,
    maxAmountRequired: "1",
    extra: { symbol: "USDC" },
  }]);
  const sol = R.solanaAccepts(withJunk);
  assert.ok(sol.every((r) => r.network.startsWith("solana:")));
  assert.ok(sol.every((r) => r.asset !== DRAINED));
  assert.ok(sol.every((r) => r.asset !== R.PLAIN_USDC));
});

check("FXYkw mint is always labeled wTOKENx2, never wTOKENx", () => {
  assert.strictEqual(R.canonicalSymbol(WTOKENX2, "wTOKENx2", "wTOKENx"), "wTOKENx2");
  assert.strictEqual(R.canonicalSymbol(WTOKENX2, "wTOKENx", "wTOKENx"), "wTOKENx2");
  const annotated = R.annotateAccepts(ACCEPTS, KINDS);
  const tok = annotated.find((a) => a.accept.asset === WTOKENX2);
  assert.ok(tok);
  assert.strictEqual(tok.symbol, "wTOKENx2");
  assert.notStrictEqual(tok.symbol, "wTOKENx");
});

check("hides drained mint even if a 402 still quotes it", () => {
  assert.ok(R.isDrainedMint(DRAINED));
  const kinds = KINDS.concat([{
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    extra: { asset: DRAINED, symbol: "wTOKENx" },
  }]);
  assert.ok(R.solanaKinds(kinds).every((k) => R.kindAsset(k) !== DRAINED));
});

check("pays with a held twin", () => {
  const d = R.pickRail(ACCEPTS, {
    twins: { [YUSDCX]: "7051", [WTOKENX2]: "0", [WLEOSX]: "0" },
    underlyings: {},
  }, KINDS);
  assert.strictEqual(d.mode, "pay");
  assert.strictEqual(d.accept.asset, YUSDCX);
});

check("wraps from TOKEN when only the live twin is short", () => {
  const d = R.pickRail(ACCEPTS, {
    twins: { [YUSDCX]: "0", [WTOKENX2]: "0", [WLEOSX]: "0" },
    underlyings: { [R.PLAIN_TOKEN]: "999999999" },
  }, KINDS);
  assert.strictEqual(d.mode, "wrap");
  assert.strictEqual(d.accept.asset, WTOKENX2);
  assert.strictEqual(d.underlying, R.PLAIN_TOKEN);
  assert.strictEqual(d.underlyingSymbol, "TOKEN");
});

check("wraps from USDC when that is what the wallet holds", () => {
  const d = R.pickRail(ACCEPTS, {
    twins: { [YUSDCX]: "0", [WTOKENX2]: "0", [WLEOSX]: "0" },
    underlyings: { [R.PLAIN_USDC]: "5000000" },
  }, KINDS);
  assert.strictEqual(d.mode, "wrap");
  assert.strictEqual(d.accept.asset, YUSDCX);
  assert.strictEqual(d.underlyingSymbol, "USDC");
});

check("need-funds copy never mentions twins or wrap homework", () => {
  const d = R.pickRail(ACCEPTS, {
    twins: { [YUSDCX]: "0", [WTOKENX2]: "0", [WLEOSX]: "0" },
    underlyings: {},
  }, KINDS);
  assert.strictEqual(d.mode, "need-funds");
  const copy = R.fundsCopy(d);
  assert.match(copy.body, /TOKEN, USDC, or LEOS|USDC or TOKEN/);
  assert.ok(copy.copyable);
  assert.doesNotMatch(copy.body, /yUSDCx|wTOKENx|wLEOSx|wrap-nav|accrue\.fund\/start|context_id|\/v1\/bind/);
});

check("pickLargestUseful does not compare TOKEN raw to twin maxAmountRequired", () => {
  const tenToken = "10000000";
  const annotated = R.annotateAccepts(ACCEPTS, KINDS);
  const useful = R.pickLargestUseful(annotated, { [R.PLAIN_TOKEN]: tenToken }, {});
  assert.ok(useful);
  assert.strictEqual(useful.underlying, R.PLAIN_TOKEN);
  assert.strictEqual(useful.accept.asset, WTOKENX2);
  assert.ok(Number(tenToken) < Number(ACCEPTS.find((a) => a.asset === WTOKENX2).maxAmountRequired));
  const d = R.pickRail(ACCEPTS, {
    twins: { [YUSDCX]: "0", [WTOKENX2]: "0", [WLEOSX]: "0" },
    underlyings: { [R.PLAIN_TOKEN]: tenToken },
  }, KINDS);
  assert.strictEqual(d.mode, "wrap");
  assert.strictEqual(d.underlyingSymbol, "TOKEN");
  const prompt = R.wrapPromptCopy(d);
  assert.match(prompt.title, /Wrap TOKEN to send this\?/);
});

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

check("encodes X-PAYMENT with the signed tx swapped in", () => {
  const header = R.encodePaymentHeader({
    x402Version: 1,
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    payload: { transaction: "<replace with the signed transaction>" },
  }, "SIGNED_TX_B64");
  const decoded = R.decodePaymentHeader(header);
  assert.strictEqual(decoded.payload.transaction, "SIGNED_TX_B64");
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

check("rails come from /supported, not a stale hardcoded PAYABLE allowlist", () => {
  assert.strictEqual(R.SUPPORTED_URL, "https://x402.accrue.fund/supported");
  assert.strictEqual(R.PAYABLE, undefined);
});

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

check("first-run is Play paywall first, with x402 escape", () => {
  const shell = read("www/index.html");
  assert.match(shell, /Card first · x402 also works/);
  assert.match(shell, /Most teams want this/);
  assert.match(shell, /Restore purchases/);
  assert.match(shell, /play-paywall/);
  assert.match(shell, /x402-pay/);
  assert.match(shell, /Continue with x402/);
  assert.ok(shell.indexOf("play-paywall") < shell.indexOf("x402-pay"));
  assert.doesNotMatch(shell, /checkout\.stripe\.com/);
  assert.doesNotMatch(shell, /\/api\/billing\/checkout/);
  assert.doesNotMatch(shell, /https:\/\/phantom\.app\/ul\//);
});

check("402 pay path partial-signs; wrap path may signAndSend", () => {
  const pay = read("www/app/js/pay.js");
  const shell = read("www/index.html");
  assert.match(pay, /wallet-sign-transaction/);
  assert.match(pay, /wallet-sign-and-send-transaction/);
  assert.match(shell, /MWA\.signTransaction\s*\(/);
  assert.match(shell, /MWA\.signAndSendTransaction\s*\(/);
  assert.match(pay, /partial-sign only/);
  assert.match(shell, /Payment signer\. MUST be signTransaction/);
  assert.match(shell, /Wrap \/ top-up only/);
});

check("no @solana/web3.js dependency and no :8402", () => {
  const joined = [
    "www/index.html",
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/app/js/rails.js",
    "www/app/js/wrap.js",
    "www/app/js/bind.js",
    "www/js/clipboard.js",
    "www/js/billing.js",
  ].map(read).join("\n");
  assert.doesNotMatch(joined, /@solana\/web3\.js|@solana\/spl-token/);
  assert.doesNotMatch(joined, /:8402/);
  assert.doesNotMatch(joined, /\/v1\/session/);
});

check("UI never shows context ids, /v1/bind, hashes, or twin homework", () => {
  const html = read("www/app/index.html");
  const app = read("www/app/js/app.js");
  assert.doesNotMatch(html, /context_id|\/v1\/hrr\/bind|bind hash|yUSDCx|wTOKENx|wLEOSx|wrap-nav/);
  assert.doesNotMatch(html, /teach the zoo|bind it|x-hrr-context/);
  assert.match(html, /Attach files/);
  assert.match(html, /Attach folder/);
  assert.match(html, /Paste text/);
  assert.match(html, /New chat/);
  assert.match(app, /userVisibleStatus/);
  assert.doesNotMatch(app, /bound ctx|context_id\.slice|bindStatus/);
});

check("widget id is fun.openzoo.android; Cordova + MWA stay", () => {
  const cfg = read("config.xml");
  const pkg = JSON.parse(read("package.json"));
  const shell = read("www/index.html");
  assert.match(cfg, /id="fun\.openzoo\.android"/);
  assert.match(cfg, /<name>OpenZoo<\/name>/);
  assert.strictEqual(pkg.name, "fun.openzoo.android");
  assert.doesNotMatch(cfg + shell, /fun\.openzoo\.seeker|fun\.openzoo\.psg1|SwiftUI|phantom\.app\/ul\/v1/);
  assert.match(shell, /cordova\.js/);
  assert.match(shell, /MWA\.authorize/);
});

console.log("\n" + passed + " checks passed");
