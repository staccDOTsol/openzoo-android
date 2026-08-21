"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const H = require("../www/js/agent-host.js");

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

const chain = [];

chain.push(check("host refuses non-https and has no ANTHROPIC_API_KEY", () => {
  assert.strictEqual(H.isHttpsUrl(""), false);
  assert.strictEqual(H.isHttpsUrl("http://zoo.openzoo.fun/ide"), false);
  assert.strictEqual(H.isHttpsUrl("https://cs.openzoo.fun/?folder=/workspace"), true);
  const src = read("www/js/agent-host.js");
  assert.doesNotMatch(src, /ANTHROPIC_API_KEY\s*[:=]/);
  assert.doesNotMatch(src, /checkout\.stripe\.com|X-PAYMENT|walletPayEnabled|MWA\./);
  assert.match(src, /InAppBrowser/);
  assert.match(src, /agentFrame/);
}));

chain.push(check("full-bleed #agentFrame + viewport-fit=cover; no nested composer", () => {
  const shell = read("www/index.html");
  const html = read("www/app/index.html");
  const app = read("www/app/js/app.js");
  assert.match(shell, /viewport-fit=cover/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(shell, /id="agentFrame"/);
  assert.match(html, /id="agentFrame"/);
  assert.match(shell, /#agentFrame\s*\{[^}]*position:\s*fixed/);
  assert.match(html, /#agentFrame\s*\{[^}]*position:\s*fixed/);
  assert.match(shell, /#agentFrame\s*\{[^}]*inset:\s*0/);
  assert.match(html, /#agentFrame\s*\{[^}]*inset:\s*0/);
  assert.match(shell + html, /100dvh/);
  assert.match(shell, /overscroll-behavior:\s*none/);
  assert.match(html, /overscroll-behavior:\s*none/);
  assert.match(html, /body\.agent-mode #bar[^{]*\{[^}]*display:\s*none/);
  assert.match(app, /openzoo-agent-open/);
  assert.match(app, /loadAgentFrame/);
  assert.doesNotMatch(app, /loadIdeFrame|ideFrame|idePane/);
  assert.doesNotMatch(html, /id="ideFrame"|id="idePane"/);
  assert.doesNotMatch(html, /body\.agent-mode #goalTip\s*\{\s*display:\s*block/);
}));

chain.push(check("paywall HTML still has no InAppBrowser string; IAP-only", () => {
  const shell = read("www/index.html");
  assert.doesNotMatch(shell, /InAppBrowser/);
  assert.match(shell, /js\/agent-host\.js/);
  assert.doesNotMatch(shell, /\/api\/billing\/checkout|checkout\.stripe\.com/);
  assert.match(read("www/js/agent-host.js"), /cordova\.InAppBrowser|InAppBrowser\.open/);
}));

Promise.all(chain).then(function () {
  console.log("\n" + passed + " checks passed");
}).catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
