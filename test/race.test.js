"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const C = require("../www/app/js/race.js");

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

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function scriptedStream(spec) {
  return async function stream(_messages, onDelta, _ctx, model) {
    const s = spec[model];
    if (!s) throw new Error("unexpected model " + model);
    if (s.err) {
      await sleep(s.at || 0);
      throw s.err;
    }
    const chunks = s.chunks || (s.text ? [s.text] : []);
    const start = Date.now();
    const tokenAt = s.tokenAt != null ? s.tokenAt : Math.max(0, (s.at || 0) - 20);
    await sleep(tokenAt);
    for (const c of chunks) onDelta(c);
    const left = Math.max(0, (s.at || 0) - (Date.now() - start));
    await sleep(left);
    return s.empty ? "" : (s.text ?? chunks.join(""));
  };
}

function checkSync() {
  check("default race dial is first 2 of 4", () => {
    assert.deepStrictEqual(C.parseRaceDial(), { k: 2, n: 4 });
    assert.deepStrictEqual(C.parseRaceDial(""), { k: 2, n: 4 });
    assert.deepStrictEqual(C.parseRaceDial("2 4"), { k: 2, n: 4 });
    assert.strictEqual(C.formatRaceDial({ k: 2, n: 4 }), "2 4");
    assert.strictEqual(C.formatRaceDial({ k: 1, n: 0 }), "0");
    assert.deepStrictEqual(C.parseRaceDial("0"), { k: 1, n: 0 });
    assert.deepStrictEqual(C.parseRaceDial("3"), { k: 1, n: 3 });
  });

  check("tiers include grok4.6 pool and the three price bands", () => {
    assert.deepStrictEqual(C.TIER_NAMES, ["cheap", "medium", "expensive", "grok4.6"]);
    assert.deepStrictEqual(C.TIERS["grok4.6"], [
      "x-ai/grok-4.6",
      "x-ai/grok-4.5",
      "x-ai/grok-4.3",
      "x-ai/grok-4.20",
    ]);
    assert.ok(C.TIERS.cheap.includes("deepseek/deepseek-v4-flash"));
    assert.ok(C.TIERS.medium.includes("google/gemini-3.7-flash"));
    assert.ok(C.TIERS.expensive.includes("x-ai/grok-4.6"));
    assert.strictEqual(C.JUDGE_MODEL, "deepseek/deepseek-v4-flash");
    assert.ok(!C.TIER_NAMES.includes("auto"));
    assert.ok(!Object.prototype.hasOwnProperty.call(C.TIERS, "auto"));
    assert.deepStrictEqual(C.tierModels("auto", 4, false), []);
  });

  check("tierModels samples without replacement from the live catalog", () => {
    const ids = ["x-ai/grok-4.6", "x-ai/grok-4.5", "missing-nope"];
    const got = C.tierModels("grok4.6", 4, false, ids);
    assert.deepStrictEqual(got, ["x-ai/grok-4.6", "x-ai/grok-4.5"]);
    const rand = C.tierModels("grok4.6", 2, true, [
      "x-ai/grok-4.6", "x-ai/grok-4.5", "x-ai/grok-4.3", "x-ai/grok-4.20",
    ]);
    assert.strictEqual(rand.length, 2);
    assert.strictEqual(new Set(rand).size, 2);
  });

  check("race status counts completions toward X, never launched-count", () => {
    assert.strictEqual(C.formatRaceStatus(0, 2), "racing 0/2 back…");
    assert.strictEqual(C.formatRaceStatus(1, 2), "racing 1/2 back…");
    assert.strictEqual(C.formatRaceStatus(2, 2), "racing 2/2 back…");
    assert.strictEqual(C.formatRaceStatus(4, 2), "racing 2/2 back…");
  });

  check("parseClassifyScore prefers SCORE n and stays in 0–10", () => {
    assert.strictEqual(C.parseClassifyScore("SCORE 8"), 8);
    assert.strictEqual(C.parseClassifyScore("SCORE: 3"), 3);
    assert.strictEqual(C.parseClassifyScore("7/10"), 7);
    assert.strictEqual(C.parseClassifyScore("no number here"), 0);
    assert.strictEqual(C.parseClassifyScore("SCORE 99"), 10);
  });

  check("pickRaceWinner: highest passing score wins; zero-pass ships last of X", () => {
    const a = { model: "fast", text: "weak", score: 3 };
    const b = { model: "better", text: "strong", score: 9 };
    assert.strictEqual(C.pickRaceWinner([a, b], 6).winner.model, "better");
    assert.strictEqual(C.pickRaceWinner([a, b], 6).reason, "score");
    const fb = C.pickRaceWinner([
      { model: "a", text: "first", score: 2 },
      { model: "b", text: "second", score: 4 },
    ], 6);
    assert.strictEqual(fb.reason, "fallback-last");
    assert.strictEqual(fb.winner.text, "second");
    const tie = C.pickRaceWinner([
      { model: "a", text: "A", score: 8 },
      { model: "b", text: "B", score: 8 },
    ], 6);
    assert.strictEqual(tie.reason, "tie");
    assert.strictEqual(tie.winner, null);
  });

  check("empty / HTTP / pay / fetch-failed are not countable", () => {
    assert.strictEqual(C.isRaceCountable(""), false);
    assert.strictEqual(C.isRaceCountable("fetch failed"), false);
    assert.strictEqual(C.isRaceCountable("TypeError: fetch failed"), false);
    assert.strictEqual(C.isRaceCountable("(upstream error — HTTP 502, try again)"), false);
    assert.strictEqual(C.isRaceCountable("(payment failed — HTTP 402 after 3 retries)"), false);
    assert.strictEqual(C.isRaceCountable("(mistral-large-2512 failed: fetch failed)"), false);
    assert.strictEqual(C.isRaceCountable({ text: "DONE: built it", error: "fetch failed" }), false);
    assert.strictEqual(C.isRaceCountable("DONE: built it"), true);
    assert.strictEqual(C.isRaceCountable("a real answer that mentions fetch failed in passing"), true);
  });

  check("all-fail ships a race-level error, never a model name", () => {
    assert.strictEqual(C.raceLastShip([]).text, C.RACE_EVERY_FAILED);
    const fail = C.raceLastShip([
      { model: "mistralai/mistral-large-2512", text: "", error: "fetch failed" },
      { model: "bytedance-seed/seed-2.0-code", text: "", error: "fetch failed" },
    ]);
    assert.strictEqual(fail.text, C.RACE_EVERY_FAILED);
    assert.doesNotMatch(fail.text, /mistral-large-2512|seed-2.0-code/);
    assert.strictEqual(C.raceLastShip([
      { model: "mistralai/mistral-large-2512", text: "", error: "fetch failed" },
      { model: "z-ai/glm-4.7", text: "the real one" },
    ]).text, "the real one");
  });

  check("fetch-failed / empty / 5xx retry; pay does not", () => {
    assert.strictEqual(C.shouldRetryRaceArrival({ text: "", error: "fetch failed" }), true);
    assert.strictEqual(C.shouldRetryRaceArrival({ text: "fetch failed" }), true);
    assert.strictEqual(C.shouldRetryRaceArrival({ text: "(payment failed — HTTP 402 after 3 retries)" }), false);
    assert.strictEqual(C.shouldRetryRaceArrival({ text: "DONE: ok" }), false);
  });

  check("createRaceFeed never paints racing 4/2 after settle", () => {
    const statuses = [];
    const feed = C.createRaceFeed(function () {}, function (s) { statuses.push(s); }, 2);
    feed.start();
    feed.onBack();
    feed.onBack();
    feed.settle({ model: "a", text: "done" });
    feed.onBack();
    feed.onBack();
    assert.deepStrictEqual(statuses, [
      "racing 0/2 back…",
      "racing 1/2 back…",
      "racing 2/2 back…",
    ]);
  });

  check("shipped chat has a race dial and live racing status, not desktop spawn", () => {
    const html = read("www/app/index.html");
    const app = read("www/app/js/app.js");
    const race = read("www/app/js/race.js");
    assert.match(html, /js\/race\.js/);
    assert.match(html, /id="raceSel"/);
    assert.match(html, /id="tierSel"/);
    assert.match(html, /value="2 4" selected/);
    assert.match(html, /value="auto" selected/);
    assert.match(html, /placeholder="Auto"/);
    assert.match(html, /value="grok4\.6"/);
    assert.match(app, /OpenZooRace/);
    assert.match(app, /raceTurn/);
    assert.match(app, /formatRaceStatus/);
    assert.match(app, /racing/);
    assert.match(race, /first X countable back of Y/);
    assert.doesNotMatch(race, /function spawn|PING:|childKickoff|worktree|podagent/);
    assert.doesNotMatch(app, /SPAWN|worktree|PING:|childKickoff|podagent/);
    assert.doesNotMatch(html + app + race, /walletPayEnabled|Connect Phantom|X-PAYMENT|showWrapPrompt/);
    assert.doesNotMatch(html + app + race, /sk-[A-Za-z0-9]|OPENZOO_TEST|jarettrsdunn1999@gmail\.com/);
  });
}

