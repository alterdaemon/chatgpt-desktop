const { app } = require("electron");

// Page state and error messages are untrusted. Only allowlisted shapes may leave
// the renderer; never serialize arbitrary strings, properties, URLs or bodies.
function sanitize(row, depth = 0) {
  const booleans = new Set(["mainFrame", "prevented", "csp", "moduleLoad", "timeout", "interactive", "observer", "knownFallbackPlaceholder", "richCode", "fallbackPresent", "codeRejected", "payloadFiltered", "richMetadata", "fallbackVersionSupported", "textEqualsFallback", "legacyRich", "hasStage", "browserAgentRequested", "nativeAgent"]);
  const numbers = new Set(["code", "status", "totalMessages", "parts", "messages", "richComponents", "richRoots", "injectedUserScripts"]);
  const strings = {
    event: new Set(["runtime", "load-failed", "redirect", "renderer-error", "request-failed", "history-request", "response-shape", "response-observation-unavailable", "response-fetch-failed", "page-error", "unhandled-rejection", "page-csp", "observer-ready", "snapshot", "snapshot-unavailable"]),
    purpose: new Set(["history-plural", "history-singular", "share", "asset", "other"]),
    origin: new Set(["chatgpt.com", "cdn.platform.openai.com", "cdn.oaistatic.com", "auth.openai.com", "other", "opaque"]),
    route: new Set(["conversation", "share", "home", "other"]),
    transport: new Set(["fetch", "xhr", "legacy-comparison"]),
    kind: new Set(["TypeError", "SyntaxError", "ReferenceError", "RangeError", "Error"]),
    directive: new Set(["script-src-elem", "script-src", "connect-src", "frame-src", "worker-src", "style-src-elem", "other"]),
    contentType: new Set(["text", "multimodal_text", "code", "other"]),
    type: new Set(["mainFrame", "subFrame", "stylesheet", "script", "image", "font", "object", "xhr", "ping", "cspReport", "media", "webSocket", "other"]),
    error: new Set(["net::ERR_ABORTED", "net::ERR_FAILED", "net::ERR_BLOCKED_BY_CLIENT", "net::ERR_BLOCKED_BY_RESPONSE", "net::ERR_CONNECTION_RESET", "net::ERR_CONNECTION_REFUSED", "net::ERR_TIMED_OUT", "net::ERR_NAME_NOT_RESOLVED", "other"]),
  };
  const result = {};
  if (!row || typeof row !== "object" || depth > 3) return result;
  for (const [key, value] of Object.entries(row)) {
    if (booleans.has(key) && typeof value === "boolean") result[key] = value;
    else if (numbers.has(key) && typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e9) result[key] = value;
    else if (Object.hasOwn(strings, key) && strings[key].has(value)) result[key] = value;
    else if (["app", "electron", "chrome"].includes(key) && typeof value === "string" && /^\d+(?:\.\d+){2,3}(?:-[a-z0-9.-]+)?$/i.test(value)) result[key] = value;
    else if (["messages", "metadata", "richFailures"].includes(key) && Array.isArray(value)) result[key] = value.slice(0, 24).map(v => sanitize(v, depth + 1));
  }
  return result;
}

