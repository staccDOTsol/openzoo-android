/**
 * Cloud code-server + Cline door for Play Store Android Agent.
 *
 * Not hosted OCC. Not local node-pty. Not an open IDE URL.
 * Every call needs Authorization: Bearer <OpenZoo subscription key>.
 * Never ANTHROPIC_API_KEY. No key → no Agent.
 *
 * Origin matches this app's existing API origin (zoo.openzoo.fun),
 * same host as /api/billing/*. Do not invent a second API.
 *
 *   POST /api/ide/session   → { url, password?, id }
 *   GET  /api/ide/session   → { url, password?, id }   (resume)
 *
 * Load `url` in the Agent webview. 401 → subscribe / restore Play.
 * Hosted OCC routes may remain in-tree unused.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OpenZooIde = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var IDE_ORIGIN = "https://zoo.openzoo.fun";
  var SESSION = "/api/ide/session";
  var PLACEHOLDER_KEYS = { openzoo: 1, "sk-openzoo": 1, "": 1 };

  function IdeAuthError(message) {
    this.name = "IdeAuthError";
    this.message = message || "Subscribe with Google Play to use Agent.";
  }
  IdeAuthError.prototype = Object.create(Error.prototype);
  IdeAuthError.prototype.constructor = IdeAuthError;

  function IdeDoorUnavailableError(message) {
    this.name = "IdeDoorUnavailableError";
    this.message = message || "cloud Agent is not live yet. Chat still works.";
  }
  IdeDoorUnavailableError.prototype = Object.create(Error.prototype);
  IdeDoorUnavailableError.prototype.constructor = IdeDoorUnavailableError;

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

  function ideHeaders(key, extra) {
    if (!isUsableKey(key)) {
      throw new IdeAuthError();
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
    return String(data.id || data.session_id || data.sessionId || data.ideSessionId || "").trim();
  }

  function sessionUrlOf(data) {
    if (!data || typeof data !== "object") return "";
    return String(data.url || data.href || data.ideUrl || data.sessionUrl || "").trim();
  }

  function sessionPasswordOf(data) {
    if (!data || typeof data !== "object") return "";
    if (data.password == null) return "";
    return String(data.password).trim();
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
      return new IdeAuthError(
        status === 402
          ? "This Agent call still asked for payment. Restore your Google Play subscription."
          : "Subscribe with Google Play to use Agent."
      );
    }
    if ((status === 404 || status === 405 || status === 500 || status === 501) && (looksHtml(raw) || !body)) {
      return new IdeDoorUnavailableError();
    }
    var err = new Error(errText((body && (body.error || body.message)) || raw || ("HTTP " + status)));
    err.status = status;
    err.body = body;
    return err;
  }

  function isBlockedHost(host) {
    var h = String(host || "").toLowerCase();
    if (!h) return true;
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]" || h === "::1") return true;
    if (/^localhost[:.]/.test(h)) return true;
    if (/(^|\.)anthropic\.com$/.test(h)) return true;
    if (/(^|\.)claude\.ai$/.test(h)) return true;
    return false;
  }

  function isSafeSessionUrl(value) {
    var raw = String(value || "").trim();
    if (!raw) return false;
    if (/[\s<>]/.test(raw)) return false;
    var parsed;
    try { parsed = new URL(raw); }
    catch (e) { return false; }
    if (parsed.protocol !== "https:") return false;
    if (isBlockedHost(parsed.hostname)) return false;
    if (Number(parsed.port) === 8000 + 402) return false;
    return true;
  }

  function sessionOf(data) {
    var url = sessionUrlOf(data);
    var id = sessionIdOf(data);
    var password = sessionPasswordOf(data);
    if (!isSafeSessionUrl(url)) return null;
    return { url: url, id: id, password: password || undefined };
  }

  function frameSrc(session) {
    if (!session || !isSafeSessionUrl(session.url)) return "";
    var parsed;
    try { parsed = new URL(session.url); }
    catch (e) { return ""; }
    if (session.password && !parsed.searchParams.get("password")) {
      parsed.searchParams.set("password", session.password);
    }
    return parsed.toString();
  }

  function readResponse(res) {
    return res.text().then(function (raw) {
      return { status: res.status, ok: res.ok, raw: raw, json: parseJsonSafe(raw), html: looksHtml(raw) };
    });
  }

  function ideFetch(options) {
    options = options || {};
    var key = options.key;
    var fetchImpl = options.fetchImpl || fetch;
    var extra = options.headers || {};
    var headers;
    try {
      headers = ideHeaders(key, extra);
    } catch (e) {
      return Promise.reject(e);
    }
    var method = String(options.method || "GET").toUpperCase();
    var path = SESSION;
    if (method === "GET" && options.id) {
      path = SESSION + "?id=" + encodeURIComponent(String(options.id));
    }
    return fetchImpl(IDE_ORIGIN + path, {
      method: method,
      headers: headers,
      body: method === "GET" ? undefined : (options.body || "{}"),
    }).then(function (res) {
      return readResponse(res).then(function (body) {
        if (!res.ok) throw mapHttpError(res.status, body.json, body.raw);
        return body;
      });
    });
  }

  function parseSessionBody(body) {
    var sess = sessionOf(body && body.json);
    if (!sess) throw new IdeDoorUnavailableError();
    return sess;
  }

  function getSession(opts) {
    opts = opts || {};
    return ideFetch({
      method: "GET",
      key: opts.key,
      id: opts.id,
      fetchImpl: opts.fetchImpl,
    }).then(parseSessionBody);
  }

  function createSession(opts) {
    opts = opts || {};
    return ideFetch({
      method: "POST",
      key: opts.key,
      fetchImpl: opts.fetchImpl,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: opts.threadId || undefined,
        name: opts.name || opts.threadId || undefined,
      }),
    }).then(parseSessionBody);
  }

  function ensureSession(opts) {
    opts = opts || {};
    return getSession(opts).catch(function (err) {
      if (err && err.name === "IdeAuthError") throw err;
      return createSession(opts);
    });
  }

  function userVisibleIdeError(err) {
    if (!err) return "cloud Agent hiccuped.";
    if (err.name === "IdeAuthError" || err.name === "OccAuthError" || err.name === "SubscriptionRequiredError") {
      return err.message || "Subscribe with Google Play to use Agent.";
    }
    if (err.name === "IdeDoorUnavailableError" || err.name === "OccDoorUnavailableError") {
      return err.message || "cloud Agent is not live yet. Chat still works.";
    }
    var rails = (typeof window !== "undefined" && window.OpenZooRails)
      || (typeof globalThis !== "undefined" && globalThis.OpenZooRails);
    if (rails && rails.looksNetworkGarbage && rails.looksNetworkGarbage(err)) {
      return rails.friendlyNetworkMessage();
    }
    return "cloud Agent hiccuped: " + ((err && err.message) || err);
  }

  return {
    IDE_ORIGIN: IDE_ORIGIN,
    SESSION: SESSION,
    IdeAuthError: IdeAuthError,
    IdeDoorUnavailableError: IdeDoorUnavailableError,
    asKey: asKey,
    isUsableKey: isUsableKey,
    normalizeRunMode: normalizeRunMode,
    isAgentMode: isAgentMode,
    defaultRunMode: defaultRunMode,
    ideHeaders: ideHeaders,
    sessionIdOf: sessionIdOf,
    sessionUrlOf: sessionUrlOf,
    sessionOf: sessionOf,
    isSafeSessionUrl: isSafeSessionUrl,
    frameSrc: frameSrc,
    mapHttpError: mapHttpError,
    getSession: getSession,
    createSession: createSession,
    ensureSession: ensureSession,
    userVisibleIdeError: userVisibleIdeError,
  };
});
