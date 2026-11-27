// Debugger-free check of the REAL signed-in usage meter. The audit account normally has no usage
// indicator (the site only shows it for accounts that report usage), so this helper rewrites the
// account's own /backend-api/ JSON responses inside this one test session so the site renders its
// genuine component, then verifies the persistent percentage with NO pointer input first.
//
// It only changes numbers/plan labels in responses the page already requested. It sends no prompt,
// makes no extra request and records only structure and booleans, never message text or account data.
const fs = require("fs");
const path = require("path");
const { app, net, session } = require("electron");

const output = process.env.USAGE_AUDIT_OUT;
if (!output || ![ "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME" ].every(key => process.env[key])) {
  throw new Error("Usage audit requires an output path and isolated XDG profile roots.");
}
const USED = 99; // the site then reports 1% remaining
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { stubbedResponses: 0 };
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(output, JSON.stringify(result));
  app.exit(code);
}
setTimeout(() => { result.error = result.error || "audit-timeout"; finish(2); }, 180000);

function stub(data, pathname) {
  let changed = 0;
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if ((key === "used_percent" || key === "usedPercent") && typeof value[key] === "number") { value[key] = USED; changed++; }
      else if (key === "plan_type" && value[key] === "free") { value[key] = "plus"; changed++; }
      else walk(value[key]);
    }
  };
  walk(data);
  if (/\/wham\/usage$/.test(pathname) && data && typeof data === "object") {
    const window = data.rate_limit && data.rate_limit.primary_window;
    if (window) { window.limit_window_seconds = 604800; window.reset_after_seconds = 300000; data.rate_limit.secondary_window = null; }
    data.ambient_usage = { default: { source: { kind: "included", heading: "Usage" },
      menu: { rows: [{ label: "Weekly", value: { text: "1%", tone: "warning" } }], actions: [] } } };
    changed++;
  }
  return changed;
}

app.whenReady().then(() => {
  session.defaultSession.protocol.handle("https", async request => {
    const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    try {
      const url = new URL(request.url);
      if (url.hostname !== "chatgpt.com" || !url.pathname.startsWith("/backend-api/")) return response;
      if (!/json/.test(response.headers.get("content-type") || "")) return response;
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }); }
      if (!stub(data, url.pathname)) return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
      result.stubbedResponses++;
      const headers = new Headers(response.headers);
      headers.delete("content-length"); headers.delete("content-encoding");
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
    } catch { return response; }
  });
});

function inspect() {
  const meters = [...document.querySelectorAll("button[aria-description]")].filter(element =>
    element.querySelector("svg") && element.querySelector("path[pathLength='100']") && /%/.test(element.getAttribute("aria-description")));
  const meter = meters[0];
  const labels = [...document.querySelectorAll("[data-chatgpt-desktop-usage-percent]")];
  const tooltip = [...document.querySelectorAll("[role='tooltip']")].some(element => /\d\s*%|%\s*\d/.test(element.textContent));
  const state = { meters: meters.length, labels: labels.length, tooltipWithPercent: tooltip, pointerEvents: window.__usagePointerEvents || 0 };
  if (!meter) return state;
  const rect = meter.getBoundingClientRect();
  state.meterRect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
  const label = labels[0];
  if (label) {
    const text = label.getBoundingClientRect();
    const style = getComputedStyle(label);
    Object.assign(state, {
      text: label.textContent,
      visible: text.width > 0 && text.height > 0 && style.visibility === "visible" && style.display !== "none",
      covers: text.left <= rect.left && text.top <= rect.top && text.right >= rect.right && text.bottom >= rect.bottom,
      white: style.color === "rgb(255, 255, 255)", size: style.fontSize, bold: Number(style.fontWeight) >= 700,
    });
  }
  return state;
}

app.on("browser-window-created", (_event, window) => {
  const wc = window.webContents;
  const run = source => wc.executeJavaScript(source, true);
  const snapshot = () => run(`(${inspect})()`);
  const waitFor = async (predicate, ms) => {
    const deadline = Date.now() + ms;
    let state = {};
    while (Date.now() < deadline) {
      try { state = await snapshot(); if (predicate(state)) return state; } catch {}
      await delay(300);
    }
    return state;
  };
  (async () => {
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        await delay(1500);
        if (await run('Boolean(document.querySelector("main form"))').catch(() => false)) break;
      }
      // Count pointer input from here on: the idle snapshots must be taken with none.
      await run('window.__usagePointerEvents = 0; addEventListener("pointermove", () => { window.__usagePointerEvents++; }, true);');
      const idle = await waitFor(state => state.meters > 0 && state.labels > 0, 40000);
      result.meterRendered = idle.meters > 0;
      if (!result.meterRendered) { result.error = "meter-not-rendered"; finish(3); return; }
      await delay(2500);
      result.idle = await snapshot();

      const point = { x: result.idle.meterRect.x + Math.round(result.idle.meterRect.w / 2), y: result.idle.meterRect.y + Math.round(result.idle.meterRect.h / 2) };
      window.focus();
      wc.sendInputEvent({ type: "mouseMove", ...point });
      result.hover = await waitFor(state => state.tooltipWithPercent, 6000);
      await delay(1500);
      result.hoverLater = await snapshot();

      wc.sendInputEvent({ type: "mouseMove", x: 900, y: 450 });
      await delay(2500);
      result.afterHover = await snapshot();

      // Fresh document, pointer still elsewhere: the percentage must come back without hovering.
      wc.reload();
      await delay(3000);
      const reloaded = await waitFor(state => state.meters > 0 && state.labels > 0, 40000);
      await delay(1500);
      result.reloaded = await snapshot();
      result.reloadedHadLabel = reloaded.labels > 0;
      finish(0);
    } catch (error) { result.error = String(error && error.message || error).slice(0, 160); finish(1); }
  })();
});
require(path.resolve(__dirname, "../../main.js"));
