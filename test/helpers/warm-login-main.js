// Electron main process for the live-suite profile warm-up.
//
// This runs as its own tiny Electron app with no debugger attached, because the
// live login cannot be completed from the Playwright session:
//   * Cloudflare serves auth.openai.com a managed challenge to CDP-attached
//     sessions, so the password screen never renders there.
//   * OpenAI's password form ignores synthetic events (isTrusted === false),
//     so executeJavaScript cannot submit it.
// Typing through webContents.sendInputEvent goes through the browser input
// pipeline and is indistinguishable from a real user, which clears both.
//
// The resulting session cookies persist in the shared profile directory, so the
// Playwright run launches the real app already authenticated.
const path = require("path");
const { COMPOSER_SELECTOR } = require("./live-composer");
const { parseSessionCookies } = require("./live-session");
const { getBrowserUserAgent } = require("../../app-logic");

const CHATGPT_URL = "https://chatgpt.com/";
const LOGIN_URL = "https://chatgpt.com/auth/login";

const email = process.env.WARM_LOGIN_EMAIL;
const password = process.env.WARM_LOGIN_PASSWORD;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class WarmLoginError extends Error {}

function loginFailureMessage(state, fallback = "Login did not complete during warm-up.") {
  if (state?.challenge) {
    return "Cloudflare challenge blocked ChatGPT sign-in during warm-up. Use a non-challenged network.";
  }
  if (state?.emailCode) {
    return "ChatGPT sign-in requires an emailed code. Complete debugger-free assisted verification in the live profile before rerunning the live suite.";
  }
  return fallback;
}

function probe(wc) {
  return wc
    .executeJavaScript(
      `(() => ({
        authPage: location.hostname === "auth.openai.com",
        challenge: /just a moment|verify you are human|checking your browser/i.test(document.title + " " + (document.body?.innerText || "")),
        emailCode: location.hostname === "auth.openai.com" && (
          !!document.querySelector("input[autocomplete='one-time-code'], input[name='code']") ||
          /check your (?:email|inbox)|code.{0,40}(?:email|inbox)|(?:email|inbox).{0,40}code/i.test(document.body?.innerText || "")
        ),
        email: !!document.querySelector("input[type='email']"),
        password: !!document.querySelector("input[type='password']"),
        composer: !!document.querySelector(${JSON.stringify(COMPOSER_SELECTOR)})
      }))()`,
      true
    )
    .catch(() => null);
}

async function waitFor(wc, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    const state = await probe(wc);
    if (state && predicate(state)) {
      return state;
    }
  }
  return null;
}

async function typeTrusted(wc, text) {
  for (const character of text) {
    wc.sendInputEvent({ type: "keyDown", keyCode: character });
    wc.sendInputEvent({ type: "char", keyCode: character });
    wc.sendInputEvent({ type: "keyUp", keyCode: character });
    await sleep(25);
  }
}

async function clickTrusted(wc, selector) {
  const box = await wc.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`,
    true
  );

  if (!box) {
    return false;
  }

  wc.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
  return true;
}

async function rememberSession(wc) {
  const box = await wc.executeJavaScript(`(() => {
    if (location.hostname !== "auth.openai.com") return null;
    for (const input of document.querySelectorAll("input[type='checkbox'], [role='checkbox']")) {
      const labels = [...(input.labels || [])];
      const label = [input.getAttribute("aria-label") || "", ...labels.map(label => label.innerText), input.closest("label")?.innerText || ""].join(" ");
      if (!/remember me|stay signed in|keep me signed in|trust this (?:browser|device)/i.test(label)) continue;
      if (input.disabled || input.checked || input.getAttribute("aria-checked") === "true") continue;
      const target = input.getBoundingClientRect().width > 0 ? input : labels.find(label => label.getBoundingClientRect().width > 0);
      if (!target) continue;
      const rect = target.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }
    return null;
  })()`).catch(() => null);
  if (!box) return;
  wc.sendInputEvent({ type: "mouseDown", ...box, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", ...box, button: "left", clickCount: 1 });
}

async function signIn(wc) {
  await wc.loadURL(LOGIN_URL);

  const loginForm = await waitFor(wc, (state) => state.email, 45000);
  if (!loginForm) {
    throw new WarmLoginError(loginFailureMessage(await probe(wc), "ChatGPT login form never rendered during warm-up."));
  }
  await rememberSession(wc);

  // The email step is a plain form, so a scripted submit is enough. Selecting a
  // button here is not: the same form also holds the Google/Apple/phone buttons.
  await wc.executeJavaScript(
    `(() => {
      const el = document.querySelector("input[type='email']");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(email)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.form.requestSubmit();
    })()`,
    true
  );

  const passwordScreen = await waitFor(
    wc,
    (state) => state.password && state.authPage,
    60000
  );
  if (!passwordScreen) {
    throw new WarmLoginError(loginFailureMessage(await probe(wc), "auth.openai.com never showed the password screen."));
  }
  await rememberSession(wc);

  if (!(await clickTrusted(wc, "input[type='password']"))) {
    throw new WarmLoginError("Could not focus the password field during warm-up.");
  }

  await sleep(500);
  await typeTrusted(wc, password);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  wc.sendInputEvent({ type: "char", keyCode: "Return" });
  wc.sendInputEvent({ type: "keyUp", keyCode: "Return" });

  const signedIn = await waitFor(wc, (state) => state.composer, 90000);
  if (!signedIn) {
    throw new WarmLoginError(loginFailureMessage(await probe(wc)));
  }
}

async function warmLogin() {
  const { app, BrowserWindow } = require("electron");
  // Mirror main.js: a bare script otherwise uses Electron's unrelated cookie jar.
  const dataRoot = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
  app.setPath("userData", path.join(dataRoot, "chatgpt-desktop"));
  await app.whenReady();

  if (!email || !password) {
    console.error("warm-login: missing credentials");
    app.exit(2);
    return;
  }

  let cookies;
  try {
    cookies = parseSessionCookies(process.env.CHATGPT_TEST_SESSION_COOKIES);
  } catch (error) {
    // The parser emits fixed messages only, never cookie contents.
    console.error("warm-login: " + error.message);
    app.exit(1);
    return;
  }

  // The window must be shown: sendInputEvent is only delivered to a visible,
  // focused window. Tests run under xvfb, so nothing appears on a real display.
  app.userAgentFallback = getBrowserUserAgent(app.userAgentFallback);
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setUserAgent(app.userAgentFallback);
  win.webContents.session.setUserAgent(app.userAgentFallback);

  try {
    for (const cookie of cookies) {
      await win.webContents.session.cookies.set(cookie);
    }
    await win.webContents.loadURL(CHATGPT_URL);
    const existing = await waitFor(win.webContents, (state) => state.composer, 20000);

    if (!existing) {
      await signIn(win.webContents);
    }

    // Let the session cookies flush to disk before the process exits.
    await win.webContents.session.cookies.flushStore();
    await sleep(1500);
    app.exit(0);
  } catch (error) {
    // Never serialize page state or raw Electron errors (which can contain URLs).
    console.error("warm-login: " + loginFailureMessage(
      await probe(win.webContents),
      error instanceof WarmLoginError ? error.message : undefined
    ));
    app.exit(1);
  }
}

// Electron's default-app loader keeps require.main pointing at its own module.
if (require.main === module || (
  process.versions.electron && path.resolve(process.argv[1] || "") === __filename
)) {
  warmLogin();
}

module.exports = { loginFailureMessage, probe, rememberSession };
