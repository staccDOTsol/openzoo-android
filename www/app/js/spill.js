/**
 * Chat-history spill — same contract as `npx openzoo claude`.
 *
 * Bind the old transcript prefix once (append the delta later). Subsequent
 * turns send system + last few messages + x-hrr-context. Never send that
 * header together with the full messages array — that skip is what dumped
 * 850k-char threads in grokui.
 *
 * Spill/bind is for chat history (and the already-abstract file attach) only.
 * Phone chat has no agent directives and no local-file harvest.
 *
 * HUD savings is directUsd / spentUsd. Never sum savesVsDirect.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooSpill = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEEP_TAIL = 3;
  var MIN_TURNS = 2;
  var MIN_MSGS_TO_CUT = 4;

  function messageText(m) {
    if (!m) return "";
    var c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c.map(function (b) {
        if (typeof b === "string") return b;
        if (b && typeof b.text === "string") return b.text;
        return "";
      }).join("\n");
    }
    return c == null ? "" : String(c);
  }

  function wireMessage(m) {
    return { role: m.role, content: messageText(m) };
  }

  function firstSpillableIndex(msgs) {
    if (!Array.isArray(msgs)) return -1;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role !== "system") return i;
    }
    return -1;
  }

  function lastUserAskIndex(msgs, firstSpillable) {
    if (!Array.isArray(msgs)) return -1;
    for (var i = msgs.length - 1; i > firstSpillable; i--) {
      if (msgs[i] && msgs[i].role === "user" && messageText(msgs[i]).trim()) return i;
    }
    return -1;
  }

  function countRealTurns(msgs, from) {
    var n = 0;
    for (var i = from; i < msgs.length; i++) {
      var r = msgs[i] && msgs[i].role;
      if (r === "user" || r === "assistant") n += 1;
    }
    return n;
  }

  function isSeverable(msgs, i, firstSpillable) {
    if (i <= firstSpillable || i >= msgs.length) return false;
    var prev = msgs[i - 1];
    if (!prev) return false;
    if (prev.role === "assistant" && Array.isArray(prev.tool_calls) && prev.tool_calls.length) return false;
    return msgs[i].role !== "tool";
  }

  /**
   * Pick a severable cut: keep system + last few turns. The last user ask
   * always stays in the forwarded tail.
   */
  function cutTranscript(msgs, knobs) {
    knobs = knobs || {};
    var keepTail = Math.max(2, Number(knobs.keepTail) || KEEP_TAIL);
    var minTurns = Math.max(2, Number(knobs.minTurns) || MIN_TURNS);
    if (!Array.isArray(msgs) || !msgs.length) {
      return { cut: -1, firstSpillable: -1, lastUser: -1, keepTail: keepTail };
    }
    var firstSpillable = firstSpillableIndex(msgs);
    var lastUser = lastUserAskIndex(msgs, firstSpillable);
    if (firstSpillable < 0 || msgs.length < MIN_MSGS_TO_CUT) {
      return { cut: -1, firstSpillable: firstSpillable, lastUser: lastUser, keepTail: keepTail };
    }

    var cut = -1;
    var start = msgs.length - keepTail;
    for (var i = start; i > firstSpillable; i--) {
      if (isSeverable(msgs, i, firstSpillable)) { cut = i; break; }
    }
    if (cut <= firstSpillable) {
      return { cut: -1, firstSpillable: firstSpillable, lastUser: lastUser, keepTail: keepTail };
    }
    if (lastUser > firstSpillable && cut > lastUser) cut = lastUser;
    if (countRealTurns(msgs, cut) < minTurns) {
      for (var j = cut - 1; j > firstSpillable; j--) {
        if (isSeverable(msgs, j, firstSpillable) && countRealTurns(msgs, j) >= minTurns) {
          cut = j;
          break;
        }
      }
    }
    if (cut <= firstSpillable) {
      return { cut: -1, firstSpillable: firstSpillable, lastUser: lastUser, keepTail: keepTail };
    }
    return { cut: cut, firstSpillable: firstSpillable, lastUser: lastUser, keepTail: keepTail };
  }

  function prefixCorpus(msgs, firstSpillable, cut) {
    if (!Array.isArray(msgs) || cut <= firstSpillable) return "";
    var parts = [];
    for (var i = firstSpillable; i < cut && i < msgs.length; i++) {
      var m = msgs[i];
      var body = messageText(m).trim();
      if (!body) continue;
      parts.push((m.role || "?").toUpperCase() + ": " + body);
    }
    return parts.join("\n\n");
  }

  function prefixDelta(previous, next) {
    var prev = String(previous || "");
    var cur = String(next || "");
    if (prev && cur.startsWith(prev) && cur.length > prev.length) return cur.slice(prev.length);
    if (prev && cur === prev) return "";
    return cur;
  }

  function topKFor(askChars) {
    var n = Number(askChars) || 0;
    var budget = Math.min(3000, Math.max(1200, Math.round(n / 3)));
    return Math.max(4, Math.min(12, Math.round(budget / 320)));
  }

  function spillHeaders(contextId, extra) {
    extra = extra || {};
    if (!contextId) return {};
    var h = { "x-hrr-context": contextId };
    var topK = extra.topK != null ? extra.topK : topKFor(extra.askChars);
    if (topK) h["x-hrr-top-k"] = String(topK);
    if (extra.corpusChars) h["x-hrr-corpus-chars"] = String(extra.corpusChars);
    return h;
  }

  /**
   * Build the POST body + headers for one turn.
   *
   * If contextId is set, messages is ALWAYS system + tail — never the full
   * thread. If contextId is missing, the full array goes out with no header.
   */
  function chatRequest(opts) {
    opts = opts || {};
    var system = opts.system || "";
    var history = Array.isArray(opts.messages) ? opts.messages : [];
    var model = opts.model;
    var maxTokens = opts.maxTokens;
    var contextId = opts.contextId || null;
    var knobs = opts.knobs || {};

    var full = [{ role: "system", content: system }].concat(history.map(wireMessage));
    var plan = cutTranscript(full, knobs);
    var prefix = "";
    var forwarded;
    var headers = {};

    if (contextId) {
      var keep = Math.max(2, Number(knobs.keepTail) || KEEP_TAIL);
      var cut = plan.cut;
      if (cut <= plan.firstSpillable) {
        cut = Math.max(1, full.length - keep);
        if (plan.lastUser > 0 && cut > plan.lastUser) cut = plan.lastUser;
        if (cut <= 0) cut = 1;
      }
      prefix = prefixCorpus(full, plan.firstSpillable > 0 ? plan.firstSpillable : 1, cut);
      forwarded = [full[0]].concat(full.slice(cut));
      // Hard skip: never pair the header with a long full thread (grokui dump).
      if (forwarded.length >= full.length && full.length > keep + 1) {
        cut = Math.max(1, full.length - keep);
        prefix = prefixCorpus(full, 1, cut);
        forwarded = [full[0]].concat(full.slice(cut));
      }
      headers = spillHeaders(contextId, {
        askChars: messageText(full[full.length - 1]),
        corpusChars: opts.corpusChars || prefix.length,
        topK: opts.topK,
      });
    } else {
      if (plan.cut > plan.firstSpillable) {
        prefix = prefixCorpus(full, plan.firstSpillable, plan.cut);
      }
      forwarded = full;
    }

    return {
      payload: {
        model: model,
        messages: forwarded,
        max_tokens: maxTokens,
      },
      headers: headers,
      contextId: contextId,
      prefix: prefix,
      sent: forwarded.length,
      total: full.length,
      plan: plan,
      spilled: !!(contextId && forwarded.length < full.length),
    };
  }

  function receiptOf(json) {
    if (!json || typeof json !== "object") return {};
    if (json.x402 && typeof json.x402 === "object") return json.x402;
    if (json.billing && typeof json.billing === "object") return json.billing;
    return {};
  }

  function numberOrZero(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Accumulate spend + counterfactual. Ignores savesVsDirect on purpose —
   * summing that field is the grokui HUD lie.
   */
  function noteSpend(acc, receipt) {
    acc = acc || { spent: 0, direct: 0, calls: 0 };
    acc.spent = numberOrZero(acc.spent);
    acc.direct = numberOrZero(acc.direct);
    var r = receipt || {};
    var spent = r.billedUsd != null ? r.billedUsd : r.spentUsd;
    var direct = r.directUsd;
    if (typeof spent === "number" && Number.isFinite(spent)) acc.spent += spent;
    if (typeof direct === "number" && Number.isFinite(direct)) acc.direct += direct;
    acc.calls = (acc.calls || 0) + 1;
    return acc;
  }

  function hudSavingX(directUsd, spentUsd) {
    var spent = numberOrZero(spentUsd);
    var direct = Number(directUsd);
    if (!(spent > 0) || !Number.isFinite(direct)) return null;
    return direct / spent;
  }

  function hudLabel(acc) {
    acc = acc || {};
    var spent = numberOrZero(acc.spent);
    var direct = numberOrZero(acc.direct);
    var x = hudSavingX(direct, spent);
    var bits = ["this chat: $" + spent.toFixed(4)];
    if (x != null) {
      bits.push((x >= 100 ? String(Math.round(x)) : x.toFixed(1)) + "× vs direct");
    }
    if (acc.calls) bits.push(acc.calls + (acc.calls === 1 ? " call" : " calls"));
    return bits.join(" · ");
  }

  return {
    KEEP_TAIL: KEEP_TAIL,
    MIN_TURNS: MIN_TURNS,
    messageText: messageText,
    firstSpillableIndex: firstSpillableIndex,
    lastUserAskIndex: lastUserAskIndex,
    cutTranscript: cutTranscript,
    prefixCorpus: prefixCorpus,
    prefixDelta: prefixDelta,
    topKFor: topKFor,
    spillHeaders: spillHeaders,
    chatRequest: chatRequest,
    receiptOf: receiptOf,
    noteSpend: noteSpend,
    hudSavingX: hudSavingX,
    hudLabel: hudLabel,
  };
});
