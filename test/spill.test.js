"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const S = require("../www/app/js/spill.js");
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

function thread(n) {
  const msgs = [];
  for (let i = 1; i <= n; i++) {
    msgs.push({ role: "user", content: "ask " + i + " " + "x".repeat(40) });
    msgs.push({ role: "assistant", content: "ans " + i + " " + "y".repeat(40) });
  }
  return msgs;
}

check("first turn without context sends the full short thread and no header", () => {
  const req = S.chatRequest({
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    model: "google/gemini-3.7-flash",
    maxTokens: 4096,
    contextId: null,
  });
  assert.strictEqual(req.headers["x-hrr-context"], undefined);
  assert.strictEqual(req.payload.messages.length, 2);
  assert.strictEqual(req.payload.messages[0].role, "system");
  assert.strictEqual(req.spilled, false);
});

check("context id never rides with the full long messages array", () => {
  const history = thread(20);
  const req = S.chatRequest({
    system: "sys",
    messages: history,
    model: "google/gemini-3.7-flash",
    maxTokens: 4096,
    contextId: "ctx_thread",
  });
  assert.strictEqual(req.headers["x-hrr-context"], "ctx_thread");
  assert.ok(req.sent < req.total, "must send a tail, not " + req.sent + "/" + req.total);
  assert.ok(req.sent <= S.KEEP_TAIL + 1, "system + last few, got sent=" + req.sent);
  assert.ok(req.prefix.length > 0);
  assert.ok(req.payload.messages[0].role === "system");
  assert.ok(req.payload.messages.some((m) => m.role === "user" && /ask 20/.test(m.content)));
  assert.ok(!req.payload.messages.some((m) => /ask 1 /.test(m.content)), "prefix must not be in the POST body");
});

check("cut keeps the last user ask and a short tail like Claude CLI ~3/N", () => {
  const msgs = [{ role: "system", content: "sys" }].concat(thread(8));
  const plan = S.cutTranscript(msgs);
  assert.ok(plan.cut > plan.firstSpillable);
  const tail = msgs.slice(plan.cut);
  assert.ok(tail.length <= S.KEEP_TAIL + 1);
  assert.ok(tail.some((m) => m.role === "user"));
  const prefix = S.prefixCorpus(msgs, plan.firstSpillable, plan.cut);
  assert.match(prefix, /USER: ask 1/);
  assert.doesNotMatch(prefix, /ask 8/);
});

check("prefix delta appends only new turns", () => {
  assert.strictEqual(S.prefixDelta("USER: a", "USER: a\n\nASSISTANT: b"), "\n\nASSISTANT: b");
  assert.strictEqual(S.prefixDelta("USER: a", "USER: a"), "");
  assert.strictEqual(S.prefixDelta("", "USER: a"), "USER: a");
});

check("HUD savings is directUsd/spentUsd, never a sum of savesVsDirect", () => {
  const acc = { spent: 0, direct: 0, calls: 0 };
  S.noteSpend(acc, { billedUsd: 0.01, directUsd: 0.08, savesVsDirect: 99 });
  S.noteSpend(acc, { billedUsd: 0.02, directUsd: 0.10, savesVsDirect: 50 });
  assert.strictEqual(acc.spent, 0.03);
  assert.strictEqual(acc.direct, 0.18);
  assert.ok(Math.abs(acc.spent - 149) > 1, "must not sum savesVsDirect");
  assert.ok(Math.abs(S.hudSavingX(acc.direct, acc.spent) - 6) < 1e-9);
  assert.match(S.hudLabel(acc), /6\.0× vs direct/);
  assert.strictEqual(S.hudSavingX(0.5, 0), null);
  const rec = S.receiptOf({ x402: { billedUsd: 1, directUsd: 4, savesVsDirect: 9 } });
  assert.strictEqual(rec.billedUsd, 1);
  assert.strictEqual(S.hudSavingX(rec.directUsd, rec.billedUsd), 4);
});

check("transcript bind payload matches Claude CLI, file bind stays items-on-append", () => {
  assert.deepStrictEqual(R.transcriptBindPayload("hello"), { corpus: "hello" });
  assert.deepStrictEqual(R.transcriptBindPayload("delta", "ctx_1"), {
    corpus: "delta",
    context_id: "ctx_1",
  });
  assert.deepStrictEqual(R.bindPayload("file", "ctx_1"), {
    items: [{ text: "file" }],
    context_id: "ctx_1",
  });
});

check("shipped chat fetch uses spill and never dumps t.messages with x-hrr-context", () => {
  const app = read("www/app/js/app.js");
  const html = read("www/app/index.html");
  assert.match(html, /js\/spill\.js/);
  assert.match(app, /OpenZooSpill/);
  assert.match(app, /prepareChat/);
  assert.match(app, /chatRequest/);
  assert.match(app, /bindTranscriptPrefix/);
  assert.match(app, /hudSavingX/);
  assert.doesNotMatch(app, /t\.messages\.map\(\s*function/);
  assert.doesNotMatch(app, /savesVsDirect/);
  assert.doesNotMatch(app, /SPAWN|worktree|PING:|childKickoff/);
  assert.match(read("www/app/index.html"), /js\/race\.js/);
  assert.doesNotMatch(read("www/app/js/race.js"), /function spawn|childKickoff|worktree/);
  assert.doesNotMatch(app, /if \(t\.ctx\) h\["x-hrr-context"\]/);
});

check("UI still hides context ids; HUD is a multiple not a dollar-sum", () => {
  const html = read("www/app/index.html");
  const app = read("www/app/js/app.js");
  assert.match(html, /id="hud"/);
  assert.doesNotMatch(html, /context_id|x-hrr-context|\/v1\/hrr\/bind/);
  assert.doesNotMatch(app, /bound ctx|context_id\.slice/);
  assert.match(app, /S\.hudLabel/);
});

check("402 path stays Play subscribe/restore — no wallet", () => {
  const pay = read("www/app/js/pay.js");
  const app = read("www/app/js/app.js");
  assert.match(pay, /SubscriptionRequiredError/);
  assert.match(pay, /Restore your Google Play subscription/);
  assert.doesNotMatch(pay, /walletPayEnabled|X-PAYMENT|showWrapPrompt/);
  assert.doesNotMatch(app, /Connect Phantom|requestWalletConnect|showWrapPrompt/);
  assert.match(read("www/app/js/rails.js"), /x402-tokens\.fly\.dev/);
});

console.log("\n" + passed + " checks passed");
