"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const B = require("../www/app/js/bind.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok  " + name);
}

check("builds a corpus from attached files without exposing ids", () => {
  const corpus = B.corpusFromItems([
    { name: "notes.md", text: "hello zoo" },
    { name: "src/app.js", text: "console.log(1)" },
  ]);
  assert.match(corpus, /notes\.md/);
  assert.match(corpus, /hello zoo/);
  assert.match(corpus, /app\.js/);
  assert.doesNotMatch(corpus, /context_id|ctx_/);
});

check("strips HTML to readable text", () => {
  const t = B.stripHtml("<html><script>alert(1)</script><p>hi</p><div>there</div></html>");
  assert.match(t, /hi/);
  assert.match(t, /there/);
  assert.doesNotMatch(t, /script|alert/);
});

check("splits large text on paragraph boundaries", () => {
  const parts = B.splitIntoParts("aaa\n\nbbb\n\nccc", 8);
  assert.ok(parts.length >= 2);
  assert.ok(parts.join("").replace(/\n/g, "").length >= 9);
});

check("user-visible status never mentions bind or hashes", () => {
  assert.strictEqual(B.userVisibleStatus([{ name: "a.md" }], false), "attaching…");
  assert.strictEqual(B.userVisibleStatus([{ name: "a.md" }], true), "attached a.md");
  assert.strictEqual(B.userVisibleStatus([{ name: "a" }, { name: "b" }], true), "attached 2 files");
  const app = fs.readFileSync(path.join(__dirname, "../www/app/js/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../www/app/index.html"), "utf8");
  assert.doesNotMatch(B.userVisibleStatus([{ name: "a" }], true), /bind|context|hash|\/v1/);
  assert.doesNotMatch(html, />bind</i);
  assert.match(app, /B\.userVisibleStatus/);
});

console.log("\n" + passed + " checks passed");
