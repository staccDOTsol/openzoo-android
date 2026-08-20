/**
 * First-X-of-Y model race for the Android grokui chat UI.
 *
 * Policy (locked): first X countable back of Y, default first 2 of 4.
 * Cheap classifier among those X. If none clear, last of those X.
 * Empty / HTTP / pay / fetch-failed are not countable. All-fail never ships
 * a single model's fetch-failed as the winner. Do not wait on the slowest.
 *
 * This is the phone race, not spill, and not a local-agent desktop port.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooRace = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RACE_MAX = 4;
  var RACE_MIN_SCORE = 6;
  var DEFAULT_NEED = 2;
  var DEFAULT_N = 4;
  var JUDGE_MODEL = "deepseek/deepseek-v4-flash";
  var RACE_EVERY_FAILED = "(race: every model failed — no reply)";

  var TIERS = {
    cheap: [
      "deepseek/deepseek-v4-flash",
      "meta-llama/llama-4-scout",
      "z-ai/glm-4.7-flash",
      "bytedance-seed/seed-2.0-mini",
      "meta-llama/llama-4-maverick",
      "z-ai/glm-4.5-air",
      "minimax/minimax-m2.5",
      "z-ai/glm-4.6v",
      "minimax/minimax-m2",
      "inclusionai/ling-3.0-flash",
    ],
    medium: [
      "deepseek/deepseek-v4-pro-0813",
      "z-ai/glm-4.7",
      "google/gemini-3.7-flash",
      "x-ai/grok-4.3",
      "moonshotai/kimi-k2.7-code",
      "z-ai/glm-5",
      "moonshotai/kimi-k2.6",
      "mistralai/mistral-large-2512",
      "bytedance-seed/seed-2.0-code",
      "qwen/qwen3.8-27b",
    ],
    expensive: [
      "anthropic/claude-opus-5",
      "openai/gpt-5.5",
      "anthropic/claude-sonnet-5",
      "x-ai/grok-4.6",
      "moonshotai/kimi-k3",
      "anthropic/claude-opus-4.8",
      "openai/gpt-5.4",
      "qwen/qwen3.8-max",
      "x-ai/grok-4.5",
    ],
    "grok4.6": [
      "x-ai/grok-4.6",
      "x-ai/grok-4.5",
      "x-ai/grok-4.3",
      "x-ai/grok-4.20",
    ],
  };

  var TIER_NAMES = Object.keys(TIERS);
  var catalogIds = null;

  var RACE_HTTP_NOTE = /^\((?:upstream error|request failed|payment failed|rate limited|stream timed out|stream stalled)/i;
  var RACE_MODEL_FAILED = /^\([^)]+ (?:failed:|returned nothing)/i;
  var RACE_FETCH_FAILED = /^(?:typeerror:\s*)?fetch failed$/i;

  function setCatalog(ids) {
    catalogIds = Array.isArray(ids) ? ids.filter(Boolean) : null;
    return catalogIds;
  }

  function getCatalog() {
    return catalogIds;
  }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /**
   * Models a tier resolves to right now. Race samples at random without
   * replacement so a band is a hedge, not the same top-N every turn.
   */
  function tierModels(tier, n, random, ids) {
    var want = TIERS[tier] || TIERS.medium;
    var served = ids || catalogIds;
    var live = served
      ? want.filter(function (m) { return served.indexOf(m) !== -1; })
      : want;
    var pool = live.length ? live : want;
    var take = Math.max(1, Math.min(Number(n) || 1, pool.length, RACE_MAX));
    if (!random) return pool.slice(0, take);
    return shuffle(pool).slice(0, take);
  }

  function parseRaceDial(value) {
    if (value == null || value === "") {
      return { k: DEFAULT_NEED, n: DEFAULT_N };
    }
    var raw = String(value).trim();
    if (raw === "0" || raw === "1" || raw.toLowerCase() === "off") {
      return { k: 1, n: 0 };
    }
    var parts = raw.split(/\s+/);
    var a = Number(parts[0]);
    var b = Number(parts[1]);
    if (parts.length >= 2 && a >= 1 && b >= 2) {
      var n = Math.min(Math.max(Math.floor(b), 2), RACE_MAX);
      var k = Math.min(Math.max(Math.floor(a), 1), n);
      return { k: k, n: n };
    }
    if (a >= 2) return { k: 1, n: Math.min(Math.floor(a), RACE_MAX) };
    return { k: DEFAULT_NEED, n: DEFAULT_N };
  }

  function formatRaceDial(spec) {
    spec = spec || {};
    var n = Number(spec.n) || 0;
    var k = Number(spec.k) || 1;
    if (n < 2) return "0";
    if (k > 1) return k + " " + n;
    return String(n);
  }

  function formatRaceStatus(back, need) {
    var n = Math.max(1, Number(need) || 1);
    var b = Math.min(n, Math.max(0, Number(back) || 0));
    return "racing " + b + "/" + n + " back…";
  }

  function isRaceCountable(textOrArrival) {
    var arrival = textOrArrival && typeof textOrArrival === "object" && !Array.isArray(textOrArrival)
      ? textOrArrival
      : { text: textOrArrival };
    if (arrival.error) return false;
    var s = String(arrival.text || "").trim();
    if (!s) return false;
    if (RACE_FETCH_FAILED.test(s)) return false;
    if (RACE_HTTP_NOTE.test(s)) return false;
    if (RACE_MODEL_FAILED.test(s)) return false;
    return true;
  }

  function raceLastShip(arrivals) {
    var list = Array.isArray(arrivals) ? arrivals : [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (isRaceCountable(list[i])) {
        return { model: list[i].model || "", text: String(list[i].text), error: false };
      }
    }
    return { model: "", text: RACE_EVERY_FAILED, error: true };
  }

  function raceFailKind(arrival) {
    var err = String((arrival && arrival.error) || "");
    var text = String((arrival && arrival.text) || "").trim();
    var s = (err + " " + text).trim();
    if (!s) return "empty body";
    if (/timeout|STREAM_IDLE|aborted|AbortError/i.test(s)) return "timeout";
    if (/402|payment failed|SubscriptionRequired/i.test(s)) return "pay";
    if (/fetch failed/i.test(s)) return "fetch failed";
    var http = /HTTP\s+(\d{3})/i.exec(s);
    if (http) return "HTTP " + http[1];
    if (err) return "error";
    if (!isRaceCountable(arrival)) return "empty body";
    return "ok";
  }

  function summarizeRaceFailures(arrivals) {
    var counts = {};
    (Array.isArray(arrivals) ? arrivals : []).forEach(function (a) {
      var k = raceFailKind(a);
      if (k === "ok") return;
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }

  function shouldRetryRaceArrival(arrival) {
    if (isRaceCountable(arrival)) return false;
    var k = raceFailKind(arrival);
    return k === "fetch failed" || k === "timeout" || k === "empty body"
      || k === "error" || /^HTTP 5/.test(k) || k === "HTTP 000";
  }

  function parseClassifyScore(text) {
    var s = String(text || "");
    var tagged = /SCORE\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(s);
    var lone = tagged || /\b(10|[0-9])(?:\s*\/\s*10)?\b/.exec(s);
    if (!lone) return 0;
    var n = Number(lone[1]);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10, n));
  }

  function pickRaceWinner(cands, minScore) {
    if (minScore == null) minScore = RACE_MIN_SCORE;
    var list = Array.isArray(cands) ? cands.filter(Boolean) : [];
    if (!list.length) return { winner: null, reason: "empty", tied: [] };
    var passing = list.filter(function (c) { return (Number(c.score) || 0) >= minScore; });
    if (!passing.length) {
      return { winner: list[list.length - 1], reason: "fallback-last", tied: [] };
    }
    var max = -Infinity;
    passing.forEach(function (c) {
      var sc = Number(c.score) || 0;
      if (sc > max) max = sc;
    });
    var tied = passing.filter(function (c) { return (Number(c.score) || 0) === max; });
    if (tied.length === 1) return { winner: tied[0], reason: "score", tied: tied };
    return { winner: null, reason: "tie", tied: tied };
  }

  function createRaceFeed(onDelta, onStatus, need) {
    var live = null;
    var settled = false;
    var back = 0;
    var buf = {};
    var dead = {};
    function paintStatus() {
      if (typeof onStatus === "function") onStatus(formatRaceStatus(back, need));
    }
    return {
      start: function () { paintStatus(); },
      liveModel: function () { return live; },
      onToken: function (model, chunk) {
        if (settled || chunk == null || chunk === "") return;
        buf[model] = (buf[model] || "") + chunk;
        if (!live) {
          live = model;
          if (typeof onDelta === "function") onDelta(chunk, { model: model });
          return;
        }
        if (live === model && typeof onDelta === "function") onDelta(chunk, { model: model });
      },
      onFail: function (model) {
        dead[model] = true;
        if (settled || live !== model) return;
        var next = null;
        Object.keys(buf).some(function (m) {
          if (m !== model && buf[m] && !dead[m]) { next = m; return true; }
          return false;
        });
        if (next) {
          live = next;
          if (typeof onDelta === "function") onDelta(buf[next], { replace: true, model: live });
        } else {
          live = null;
        }
      },
      onBack: function () {
        if (settled || back >= need) return;
        back += 1;
        paintStatus();
      },
      settle: function (winner) {
        settled = true;
        var text = String((winner && winner.text) || "").trim()
          ? winner.text
          : RACE_EVERY_FAILED;
        if (winner && winner.model && live === winner.model && !winner.error) return;
        live = (winner && winner.model) || live;
        if (typeof onDelta === "function") onDelta(text, { replace: true, model: winner && winner.model });
      },
    };
  }

  function completionText(json) {
    if (!json || typeof json !== "object") return "";
    var ch = json.choices && json.choices[0];
    var content = ch && ch.message && ch.message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map(function (b) {
        if (typeof b === "string") return b;
        if (b && typeof b.text === "string") return b.text;
        return "";
      }).join("");
    }
    return content == null ? "" : String(content);
  }

  function raceQuestion(messages) {
    if (!Array.isArray(messages)) return "(see candidates)";
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === "user") {
        var c = messages[i].content;
        return typeof c === "string" ? c : "(see candidates)";
      }
    }
    return "(see candidates)";
  }

  function classifyPrompt(messages, cand) {
    return "Score this answer to one question from 0 to 10.\n\n"
      + "QUESTION:\n" + String(raceQuestion(messages)).slice(0, 4000) + "\n\n"
      + "ANSWER:\n" + String((cand && cand.text) || "").slice(0, 6000) + "\n\n"
      + "Judge on: correctness first, then completeness, then whether it actually did what was asked. "
      + "Ignore length and confidence of tone.\n"
      + "Reply with exactly: SCORE <n>";
  }

  function pairwisePrompt(messages, tied) {
    var letters = tied.map(function (_, i) { return String.fromCharCode(65 + i); });
    return "You are judging answers to one question. Pick the single best one.\n\n"
      + "QUESTION:\n" + String(raceQuestion(messages)).slice(0, 4000) + "\n\n"
      + tied.map(function (c, i) {
        return "ANSWER " + letters[i] + ":\n" + String(c.text || "").slice(0, 6000);
      }).join("\n\n")
      + "\n\nJudge on: correctness first, then completeness, then whether it actually did what was asked. "
      + "Ignore length and confidence of tone.\n"
      + "Reply with ONE letter and nothing else: " + letters.join(" or ") + ".";
  }

  function parsePairwise(verdict, tied) {
    var hit = String(verdict || "").toUpperCase().split("").filter(function (ch) {
      var n = ch.charCodeAt(0) - 65;
      return n >= 0 && n < tied.length;
    })[0];
    if (hit) return tied[hit.charCodeAt(0) - 65];
    return tied[tied.length - 1];
  }

  function isFatalRaceError(err) {
    var name = err && err.name;
    return name === "SubscriptionRequiredError" || name === "ContextNotFoundError";
  }

  /**
   * Launch N models, judge the first X countable answers, ship a winner.
   * hooks.run(model, onDelta, signal) -> text | { text, error, ... }
   * Optional hooks.stream matches desktop brainRace tests.
   */
  function runRace(opts) {
    opts = opts || {};
    var hooks = opts.hooks || opts;
    var messages = opts.messages || [];
    var list = (opts.models || []).filter(Boolean).slice(0, RACE_MAX);
    var want = Math.max(1, Math.min(Number(opts.need) || DEFAULT_NEED, list.length));
    var minScore = hooks.minScore != null ? Number(hooks.minScore) : RACE_MIN_SCORE;
    var onDelta = opts.onDelta || hooks.onDelta;
    var onStatus = opts.onStatus || hooks.onStatus;

    function asArrival(model, value) {
      if (value && typeof value === "object" && !Array.isArray(value) && ("text" in value || value.error)) {
        return {
          model: model,
          text: value.text == null ? "" : String(value.text),
          error: value.error || null,
          receipt: value.receipt,
          json: value.json,
        };
      }
      return { model: model, text: value == null ? "" : String(value) };
    }

    function invoke(model, onTok, signal) {
      if (typeof hooks.stream === "function") {
        return Promise.resolve(hooks.stream(messages, onTok, null, model)).then(function (text) {
          return asArrival(model, text);
        });
      }
      if (typeof hooks.run !== "function") {
        return Promise.reject(new Error("race run hook missing"));
      }
      return Promise.resolve(hooks.run(model, onTok, signal)).then(function (value) {
        return asArrival(model, value);
      });
    }

    function classifyOne(cand) {
      if (typeof hooks.classify === "function") {
        return Promise.resolve(hooks.classify(messages, cand)).then(function (n) {
          return Number(n) || 0;
        });
      }
      if (typeof hooks.complete !== "function") return Promise.resolve(0);
      return Promise.resolve(hooks.complete(JUDGE_MODEL, [
        { role: "user", content: classifyPrompt(messages, cand) },
      ], 24)).then(function (text) {
        return parseClassifyScore(text);
      }).catch(function () { return 0; });
    }

    function pairwise(tied) {
      if (typeof hooks.pairwise === "function") {
        return Promise.resolve(hooks.pairwise(messages, tied));
      }
      if (typeof hooks.complete !== "function") return Promise.resolve(tied[tied.length - 1]);
      return Promise.resolve(hooks.complete(JUDGE_MODEL, [
        { role: "user", content: pairwisePrompt(messages, tied) },
      ], 8)).then(function (text) {
        return parsePairwise(text, tied);
      }).catch(function () { return tied[tied.length - 1]; });
    }

    if (list.length < 2) {
      var only = list[0];
      if (!only) {
        return Promise.resolve({ model: "", text: RACE_EVERY_FAILED, error: true });
      }
      return invoke(only, function (chunk) {
        if (typeof onDelta === "function") onDelta(chunk, { model: only });
      }, null).then(function (arr) {
        if (!isRaceCountable(arr)) return raceLastShip([arr]);
        return arr;
      });
    }

    var feed = createRaceFeed(onDelta, onStatus, want);
    feed.start();

    var done = [];
    var arrivals = [];
    var finished = 0;
    var release;
    var enough = new Promise(function (r) { release = r; });
    var raceAbort = new AbortController();
    var fatal = null;

    function ship(cand) {
      var out = cand && String(cand.text || "").trim() ? cand : raceLastShip(arrivals);
      feed.settle(out);
      try { raceAbort.abort(); } catch (e) { /* already */ }
      if (typeof hooks.onArrivals === "function") {
        try { hooks.onArrivals(arrivals); } catch (e2) { /* diagnostic */ }
      }
      return out;
    }

    function runOne(m) {
      var last = { model: m, text: "", error: "empty body" };
      function attempt(n) {
        if (raceAbort.signal.aborted && n > 0) return Promise.resolve();
        return invoke(m, function (chunk) { feed.onToken(m, chunk); }, raceAbort.signal)
          .then(function (arr) {
            last = arr;
            if (isRaceCountable(last)) {
              arrivals.push(last);
              done.push(last);
              feed.onBack();
              return;
            }
            if (!shouldRetryRaceArrival(last) || n >= 1 || raceAbort.signal.aborted) {
              arrivals.push(last);
              feed.onFail(m);
              return;
            }
            return attempt(n + 1);
          })
          .catch(function (e) {
            if (isFatalRaceError(e)) {
              fatal = e;
              last = { model: m, text: "", error: (e && e.message) || "error" };
              arrivals.push(last);
              feed.onFail(m);
              try { release(); } catch (e3) { /* already */ }
              return;
            }
            last = { model: m, text: "", error: (e && e.message) || "error" };
            if (!shouldRetryRaceArrival(last) || n >= 1 || raceAbort.signal.aborted) {
              arrivals.push(last);
              feed.onFail(m);
              return;
            }
            return attempt(n + 1);
          });
      }
      return attempt(0);
    }

    var attempts = list.map(function (m) {
      return runOne(m).then(function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      }, function () {
        finished += 1;
        if (done.length >= want || finished === list.length) release();
      });
    });
    attempts.forEach(function (p) { p.catch(function () {}); });

    return enough.then(function () {
      if (fatal) throw fatal;
      var cands = done.slice(0, want);
      if (!cands.length) return ship(raceLastShip(arrivals));
      if (cands.length === 1) return ship(cands[0]);
      if (typeof onStatus === "function") onStatus("judging…");
      return Promise.all(cands.map(function (c) {
        return classifyOne(c).then(function (score) {
          var copy = {};
          Object.keys(c).forEach(function (k) { copy[k] = c[k]; });
          copy.score = score;
          return copy;
        });
      })).then(function (scored) {
        var picked = pickRaceWinner(scored, minScore);
        if (picked.reason === "tie" && picked.tied && picked.tied.length > 1) {
          return pairwise(picked.tied).then(function (broken) {
            var usable = broken && String(broken.text || "").trim();
            var winner = usable ? broken : picked.tied[picked.tied.length - 1];
            return ship(winner || scored[scored.length - 1] || raceLastShip(arrivals));
          });
        }
        return ship(picked.winner || scored[scored.length - 1] || raceLastShip(arrivals));
      });
    });
  }

  /**
   * Desktop-shaped wrapper so the locked brainRace tests port 1:1.
   * (messages, onDelta, ctx, models, need, maxTokens, onStatus, hooks)
   */
  function brainRace(messages, onDelta, _ctx, models, need, _maxTokens, onStatus, hooks) {
    hooks = hooks || {};
    return runRace({
      messages: messages,
      models: models,
      need: need,
      onDelta: onDelta,
      onStatus: onStatus,
      hooks: hooks,
    }).then(function (out) {
      return out && out.text != null ? out.text : RACE_EVERY_FAILED;
    });
  }

  return {
    RACE_MAX: RACE_MAX,
    RACE_MIN_SCORE: RACE_MIN_SCORE,
    DEFAULT_NEED: DEFAULT_NEED,
    DEFAULT_N: DEFAULT_N,
    JUDGE_MODEL: JUDGE_MODEL,
    RACE_EVERY_FAILED: RACE_EVERY_FAILED,
    TIERS: TIERS,
    TIER_NAMES: TIER_NAMES,
    setCatalog: setCatalog,
    getCatalog: getCatalog,
    tierModels: tierModels,
    parseRaceDial: parseRaceDial,
    formatRaceDial: formatRaceDial,
    formatRaceStatus: formatRaceStatus,
    isRaceCountable: isRaceCountable,
    raceLastShip: raceLastShip,
    raceFailKind: raceFailKind,
    summarizeRaceFailures: summarizeRaceFailures,
    shouldRetryRaceArrival: shouldRetryRaceArrival,
    parseClassifyScore: parseClassifyScore,
    pickRaceWinner: pickRaceWinner,
    createRaceFeed: createRaceFeed,
    completionText: completionText,
    classifyPrompt: classifyPrompt,
    pairwisePrompt: pairwisePrompt,
    parsePairwise: parsePairwise,
    runRace: runRace,
    brainRace: brainRace,
  };
});
