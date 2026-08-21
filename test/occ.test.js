"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const O = require("../www/app/js/occ.js");
const R = require("../www/app/js/rails.js");

let passed = 0;
function check(name, fn) {
  const out = fn();
  if (out && typeof out.then === "function") {
    return out.then(function () {
      passed += 1;
      console.log("ok  " + name);
    });
  }
  passed += 1;
  console.log("ok  " + name);
  return Promise.resolve();
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function jsonRes(status, obj, headers) {
  const raw = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: function (k) { return (headers && headers[k]) || "application/json"; } },
    text: async function () { return raw; },
    json: async function () { return obj; },
  };
}

function htmlRes(status) {
  return {
    ok: false,
    status: status,
    headers: { get: function () { return "text/html"; } },
    text: async function () { return "<!DOCTYPE html><html>not found</html>"; },
  };
}

function sseRes(blocks) {
  const raw = blocks.map(function (b) {
    return "data: " + (typeof b === "string" ? b : JSON.stringify(b)) + "\n\n";
  }).join("");
  return {
    ok: true,
    status: 200,
    body: null,
    headers: { get: function () { return "text/event-stream"; } },
    text: async function () { return raw; },
  };
}

const chain = [];

chain.push(check("origin is this app's existing API host, not an open OCC URL", () => {
  assert.strictEqual(O.OCC_ORIGIN, "https://zoo.openzoo.fun");
  assert.strictEqual(O.OCC_ORIGIN, R.CONNECT_ORIGINS[0]);
  assert.strictEqual(O.SESSIONS, "/api/occ/sessions");
  assert.strictEqual(O.sessionPath("abc"), "/api/occ/sessions/abc");
  assert.ok(O.sessionUrl("abc").startsWith("https://zoo.openzoo.fun/api/occ/"));
  assert.doesNotMatch(O.OCC_ORIGIN, /localhost|:8402|anthropic|claude\.ai/i);
}));

chain.push(check("usable key rejects empty, placeholder, and anthropic keys", () => {
  assert.strictEqual(O.isUsableKey(""), false);
  assert.strictEqual(O.isUsableKey(null), false);
  assert.strictEqual(O.isUsableKey("openzoo"), false);
  assert.strictEqual(O.isUsableKey("sk-openzoo"), false);
  assert.strictEqual(O.isUsableKey("anthropic-xyz"), false);
  assert.strictEqual(O.isUsableKey("oz_sub_live_key"), true);
}));

chain.push(check("occHeaders requires a real Bearer and never ANTHROPIC_API_KEY", () => {
  assert.throws(() => O.occHeaders(null), (e) => e.name === "OccAuthError");
  assert.throws(() => O.occHeaders("openzoo"), (e) => e.name === "OccAuthError");
  const h = O.occHeaders("oz_sub_live_key", { "x-extra": "1", ANTHROPIC_API_KEY: "sk-ant" });
  assert.strictEqual(h.authorization, "Bearer oz_sub_live_key");
  assert.strictEqual(h["x-extra"], "1");
  assert.ok(!h.ANTHROPIC_API_KEY);
  assert.ok(!Object.keys(h).some((k) => /anthropic/i.test(k)));
}));

chain.push(check("/goal is first-class; empty goal stays local", () => {
  assert.strictEqual(O.goalFromMessage("hello"), null);
  assert.strictEqual(O.goalFromMessage("/goal build the app"), "build the app");
  assert.strictEqual(O.goalFromMessage("/GOAL   ship it  "), "ship it");
  assert.strictEqual(O.goalFromMessage("/goal"), "");
  assert.ok(O.isGoalCommand("/goal x"));
  assert.ok(!O.isGoalCommand("goal x"));
}));

chain.push(check("run mode: agent vs chat; no key defaults chat", () => {
  assert.strictEqual(O.normalizeRunMode("agent"), "agent");
  assert.strictEqual(O.normalizeRunMode("auto"), "agent");
  assert.strictEqual(O.normalizeRunMode("chat"), "chat");
  assert.strictEqual(O.defaultRunMode(true), "agent");
  assert.strictEqual(O.defaultRunMode(false), "chat");
  assert.ok(O.isAgentMode({ runMode: "agent" }));
  assert.ok(!O.isAgentMode({ runMode: "chat" }));
}));

chain.push(check("SSE + NDJSON events normalize to delta/status/done", () => {
  const ev = [];
  const rest = O.consumeBuffer(
    'data: {"type":"status","text":"working"}\n\n' +
    'data: {"type":"delta","text":"hi"}\n\n' +
    '{"text":" there"}\n\n',
    function (e) { ev.push(e); }
  );
  assert.strictEqual(rest, "");
  assert.strictEqual(ev[0].type, "status");
  assert.strictEqual(ev[1].text, "hi");
  assert.strictEqual(ev[2].text, " there");
  assert.strictEqual(O.normalizeEvent({ choices: [{ delta: { content: "tok" } }] }).text, "tok");
  assert.strictEqual(O.normalizeEvent({ type: "done" }).type, "done");
}));

