const assert = require("node:assert/strict");
const test = require("node:test");
const { parseSessionCookies } = require("../helpers/live-session");

const cookie = {
  name: "__Secure-next-auth.session-token",
  value: "fixture-session-token",
  domain: ".chatgpt.com",
  expirationDate: Date.now() / 1000 + 3600,
};

test("leaves session bootstrap optional", () => {
  assert.deepEqual(parseSessionCookies(undefined), []);
  assert.deepEqual(parseSessionCookies(""), []);
});

test("normalizes first-party session cookies and ignores unrelated properties", () => {
  const [parsed] = parseSessionCookies(JSON.stringify([{ ...cookie, url: "http://untrusted.example", path: "/other", secure: false }]));
  assert.equal(parsed.url, "https://chatgpt.com/");
  assert.equal(parsed.path, "/");
  assert.equal(parsed.secure, true);
  assert.equal(parsed.httpOnly, true);
  assert.equal(parsed.value, cookie.value);
});

test("accepts host-only and chunked authentication cookies", () => {
  const parsed = parseSessionCookies(JSON.stringify([
    { ...cookie, name: "next-auth.session-token.0", domain: "chatgpt.com" },
    { ...cookie, name: "__Secure-authjs.session-token.1" },
  ]));
  assert.equal(parsed.length, 2);
});

test("rejects malformed session bootstrap without including its contents in errors", () => {
  for (const source of ["fixture-private-value", "{}", "[]", "[null]"]) {
    assert.throws(() => parseSessionCookies(source), (error) => !error.message.includes("fixture-private-value"));
  }
});

test("rejects unrelated, expired, or invalid cookies without leaking their values", () => {
  for (const invalid of [
    { ...cookie, domain: "chatgpt.com.untrusted.example" },
    { ...cookie, domain: "auth.openai.com" },
    { ...cookie, name: "unrelated-cookie" },
    { ...cookie, value: "" },
    { ...cookie, expirationDate: 1 },
    { ...cookie, expirationDate: "tomorrow" },
  ]) {
    assert.throws(() => parseSessionCookies(JSON.stringify([invalid])), (error) => !error.message.includes(cookie.value));
  }
});
