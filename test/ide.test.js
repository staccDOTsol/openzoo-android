"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const I = require("../www/app/js/ide.js");
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

const chain = [];

chain.push(check("origin is this app's existing API host; door is /ide/session", () => {
  assert.strictEqual(I.IDE_ORIGIN, "https://zoo.openzoo.fun");
  assert.strictEqual(I.IDE_ORIGIN, R.CONNECT_ORIGINS[0]);
  assert.strictEqual(I.SESSION, "/ide/session");
  assert.doesNotMatch(I.SESSION, /\/occ\/|\/api\/occ|\/v1\/session/);
  assert.doesNotMatch(I.IDE_ORIGIN, /localhost|:8402|anthropic|claude\.ai/i);
}));

chain.push(check("usable key rejects empty, placeholder, and anthropic keys", () => {
  assert.strictEqual(I.isUsableKey(""), false);
  assert.strictEqual(I.isUsableKey(null), false);
  assert.strictEqual(I.isUsableKey("openzoo"), false);
  assert.strictEqual(I.isUsableKey("sk-openzoo"), false);
  assert.strictEqual(I.isUsableKey("anthropic-xyz"), false);
  assert.strictEqual(I.isUsableKey("oz_sub_live_key"), true);
}));

chain.push(check("ideHeaders requires a real Bearer and never ANTHROPIC_API_KEY", () => {
  assert.throws(() => I.ideHeaders(null), (e) => e.name === "IdeAuthError");
  assert.throws(() => I.ideHeaders("openzoo"), (e) => e.name === "IdeAuthError");
  const h = I.ideHeaders("oz_sub_live_key", { "x-extra": "1", ANTHROPIC_API_KEY: "sk-ant" });
  assert.strictEqual(h.authorization, "Bearer oz_sub_live_key");
  assert.strictEqual(h["x-extra"], "1");
  assert.ok(!h.ANTHROPIC_API_KEY);
  assert.ok(!Object.keys(h).some((k) => /anthropic/i.test(k)));
}));

chain.push(check("session URL must be https and never an open/local/anthropic URL", () => {
  assert.strictEqual(I.isSafeSessionUrl(""), false);
  assert.strictEqual(I.isSafeSessionUrl("http://zoo.openzoo.fun/ide"), false);
  assert.strictEqual(I.isSafeSessionUrl("https://localhost:8443"), false);
  assert.strictEqual(I.isSafeSessionUrl("https://127.0.0.1/ide"), false);
  assert.strictEqual(I.isSafeSessionUrl("https://claude.ai/"), false);
  assert.strictEqual(I.isSafeSessionUrl("https://api.anthropic.com/"), false);
  assert.strictEqual(I.isSafeSessionUrl("javascript:alert(1)"), false);
  assert.strictEqual(I.isSafeSessionUrl("https://cs.openzoo.fun/?folder=/workspace"), true);
  assert.ok(!I.sessionOf({ id: "x" }));
  assert.ok(!I.sessionOf({ url: "https://localhost/ide", id: "x" }));
  const sess = I.sessionOf({
    url: "https://cs.openzoo.fun/?folder=/workspace",
    password: "p4ss",
    session_id: "ide_1",
  });
  assert.strictEqual(sess.id, "ide_1");
  assert.match(I.frameSrc(sess), /^https:\/\/cs\.openzoo\.fun\/\?/);
  assert.match(I.frameSrc(sess), /password=p4ss/);
  assert.strictEqual(I.frameSrc(null), "");
  assert.strictEqual(I.frameSrc({ url: "http://open.example" }), "");
}));

chain.push(check("run mode: agent vs chat; no key defaults chat", () => {
  assert.strictEqual(I.normalizeRunMode("agent"), "agent");
  assert.strictEqual(I.normalizeRunMode("auto"), "agent");
  assert.strictEqual(I.normalizeRunMode("chat"), "chat");
  assert.strictEqual(I.defaultRunMode(true), "agent");
  assert.strictEqual(I.defaultRunMode(false), "chat");
  assert.ok(I.isAgentMode({ runMode: "agent" }));
  assert.ok(!I.isAgentMode({ runMode: "chat" }));
}));

