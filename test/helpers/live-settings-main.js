// Read-only Settings regression against the signed-in website, with no debugger.
// Emits only structural counts/booleans; never reads account values or sends a prompt.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { COMPOSER_SELECTOR } = require("./live-composer");

const output = process.env.SETTINGS_AUDIT_OUT;
if (!output || !["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"].every(key => process.env[key])) {
  throw new Error("Settings audit requires an output path and isolated XDG profile roots.");
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { checks: [] };
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(output, JSON.stringify(result));
  app.exit(code);
}
const timeout = setTimeout(() => { result.error = "audit-timeout"; finish(2); }, 180000);

function inspectPage(composerSelector) {
  const visible = element => Boolean(element && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
  const composer = [...document.querySelectorAll(composerSelector)].find(visible);
  const headings = [...document.querySelectorAll("main h1, main h2, main [role='heading']")].filter(visible).length;
  const controls = [...document.querySelectorAll("main input, main select, main [role='switch'], main [role='checkbox']")].filter(visible).length;
  const settingsLinks = [...document.querySelectorAll("main a[href]")].filter(element => {
    try { return visible(element) && new URL(element.href).pathname.startsWith("/settings"); } catch { return false; }
  }).length;
  const settingsRoute = location.pathname === "/settings/account";
  const fullBleed = Boolean(document.querySelector('[data-app-shell-main-content-layout="full-bleed"]'));
  const accountHeading = [...document.querySelectorAll("main h1, main h2")].some(element => visible(element) && element.textContent.trim() === "Account");
  return { composer: Boolean(composer), settingsRoute, fullBleed, headings, controls, settingsLinks,
    sameDocument: window.__settingsAuditDocument === true,
    settingsReady: settingsRoute && fullBleed && accountHeading && !composer };
}

app.on("browser-window-created", (_event, window) => {
  const wc = window.webContents;
  const inspect = () => wc.executeJavaScript(`(${inspectPage.toString()})(${JSON.stringify(COMPOSER_SELECTOR)})`, true);
  const waitFor = async predicate => {
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) {
      try { const state = await inspect(); if (predicate(state)) return state; } catch {}
      await delay(250);
    }
    return inspect();
  };
  (async () => {
    try {
      const initial = await waitFor(state => state.composer);
      if (!initial.composer) { result.error = "composer-unavailable"; finish(3); return; }
      result.menu = require("electron").Menu.getApplicationMenu().getMenuItemById("chatgpt-settings").enabled;
      for (const mode of ["shortcut", "menu"]) {
        if (mode === "menu") {
          await wc.executeJavaScript("history.back()");
          const ready = await waitFor(state => state.composer);
          if (!ready.composer) { result.error = "composer-unavailable"; finish(3); return; }
        }
        await wc.executeJavaScript(`(() => {
          window.__settingsAuditDocument = true;
          const editor = [...document.querySelectorAll(${JSON.stringify(COMPOSER_SELECTOR)})].find(element => element.getBoundingClientRect().height > 0);
          editor.focus();
        })()`, true);
        const zoom = wc.getZoomFactor();
        const font = await wc.executeJavaScript("getComputedStyle(document.body).fontFamily");
        window.focus();
        if (mode === "shortcut") {
          wc.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["control"] });
          wc.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["control"] });
        } else {
          require("electron").Menu.getApplicationMenu().getMenuItemById("chatgpt-settings").click();
        }
        const state = await waitFor(state => state.settingsReady);
        result.checks.push({ mode, ...state, zoomPreserved: wc.getZoomFactor() === zoom,
          fontPreserved: await wc.executeJavaScript(`getComputedStyle(document.body).fontFamily === ${JSON.stringify(font)}`) });
        if (!state.settingsReady) { result.error = "settings-not-rendered"; finish(4); return; }
      }
      clearTimeout(timeout);
      finish(0);
    } catch { result.error = "audit-failed"; finish(1); }
  })();
});
require(path.resolve(__dirname, "../../main.js"));
