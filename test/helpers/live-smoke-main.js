// Mandatory real prompt/reply check through the actual app, with no debugger.
// Only fixed errors, booleans and counts are written; never message/account text.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { COMPOSER_SELECTOR, inspectLiveReadiness } = require("./live-composer");
const { findLiveMessages } = require("./live-message");
const output = process.env.SMOKE_AUDIT_OUT;
if (!output || !["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"].every(key => process.env[key])) {
  throw new Error("Live smoke requires an output path and isolated XDG profile roots.");
}
const PROMPT = "Reply with exactly LIVE_SMOKE_OK and no other text.";
const result = {};
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(output, JSON.stringify(result));
  app.exit(code);
}
setTimeout(() => { result.error = "smoke-timeout"; finish(2); }, 210000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on("browser-window-created", (_event, win) => {
  (async () => {
    const wc = win.webContents;
    const run = source => wc.executeJavaScript(source, true);
    const readiness = () => run(`(${inspectLiveReadiness})(${JSON.stringify(COMPOSER_SELECTOR)})`);
    try {
      result.debuggerAttached = app.commandLine.hasSwitch("remote-debugging-port") ||
        app.commandLine.hasSwitch("inspect") || wc.debugger.isAttached();
      if (result.debuggerAttached) { result.error = "debugger-attached"; finish(3); return; }
      const deadline = Date.now() + 60000;
      let state = {};
      while (Date.now() < deadline) {
        state = await readiness().catch(() => ({}));
        if (state.ready || state.signInRequired) break;
        await delay(500);
      }
      if (!state.ready) {
        result.error = state.challenge ? "site-challenge" : state.signInRequired ? "sign-in-required" : "composer-unavailable";
        finish(4); return;
      }
      const preferences = wc.getLastWebPreferences();
      result.security = {
        contextIsolation: preferences.contextIsolation === true,
        nodeIntegration: preferences.nodeIntegration === true,
        sandbox: preferences.sandbox === true,
        processHidden: await run("typeof process === 'undefined'"),
        requireHidden: await run("typeof require === 'undefined'"),
      };
      const before = await run(`({ users: (${findLiveMessages})("user").length, assistants: (${findLiveMessages})().length })`);
      const draft = await run(`(() => {
        const composer = [...document.querySelectorAll(${JSON.stringify(COMPOSER_SELECTOR)})]
          .find(element => element.getBoundingClientRect().height > 0);
        const text = (composer.value ?? composer.innerText ?? "").trim();
        composer.focus();
        return { empty: text === "", ours: text === ${JSON.stringify(PROMPT)} };
      })()`);
      if (!draft.empty && !draft.ours) { result.error = "unrelated-draft-present"; finish(5); return; }
      win.focus();
      if (draft.empty) await wc.insertText(PROMPT);
      const entered = await run(`(() => {
        const composer = [...document.querySelectorAll(${JSON.stringify(COMPOSER_SELECTOR)})]
          .find(element => element.getBoundingClientRect().height > 0);
        return (composer.value ?? composer.innerText ?? "").trim() === ${JSON.stringify(PROMPT)};
      })()`);
      if (!entered) { result.error = "prompt-entry-failed"; finish(6); return; }
      let send;
      const sendDeadline = Date.now() + 5000;
      while (Date.now() < sendDeadline) {
        send = await run(`(() => {
          const composer = [...document.querySelectorAll(${JSON.stringify(COMPOSER_SELECTOR)})]
            .find(element => element.getBoundingClientRect().height > 0);
          const buttons = [...(composer.closest("form")?.querySelectorAll("button") || [])]
            .filter(element => !element.disabled && /\\bsend\\b/i.test(element.getAttribute("aria-label") || element.textContent || "") && element.getBoundingClientRect().width > 0);
          if (buttons.length !== 1) return null;
          const rect = buttons[0].getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        })()`);
        if (send) break;
        await delay(100);
      }
      if (!send) { result.error = "send-control-unavailable"; finish(8); return; }
      wc.sendInputEvent({ type: "mouseDown", ...send, button: "left", clickCount: 1 });
      wc.sendInputEvent({ type: "mouseUp", ...send, button: "left", clickCount: 1 });
      result.promptSent = false;
      const replyDeadline = Date.now() + 120000;
      while (Date.now() < replyDeadline) {
        const observed = await run(`(() => {
          const messages = (${findLiveMessages})();
          return {
            users: (${findLiveMessages})("user").length,
            assistants: messages.length,
            promptSent: (${findLiveMessages})("user").length > ${before.users},
            replyVerified: messages.length > ${before.assistants} && messages.at(-1).textContent.includes("LIVE_SMOKE_OK")
          };
        })()`).catch(() => ({ promptSent: false, replyVerified: false }));
        result.promptSent = observed.promptSent;
        result.replyVerified = observed.replyVerified;
        result.messageCounts = { users: observed.users || 0, assistants: observed.assistants || 0 };
        if (result.promptSent && result.replyVerified) { finish(0); return; }
        await delay(500);
      }
      result.error = "assistant-reply-not-observed"; finish(7);
    } catch { result.error = "smoke-operation-failed"; finish(1); }
  })();
});
require(path.resolve(__dirname, "../../main.js"));