chain.push(check("GET/POST /ide/session send Bearer and load only the returned url", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: url, init: init });
    if (url.indexOf("/ide/session") !== -1 && (!init.method || init.method === "GET")) {
      return jsonRes(404, { error: "none" });
    }
    if (url.endsWith("/ide/session") && init.method === "POST") {
      return jsonRes(200, {
        ok: true,
        id: "ide_1",
        url: "https://cs.openzoo.fun/?folder=/workspace",
        password: "s3cret",
      });
    }
    return jsonRes(404, { error: "missing" });
  };
  const key = "oz_sub_live_key";
  const sess = await I.ensureSession({ key: key, threadId: "t-1", name: "New chat", fetchImpl: fetchImpl });
  assert.strictEqual(sess.id, "ide_1");
  assert.strictEqual(sess.url, "https://cs.openzoo.fun/?folder=/workspace");
  assert.strictEqual(sess.password, "s3cret");
  assert.match(I.frameSrc(sess), /cs\.openzoo\.fun/);
  assert.ok(calls.some((c) => c.url === "https://zoo.openzoo.fun/ide/session" && (!c.init.method || c.init.method === "GET")));
  assert.ok(calls.some((c) => c.url === "https://zoo.openzoo.fun/ide/session" && c.init.method === "POST"));
  calls.forEach(function (c) {
    assert.match(c.init.headers.authorization, /^Bearer oz_sub_live_key$/);
    assert.doesNotMatch(JSON.stringify(c.init.headers), /ANTHROPIC_API_KEY/);
    assert.match(c.url, /^https:\/\/zoo\.openzoo\.fun\/ide\/session/);
    assert.doesNotMatch(c.url, /\/occ\/|\/api\/occ|localhost|:8402/);
  });
  const got = await I.getSession({
    key: key,
    id: "ide_1",
    fetchImpl: async (url, init) => {
      assert.match(url, /\/ide\/session\?id=ide_1$/);
      assert.strictEqual(init.method, "GET");
      return jsonRes(200, { url: "https://cs.openzoo.fun/s/ide_1", id: "ide_1" });
    },
  });
  assert.strictEqual(got.id, "ide_1");
}));

chain.push(check("no key never hits the door", async () => {
  let hit = false;
  try {
    await I.createSession({
      key: "",
      fetchImpl: async () => { hit = true; return jsonRes(200, { url: "https://cs.openzoo.fun/" }); },
    });
    assert.fail("should refuse");
  } catch (e) {
    assert.strictEqual(e.name, "IdeAuthError");
  }
  assert.strictEqual(hit, false);
}));

chain.push(check("HTML 404/500 door is unavailable, not a fake local IDE", async () => {
  try {
    await I.createSession({
      key: "oz_sub_live_key",
      fetchImpl: async () => htmlRes(404),
    });
    assert.fail("should fail");
  } catch (e) {
    assert.strictEqual(e.name, "IdeDoorUnavailableError");
    assert.match(e.message, /Chat still works/);
    assert.doesNotMatch(e.message, /zoo\.openzoo\.fun|\/ide\/session|node-pty|:8402/);
  }
  try {
    await I.createSession({
      key: "oz_sub_live_key",
      fetchImpl: async () => htmlRes(500),
    });
    assert.fail("should fail");
  } catch (e) {
    assert.strictEqual(e.name, "IdeDoorUnavailableError");
  }
}));

chain.push(check("401/402 map to subscribe/restore, never x402", () => {
  const a = I.mapHttpError(401, { error: "no" }, "");
  const b = I.mapHttpError(402, { error: "pay" }, "");
  assert.strictEqual(a.name, "IdeAuthError");
  assert.match(b.message, /Restore your Google Play/);
  assert.doesNotMatch(a.message + b.message, /x402|Phantom|wallet|Stripe|MWA/);
}));