function install() {
  if (!process.argv.includes("--diagnose-rendering")) return;
  const browserAgentRequested = process.argv.includes("--diagnose-browser-agent");
  if (browserAgentRequested) app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|chatgpt-desktop)\/\S+/gi, "");
  const emit = row => console.log("[render-diagnostic] " + JSON.stringify(sanitize(row)));
  const originKind = raw => {
    try {
      const host = new URL(raw).hostname;
      return ["chatgpt.com", "cdn.platform.openai.com", "cdn.oaistatic.com", "auth.openai.com"].includes(host) ? host : "other";
    } catch { return "opaque"; }
  };
  const purpose = raw => {
    try {
      const pathname = new URL(raw).pathname;
      if (/^\/backend-api\/(?:f\/)?conversations\/[0-9a-f-]{36}(?:\/|$)/i.test(pathname)) return "history-plural";
      if (/^\/backend-api\/(?:f\/)?conversation\/[0-9a-f-]{36}(?:\/|$)/i.test(pathname)) return "history-singular";
      if (/^\/backend-api\/share\//.test(pathname)) return "share";
      if (/\.m?js$/.test(pathname)) return "asset";
    } catch {}
    return "other";
  };
  app.on("browser-window-created", (_event, window) => {
    const wc = window.webContents;
    wc.setUserAgent(app.userAgentFallback);
    wc.session.setUserAgent(app.userAgentFallback);
    emit({ event: "runtime", app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, browserAgentRequested });
    wc.on("did-fail-load", (_event, code, _description, url, mainFrame) => emit({ event: "load-failed", code, origin: originKind(url), mainFrame }));
    wc.on("will-redirect", (event, url, _inPlace, mainFrame) => {
      const row = { event: "redirect", origin: originKind(event.url || url), mainFrame: event.isMainFrame ?? mainFrame };
      setImmediate(() => emit({ ...row, prevented: Boolean(event.defaultPrevented) }));
    });
    wc.on("console-message", event => {
      if (event.level !== "error") return;
      const text = event.message || "";
      emit({ event: "renderer-error", origin: originKind(event.sourceId),
        csp: /content security policy|refused to/i.test(text),
        moduleLoad: /dynamically imported module|Loading chunk|ChunkLoadError/i.test(text),
        timeout: /timed? ?out|timeout/i.test(text), interactive: /\bdil\b|runner|sandbox/i.test(text) });
    });
    wc.session.webRequest.onErrorOccurred(details => {
      const origin = originKind(details.url);
      if (!["chatgpt.com", "cdn.platform.openai.com", "cdn.oaistatic.com"].includes(origin)) return;
      emit({ event: "request-failed", origin, purpose: purpose(details.url), type: details.resourceType, error: details.error });
    });
    wc.session.webRequest.onCompleted(details => {
      const kind = purpose(details.url);
      if (originKind(details.url) === "chatgpt.com" && ["history-plural", "history-singular", "share"].includes(kind)) emit({ event: "history-request", purpose: kind, status: details.statusCode });
    });
    let active = false;
    const timer = setInterval(async () => {
      if (active || wc.isDestroyed()) return;
      active = true;
      try {
        if (originKind(wc.getURL()) !== "chatgpt.com") return;
        const result = await wc.executeJavaScript(`(() => {
          const state = window.__chatgptRenderDiagnostics;
          const metadata = [];
          const seen = new Set();
          for (const element of document.querySelectorAll('[data-conversation-role="assistant"], [data-message-author-role="assistant"], [data-dil-widget-copy-target], [data-dil-source-message-id]')) {
            const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
            for (let fiber = key ? element[key] : null, depth = 0; fiber && depth < 100; fiber = fiber.return, depth++) {
              const props = fiber.memoizedProps;
              for (const rich of [props?.metadata?.model_dil_v2, props?.reference?.model_dil_v2, props?.message?.metadata?.model_dil_v2]) {
                if (!rich || seen.has(rich)) continue;
                seen.add(rich);
                if (metadata.length < 24) metadata.push({ richCode: typeof rich.code === 'string', fallbackPresent: typeof rich.fallbackMarkdown === 'string', codeRejected: rich.programFailure != null, payloadFiltered: rich.appData?.__FILTERED_REASON__ != null });
              }
            }
          }
          return { events: state ? state.queue.splice(0, 32) : [], snapshot: {
            route: location.pathname.startsWith('/c/') ? 'conversation' : location.pathname.startsWith('/share/') ? 'share' : location.pathname === '/' ? 'home' : 'other',
            observer: Boolean(state),
            nativeAgent: navigator.userAgent.includes('Electron/') || navigator.userAgent.toLowerCase().includes('chatgpt-desktop/'),
            messages: document.querySelectorAll('[data-conversation-role], [data-message-author-role]').length,
            richComponents: document.querySelectorAll('[data-d-component]').length,
            richRoots: document.querySelectorAll('[data-dil-source-message-id], [data-dil-widget-copy-target]').length,
            richFailures: Array.from(document.querySelectorAll('[data-dil-render-failed], [data-internal-render-dil-v2-failure-stage]'), e => ({ hasStage: e.hasAttribute('data-internal-render-dil-v2-failure-stage') })),
            knownFallbackPlaceholder: document.body?.textContent.includes('Current selection unavailable') || false,
            injectedUserScripts: Object.keys(window.__chatgptDesktopUserScriptRegistry || {}).length, metadata
          }};
        })()`);
        for (const event of result.events) emit(event);
        emit({ event: "snapshot", ...result.snapshot });
      } catch { emit({ event: "snapshot-unavailable" }); }
      finally { active = false; }
    }, 6000);
    window.on("closed", () => clearInterval(timer));
  });
}
module.exports = { install, sanitize };
