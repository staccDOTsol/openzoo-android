(function () {
  "use strict";

  var R = window.OpenZooRails;
  var P = window.OpenZooPay;
  var $ = function (id) { return document.getElementById(id); };
  var SKEY = "openzoo.android.session.v1";

  var state = Object.assign(
    { messages: [], ctx: null, corpus: "", spent: 0, saved: 0, calls: 0, model: "", topK: "" },
    JSON.parse(localStorage.getItem(SKEY) || "{}"),
    { busy: false }
  );

  function persist() {
    localStorage.setItem(SKEY, JSON.stringify({
      messages: state.messages,
      ctx: state.ctx,
      corpus: state.corpus,
      spent: state.spent,
      saved: state.saved,
      calls: state.calls,
      model: $("model") ? $("model").value : state.model,
      topK: $("topK") ? $("topK").value : state.topK,
    }));
  }

  function shortAddr(addr) {
    if (!addr) return "not connected";
    return addr.slice(0, 4) + "…" + addr.slice(-4);
  }

  function setWalletChip(addr) {
    var chip = $("walletChip");
    if (!chip) return;
    chip.textContent = addr ? shortAddr(addr) : "no wallet";
    chip.classList.toggle("on", !!addr);
  }

  function showSteer(copy) {
    $("steerTitle").textContent = (copy && copy.title) || "Need USDC on Solana";
    $("steerBody").textContent = (copy && copy.body) || "";
    $("steer").classList.add("open");
  }

  function hideSteer() {
    $("steer").classList.remove("open");
  }

  function showPanel(name) {
    $("stats").classList.toggle("open", name === "stats");
    $("drawer").classList.toggle("open", name === "bind");
  }

  function bubble(text, mine, meta) {
    var row = document.createElement("div");
    row.className = "row";
    row.setAttribute("data-row", mine ? "user" : "assistant");
    var wrap = document.createElement("div");
    wrap.setAttribute("data-role", "bubble-wrap");
    var b = document.createElement("div");
    b.className = "bubble " + (mine ? "me" : "zoo");
    b.setAttribute("data-role", "bubble");
    b.textContent = text;
    wrap.appendChild(b);
    if (meta) {
      var m = document.createElement("div");
      m.className = "meta";
      m.setAttribute("data-role", "bubble-meta");
      m.textContent = meta;
      wrap.appendChild(m);
    }
    row.appendChild(wrap);
    $("chat").appendChild(row);
    $("chat").scrollTop = $("chat").scrollHeight;
    return b;
  }

  function animal(id) {
    id = id || "";
    if (id.indexOf("anthropic") === 0) return "🦒";
    if (id.indexOf("openai") === 0) return "🦉";
    if (id.indexOf("deepseek") === 0) return "🐋";
    if (id.indexOf("x-ai") === 0) return "🦊";
    if (id.indexOf("google") === 0) return "🐦";
    if (id.indexOf("meta") === 0) return "🦙";
    if (id.indexOf("mistral") === 0) return "🐈";
    if (id.indexOf("qwen") === 0) return "🐼";
    return "🐾";
  }

  function loadModels() {
    return fetch(R.GATEWAY + "/v1/models", {
      headers: R.gatewayHeaders(),
    }).then(function (r) { return r.json(); }).then(function (d) {
      var models = (d.data || []).filter(function (m) {
        return m.id && m.id.charAt(0) !== "~" && m.id.indexOf(":batch") === -1;
      });
      models.sort(function (a, b) { return a.id.localeCompare(b.id); });
      var dl = $("modelList");
      dl.innerHTML = "";
      models.forEach(function (m) {
        var o = document.createElement("option");
        o.value = m.id;
        var inM = m.pricing && m.pricing.prompt ? (1e6 * m.pricing.prompt).toFixed(2) : "?";
        o.label = animal(m.id) + " $" + inM + "/M";
        dl.appendChild(o);
      });
      if (!$("model").value) $("model").value = R.defaultModelId(models);
      $("netChip").textContent = models.length + " models";
      $("netChip").classList.add("on");
    }).catch(function () {
      $("netChip").textContent = "gateway unreachable";
      if (!$("model").value) $("model").value = R.DEFAULT_MODEL;
    });
  }

  function renderStats(d) {
    var today = d.today || {};
    var lines = [];
    if (d.app) lines.push(String(d.app));
    lines.push("Today (" + (today.day || "?") + "): " + (today.calls || 0) + " calls · " +
      (today.paid || 0) + " paid · $" + Number(today.usdPaid || 0).toFixed(2));
    if (Array.isArray(d.days) && d.days.length) {
      lines.push(d.days.length + " daily row" + (d.days.length === 1 ? "" : "s") +
        " since " + ((d.coverage && d.coverage.since) || d.days[0].day || "?"));
    }
    if (d.growth && d.growth.trailing7) {
      lines.push("Trailing 7 days: " + d.growth.trailing7.calls + " calls · $" +
        Number(d.growth.trailing7.usdPaid || 0).toFixed(2));
    }
    var tops = (d.topModels || []).slice(0, 8).map(function (m) {
      return (m.model || "?") + " (" + m.calls + ")";
    });
    if (tops.length) lines.push("Top models: " + tops.join(", "));
    if (d.coverage && d.coverage.caveat) lines.push(d.coverage.caveat);
    $("statsBody").textContent = lines.join("\n\n");
  }

  function loadStats() {
    $("statsBody").textContent = "loading…";
    return fetch(R.GATEWAY + "/v1/stats", { headers: R.gatewayHeaders() })
      .then(function (r) { return r.json(); }).then(renderStats)
      .catch(function (e) { $("statsBody").textContent = "Could not load stats: " + e.message; });
  }

  function handlePayError(e, thinking) {
    if (e && e.name === "SteerError") {
      showSteer(e.copy);
      if (thinking) thinking.textContent = "Need USDC on Solana — see the wrap panel.";
      return;
    }
    if (thinking) thinking.textContent = "the zoo hiccuped: " + ((e && e.message) || e);
  }

  function send() {
    var text = $("box").value.trim();
    if (!text || state.busy) return;
    if (!P.getAddress()) {
      bubble("Connect Phantom in the shell first — each call is paid from your wallet.", false);
      return;
    }
    state.busy = true;
    $("sendBtn").disabled = true;
    $("box").value = "";
    bubble(text, true);
    state.messages.push({ role: "user", content: text });
    var thinking = bubble("…", false);

    var headers = {};
    if (state.ctx) headers["x-hrr-context"] = state.ctx;
    if ($("topK").value) headers["x-hrr-top-k"] = $("topK").value;

    var model = $("model").value || R.DEFAULT_MODEL;
    var payload = {
      model: model,
      messages: [{ role: "system", content: R.SYSTEM_PROMPT }].concat(state.messages),
      max_tokens: R.maxTokensFor(model),
    };

    function runPaid() {
      return P.paidFetch("/v1/chat/completions", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
      });
    }

    runPaid().catch(function (e) {
      if (e && e.name !== "ContextNotFoundError") throw e;
      return rebindFree().then(function () {
        if (state.ctx) headers["x-hrr-context"] = state.ctx;
        else delete headers["x-hrr-context"];
        return runPaid();
      });
    }).then(function (r) { return r.json(); }).then(function (d) {
      var ch = d.choices && d.choices[0];
      var content = (ch && ch.message && ch.message.content) || "";
      if (!content && ch && ch.finish_reason === "length") {
        content = "the model used its token budget on thinking and said nothing. try again.";
      } else if (!content) {
        content = (d.error && d.error.message) || "unusual reply: " + JSON.stringify(d).slice(0, 200);
      }
      thinking.textContent = content;
      state.messages.push({ role: "assistant", content: content });
      var x = d.x402 || {};
      state.calls += 1;
      if (typeof x.billedUsd === "number") state.spent += x.billedUsd;
      if (typeof x.savesVsDirect === "number" && x.savesVsDirect > 0) state.saved += x.savesVsDirect;
      var bits = [];
      if (typeof x.billedUsd === "number") bits.push("$" + x.billedUsd.toFixed(4));
      if (x.lecore && x.lecore.engaged) bits.push("retrieved " + (x.lecore.recalled != null ? x.lecore.recalled : "?") + " slices");
      if (bits.length) {
        var old = thinking.parentElement.querySelector("[data-role=bubble-meta]");
        if (old) old.remove();
        var meta = document.createElement("div");
        meta.className = "meta";
        meta.setAttribute("data-role", "bubble-meta");
        meta.textContent = bits.join(" · ");
        thinking.insertAdjacentElement("afterend", meta);
      }
      $("spent").textContent = "this session: $" + state.spent.toFixed(4);
      if (state.saved > 0) $("saved").textContent = "saved ~$" + state.saved.toFixed(4) + " vs direct";
      $("calls").textContent = state.calls + (state.calls === 1 ? " call" : " calls");
      persist();
    }).catch(function (e) {
      handlePayError(e, thinking);
    }).then(function () {
      state.busy = false;
      $("sendBtn").disabled = false;
    });
  }

  function applyBind(d, corpus) {
    if (!d || !d.context_id) return false;
    state.ctx = d.context_id;
    if (corpus) state.corpus = corpus;
    $("bindStatus").textContent = "bound " + ((corpus || "").length / 1000).toFixed(0) + "k chars";
    var chip = $("ctxChip");
    chip.style.display = "";
    chip.classList.add("on");
    chip.textContent = "bound " + d.context_id.slice(0, 10) + "…";
    persist();
    return true;
  }

  function postBind(corpus, contextId) {
    return fetch(R.GATEWAY + "/v1/hrr/bind", {
      method: "POST",
      headers: R.gatewayHeaders(),
      body: JSON.stringify(R.bindPayload(corpus, contextId)),
    }).then(function (r) { return r.json(); });
  }

  function rebindFree() {
    var corpus = state.corpus || ($("corpus") && $("corpus").value) || "";
    if (!corpus.trim()) {
      state.ctx = null;
      persist();
      return Promise.resolve(null);
    }
    return postBind(corpus, state.ctx).then(function (d) {
      if (!applyBind(d, corpus)) {
        state.ctx = null;
        persist();
      }
      return d;
    });
  }

  function bind() {
    var corpus = $("corpus").value;
    if (!corpus.trim()) return;
    $("bindStatus").textContent = "binding…";
    postBind(corpus, null).then(function (d) {
      if (applyBind(d, corpus)) $("drawer").classList.remove("open");
      else $("bindStatus").textContent = (d.error && d.error.message) || d.error || "bind failed";
    }).catch(function (e) {
      $("bindStatus").textContent = e.message;
    });
  }

  function restore() {
    state.messages.forEach(function (m) {
      bubble(m.content, m.role === "user");
    });
    $("spent").textContent = "this session: $" + Number(state.spent || 0).toFixed(4);
    if (state.saved > 0) $("saved").textContent = "saved ~$" + Number(state.saved).toFixed(4) + " vs direct";
    if (state.calls) $("calls").textContent = state.calls + (state.calls === 1 ? " call" : " calls");
    if (state.model) $("model").value = state.model;
    if (state.topK) $("topK").value = state.topK;
    if (state.corpus && $("corpus") && !$("corpus").value) $("corpus").value = state.corpus;
    if (state.ctx) {
      var chip = $("ctxChip");
      chip.style.display = "";
      chip.classList.add("on");
      chip.textContent = "bound " + String(state.ctx).slice(0, 10) + "…";
    }
  }

  $("newBtn").onclick = function () {
    localStorage.removeItem(SKEY);
    location.reload();
  };
  $("sendBtn").onclick = send;
  $("box").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $("brainBtn").onclick = function () {
    var open = !$("drawer").classList.contains("open");
    showPanel(open ? "bind" : "");
  };
  $("statsBtn").onclick = function () {
    var open = !$("stats").classList.contains("open");
    showPanel(open ? "stats" : "");
    if (open) loadStats();
  };
  $("bindBtn").onclick = bind;
  $("steerClose").onclick = hideSteer;
  $("steerWrap").onclick = function () { P.openWrapPage(); };
  $("disconnectBtn").onclick = function () { P.disconnectWallet(); };
  $("corpus").addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) f.text().then(function (t) { $("corpus").value = t; });
  });
  $("corpus").addEventListener("dragover", function (e) { e.preventDefault(); });

  window.addEventListener("openzoo-wallet", function (e) {
    setWalletChip(e.detail && e.detail.address);
  });

  restore();
  setWalletChip(P.getAddress());
  P.requestWalletInfo();
  loadModels();
})();