async function checkAsync() {
  await check("first two countable back are judged; a slow 3rd does not enter", async () => {
    const classified = [];
    let cStarted = false;
    const t0 = Date.now();
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      ["empty", "a", "b", "c"],
      2,
      undefined,
      function () {},
      {
        stream: async function (_m, onDelta, _ctx, model) {
          if (model === "empty") { await sleep(5); return ""; }
          if (model === "a") { await sleep(15); onDelta("first"); return "first"; }
          if (model === "b") { await sleep(30); onDelta("second"); return "second"; }
          cStarted = true;
          await sleep(250);
          onDelta("third");
          return "third-should-not-win";
        },
        classify: async function (_m, c) {
          classified.push(c.model);
          return c.model === "b" ? 9 : 8;
        },
      },
    );
    assert.deepStrictEqual(classified.slice().sort(), ["a", "b"]);
    assert.strictEqual(text, "second");
    assert.ok(cStarted, "the 3rd is still launched");
    assert.ok(Date.now() - t0 < 150, "must ship when X are in, not wait for N");
  });

  await check("status updates as racers finish: racing n/X back…", async () => {
    const statuses = [];
    await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      ["a", "b", "c"],
      2,
      undefined,
      function (s) { statuses.push(s); },
      {
        stream: scriptedStream({
          a: { text: "one", at: 15 },
          b: { text: "two", at: 35 },
          c: { text: "three", at: 200 },
        }),
        classify: async function (_m, c) { return c.model === "b" ? 9 : 7; },
      },
    );
    assert.ok(statuses.includes("racing 0/2 back…"));
    assert.ok(statuses.includes("racing 1/2 back…"));
    assert.ok(statuses.includes("racing 2/2 back…"));
    assert.strictEqual(statuses.filter(function (s) { return s === "racing 3/2 back…"; }).length, 0);
  });

  await check("a low-score first-back does not win just by being fast", async () => {
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      ["fast", "good"],
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          fast: { text: "meh", at: 10 },
          good: { text: "solid", at: 25 },
        }),
        classify: async function (_m, c) { return c.model === "fast" ? 2 : 9; },
      },
    );
    assert.strictEqual(text, "solid");
  });

  await check("zero-pass classifier still ships the last of the X", async () => {
    const classified = [];
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      ["a", "b", "c"],
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          a: { text: "first-back", at: 10 },
          b: { text: "last-of-x", at: 25 },
          c: { text: "late-high", at: 200 },
        }),
        classify: async function (_m, c) {
          classified.push(c.text);
          return 1;
        },
        minScore: 6,
      },
    );
    assert.deepStrictEqual(classified.slice().sort(), ["first-back", "last-of-x"]);
    assert.strictEqual(text, "last-of-x");
  });

  await check("fetch-failed racer is dropped; two real answers still classify", async () => {
    const classified = [];
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      [
        "mistralai/mistral-large-2512",
        "bytedance-seed/seed-2.0-code",
        "deepseek/deepseek-v4-pro-0813",
        "z-ai/glm-4.7",
      ],
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          "mistralai/mistral-large-2512": {
            err: Object.assign(new TypeError("fetch failed"), { name: "TypeError" }),
            at: 5,
          },
          "bytedance-seed/seed-2.0-code": { text: "real-seed-answer", at: 25 },
          "deepseek/deepseek-v4-pro-0813": { text: "real-deepseek-answer", at: 40 },
          "z-ai/glm-4.7": { text: "late-should-not-enter", at: 200 },
        }),
        classify: async function (_m, c) {
          classified.push(c.text);
          return c.text === "real-deepseek-answer" ? 9 : 7;
        },
      },
    );
    assert.strictEqual(text, "real-deepseek-answer");
    assert.doesNotMatch(text, /failed: fetch failed/);
    assert.deepStrictEqual(classified.slice().sort(), ["real-deepseek-answer", "real-seed-answer"]);
  });

  await check("resolved fetch-failed text is not countable toward X", async () => {
    const classified = [];
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      [
        "mistralai/mistral-large-2512",
        "bytedance-seed/seed-2.0-code",
        "deepseek/deepseek-v4-pro-0813",
        "z-ai/glm-4.7",
      ],
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          "mistralai/mistral-large-2512": { text: "fetch failed", at: 5 },
          "bytedance-seed/seed-2.0-code": { empty: true, text: "", at: 8 },
          "deepseek/deepseek-v4-pro-0813": { text: "ok-one", at: 25 },
          "z-ai/glm-4.7": { text: "ok-two", at: 40 },
        }),
        classify: async function (_m, c) {
          classified.push(c.text);
          return c.text === "ok-two" ? 9 : 7;
        },
      },
    );
    assert.strictEqual(text, "ok-two");
    assert.doesNotMatch(text, /fetch failed/);
    assert.deepStrictEqual(classified.slice().sort(), ["ok-one", "ok-two"]);
  });

  await check("every racer fetch-failed → race-level failure, not a model name", async () => {
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      [
        "mistralai/mistral-large-2512",
        "bytedance-seed/seed-2.0-code",
        "deepseek/deepseek-v4-pro-0813",
        "z-ai/glm-4.7",
      ],
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          "mistralai/mistral-large-2512": { err: new TypeError("fetch failed"), at: 4 },
          "bytedance-seed/seed-2.0-code": { err: new TypeError("fetch failed"), at: 8 },
          "deepseek/deepseek-v4-pro-0813": { err: new TypeError("fetch failed"), at: 12 },
          "z-ai/glm-4.7": { err: new TypeError("fetch failed"), at: 16 },
        }),
        classify: async function () { throw new Error("classify must not run when every racer failed"); },
      },
    );
    assert.strictEqual(text, C.RACE_EVERY_FAILED);
    assert.doesNotMatch(text, /mistral-large-2512|seed-2.0-code|deepseek|glm-4\.7/);
    assert.doesNotMatch(text, /failed: fetch failed/);
  });

  await check("empty/5xx do not count toward X", async () => {
    const classified = [];
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      ["boom", "blank", "real1", "real2"],
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          boom: { err: new Error("5xx"), at: 5 },
          blank: { empty: true, text: "", at: 8 },
          real1: { text: "ok-one", at: 20 },
          real2: { text: "ok-two", at: 35 },
        }),
        classify: async function (_m, c) {
          classified.push(c.text);
          return c.text === "ok-two" ? 9 : 7;
        },
      },
    );
    assert.deepStrictEqual(classified.slice().sort(), ["ok-one", "ok-two"]);
    assert.strictEqual(text, "ok-two");
  });

  await check("fetch-failed racer is retried once and can still fill X", async () => {
    const tries = {};
    const classified = [];
    const text = await C.brainRace(
      [{ role: "user", content: "q" }],
      function () {},
      null,
      ["flaky", "good"],
      2,
      undefined,
      function () {},
      {
        stream: async function (_messages, onDelta, _ctx, model) {
          tries[model] = (tries[model] || 0) + 1;
          if (model === "flaky" && tries[model] === 1) {
            await sleep(5);
            throw new TypeError("fetch failed");
          }
          await sleep(10);
          onDelta(model + "-ok");
          return model + "-ok";
        },
        classify: async function (_m, c) {
          classified.push(c.model);
          return c.model === "flaky" ? 9 : 7;
        },
      },
    );
    assert.strictEqual(tries.flaky, 2);
    assert.strictEqual(tries.good, 1);
    assert.strictEqual(text, "flaky-ok");
    assert.deepStrictEqual(classified.slice().sort(), ["flaky", "good"]);
  });

  await check("best-2-of-4 from a band: two real answers judged, failures do not win", async () => {
    const classified = [];
    const launched = [];
    const text = await C.brainRace(
      [{ role: "user", content: "what is 2+2?" }],
      function () {},
      null,
      C.TIERS["grok4.6"].slice(),
      2,
      undefined,
      function () {},
      {
        stream: scriptedStream({
          "x-ai/grok-4.6": { err: new TypeError("fetch failed"), at: 4 },
          "x-ai/grok-4.5": { text: "4 — two plus two is four.", at: 20 },
          "x-ai/grok-4.3": { text: "The sum is 4.", at: 35 },
          "x-ai/grok-4.20": { text: "late-should-not-enter", at: 200 },
        }),
        classify: async function (_m, c) {
          classified.push(c.model);
          launched.push(c.text);
          return c.model === "x-ai/grok-4.3" ? 9 : 7;
        },
      },
    );
    assert.strictEqual(classified.length, 2);
    assert.ok(classified.includes("x-ai/grok-4.5"));
    assert.ok(classified.includes("x-ai/grok-4.3"));
    assert.ok(!classified.includes("x-ai/grok-4.6"));
    assert.ok(!classified.includes("x-ai/grok-4.20"));
    assert.strictEqual(text, "The sum is 4.");
    assert.doesNotMatch(text, /fetch failed|grok-4\.6 failed/);
  });
}

checkSync();
checkAsync().then(function () {
  console.log("\n" + passed + " checks passed");
}).catch(function (e) {
  console.error("race test failed:", e && e.stack || e);
  process.exit(1);
});
