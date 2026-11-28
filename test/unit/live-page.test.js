const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { COMPOSER_SELECTOR, inspectLiveReadiness } = require("../helpers/live-composer");
const { findLiveMessages } = require("../helpers/live-message");

test("readiness distinguishes a challenge, an explicit login and a signed-in composer", () => {
  for (const [composer, sidebar, title, login, expected] of [
    [false, false, "Just a moment...", false, "challenge"],
    [true, true, "ChatGPT", true, "signInRequired"],
    [true, true, "ChatGPT", false, "ready"],
    [true, true, "Just a moment", false, "ready"],
  ]) {
    const element = textContent => ({ textContent, getBoundingClientRect: () => ({ width: 100, height: 30 }) });
    const state = vm.runInNewContext(`(${inspectLiveReadiness})(${JSON.stringify(COMPOSER_SELECTOR)})`, {
      location: { hostname: "chatgpt.com" },
      document: {
        title,
        querySelector: selector => selector === "#app-shell-sidebar" && sidebar ? {} : null,
        querySelectorAll: selector => selector === COMPOSER_SELECTOR ? (composer ? [element("")] : []) : (login ? [element("Log in")] : []),
      },
    });
    assert.equal(state[expected], true);
    assert.equal(Object.values(state).every(value => typeof value === "boolean"), true);
  }
});

test("reply detection never accepts the user's echoed smoke marker", () => {
  const user = { textContent: "Reply with exactly LIVE_SMOKE_OK and no other text." };
  const heading = { textContent: "You said:" };
  const document = {
    querySelectorAll: selector => selector.includes("data-message-author-role='user'") ? [user]
      : selector.startsWith("h1") ? [heading] : [],
  };
  assert.equal(vm.runInNewContext(`(${findLiveMessages})().length`, { document }), 0);
  assert.equal(vm.runInNewContext(`(${findLiveMessages})("user").length`, { document }), 1);
});

test("reply detection supports both signed-in role markers and the labeled reply fallback", () => {
  const reply = { textContent: "LIVE_SMOKE_OK" };
  const document = { querySelectorAll: selector => selector.includes("data-message-author-role='assistant'") ? [reply] : [] };
  assert.equal(vm.runInNewContext(`(${findLiveMessages})()[0]`, { document }), reply);
  const heading = { textContent: "ChatGPT said:", parentElement: reply };
  reply.querySelector = () => ({});
  reply.contains = other => other === heading;
  document.body = {};
  document.querySelectorAll = selector => selector.startsWith("h1") ? [heading] : [];
  assert.equal(vm.runInNewContext(`(${findLiveMessages})()[0]`, { document }), reply);
});

test("rich reply detection scopes an assistant heading to its own message, never the user turn", () => {
  const unit = { textContent: "LIVE_SMOKE_OK", querySelector: () => null };
  const heading = { closest: () => unit, textContent: "Assistant" };
  const document = { querySelectorAll: () => [heading] };
  assert.equal(vm.runInNewContext(`(${findLiveMessages})()[0]`, { document }), unit);
  unit.querySelector = () => ({});
  assert.equal(vm.runInNewContext(`(${findLiveMessages})()[0]`, { document }), heading);
});