chain.push(check("createSession / message / goal / upload / stop send Bearer", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: url, init: init });
    if (url.endsWith("/api/occ/sessions") && init.method === "POST") {
      return jsonRes(200, { ok: true, id: "sess_1", cwd: "/workspace" });
    }
    if (url.indexOf("/messages") !== -1) return sseRes([{ type: "delta", text: "ok" }]);
    if (url.indexOf("/goal") !== -1) return sseRes([{ type: "delta", text: "goal set" }]);
    if (url.indexOf("/upload") !== -1) return jsonRes(200, { ok: true, name: "note.txt", path: "note.txt" });
    if (url.indexOf("/stop") !== -1) return jsonRes(200, { ok: true });
    return jsonRes(404, { error: "missing" });
  };
  const key = "oz_sub_live_key";
  const sess = await O.createSession({ key: key, threadId: "t-1", fetchImpl: fetchImpl });
  assert.strictEqual(sess.id, "sess_1");
  const deltas = [];
  await O.postMessage("sess_1", "hello", {
    key: key,
    fetchImpl: fetchImpl,
    onEvent: function (e) { if (e.text) deltas.push(e.text); },
  });
  await O.postGoal("sess_1", "ship it", { key: key, fetchImpl: fetchImpl, onEvent: function () {} });
  const up = await O.uploadFile("sess_1", { name: "note.txt", text: "hi" }, { key: key, fetchImpl: fetchImpl });
  await O.stopSession("sess_1", { key: key, fetchImpl: fetchImpl });
  assert.ok(up.ok);
  assert.ok(deltas.join("").indexOf("ok") !== -1);
  assert.ok(calls.length >= 5);
  calls.forEach(function (c) {
    assert.match(c.init.headers.authorization, /^Bearer oz_sub_live_key$/);
    assert.doesNotMatch(JSON.stringify(c.init.headers), /ANTHROPIC_API_KEY/);
    assert.match(c.url, /^https:\/\/zoo\.openzoo\.fun\/api\/occ\//);
  });
  assert.ok(calls.some((c) => c.url.endsWith("/api/occ/sessions") && c.init.method === "POST"));
  assert.ok(calls.some((c) => /\/messages$/.test(c.url)));
  assert.ok(calls.some((c) => /\/goal$/.test(c.url)));
  assert.ok(calls.some((c) => /\/upload$/.test(c.url)));
  assert.ok(calls.some((c) => /\/stop$/.test(c.url)));
}));

chain.push(check("no key never hits the door", async () => {
  let hit = false;
  try {
    await O.createSession({
      key: "",
      fetchImpl: async () => { hit = true; return jsonRes(200, { id: "x" }); },
    });
    assert.fail("should refuse");
  } catch (e) {
    assert.strictEqual(e.name, "OccAuthError");
  }
  assert.strictEqual(hit, false);
}));

chain.push(check("HTML 404 door is unavailable, not a fake local PTY", async () => {
  try {
    await O.createSession({
      key: "oz_sub_live_key",
      fetchImpl: async () => htmlRes(404),
    });
    assert.fail("should fail");
  } catch (e) {
    assert.strictEqual(e.name, "OccDoorUnavailableError");
    assert.match(e.message, /Chat still works/);
    assert.doesNotMatch(e.message, /zoo\.openzoo\.fun|\/api\/occ|node-pty|:8402/);
  }
}));

chain.push(check("401/402 map to subscribe/restore, never x402", () => {
  const a = O.mapHttpError(401, { error: "no" }, "");
  const b = O.mapHttpError(402, { error: "pay" }, "");
  assert.strictEqual(a.name, "OccAuthError");
  assert.match(b.message, /Restore your Google Play/);
  assert.doesNotMatch(a.message + b.message, /x402|Phantom|wallet|Stripe/);
}));

chain.push(check("shipped UI keeps Chat, adds Agent, hides door URLs", () => {
  const html = read("www/app/index.html");
  const app = read("www/app/js/app.js");
  const occ = read("www/app/js/occ.js");
  const rails = read("www/app/js/rails.js");
  const pay = read("www/app/js/pay.js");
  const joined = html + app + occ + rails + pay;
  assert.match(html, /js\/occ\.js/);
  assert.match(html, /id="modeToggle"/);
  assert.match(html, /id="modeChat"/);
  assert.match(html, /id="modeAgent"/);
  assert.match(html, />Chat</);
  assert.match(html, />Agent</);
  assert.match(html, /id="goalTip"/);
  assert.match(html, /id="agentStop"/);
  assert.match(app, /OpenZooOcc/);
  assert.match(app, /function startNewChat\(\) \{ newThread\(\); \}/);
  assert.match(app, /ensureOccSession/);
  assert.match(app, /agentSend/);
  assert.match(app, /uploadAgentItems/);
  assert.doesNotMatch(html, /\/api\/occ|node-pty|:8402|ANTHROPIC_API_KEY/);
  assert.doesNotMatch(app, /ANTHROPIC_API_KEY|node-pty|pty\.spawn|localhost:8402/);
  assert.doesNotMatch(occ, /ANTHROPIC_API_KEY\s*[:=]/);
  assert.doesNotMatch(joined, /checkout\.stripe\.com|walletPayEnabled|X-PAYMENT|CONNECT PHANTOM/);
}));

chain.push(check("Play IAP still entitles the key; store path is not x402", () => {
  const shell = read("www/index.html");
  const billing = read("www/js/billing.js");
  const occ = read("www/app/js/occ.js");
  const app = read("www/app/js/app.js");
  const handoff = read("HANDOFF_OPENZOO_ANDROID.md");
  const readme = read("README.md");
  assert.match(shell, /play-paywall/);
  assert.match(billing, /exchangePlayPurchase/);
  assert.match(handoff, /\/api\/occ\/sessions/);
  assert.match(handoff, /Authorization: Bearer/);
  assert.match(readme, /hosted OCC/);
  assert.doesNotMatch(shell, /\/api\/billing\/checkout|checkout\.stripe\.com/);
  assert.doesNotMatch(occ + app, /\/api\/billing\/checkout|checkout\.stripe\.com|X-PAYMENT|walletPayEnabled/);
  assert.doesNotMatch(handoff, /jarettrsdunn1999@gmail\.com/);
}));

Promise.all(chain).then(function () {
  console.log("\n" + passed + " checks passed");
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
