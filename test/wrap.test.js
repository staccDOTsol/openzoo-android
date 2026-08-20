"use strict";

const assert = require("assert");
const S = require("../www/app/js/solana-lite.js");
const R = require("../www/app/js/rails.js");
const W = require("../www/app/js/wrap.js");

const WTOKENX2 = "FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B";
const AUTH = "2SFdjJoRyWfXvXghAjahDgmaZPrAr5WqqCr8KquAtZVM";

const ACQUIRE = {
  method: "spl-token-wrap",
  program: R.WRAP_PROGRAM,
  underlying: {
    address: R.PLAIN_TOKEN,
    symbol: "TOKEN",
    decimals: 6,
    tokenProgram: S.TOKEN_2022_PROGRAM,
  },
  escrow: "2ZFYUDiYbtJ8czCPnd6Wjbeo1Yg1LLJ9JkGPMeuZkKyh",
  mintAuthority: AUTH,
  authorityBump: 254,
};

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok  " + name);
}

check("wTOKENx2 mint-authority PDA is bump 254", () => {
  const pda = S.findProgramAddress(["mint_authority", WTOKENX2], S.WRAP_PROGRAM);
  assert.strictEqual(pda.address, AUTH);
  assert.strictEqual(pda.bump, 254);
});

check("yUSDCx mint-authority derives when directory omits bump", () => {
  const mint = "6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv";
  const pda = S.findProgramAddress(["mint_authority", mint], S.WRAP_PROGRAM);
  assert.strictEqual(pda.address, "EBGYMEEEPKu7szPUbnbp2h63azY9Sj9GR4MA2Ms6Quoi");
  assert.strictEqual(pda.bump, 253);
});

check("depositForShares adds a small NAV margin", () => {
  assert.strictEqual(W.depositForShares(1000n, 0n, 0n), 2000n);
  const d = W.depositForShares(10000n, 1000000n, 1000000n);
  assert.ok(d > 10000n);
});

check("wTOKENx2 wrap is nine accounts, bump 254, program pulls deposit", () => {
  const pool = W.poolFromAcquire(WTOKENX2, ACQUIRE, S.TOKEN_2022_PROGRAM);
  assert.strictEqual(pool.bump, 254);
  assert.strictEqual(pool.programId, R.WRAP_PROGRAM);
  const owner = "WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb";
  const built = W.buildWrapInstructions(pool, owner, 12345n, owner);
  const wrap = built.ixs[1];
  assert.strictEqual(wrap.keys.length, 9);
  assert.strictEqual(wrap.programId, R.WRAP_PROGRAM);
  assert.strictEqual(wrap.keys[5].pubkey, built.userUnderlying);
  assert.strictEqual(wrap.keys[6].pubkey, owner);
  assert.strictEqual(wrap.keys[6].isSigner, true);
  assert.strictEqual(wrap.data[0], 1);
  assert.strictEqual(wrap.data[wrap.data.length - 1], 254);
  const amt = S.u64le(12345n);
  for (var i = 0; i < 8; i++) assert.strictEqual(wrap.data[1 + i], amt[i]);
});

check("compiled wrap tx is unsigned (empty signature slots)", () => {
  const pool = W.poolFromAcquire(WTOKENX2, ACQUIRE, S.TOKEN_2022_PROGRAM);
  const owner = "WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb";
  const blockhash = "11111111111111111111111111111111";
  const tx = W.buildWrapTx(pool, owner, 99n, blockhash, owner);
  assert.ok(tx.base64.length > 80);
  const raw = Buffer.from(tx.base64, "base64");
  assert.ok(raw[0] >= 1);
  var zeros = 0;
  for (var i = 1; i <= 64; i++) if (raw[i] === 0) zeros++;
  assert.ok(zeros === 64, "first signature slot must be empty so Phantom can sign");
});

console.log("\n" + passed + " checks passed");
