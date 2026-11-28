const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { loginFailureMessage, probe, rememberSession } = require("../helpers/warm-login-main");
const { parseSessionCookies } = require("../helpers/live-session");
const { warmupFailureDetail } = require("../helpers/warm-live-profile");

test("names blocked sign-ins and expired sessions without recording page or cookie values", async () => {
  const privateValue = "PRIVATE_VALUE_MUST_NOT_BE_RECORDED";
  const inspect = (text, selector = "", title = privateValue, hostname = "auth.openai.com") => probe({
    executeJavaScript: async (source) => vm.runInNewContext(source, {
      location: { hostname },
      document: {
        title,
        body: { innerText: text },
        querySelector: (query) => selector && query.includes(selector) ? {} : null,
      },
    }),
  });

  for (const state of [
    await inspect("Verify you are human " + privateValue),
    await inspect(privateValue, "", "Just a moment..."),
  ]) {
    assert.equal(loginFailureMessage(state), "Cloudflare challenge blocked ChatGPT sign-in during warm-up. Use a non-challenged network.");
    assert.ok(!JSON.stringify(state).includes(privateValue));
  }

  for (const state of [
    await inspect("Check your inbox " + privateValue),
    await inspect("Enter the code sent to your email " + privateValue),
    await inspect(privateValue, "one-time-code"),
  ]) {
    assert.equal(loginFailureMessage(state), "ChatGPT sign-in requires an emailed code. Complete debugger-free assisted verification in the live profile before rerunning the live suite.");
    assert.ok(!JSON.stringify(state).includes(privateValue));
  }

  const generic = await inspect(privateValue);
  assert.equal(loginFailureMessage(generic), "Login did not complete during warm-up.");
  assert.equal(loginFailureMessage(null), "Login did not complete during warm-up.");
  assert.equal(loginFailureMessage(generic, "ChatGPT login form never rendered during warm-up."), "ChatGPT login form never rendered during warm-up.");
  assert.equal((await inspect("Check your inbox", "", "", "chatgpt.com")).emailCode, false);
  assert.ok(Object.values(generic).every((value) => typeof value === "boolean"));
  assert.equal(await probe({ executeJavaScript: async () => { throw new Error(privateValue); } }), null);

  assert.throws(() => parseSessionCookies(JSON.stringify([{
    name: "__Secure-next-auth.session-token",
    value: privateValue,
    domain: ".chatgpt.com",
    expirationDate: 1,
  }])), {
    message: "CHATGPT_TEST_SESSION_COOKIES has expired. Refresh the CI secret from the authenticated live profile.",
  });
});

test("starts the warm-up under Electron's default-app loader", async () => {
  const filename = path.resolve(__dirname, "../helpers/warm-login-main.js");
  const requireHelper = createRequire(filename);
  let loadedElectron = false;
  let exitCode;
  const requireStub = (id) => {
    if (id !== "electron") return requireHelper(id);
    loadedElectron = true;
    return { app: {
      getPath: () => "/unused-home",
      setPath: () => {},
      whenReady: () => Promise.resolve(),
      exit: (code) => { exitCode = code; },
    } };
  };
  requireStub.main = {};
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    __filename: filename,
    require: requireStub,
    module: { exports: {} },
    process: { argv: ["electron", filename], versions: { electron: "45.5.0" }, env: {} },
    console: { error: () => {} },
  });
  assert.equal(loadedElectron, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exitCode, 2);
});

test("selects an offered remember-session control without unchecking it or choosing unrelated consent", async () => {
  for (const [label, checked, expected] of [
    ["Remember me", false, 2],
    ["Keep me signed in", false, 2],
    ["Trust this device", false, 2],
    ["Remember me", true, 0],
    ["Subscribe to updates", false, 0],
  ]) {
    const events = [];
    const input = {
      labels: [{ innerText: label }], checked, disabled: false,
      getAttribute: () => null, closest: () => null,
      getBoundingClientRect: () => ({ x: 10, y: 20, width: 20, height: 20 }),
    };
    await rememberSession({
      executeJavaScript: async source => vm.runInNewContext(source, {
        location: { hostname: "auth.openai.com" },
        document: { querySelectorAll: () => [input] },
      }),
      sendInputEvent: event => events.push(event),
    });
    assert.equal(events.length, expected);
    if (expected) assert.deepEqual(events.map(event => event.type), ["mouseDown", "mouseUp"]);
  }
});

test("warm-up failures retain only fixed cause messages, never raw browser diagnostics", () => {
  const privateValue = "PRIVATE_VALUE_MUST_NOT_BE_RECORDED";
  for (const state of [{ challenge: true }, { emailCode: true }, null]) {
    const fixed = "warm-login: " + loginFailureMessage(state);
    assert.equal(warmupFailureDetail(privateValue + "\n" + fixed + "\n"), fixed);
  }
  assert.equal(warmupFailureDetail("warm-login: " + privateValue), "");
  const expired = "warm-login: CHATGPT_TEST_SESSION_COOKIES has expired. Refresh the CI secret from the authenticated live profile.";
  assert.equal(warmupFailureDetail(privateValue + "\n" + expired), expired);
});
