"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("../www/app/js/rails.js");

const ACCEPTS = [
  {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: "6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv",
    maxAmountRequired: "7051",
    extra: { symbol: "yUSDCx", decimals: 6 },
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
    asset: "FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B",
    maxAmountRequired: "33545783",
    extra: { symbol: "wTOKENx", decimals: 6 },
  },
  {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: "3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35",
    maxAmountRequired: "46679017404",
    extra: { symbol: "wLEOSx", decimals: 9 },
  },
];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok  " + name);
}

check("filters eip155 rows", () => {
  const sol = R.solanaAccepts(ACCEPTS);
  assert.strictEqual(sol.length, 3);
  assert.ok(sol.every((r) => r.network.startsWith("solana:")));
});

check("prefers yUSDCx when it can cover", () => {
  const d = R.pickRail(ACCEPTS, {
    payable: { yUSDCx: "7051", wTOKENx: "0", wLEOSx: "0" },
    underlying: {},
  });
  assert.strictEqual(d.mode, "pay");
  assert.strictEqual(d.symbol, "yUSDCx");
});

check("falls to wTOKENx when yUSDCx is short", () => {
  const d = R.pickRail(ACCEPTS, {
    payable: { yUSDCx: "10", wTOKENx: "33545783", wLEOSx: "0" },
    underlying: { USDC: "1000000" },
  });
  assert.strictEqual(d.mode, "pay");
  assert.strictEqual(d.symbol, "wTOKENx");
});

check("falls to wLEOSx last among twins", () => {
  const d = R.pickRail(ACCEPTS, {
    payable: { yUSDCx: "0", wTOKENx: "0", wLEOSx: "46679017404" },
    underlying: {},
  });
  assert.strictEqual(d.mode, "pay");
  assert.strictEqual(d.symbol, "wLEOSx");
});

check("steers when only plain USDC is held", () => {
  const d = R.pickRail(ACCEPTS, {
    payable: { yUSDCx: "0", wTOKENx: "0", wLEOSx: "0" },
    underlying: { USDC: "5000000", TOKEN: "0", LEOS: "0" },
  });
  assert.strictEqual(d.mode, "steer");
  assert.deepStrictEqual(d.heldUnderlying, ["USDC"]);
  const copy = R.steerCopy(d, "help text should stay off when they hold USDC");
  assert.match(copy.body, /yUSDCx \(wrapped USDC\), not plain USDC/);
  assert.match(copy.body, /https:\/\/x402\.accrue\.fund\/start/);
  assert.strictEqual(copy.help, "");
});

check("steers TOKEN-only wallets", () => {
  const d = R.pickRail(ACCEPTS, {
    payable: { yUSDCx: "0", wTOKENx: "0", wLEOSx: "0" },
    underlying: { TOKEN: "99" },
  });
  assert.strictEqual(d.mode, "steer");
  assert.ok(d.heldUnderlying.includes("TOKEN"));
  assert.match(R.steerCopy(d).body, /wTOKENx/);
});

check("empty wallet includes 402 help text", () => {
  const d = R.pickRail(ACCEPTS, {
    payable: { yUSDCx: "0", wTOKENx: "0", wLEOSx: "0" },
    underlying: {},
  });
  assert.strictEqual(d.mode, "steer");
  assert.strictEqual(d.empty, true);
  const help = "Don't hold any yet? https://x402.accrue.fund/start";
  const copy = R.steerCopy(d, help);
  assert.match(copy.body, /yUSDCx \(wrapped USDC\), not plain USDC/);
  assert.match(copy.body, help);
});

check("probe failure returns yUSDCx then wTOKENx then wLEOSx", () => {
  const d = R.pickRail(ACCEPTS, { probeFailed: true });
  assert.strictEqual(d.mode, "fallback");
  assert.deepStrictEqual(d.order.map((x) => x.symbol), ["yUSDCx", "wTOKENx", "wLEOSx"]);
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
  assert.strictEqual(decoded.x402Version, 1);
});

check("detects underfunded / simulation failures", () => {
  assert.ok(R.looksUnderfunded("Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1"));
  assert.ok(R.looksUnderfunded("insufficient funds"));
  assert.ok(!R.looksUnderfunded("wallet rejected the request"));
});

check("defaults to google/gemini-3.7-flash, never a fake openzoo id", () => {
  const id = R.defaultModelId([
    { id: "~hidden" },
    { id: "openai/gpt-4o-mini" },
    { id: "google/gemini-3.7-flash:batch" },
    { id: "google/gemini-3.7-flash" },
  ]);
  assert.strictEqual(id, "google/gemini-3.7-flash");
  assert.notStrictEqual(id, "openzoo");
});

check("system prompt does not claim RUN/WRITE/READ/SERVE", () => {
  assert.match(R.SYSTEM_PROMPT, /chat only/i);
  assert.doesNotMatch(R.SYSTEM_PROMPT, /\bRUN\b.*work/i);
  assert.match(R.SYSTEM_PROMPT, /Never emit RUN, WRITE, READ, or SERVE/);
});

check("pay path sources never call signAndSendTransaction", () => {
  const files = [
    "www/index.html",
    "www/app/js/pay.js",
    "www/app/js/rails.js",
    "www/app/js/app.js",
    "www/app/index.html",
  ].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
  const joined = files.join("\n");
  assert.doesNotMatch(joined, /signAndSendTransaction/);
  assert.match(joined, /MWA\.signTransaction/);
  assert.doesNotMatch(joined, /@solana\/web3\.js|@solana\/spl-token/);
});

check("widget id is fun.openzoo.android and forbidden ids are gone", () => {
  const cfg = fs.readFileSync(path.join(__dirname, "..", "config.xml"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const shell = fs.readFileSync(path.join(__dirname, "..", "www/index.html"), "utf8");
  assert.match(cfg, /id="fun\.openzoo\.android"/);
  assert.match(cfg, /<name>OpenZoo<\/name>/);
  assert.strictEqual(pkg.name, "fun.openzoo.android");
  assert.strictEqual(pkg.displayName, "OpenZoo");
  assert.doesNotMatch(cfg + shell, /fun\.openzoo\.seeker|fun\.openzoo\.psg1|com\.example\.cordovaseeker/);
  assert.doesNotMatch(shell, /:8402/);
  assert.doesNotMatch(joinedApp(), /:8402/);
});

function joinedApp() {
  return [
    "www/app/index.html",
    "www/app/js/app.js",
    "www/app/js/pay.js",
    "www/app/js/rails.js",
  ].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
}

check("clicker demo is no longer loaded", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "www/index.html"), "utf8");
  assert.match(shell, /app\/index\.html/);
  assert.doesNotMatch(shell, /game\/index\.html/);
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "www/game/index.html")));
});

console.log("\n" + passed + " checks passed");