chain.push(check("ensureSession treats 401 as subscribe and does not POST", async () => {
  const calls = [];
  try {
    await I.ensureSession({
      key: "oz_sub_live_key",
      fetchImpl: async (url, init) => {
        calls.push(init.method || "GET");
        return { ok: false, status: 401, text: async () => "{\"error\":\"no\"}" };
      },
    });
    assert.fail("should fail");
  } catch (e) {
    assert.strictEqual(e.name, "IdeAuthError");
    assert.match(e.message, /Subscribe with Google Play/);
  }
  assert.deepStrictEqual(calls, ["GET"]);
}));

chain.push(check("shipped UI loads Agent webview from /ide/session; Chat unchanged", () => {
  const html = read("www/app/index.html");
  const app = read("www/app/js/app.js");
  const ide = read("www/app/js/ide.js");
  const rails = read("www/app/js/rails.js");
  const pay = read("www/app/js/pay.js");
  const joined = html + app + ide + rails + pay;
  assert.match(html, /js\/ide\.js/);
  assert.match(html, /id="modeToggle"/);
  assert.match(html, /id="modeChat"/);
  assert.match(html, /id="modeAgent"/);
  assert.match(html, />Chat</);
  assert.match(html, />Agent</);
  assert.match(html, /id="agentFrame"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /frame-src 'self' https:/);
  assert.match(app, /OpenZooIde/);
  assert.match(app, /function startNewChat\(\) \{ newThread\(\); \}/);
  assert.match(app, /openAgentIde/);
  assert.match(app, /loadAgentFrame/);
  assert.match(app, /I\.ensureSession/);
  assert.match(app, /I\.frameSrc/);
  assert.doesNotMatch(app, /ensureOccSession|agentSend|uploadAgentItems|OpenZooOcc/);
  assert.doesNotMatch(html, /\/api\/occ|node-pty|:8402|ANTHROPIC_API_KEY/);
  assert.doesNotMatch(app, /ANTHROPIC_API_KEY|node-pty|pty\.spawn|localhost:8402/);
  assert.doesNotMatch(ide, /ANTHROPIC_API_KEY\s*[:=]/);
  assert.doesNotMatch(ide, /\/occ\/sessions/);
  assert.doesNotMatch(joined, /checkout\.stripe\.com|walletPayEnabled|X-PAYMENT|CONNECT PHANTOM|MWA\./);
}));

chain.push(check("Play IAP still entitles the key; store path is not x402 or MWA", () => {
  const shell = read("www/index.html");
  const billing = read("www/js/billing.js");
  const ide = read("www/app/js/ide.js");
  const app = read("www/app/js/app.js");
  const handoff = read("HANDOFF_OPENZOO_ANDROID.md");
  const readme = read("README.md");
  const cfg = read("config.xml");
  assert.match(shell, /play-paywall/);
  assert.match(billing, /exchangePlayPurchase/);
  assert.match(handoff, /\/ide\/session/);
  assert.match(readme, /\/ide\/session/);
  assert.match(handoff, /code-server \+ Cline/);
  assert.match(readme, /code-server \+ Cline/);
  assert.match(handoff, /Authorization: Bearer/);
  assert.match(readme, /IAP-only|Play Billing/);
  assert.match(cfg, /<content\s+src="index\.html"/);
  assert.match(cfg, /allow-navigation href="https:\/\/\*\/\*"/);
  assert.doesNotMatch(shell, /\/api\/billing\/checkout|checkout\.stripe\.com/);
  assert.doesNotMatch(ide + app, /\/api\/billing\/checkout|checkout\.stripe\.com|X-PAYMENT|walletPayEnabled|connectMWA/);
  assert.doesNotMatch(handoff + readme, /jarettrsdunn1999@gmail\.com/);
  assert.doesNotMatch(handoff + readme, /adb install|cordova run android/);
}));

Promise.all(chain).then(function () {
  console.log("\n" + passed + " checks passed");
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
