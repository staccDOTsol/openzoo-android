(function () {
  "use strict";

  var R = window.OpenZooRails;
  var P = window.OpenZooPay;
  var B = window.OpenZooBind;
  var S = window.OpenZooSpill;
  var C = window.OpenZooRace;
  var O = window.OpenZooOcc;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = "openzoo.android.grokui.v1";
  var PALETTE = ["#e91e8c", "#34c759", "#ff9500", "#5e5ce6", "#ff3b30", "#0a84ff", "#00c7be"];

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); }
    catch (e) { return {}; }
  }

  var saved = loadStore();
  var threads = (Array.isArray(saved.threads) ? saved.threads : []).map(function (t) {
    if (!t || typeof t !== "object") return t;
    if (t.boundPrefix == null) t.boundPrefix = "";
    if (typeof t.direct !== "number") t.direct = 0;
    if (!t.tier) t.tier = "medium";
    if (typeof t.race !== "number") t.race = C ? C.DEFAULT_N : 4;
    if (typeof t.raceNeed !== "number") t.raceNeed = C ? C.DEFAULT_NEED : 2;
    if (!t.runMode) t.runMode = "chat";
    if (!t.occSession) t.occSession = null;
    if (t.goalSet == null) t.goalSet = false;
    return t;
  });
  var activeId = saved.activeId || null;
  var busy = false;

  function persist() {
    localStorage.setItem(STORE, JSON.stringify({ threads: threads, activeId: activeId }));
  }

  function colorFor(name) {
    var h = 0;
    var s = String(name || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function initials(name) {
    return String(name || "OZ").slice(0, 2).toUpperCase();
  }

  function uid() {
    return "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function active() {
    for (var i = 0; i < threads.length; i++) if (threads[i].id === activeId) return threads[i];
    return null;
  }

  function ensureThread() {
    if (active()) return active();
    return newThread();
  }

  function newThread() {
    var t = {
      id: uid(),
      name: "New chat",
      color: colorFor("chat" + threads.length),
      messages: [],
      items: [],
      ctx: null,
      boundPrefix: "",
      corpus: "",
      model: $("model") ? $("model").value : "",
      tier: $("tierSel") ? $("tierSel").value : "medium",
      race: C ? C.parseRaceDial($("raceSel") && $("raceSel").value).n : 4,
      raceNeed: C ? C.parseRaceDial($("raceSel") && $("raceSel").value).k : 2,
      spent: 0,
      direct: 0,
      calls: 0,
      runMode: O ? O.defaultRunMode(hasOccKey()) : "chat",
      occSession: null,
      goalSet: false,
      updatedAt: Date.now(),
    };
    threads.unshift(t);
    activeId = t.id;
    persist();
    renderThreads();
    renderChat();
    return t;
  }

  function previewOf(t) {
    for (var i = (t.messages || []).length - 1; i >= 0; i--) {
      var m = t.messages[i];
      if (m && m.content) return String(m.content).replace(/\s+/g, " ").slice(0, 72);
    }
    if (t.items && t.items.length) return B.chipLabel(t.items);
    return "Say something";
  }

  function renderThreads() {
    var q = ($("search").value || "").trim().toLowerCase();
    var el = $("threads");
    el.innerHTML = "";
    var list = threads.filter(function (t) {
      if (!q) return true;
      return (t.name || "").toLowerCase().indexOf(q) !== -1 || previewOf(t).toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "tprev";
      empty.style.padding = "16px";
      empty.textContent = threads.length ? "No matches" : "New thread with +";
      el.appendChild(empty);
      return;
    }
    list.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "trow" + (t.id === activeId ? " active" : "");
      var av = document.createElement("div");
      av.className = "tavatar";
      av.style.background = t.color || colorFor(t.name);
      av.textContent = initials(t.name);
      var meta = document.createElement("div");
      meta.className = "tmeta";
      var name = document.createElement("div");
      name.className = "tname";
      name.textContent = t.name || "New chat";
      var prev = document.createElement("div");
      prev.className = "tprev";
      prev.textContent = previewOf(t);
      meta.appendChild(name);
      meta.appendChild(prev);
      var x = document.createElement("button");
      x.className = "tclose";
      x.type = "button";
      x.textContent = "×";
      x.onclick = function (e) {
        e.stopPropagation();
        threads = threads.filter(function (o) { return o.id !== t.id; });
        if (activeId === t.id) activeId = threads[0] ? threads[0].id : null;
        persist();
        if (!threads.length) newThread();
        else { renderThreads(); renderChat(); }
      };
      row.appendChild(av);
      row.appendChild(meta);
      row.appendChild(x);
      row.onclick = function () {
        activeId = t.id;
        persist();
        $("sidebar").classList.remove("open");
        $("scrim").classList.remove("show");
        renderThreads();
        renderChat();
      };
      el.appendChild(row);
    });
  }

  function bubble(text, mine, meta) {
    var row = document.createElement("div");
    row.className = "row " + (mine ? "user" : "bot");
    var wrap = document.createElement("div");
    var b = document.createElement("div");
    b.className = "bubble";
    b.textContent = text;
    wrap.appendChild(b);
    if (meta) {
      var m = document.createElement("div");
      m.className = "meta";
      m.textContent = meta;
      wrap.appendChild(m);
    }
    row.appendChild(wrap);
    $("log").appendChild(row);
    $("log").scrollTop = $("log").scrollHeight;
    return b;
  }

  function renderChat() {
    var t = active();
    $("log").innerHTML = "";
    $("headName").textContent = t ? (t.name || "openzoo") : "openzoo";
    $("headAv").textContent = initials(t ? t.name : "OZ");
    $("headAv").style.background = t ? (t.color || colorFor(t.name)) : "#5e5ce6";
    if (t && t.model) $("model").value = t.model;
    if (t && $("tierSel")) $("tierSel").value = t.tier || "medium";
    if (t && $("raceSel") && C) $("raceSel").value = C.formatRaceDial({ k: t.raceNeed, n: t.race });
    syncDials();
    renderHud();
    applyAgentMode(threadMode(t) === "agent");
    if (!t || !t.messages.length) {
      bubble(welcomeCopy(t), false);
    } else {
      t.messages.forEach(function (m) {
        bubble(m.content, m.role === "user", m.meta || "");
      });
    }
    renderAttachChips();
    refreshSend();
  }

  function renderAttachChips() {
    var t = active();
    var el = $("attachChips");
    el.innerHTML = "";
    ((t && t.items) || []).forEach(function (it, i) {
      var chip = document.createElement("span");
      chip.className = "achip";
      chip.innerHTML = "<span></span><span class=\"ax\">✕</span>";
      chip.querySelector("span").textContent = it.name || "note";
      chip.querySelector(".ax").onclick = function () {
        t.items.splice(i, 1);
        t.corpus = B.corpusFromItems(t.items);
        persist();
        renderAttachChips();
      };
      el.appendChild(chip);
    });
    $("statusLine").textContent = t ? B.userVisibleStatus(t.items, !!t.ctx || !t.items.length) : "";
  }

  function refreshSend() {
    var t = active();
    var has = !!($("inp").value.trim() || (t && t.items && t.items.length));
    $("send").classList.toggle("show", has);
  }

  function setStatus(msg) {
    $("statusLine").textContent = msg || "";
  }

  function planLabel() {
    var b = P.getBilling ? P.getBilling() : {};
    var plan = "Play subscription";
    if (b && b.tier) {
      plan = (b.tier.charAt(0).toUpperCase() + b.tier.slice(1)) + (b.key ? " · key ready" : " · waiting on Play key exchange");
    }
    var t = active();
    if (t && t.calls) return plan + "\n" + S.hudLabel(t);
    return plan;
  }

  function renderHud() {
    var el = $("hud");
    if (!el) return;
    var t = active();
    el.textContent = t && (t.calls || t.spent) ? S.hudLabel(t) : "";
  }

  function raceSpec() {
    return C ? C.parseRaceDial($("raceSel") && $("raceSel").value) : { k: 1, n: 0 };
  }

  function syncDials() {
    var spec = raceSpec();
    var racing = spec.n >= 2;
    if ($("model")) $("model").classList.toggle("hidden-dial", racing);
    if ($("tierSel")) {
      var tier = $("tierSel").value;
      $("tierSel").classList.toggle("hot", racing || tier === "expensive" || tier === "grok4.6");
    }
    if ($("raceSel")) $("raceSel").classList.toggle("hot", racing);
  }

  function paintAssistantMeta(el, rec, extra) {
    var bits = [];
    if (extra) bits.push(extra);
    if (rec) {
      if (typeof rec.billedUsd === "number") bits.push("$" + rec.billedUsd.toFixed(4));
      else if (typeof rec.spentUsd === "number") bits.push("$" + rec.spentUsd.toFixed(4));
      var x = S.hudSavingX(rec.directUsd, rec.billedUsd != null ? rec.billedUsd : rec.spentUsd);
      if (x != null) bits.push(x.toFixed(1) + "×");
    }
    var meta = bits.join(" · ");
    if (meta) {
      var m = document.createElement("div");
      m.className = "meta";
      m.textContent = meta;
      el.insertAdjacentElement("afterend", m);
    }
    return meta;
  }

  function assistantFromJson(d) {
    var content = C ? C.completionText(d) : "";
    if (!content) {
      var ch = d && d.choices && d.choices[0];
      if (ch && ch.finish_reason === "length") {
        content = "the model used its token budget on thinking and said nothing. try again.";
      } else {
        content = (d && d.error && d.error.message) || "unusual reply";
      }
    }
    return content;
  }

  function openSettings() {
    $("settingsOverlay").classList.add("show");
    $("planBody").textContent = planLabel();
  }

  function postBind(corpus, contextId, asTranscript) {
    var body = asTranscript
      ? R.transcriptBindPayload(corpus, contextId)
      : R.bindPayload(corpus, contextId);
    return fetch(R.GATEWAY + "/v1/hrr/bind", {
      method: "POST",
      headers: R.gatewayHeaders(),
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function bindParts(parts, ctx, asTranscript) {
    var i = 0;
    function next() {
      if (i >= parts.length) return ctx;
      var part = parts[i++];
      return postBind(part, ctx, asTranscript).then(function (d) {
        if (d && d.context_id) ctx = d.context_id;
        return next();
      });
    }
    return next();
  }

  function bindThread(t) {
    var corpus = B.corpusFromItems(t.items);
    t.corpus = corpus;
    if (!corpus.trim()) {
      persist();
      return Promise.resolve(t.ctx);
    }
    var parts = B.splitIntoParts(corpus);
    var ctx = t.ctx || null;
    setStatus(t.items.length === 1 ? "attaching…" : "attaching " + t.items.length + " files…");
    return bindParts(parts, ctx, false).then(function (id) {
      t.ctx = id;
      persist();
      setStatus(B.userVisibleStatus(t.items, true));
      return t.ctx;
    }).catch(function (e) {
      setStatus(R.looksNetworkGarbage(e) ? R.friendlyNetworkMessage() : ("could not attach: " + ((e && e.message) || e)));
      return t.ctx;
    });
  }

  function bindTranscriptPrefix(t, prefix, force) {
    var text = String(prefix || "").trim();
    if (!text) return Promise.resolve(t.ctx);
    var delta = force ? text : S.prefixDelta(t.boundPrefix, text);
    if (!delta.trim()) return Promise.resolve(t.ctx);
    var parts = B.splitIntoParts(delta);
    var ctx = t.ctx || null;
    var mustWait = !ctx;
    var job = bindParts(parts, ctx, true).then(function (id) {
      t.ctx = id;
      t.boundPrefix = text;
      persist();
      return t.ctx;
    }).catch(function () {
      return t.ctx;
    });
    // First bind must land before the header can ride. Later deltas are
    // history for the next turn — fire-and-forget like Claude CLI.
    return mustWait ? job : (job.then(function () {}), Promise.resolve(t.ctx));
  }

  function prepareChat(t, model, opts) {
    opts = opts || {};
    var files = (t.items && t.items.length && (opts.force || !t.ctx))
      ? bindThread(t)
      : Promise.resolve(t.ctx);
    return files.then(function () {
      var draft = S.chatRequest({
        system: R.SYSTEM_PROMPT,
        messages: t.messages,
        model: model,
        maxTokens: R.maxTokensFor(model),
        contextId: null,
      });
      var prefix = draft.prefix;
      var needPrefix = !!(prefix && (opts.force || prefix !== t.boundPrefix || !t.ctx));
      var bind = needPrefix ? bindTranscriptPrefix(t, prefix, opts.force) : Promise.resolve(t.ctx);
      return bind.then(function () {
        return S.chatRequest({
          system: R.SYSTEM_PROMPT,
          messages: t.messages,
          model: model,
          maxTokens: R.maxTokensFor(model),
          contextId: t.ctx,
          corpusChars: (t.boundPrefix || prefix || "").length,
        });
      });
    });
  }

  function addItems(files) {
    var t = ensureThread();
    if (O && threadMode(t) === "agent") return uploadAgentItems(t, files);
    var jobs = [];
    Array.prototype.forEach.call(files || [], function (f) {
      if (!B.looksText(f.name, f.type)) return;
      jobs.push(f.text().then(function (text) {
        t.items.push({ name: B.fileLabel(f.webkitRelativePath || f.name), text: text });
      }).catch(function () {}));
    });
    return Promise.all(jobs).then(function () {
      persist();
      renderAttachChips();
      refreshSend();
      return bindThread(t);
    });
  }

  function currentKey() {
    return R.getSubscriptionKey ? R.getSubscriptionKey() : null;
  }

  function hasOccKey() {
    return !!(O && O.isUsableKey(currentKey()));
  }

  function threadMode(t) {
    return O ? O.normalizeRunMode(t && t.runMode) : "chat";
  }

  function welcomeCopy(t) {
    if (threadMode(t) === "agent") {
      return "welcome — Agent is hosted OCC. send a message, /goal <job>, or attach files into the session folder. needs a Play subscription key. Chat is still one tap away.";
    }
    return "welcome — pick a band, race a few models if you want, attach notes, and say anything. this phone app cannot run, write, read, or serve local files. calls use your Play subscription key.";
  }

  function applyAgentMode(agent) {
    document.body.classList.toggle("agent-mode", !!agent);
    if ($("modeChat")) $("modeChat").className = "modebtn chat" + (!agent ? " on" : "");
    if ($("modeAgent")) $("modeAgent").className = "modebtn agent" + (agent ? " on" : "");
    if ($("modeToggle")) $("modeToggle").classList.toggle("locked", !hasOccKey());
    if ($("inp")) $("inp").placeholder = agent ? "Message or /goal …" : "Message";
  }

  function setThreadMode(mode) {
    var next = O ? O.normalizeRunMode(mode) : "chat";
    if (next === "agent" && !hasOccKey()) {
      setStatus("Subscribe with Google Play to use Agent.");
      next = "chat";
    }
    var t = ensureThread();
    t.runMode = next;
    persist();
    applyAgentMode(next === "agent");
    renderChat();
  }

  function ensureOccSession(t) {
    if (!hasOccKey()) return Promise.reject(new O.OccAuthError());
    if (t.occSession && t.occSession.id) return Promise.resolve(t.occSession);
    setStatus("starting Agent…");
    return O.createSession({
      key: currentKey(),
      threadId: t.id,
      model: t.model || ($("model") && $("model").value) || "",
    }).then(function (sess) {
      t.occSession = { id: sess.id };
      persist();
      setStatus("");
      return t.occSession;
    });
  }

  function paintOccStream(thinking) {
    var streamed = "";
    return {
      text: function () { return streamed; },
      onEvent: function (ev) {
        if (!ev) return;
        if (ev.type === "status" && ev.text) {
          setStatus(ev.text);
          return;
        }
        if (ev.type === "error") throw new Error(ev.error || "hosted Agent error");
        if (ev.text && (ev.type === "delta" || ev.type === "text")) {
          streamed += ev.text;
          thinking.textContent = streamed;
          $("log").scrollTop = $("log").scrollHeight;
        }
      },
    };
  }

  function agentSend(t, text, thinking) {
    if (!hasOccKey()) {
      thinking.textContent = "Subscribe with Google Play to use Agent.";
      return Promise.resolve();
    }
    var goal = O.goalFromMessage(text);
    if (goal === "") {
      thinking.textContent = "usage: /goal <job> — one slash. Agent keeps working until it's done.";
      t.messages.push({ role: "assistant", content: thinking.textContent });
      persist();
      return Promise.resolve();
    }
    var retried = false;
    function run(forceNew) {
      if (forceNew) t.occSession = null;
      return ensureOccSession(t).then(function (sess) {
        var stream = paintOccStream(thinking);
        var opts = { key: currentKey(), onEvent: stream.onEvent };
        var job = goal != null
          ? O.postGoal(sess.id, goal, opts)
          : O.postMessage(sess.id, text, opts);
        return job.then(function () {
          if (goal != null) t.goalSet = true;
          var content = stream.text() || (goal != null ? "goal set." : "(no Agent output)");
          thinking.textContent = content;
          t.messages.push({ role: "assistant", content: content });
          persist();
          setStatus("");
        });
      }).catch(function (e) {
        if (!retried && e && (e.name === "OccDoorUnavailableError" || e.status === 404)) {
          retried = true;
          t.occSession = null;
          persist();
          if (e.name === "OccDoorUnavailableError") throw e;
          return run(true);
        }
        throw e;
      });
    }
    return run(false).catch(function (e) {
      thinking.textContent = O.userVisibleOccError(e);
    });
  }

  function uploadAgentItems(t, files) {
    if (!hasOccKey()) {
      setStatus("Subscribe with Google Play to use Agent.");
      return Promise.resolve();
    }
    return ensureOccSession(t).then(function (sess) {
      var jobs = [];
      Array.prototype.forEach.call(files || [], function (f) {
        var name = B.fileLabel(f.webkitRelativePath || f.name);
        jobs.push(O.uploadFile(sess.id, {
          name: name,
          blob: f,
          relativePath: f.webkitRelativePath || name,
        }, { key: currentKey() }).then(function (up) {
          t.items.push({ name: up.name || name, uploaded: true });
        }));
      });
      return Promise.all(jobs);
    }).then(function () {
      persist();
      renderAttachChips();
      refreshSend();
      setStatus(t.items.length
        ? ("uploaded " + t.items.length + " file" + (t.items.length === 1 ? "" : "s") + " to Agent")
        : "");
    }).catch(function (e) {
      setStatus(O.userVisibleOccError(e));
    });
  }

  function uploadPastedNote(t, text) {
    if (!hasOccKey()) {
      setStatus("Subscribe with Google Play to use Agent.");
      return Promise.resolve();
    }
    return ensureOccSession(t).then(function (sess) {
      return O.uploadFile(sess.id, {
        name: "note.txt",
        text: text,
        relativePath: "note.txt",
      }, { key: currentKey() });
    }).then(function (up) {
      t.items.push({ name: up.name || "note.txt", uploaded: true });
      persist();
      renderAttachChips();
      refreshSend();
      setStatus("uploaded note.txt to Agent");
    }).catch(function (e) {
      setStatus(O.userVisibleOccError(e));
    });
  }

  function send() {
    var text = $("inp").value.trim();
    var t = ensureThread();
    if ((!text && !(t.items && t.items.length)) || busy) return;
    var modeCmd = /^\/mode\s+(chat|agent|auto|ask)\b/i.exec(text);
    if (modeCmd) {
      $("inp").value = "";
      refreshSend();
      setThreadMode(modeCmd[1]);
      return;
    }
    busy = true;
    $("inp").value = "";
    refreshSend();
    if (text) {
      if (t.name === "New chat") t.name = text.slice(0, 32);
      t.messages.push({ role: "user", content: text });
      bubble(text, true);
    } else {
      var label = "look at what I attached";
      t.messages.push({ role: "user", content: label });
      bubble(label, true);
    }
    t.updatedAt = Date.now();
    persist();
    renderThreads();
    var thinking = bubble("…", false);
    thinking.innerHTML = "<span class=\"dots\"><span></span><span></span><span></span></span>";

    if (O && threadMode(t) === "agent") {
      agentSend(t, text || "look at what I attached", thinking).then(function () {
        busy = false;
        renderThreads();
      });
      return;
    }

    var model = $("model").value || t.model || R.DEFAULT_MODEL;
    t.model = model;

    function runPaid(req, signal) {
      return P.paidFetch("/v1/chat/completions", {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.payload),
        signal: signal,
      });
    }

    function finishTurn(content, rec, extra) {
      thinking.textContent = content;
      var meta = paintAssistantMeta(thinking, rec, extra);
      t.messages.push({ role: "assistant", content: content, meta: meta });
      persist();
      renderHud();
      setStatus("");
    }

    function singleTurn(reqModel) {
      return prepareChat(t, reqModel).then(function (req) {
        return runPaid(req).catch(function (e) {
          if (e && e.name !== "ContextNotFoundError") throw e;
          t.ctx = null;
          t.boundPrefix = "";
          return prepareChat(t, reqModel, { force: true }).then(function (req2) {
            return runPaid(req2);
          });
        });
      }).then(function (r) { return r.json(); }).then(function (d) {
        S.noteSpend(t, S.receiptOf(d));
        finishTurn(assistantFromJson(d), S.receiptOf(d), "");
      });
    }

    function raceTurn(force) {
      var spec = raceSpec();
      var tier = ($("tierSel") && $("tierSel").value) || t.tier || "medium";
      t.tier = tier;
      t.race = spec.n;
      t.raceNeed = spec.k;
      var models = C.tierModels(tier, spec.n, true, C.getCatalog());
      var need = Math.min(spec.k, models.length);
      if (models.length < 2) {
        var fallback = models[0] || model;
        t.model = fallback;
        return singleTurn(fallback);
      }
      setStatus(C.formatRaceStatus(0, need));
      thinking.textContent = C.formatRaceStatus(0, need);

      function chatOnce(req, racer, signal) {
        var payload = Object.assign({}, req.payload, {
          model: racer,
          max_tokens: R.maxTokensFor(racer),
        });
        return P.paidFetch("/v1/chat/completions", {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(payload),
          signal: signal,
        }).then(function (r) { return r.json(); }).then(function (d) {
          S.noteSpend(t, S.receiptOf(d));
          return { text: C.completionText(d), receipt: S.receiptOf(d), json: d };
        });
      }

      return prepareChat(t, models[0], { force: force }).then(function (req) {
        return C.runRace({
          messages: t.messages,
          models: models,
          need: need,
          onStatus: function (s) {
            setStatus(s);
            if (!thinking.dataset.locked) thinking.textContent = s;
          },
          onDelta: function (text, meta) {
            thinking.dataset.locked = "1";
            if (meta && meta.replace) thinking.textContent = text;
            else {
              var cur = thinking.textContent || "";
              if (/^racing |^judging/.test(cur) || cur === "…") cur = "";
              thinking.textContent = cur + text;
            }
          },
          run: function (racer, onDelta, signal) {
            return chatOnce(req, racer, signal).then(function (arr) {
              if (arr.text) onDelta(arr.text);
              return arr;
            });
          },
          complete: function (judgeModel, msgs, maxTokens) {
            return P.paidFetch("/v1/chat/completions", {
              method: "POST",
              body: JSON.stringify({
                model: judgeModel,
                messages: msgs,
                max_tokens: maxTokens || 24,
              }),
            }).then(function (r) { return r.json(); }).then(function (d) {
              S.noteSpend(t, S.receiptOf(d));
              return C.completionText(d);
            });
          },
        });
      }).then(function (out) {
        var content = (out && out.text) || C.RACE_EVERY_FAILED;
        var extra = out && out.model
          ? ("race " + need + "/" + models.length + " · " + out.model)
          : ("race " + need + "/" + models.length);
        finishTurn(content, out && out.receipt, extra);
      });
    }

    var spec = raceSpec();
    var job = (C && spec.n >= 2)
      ? raceTurn(false).catch(function (e) {
        if (!e || e.name !== "ContextNotFoundError") throw e;
        t.ctx = null;
        t.boundPrefix = "";
        return raceTurn(true);
      })
      : singleTurn(model);

    job.catch(function (e) {
      if (e && e.name === "SubscriptionRequiredError") {
        thinking.textContent = e.message;
        return;
      }
      thinking.textContent = R.looksNetworkGarbage(e)
        ? R.friendlyNetworkMessage()
        : ("the zoo hiccuped: " + ((e && e.message) || e));
    }).then(function () {
      busy = false;
    });
  }

  function loadModels() {
    return fetch(R.GATEWAY + "/v1/models", { headers: R.gatewayHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var models = (d.data || []).filter(function (m) {
          return m.id && m.id.charAt(0) !== "~" && m.id.indexOf(":batch") === -1;
        });
        models.sort(function (a, b) { return a.id.localeCompare(b.id); });
        var dl = $("modelList");
        dl.innerHTML = "";
        models.forEach(function (m) {
          var o = document.createElement("option");
          o.value = m.id;
          dl.appendChild(o);
        });
        if (C) C.setCatalog(models.map(function (m) { return m.id; }));
        if (!$("model").value) $("model").value = R.defaultModelId(models);
      }).catch(function () {
        if (!$("model").value) $("model").value = R.DEFAULT_MODEL;
      });
  }

  function startNewChat() { newThread(); }
  if ($("newBtn")) $("newBtn").onclick = startNewChat;
  if ($("headerNewBtn")) $("headerNewBtn").onclick = startNewChat;
  if ($("sideNewBtn")) {
    $("sideNewBtn").onclick = function () {
      startNewChat();
      $("sidebar").classList.remove("open");
      $("scrim").classList.remove("show");
    };
  }
  $("menuBtn").onclick = function () {
    $("sidebar").classList.add("open");
    $("scrim").classList.add("show");
  };
  $("scrim").onclick = function () {
    $("sidebar").classList.remove("open");
    $("scrim").classList.remove("show");
  };
  $("search").addEventListener("input", renderThreads);
  $("plusBtn").onclick = function (e) {
    e.stopPropagation();
    $("plusMenu").classList.toggle("show");
  };
  document.addEventListener("click", function () { $("plusMenu").classList.remove("show"); });
  $("attachBtn").onclick = function (e) {
    e.stopPropagation();
    $("plusMenu").classList.remove("show");
    $("fileInp").click();
  };
  $("folderBtn").onclick = function (e) {
    e.stopPropagation();
    $("plusMenu").classList.remove("show");
    $("folderInp").click();
  };
  $("pasteBtn").onclick = function (e) {
    e.stopPropagation();
    $("plusMenu").classList.remove("show");
    $("pasteOverlay").classList.add("show");
    $("pasteBox").focus();
  };
  $("fileInp").addEventListener("change", function () {
    addItems($("fileInp").files);
    $("fileInp").value = "";
  });
  $("folderInp").addEventListener("change", function () {
    addItems($("folderInp").files);
    $("folderInp").value = "";
  });
  $("pasteSave").onclick = function () {
    var text = $("pasteBox").value;
    if (!text.trim()) return;
    var t = ensureThread();
    $("pasteBox").value = "";
    $("pasteOverlay").classList.remove("show");
    if (O && threadMode(t) === "agent") {
      uploadPastedNote(t, text);
      return;
    }
    t.items.push({ name: "note.txt", text: text });
    persist();
    renderAttachChips();
    refreshSend();
    bindThread(t);
  };
  $("pasteClose").onclick = function () { $("pasteOverlay").classList.remove("show"); };
  if ($("modeChat")) $("modeChat").onclick = function () { setThreadMode("chat"); };
  if ($("modeAgent")) $("modeAgent").onclick = function () { setThreadMode("agent"); };
  if ($("agentStop")) {
    $("agentStop").onclick = function () {
      var t = active();
      if (!t || !t.occSession || !t.occSession.id || !hasOccKey()) return;
      O.stopSession(t.occSession.id, { key: currentKey() }).catch(function () {});
    };
  }
  $("settingsBtn").onclick = openSettings;
  $("settingsClose").onclick = function () { $("settingsOverlay").classList.remove("show"); };
  $("changePlanBtn").onclick = function () { P.signOutBilling(); };
  $("send").onclick = send;
  $("inp").addEventListener("input", refreshSend);
  $("inp").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $("model").addEventListener("change", function () {
    var t = active();
    if (t) { t.model = $("model").value; persist(); }
  });
  function rememberDials() {
    var t = active();
    if (!t) return;
    var spec = raceSpec();
    t.tier = $("tierSel") ? $("tierSel").value : t.tier;
    t.race = spec.n;
    t.raceNeed = spec.k;
    persist();
    syncDials();
  }
  if ($("tierSel")) $("tierSel").addEventListener("change", rememberDials);
  if ($("raceSel")) $("raceSel").addEventListener("change", rememberDials);

  window.addEventListener("openzoo-billing", function () {
    if ($("planBody")) $("planBody").textContent = planLabel();
    var t = active();
    applyAgentMode(threadMode(t) === "agent" && hasOccKey());
    if (t && threadMode(t) === "agent" && !hasOccKey()) {
      t.runMode = "chat";
      persist();
      applyAgentMode(false);
    }
  });

  if (!threads.length) newThread();
  else {
    if (!active()) activeId = threads[0].id;
    renderThreads();
    renderChat();
  }
  syncDials();
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "openzoo-chrome-ready" }, "*");
  }
  loadModels();
})();
