(function () {
  "use strict";

  var R = window.OpenZooRails;
  var P = window.OpenZooPay;
  var B = window.OpenZooBind;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = "openzoo.android.grokui.v1";
  var PALETTE = ["#e91e8c", "#34c759", "#ff9500", "#5e5ce6", "#ff3b30", "#0a84ff", "#00c7be"];

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || "{}"); }
    catch (e) { return {}; }
  }

  var saved = loadStore();
  var threads = Array.isArray(saved.threads) ? saved.threads : [];
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
      corpus: "",
      model: $("model") ? $("model").value : "",
      spent: 0,
      saved: 0,
      calls: 0,
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
    if (!t || !t.messages.length) {
      bubble("welcome — pick a model, attach notes if you want, and say anything. this phone app cannot run, write, read, or serve local files.", false);
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
        t.ctx = null;
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

  function showFunds(copy) {
    $("fundsTitle").textContent = (copy && copy.title) || "Need funds in Phantom";
    $("fundsBody").textContent = (copy && copy.body) || "";
    $("fundsOverlay").classList.add("show");
  }

  function shortAddr(addr) {
    if (!addr) return "not connected";
    return addr.slice(0, 4) + "…" + addr.slice(-4);
  }

  function uiAmount(raw, decimals) {
    var n = Number(raw || 0) / Math.pow(10, decimals);
    if (!n) return "0";
    return n >= 1 ? n.toFixed(2) : n.toPrecision(3);
  }

  function openWallet() {
    $("walletOverlay").classList.add("show");
    var body = $("walletBody");
    var addr = P.getAddress();
    body.innerHTML = "";
    var row = document.createElement("div");
    row.className = "wrow";
    row.innerHTML = "<div class=\"wlab\">Phantom</div><div class=\"waddr\"></div>";
    row.querySelector(".waddr").textContent = addr || "not connected";
    body.appendChild(row);
    var bal = document.createElement("div");
    bal.className = "wbal";
    bal.textContent = "loading balances…";
    body.appendChild(bal);
    P.holdingsForWallet().then(function (h) {
      if (!h) { bal.textContent = "Connect Phantom in the shell first."; return; }
      bal.textContent = "USDC " + uiAmount(h.usdc, 6) + " · TOKEN " + uiAmount(h.token, 6) + " · LEOS " + uiAmount(h.leos, 9);
    }).catch(function () {
      bal.textContent = "Could not read balances.";
    });
  }

  function postBind(corpus, contextId) {
    return fetch(R.GATEWAY + "/v1/hrr/bind", {
      method: "POST",
      headers: R.gatewayHeaders(),
      body: JSON.stringify(R.bindPayload(corpus, contextId)),
    }).then(function (r) { return r.json(); });
  }

  function bindThread(t) {
    var corpus = B.corpusFromItems(t.items);
    t.corpus = corpus;
    if (!corpus.trim()) {
      t.ctx = null;
      persist();
      return Promise.resolve(null);
    }
    var parts = B.splitIntoParts(corpus);
    var ctx = null;
    var i = 0;
    function next() {
      if (i >= parts.length) {
        t.ctx = ctx;
        persist();
        return t.ctx;
      }
      var part = parts[i++];
      return postBind(part, ctx).then(function (d) {
        if (d && d.context_id) ctx = d.context_id;
        return next();
      });
    }
    setStatus(t.items.length === 1 ? "attaching…" : "attaching " + t.items.length + " files…");
    return next().then(function () {
      setStatus(B.userVisibleStatus(t.items, true));
      return t.ctx;
    }).catch(function (e) {
      setStatus("could not attach: " + ((e && e.message) || e));
      return null;
    });
  }

  function addItems(files) {
    var t = ensureThread();
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

  function send() {
    var text = $("inp").value.trim();
    var t = ensureThread();
    if ((!text && !(t.items && t.items.length)) || busy) return;
    if (!P.getAddress()) {
      bubble("Connect Phantom in the shell first — each call is paid from your wallet.", false);
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

    function headersFor() {
      var h = {};
      if (t.ctx) h["x-hrr-context"] = t.ctx;
      return h;
    }

    var model = $("model").value || t.model || R.DEFAULT_MODEL;
    t.model = model;
    var payload = {
      model: model,
      messages: [{ role: "system", content: R.SYSTEM_PROMPT }].concat(t.messages.map(function (m) {
        return { role: m.role, content: m.content };
      })),
      max_tokens: R.maxTokensFor(model),
    };

    function runPaid() {
      return P.paidFetch("/v1/chat/completions", {
        method: "POST",
        headers: headersFor(),
        body: JSON.stringify(payload),
        onStage: function (stage) {
          if (stage === "topup") setStatus("topping up…");
        },
      });
    }

    var start = (t.items && t.items.length && !t.ctx) ? bindThread(t) : Promise.resolve(t.ctx);
    start.then(function () {
      return runPaid().catch(function (e) {
        if (e && e.name !== "ContextNotFoundError") throw e;
        return bindThread(t).then(function () { return runPaid(); });
      });
    }).then(function (r) { return r.json(); }).then(function (d) {
      var ch = d.choices && d.choices[0];
      var content = (ch && ch.message && ch.message.content) || "";
      if (!content && ch && ch.finish_reason === "length") {
        content = "the model used its token budget on thinking and said nothing. try again.";
      } else if (!content) {
        content = (d.error && d.error.message) || "unusual reply";
      }
      thinking.textContent = content;
      var x = d.x402 || {};
      t.calls += 1;
      if (typeof x.billedUsd === "number") t.spent += x.billedUsd;
      if (typeof x.savesVsDirect === "number" && x.savesVsDirect > 0) t.saved += x.savesVsDirect;
      var bits = [];
      if (typeof x.billedUsd === "number") bits.push("$" + x.billedUsd.toFixed(4));
      if (x.lecore && x.lecore.engaged) bits.push("retrieved " + (x.lecore.recalled != null ? x.lecore.recalled : "?") + " slices");
      var meta = bits.join(" · ");
      if (meta) {
        var m = document.createElement("div");
        m.className = "meta";
        m.textContent = meta;
        thinking.insertAdjacentElement("afterend", m);
      }
      t.messages.push({ role: "assistant", content: content, meta: meta });
      persist();
      setStatus("");
    }).catch(function (e) {
      if (e && e.name === "FundsError") {
        showFunds(e.copy);
        thinking.textContent = e.copy && e.copy.body ? e.copy.body : "Need funds in Phantom.";
        return;
      }
      thinking.textContent = "the zoo hiccuped: " + ((e && e.message) || e);
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
        if (!$("model").value) $("model").value = R.defaultModelId(models);
      }).catch(function () {
        if (!$("model").value) $("model").value = R.DEFAULT_MODEL;
      });
  }

  $("newBtn").onclick = function () { newThread(); };
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
    t.items.push({ name: "note.txt", text: text });
    $("pasteBox").value = "";
    $("pasteOverlay").classList.remove("show");
    persist();
    renderAttachChips();
    refreshSend();
    bindThread(t);
  };
  $("pasteClose").onclick = function () { $("pasteOverlay").classList.remove("show"); };
  $("walletBtn").onclick = openWallet;
  $("walletClose").onclick = function () { $("walletOverlay").classList.remove("show"); };
  $("leaveBtn").onclick = function () { P.disconnectWallet(); };
  $("fundsClose").onclick = function () { $("fundsOverlay").classList.remove("show"); };
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

  window.addEventListener("openzoo-wallet", function (e) {
    var addr = e.detail && e.detail.address;
    $("walletBtn").textContent = addr ? shortAddr(addr) : "wallet";
    if (!addr) $("walletOverlay").classList.remove("show");
  });

  if (!threads.length) newThread();
  else {
    if (!active()) activeId = threads[0].id;
    renderThreads();
    renderChat();
  }
  $("walletBtn").textContent = P.getAddress() ? shortAddr(P.getAddress()) : "wallet";
  P.requestWalletInfo();
  loadModels();
  P.loadDirectory().catch(function () {});
})();
