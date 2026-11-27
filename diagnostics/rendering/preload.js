// Diagnostic-only observer. Never emits message text, URLs, IDs or credentials.
function diagnosticPageProbe(test) {
  function summarize(payload) {
    const result = { messages: [], totalMessages: 0 };
    const seen = new WeakSet();
    let budget = 30000;
    function visit(value, depth) {
      if (!value || typeof value !== "object" || seen.has(value) || depth > 14 || --budget < 0) return;
      seen.add(value);
      const role = value.author?.role;
      if (["assistant", "user", "tool", "system"].includes(role) && value.content) {
        result.totalMessages++;
        if (role === "assistant" && result.messages.length < 24) {
          const rich = value.metadata?.model_dil_v2;
          const parts = value.content.parts;
          const text = Array.isArray(parts) ? parts.filter(p => typeof p === "string").join("") : "";
          const fallback = typeof rich?.fallbackMarkdown === "string" ? rich.fallbackMarkdown : null;
          result.messages.push({
            richMetadata: rich != null,
            richCode: typeof rich?.code === "string",
            fallbackPresent: fallback != null,
            fallbackVersionSupported: rich?.fallbackMarkdownVersion === 1,
            textEqualsFallback: fallback != null && text.trim() === fallback.trim(),
            knownFallbackPlaceholder: text.includes("Current selection unavailable"),
            codeRejected: rich?.programFailure != null,
            payloadFiltered: rich?.appData?.__FILTERED_REASON__ != null,
            legacyRich: value.metadata?.model_dil?.dil != null,
            parts: Array.isArray(parts) ? parts.length : 0,
            contentType: ["text", "multimodal_text", "code"].includes(value.content.content_type) ? value.content.content_type : "other",
          });
        }
      }
      if (Array.isArray(value)) value.forEach(v => visit(v, depth + 1));
      else for (const [key, child] of Object.entries(value)) {
        if (!["code", "constants", "appData", "fallbackMarkdown", "content", "title"].includes(key)) visit(child, depth + 1);
      }
    }
    visit(payload, 0);
    return result;
  }
  if (test && Object.prototype.hasOwnProperty.call(test, "payload")) return summarize(test.payload);
  if (window.__chatgptRenderDiagnostics) return;
  const queue = [];
  const emit = data => { if (queue.length >= 32) queue.shift(); queue.push(data); };
  Object.defineProperty(window, "__chatgptRenderDiagnostics", { value: { queue }, configurable: true });
  function eligible(input, method) {
    try {
      if ((method || "GET").toUpperCase() !== "GET") return false;
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
      return url.origin === "https://chatgpt.com" && /^\/backend-api\/(?:f\/)?(?:conversations?|share)\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname);
    } catch { return false; }
  }
  function record(payload, transport, status) {
    const shape = summarize(payload);
    if (shape.totalMessages) emit({ event: "response-shape", transport, status, ...shape });
  }
  const originalFetch = window.fetch;
  const compared = new Set();
  window.fetch = function (input, init) {
    const observe = eligible(input, init?.method || input?.method);
    const promise = originalFetch.apply(this, arguments);
    if (observe) promise.then(response => {
      if (!response.headers.get("content-type")?.includes("application/json")) return;
      response.clone().json().then(async payload => {
        record(payload, "fetch", response.status);
        const shape = summarize(payload);
        if (!shape.messages.some(m => m.knownFallbackPlaceholder && !m.richCode)) return;
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (!/^\/backend-api\/conversations\/[0-9a-f-]{36}$/i.test(url.pathname) || compared.has(url.pathname) || compared.size >= 2) return;
        compared.add(url.pathname);
        url.pathname = url.pathname.replace("/conversations/", "/conversation/");
        url.search = "";
        try {
          // Reuse request context in the renderer only. Do not export headers.
          // At most two extra read-only legacy GETs; never prompts or writes.
          const legacy = await originalFetch.call(window, new Request(url, request));
          emit({ event: "response-shape", transport: "legacy-comparison", status: legacy.status, ...summarize(await legacy.json()) });
        } catch { emit({ event: "response-observation-unavailable" }); }
      }).catch(() => emit({ event: "response-observation-unavailable" }));
    }).catch(() => emit({ event: "response-fetch-failed" }));
    return promise;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (eligible(url, method)) this.addEventListener("load", () => {
      try {
        if (!this.getResponseHeader("content-type")?.includes("application/json")) return;
        record(this.responseType === "json" ? this.response : JSON.parse(this.responseText), "xhr", this.status);
      } catch { emit({ event: "response-observation-unavailable" }); }
    }, { once: true });
    return open.apply(this, arguments);
  };
  window.addEventListener("error", event => {
    const name = event.error?.name;
    emit({ event: "page-error", kind: ["TypeError", "SyntaxError", "ReferenceError", "RangeError"].includes(name) ? name : "Error" });
  });
  window.addEventListener("unhandledrejection", () => emit({ event: "unhandled-rejection" }));
  window.addEventListener("securitypolicyviolation", event => {
    const directive = event.effectiveDirective;
    emit({ event: "page-csp", directive: ["script-src-elem", "script-src", "connect-src", "frame-src", "worker-src", "style-src-elem"].includes(directive) ? directive : "other" });
  });
  emit({ event: "observer-ready" });
}

if (typeof process !== "undefined" && process.type === "renderer" && process.argv.includes("--render-diagnostic-enabled")) {
  require("electron").contextBridge.executeInMainWorld({ func: diagnosticPageProbe });
}
if (typeof module !== "undefined") module.exports = { diagnosticPageProbe };
