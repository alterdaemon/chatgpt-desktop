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
const { app, BrowserWindow } = require("electron");

// This runs as a bare script, so Electron would default the app name to
// "Electron" and use a different userData directory than the real app. Mirror
// main.js exactly, or the warmed session lands in a cookie jar the app never
// reads.
const dataRoot = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
app.setPath("userData", path.join(dataRoot, "chatgpt-desktop"));

const CHATGPT_URL = "https://chatgpt.com/";
const LOGIN_URL = "https://chatgpt.com/auth/login";

const email = process.env.WARM_LOGIN_EMAIL;
const password = process.env.WARM_LOGIN_PASSWORD;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function probe(wc) {
  return wc
    .executeJavaScript(
      `(() => ({
        host: location.host,
        email: !!document.querySelector("input[type='email']"),
        password: !!document.querySelector("input[type='password']"),
        composer: !!document.querySelector("#prompt-textarea")
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

async function signIn(wc) {
  await wc.loadURL(LOGIN_URL);

  const loginForm = await waitFor(wc, (state) => state.email, 45000);
  if (!loginForm) {
    throw new Error("ChatGPT login form never rendered during warm-up.");
  }

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
    (state) => state.password && /auth\.openai\.com/.test(state.host),
    60000
  );
  if (!passwordScreen) {
    throw new Error(
      "auth.openai.com never showed the password screen. Cloudflare is challenging this egress IP; " +
        "run the live suite from a non-challenged network."
    );
  }

  if (!(await clickTrusted(wc, "input[type='password']"))) {
    throw new Error("Could not focus the password field during warm-up.");
  }

  await sleep(500);
  await typeTrusted(wc, password);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  wc.sendInputEvent({ type: "char", keyCode: "Return" });
  wc.sendInputEvent({ type: "keyUp", keyCode: "Return" });

  const signedIn = await waitFor(wc, (state) => state.composer, 90000);
  if (!signedIn) {
    const state = await probe(wc);
    throw new Error(
      "Login did not complete during warm-up. Last state: " + JSON.stringify(state)
    );
  }
}

app.whenReady().then(async () => {
  if (!email || !password) {
    console.error("warm-login: missing credentials");
    app.exit(2);
    return;
  }

  // The window must be shown: sendInputEvent is only delivered to a visible,
  // focused window. Tests run under xvfb, so nothing appears on a real display.
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  try {
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
    console.error("warm-login: " + (error && error.message ? error.message : String(error)));
    app.exit(1);
  }
});
