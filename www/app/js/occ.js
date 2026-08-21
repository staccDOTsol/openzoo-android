/**
 * Hosted OCC (openzoo-claude) door for Play Store Android.
 *
 * Not local node-pty. Not an open OCC URL. Every call needs
 * Authorization: Bearer <OpenZoo subscription key>.
 * Never ANTHROPIC_API_KEY. No key → no Agent.
 *
 * Origin matches this app's existing API origin (zoo.openzoo.fun),
 * same host as /api/billing/* and iOS PR staccDOTsol/openzoo-ios#11.
 * Same door — do not invent a second API.
 *
 *   POST /occ/sessions
 *   GET  /occ/sessions/:id                 (optional probe)
 *   POST /occ/sessions/:id/messages        (SSE; a goal slash is a message)
 *   POST /occ/sessions/:id/files           (multipart file or JSON base64)
 *   POST /occ/sessions/:id/stop
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooOcc = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var OCC_ORIGIN = "https://zoo.openzoo.fun";
  var SESSIONS = "/occ/sessions";
  var PLACEHOLDER_KEYS = { openzoo: 1, "sk-openzoo": 1, "": 1 };
  var OCC_PATHS = {
    sessions: SESSIONS,
    messages: function (id) { return sessionPath(id) + "/messages"; },
    files: function (id) { return sessionPath(id) + "/files"; },
    stop: function (id) { return sessionPath(id) + "/stop"; },
  };

  function OccAuthError(message) {
    this.name = "OccAuthError";
    this.message = message || "Subscribe with Google Play to use Agent.";
  }
  OccAuthError.prototype = Object.create(Error.prototype);
  OccAuthError.prototype.constructor = OccAuthError;

  function OccDoorUnavailableError(message) {
    this.name = "OccDoorUnavailableError";
    this.message = message || "hosted Agent is not live yet. Chat still works.";
  }
  OccDoorUnavailableError.prototype = Object.create(Error.prototype);
  OccDoorUnavailableError.prototype.constructor = OccDoorUnavailableError;

  function asKey(value) {
    return String(value == null ? "" : value).trim();
  }

  function isUsableKey(key) {
    var k = asKey(key);
    if (!k) return false;
    if (PLACEHOLDER_KEYS[k] || PLACEHOLDER_KEYS[k.toLowerCase()]) return false;
    if (/^anthropic/i.test(k)) return false;
    return true;
  }

  function normalizeRunMode(mode) {
    var m = String(mode || "").trim().toLowerCase();
    if (m === "agent" || m === "auto") return "agent";
    return "chat";
  }

  function isAgentMode(tOrMode) {
    if (tOrMode && typeof tOrMode === "object") return normalizeRunMode(tOrMode.runMode) === "agent";
    return normalizeRunMode(tOrMode) === "agent";
  }

  function defaultRunMode(hasKey) {
    return hasKey ? "agent" : "chat";
  }

  function goalFromMessage(text) {
    var raw = String(text || "").replace(/^\s+/, "");
    var m = /^\/goal(?:\s+|$)([\s\S]*)/i.exec(raw);
    if (!m) return null;
    return String(m[1] || "").replace(/\s+$/, "");
  }

  function isGoalCommand(text) {
    return goalFromMessage(text) != null;
  }

  function occHeaders(key, extra) {
    if (!isUsableKey(key)) {
      throw new OccAuthError();
    }
    var headers = Object.assign({
      authorization: "Bearer " + asKey(key),
      accept: "application/json",
    }, extra || {});
    var names = Object.keys(headers);
    for (var i = 0; i < names.length; i++) {
      if (/anthropic/i.test(names[i])) delete headers[names[i]];
    }
    return headers;
  }

  function sessionIdOf(data) {
    if (!data || typeof data !== "object") return "";
    return String(data.id || data.session_id || data.sessionId || data.occSessionId || "").trim();
  }

  function sessionPath(id) {
    return SESSIONS + "/" + encodeURIComponent(String(id || ""));
  }

  function stripAnsi(s) {
    return String(s || "")
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
      .replace(/\u001b./g, "");
  }

  function decodePty(data) {
    var raw = String(data || "");
    if (!raw) return "";
    if (/^[A-Za-z0-9+/]+=*$/.test(raw.replace(/\s/g, "")) && raw.length % 4 === 0) {
      try {
        if (typeof Buffer !== "undefined") return Buffer.from(raw, "base64").toString("utf8");
        if (typeof atob === "function") {
          var bin = atob(raw);
          var out = "";
          for (var i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
          return out;
        }
      } catch (e) { /* treat as plain */ }
    }
    return raw;
  }

  function sessionUrl(id) {
    return OCC_ORIGIN + sessionPath(id);
  }

  function looksHtml(raw) {
    var s = String(raw || "").replace(/^\s+/, "");
    return s.charAt(0) === "<";
  }

  function parseJsonSafe(raw) {
    try { return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  function errText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (value && typeof value.message === "string") return value.message;
    if (value && typeof value.error === "string") return value.error;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function mapHttpError(status, body, raw) {
    if (status === 401 || status === 402 || status === 403) {
      return new OccAuthError(
        status === 402
          ? "This Agent call still asked for payment. Restore your Google Play subscription."
          : "Subscribe with Google Play to use Agent."
      );
    }
    if ((status === 404 || status === 405 || status === 500 || status === 501) && (looksHtml(raw) || !body)) {
      return new OccDoorUnavailableError();
    }
    var err = new Error(errText((body && (body.error || body.message)) || raw || ("HTTP " + status)));
    err.status = status;
    err.body = body;
    return err;
  }

  function normalizeEvent(json) {
    if (json == null) return { type: "delta", text: "" };
    if (typeof json === "string") {
      if (json === "[DONE]") return { type: "done" };
      return { type: "delta", text: json };
    }
    if (typeof json !== "object") return { type: "delta", text: String(json) };
    var type = String(json.type || json.event || "").toLowerCase();
    if (type === "done" || type === "end" || json.done === true) return { type: "done" };
    if (type === "error" || json.error) {
      return { type: "error", error: errText(json.error || json.message || json) };
    }
    if (type === "status" || type === "progress") {
      return { type: "status", text: String(json.text || json.message || json.status || "") };
    }
    if (type === "pty") {
      return { type: "delta", text: stripAnsi(decodePty(json.data || json.pty || json.text || "")) };
    }
    var text = json.text;
    if (text == null && json.output != null) text = json.output;
    if (text == null && json.delta != null) {
      text = typeof json.delta === "string" ? json.delta : (json.delta.text || json.delta.content);
    }
    if (text == null) {
      var ch = json.choices && json.choices[0];
      if (ch && ch.delta && ch.delta.content != null) text = ch.delta.content;
      else if (ch && ch.message && ch.message.content != null) text = ch.message.content;
    }
    if (text == null) text = json.content;
    if (text == null) text = "";
    if (type === "output") return { type: "delta", text: String(text) };
    return { type: type === "text" ? "text" : "delta", text: String(text) };
  }

  function emitDataPayload(raw, onEvent) {
    var s = String(raw || "").replace(/^\s+/, "");
    if (!s) return;
    if (s === "[DONE]") { onEvent({ type: "done" }); return; }
    var json = parseJsonSafe(s);
    if (json) onEvent(normalizeEvent(json));
    else onEvent({ type: "delta", text: s });
  }

  function parseSseBlock(block, onEvent) {
    var dataLines = [];
    String(block || "").split(/\r?\n/).forEach(function (line) {
      if (line.indexOf("data:") === 0) dataLines.push(line.slice(5).replace(/^ /, ""));
    });
    if (!dataLines.length) return;
    emitDataPayload(dataLines.join("\n"), onEvent);
  }

  function consumeBuffer(buffer, onEvent) {
    var chunks = String(buffer || "").split(/\r?\n\r?\n/);
    var rest = chunks.pop();
    chunks.forEach(function (block) {
      if (block.indexOf("data:") !== -1) parseSseBlock(block, onEvent);
      else {
        String(block).split(/\r?\n/).forEach(function (line) {
          var t = line.replace(/^\s+/, "");
          if (!t) return;
          emitDataPayload(t, onEvent);
        });
      }
    });
    return rest || "";
  }

  function flushTail(tail, onEvent) {
    var left = String(tail || "").replace(/^\s+/, "");
    if (!left) return;
    if (left.indexOf("data:") !== -1) parseSseBlock(left, onEvent);
    else emitDataPayload(left, onEvent);
  }

  function consumeOccStream(res, onEvent) {
    onEvent = onEvent || function () {};
    if (res && res.body && typeof res.body.getReader === "function") {
      var reader = res.body.getReader();
      var decoder = typeof TextDecoder === "function" ? new TextDecoder() : null;
      var buf = "";
      function pump() {
        return reader.read().then(function (part) {
          var chunk = part.value;
          var text = "";
          if (chunk) {
            if (typeof chunk === "string") text = chunk;
            else if (decoder) text = decoder.decode(chunk, { stream: !part.done });
            else text = String.fromCharCode.apply(null, chunk);
          }
          buf = consumeBuffer(buf + text, onEvent);
          if (part.done) {
            flushTail(buf, onEvent);
            onEvent({ type: "done" });
            return;
          }
          return pump();
        });
      }
      return pump();
    }
    return Promise.resolve(res && typeof res.text === "function" ? res.text() : "").then(function (raw) {
      var rest = consumeBuffer(String(raw || "") + "\n\n", onEvent);
      flushTail(rest, onEvent);
      onEvent({ type: "done" });
    });
  }

  function readResponse(res) {
    return res.text().then(function (raw) {
      return { status: res.status, ok: res.ok, raw: raw, json: parseJsonSafe(raw), html: looksHtml(raw) };
    });
  }

  function occFetch(path, options) {
    options = options || {};
    var key = options.key;
    var fetchImpl = options.fetchImpl || fetch;
    var extra = options.headers || {};
    var headers;
    try {
      headers = occHeaders(key, extra);
    } catch (e) {
      return Promise.reject(e);
    }
    if (options.omitContentType && headers["content-type"]) delete headers["content-type"];
    return fetchImpl(OCC_ORIGIN + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body,
      signal: options.signal,
    }).then(function (res) {
      var stream = options.stream && res.ok;
      if (stream) return res;
      return readResponse(res).then(function (body) {
        if (!res.ok) throw mapHttpError(res.status, body.json, body.raw);
        return body;
      });
    }).then(function (out) {
      if (options.stream && out && typeof out.ok === "boolean" && out.ok && out.body) {
        return consumeOccStream(out, options.onEvent).then(function () { return out; });
      }
      if (options.stream && out && typeof out.text === "function") {
        return consumeOccStream(out, options.onEvent).then(function () { return out; });
      }
      return out;
    });
  }

  function createSession(opts) {
    opts = opts || {};
    return occFetch(SESSIONS, {
      method: "POST",
      key: opts.key,
      fetchImpl: opts.fetchImpl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: opts.threadId || undefined,
        name: opts.name || opts.threadId || undefined,
      }),
    }).then(function (body) {
      var id = sessionIdOf(body.json);
      if (!id) throw new OccDoorUnavailableError();
      return {
        id: id,
        cwd: (body.json && body.json.cwd) || "",
        status: (body.json && body.json.status) || "ready",
      };
    });
  }

  function getSession(id, opts) {
    opts = opts || {};
    return occFetch(sessionPath(id), {
      key: opts.key,
      fetchImpl: opts.fetchImpl,
    }).then(function (body) {
      return {
        id: sessionIdOf(body.json) || id,
        cwd: (body.json && body.json.cwd) || "",
        status: (body.json && body.json.status) || "ready",
      };
    });
  }

  function postMessage(id, text, opts) {
    opts = opts || {};
    return occFetch(sessionPath(id) + "/messages", {
      method: "POST",
      key: opts.key,
      fetchImpl: opts.fetchImpl,
      stream: true,
      onEvent: opts.onEvent,
      signal: opts.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream, application/x-ndjson, application/json",
      },
      body: JSON.stringify({
        text: String(text || ""),
        message: String(text || ""),
        stream: true,
      }),
    });
  }

  function toBase64(text) {
    var s = String(text || "");
    if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
    if (typeof btoa === "function") {
      var bin = "";
      for (var i = 0; i < s.length; i++) bin += String.fromCharCode(s.charCodeAt(i) & 0xff);
      return btoa(bin);
    }
    return s;
  }

  function buildUploadBody(file) {
    file = file || {};
    var name = file.name || "file";
    if (typeof FormData !== "undefined" && (file.blob || file.file || typeof Blob !== "undefined")) {
      var fd = new FormData();
      var blob = file.blob || file.file;
      if (blob) fd.append("file", blob, name);
      else fd.append("file", new Blob([file.text || file.content || ""], { type: file.type || "text/plain" }), name);
      fd.append("name", name);
      return { body: fd, multipart: true };
    }
    var content = file.content != null ? file.content : toBase64(file.text || "");
    return {
      body: JSON.stringify({
        name: name,
        content: content,
        encoding: file.encoding || "base64",
      }),
      multipart: false,
    };
  }

  function uploadFile(id, file, opts) {
    opts = opts || {};
    var built = buildUploadBody(file);
    var extra = built.multipart ? {} : { "content-type": "application/json" };
    return occFetch(sessionPath(id) + "/files", {
      method: "POST",
      key: opts.key,
      fetchImpl: opts.fetchImpl,
      omitContentType: built.multipart,
      headers: extra,
      body: built.body,
    }).then(function (body) {
      return {
        ok: true,
        name: (body.json && (body.json.name || body.json.filename)) || (file && file.name) || "file",
        path: (body.json && body.json.path) || "",
      };
    });
  }

  function stopSession(id, opts) {
    opts = opts || {};
    return occFetch(sessionPath(id) + "/stop", {
      method: "POST",
      key: opts.key,
      fetchImpl: opts.fetchImpl,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  function userVisibleOccError(err) {
    if (!err) return "hosted Agent hiccuped.";
    if (err.name === "OccAuthError" || err.name === "SubscriptionRequiredError") {
      return err.message || "Subscribe with Google Play to use Agent.";
    }
    if (err.name === "OccDoorUnavailableError") return err.message;
    var rails = (typeof window !== "undefined" && window.OpenZooRails)
      || (typeof globalThis !== "undefined" && globalThis.OpenZooRails);
    if (rails && rails.looksNetworkGarbage && rails.looksNetworkGarbage(err)) {
      return rails.friendlyNetworkMessage();
    }
    return "hosted Agent hiccuped: " + ((err && err.message) || err);
  }

  return {
    OCC_ORIGIN: OCC_ORIGIN,
    SESSIONS: SESSIONS,
    OCC_PATHS: OCC_PATHS,
    sessionIdOf: sessionIdOf,
    OccAuthError: OccAuthError,
    OccDoorUnavailableError: OccDoorUnavailableError,
    asKey: asKey,
    isUsableKey: isUsableKey,
    normalizeRunMode: normalizeRunMode,
    isAgentMode: isAgentMode,
    defaultRunMode: defaultRunMode,
    goalFromMessage: goalFromMessage,
    isGoalCommand: isGoalCommand,
    occHeaders: occHeaders,
    sessionPath: sessionPath,
    sessionUrl: sessionUrl,
    normalizeEvent: normalizeEvent,
    consumeBuffer: consumeBuffer,
    consumeOccStream: consumeOccStream,
    mapHttpError: mapHttpError,
    createSession: createSession,
    getSession: getSession,
    postMessage: postMessage,
    buildUploadBody: buildUploadBody,
    uploadFile: uploadFile,
    stopSession: stopSession,
    userVisibleOccError: userVisibleOccError,
  };
});
