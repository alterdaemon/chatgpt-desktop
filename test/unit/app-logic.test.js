const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  DEFAULT_INITIAL_URL,
  getInitialUrl,
  isAllowedExternalUrl,
  loadScriptManifest,
  normalizeSettings,
} = require("../../app-logic");

const defaults = {
  spellCheckEnabled: false,
  showShortcut: "CommandOrControl+Shift+Space",
  zoomFactor: 1,
  vimiumNavigationEnabled: true,
};

test("normalizes valid settings and rejects malformed values", () => {
  assert.deepEqual(
    normalizeSettings(
      {
        spellCheckEnabled: true,
        showShortcut: "  Control+Shift+P  ",
        zoomFactor: 8,
        vimiumNavigationEnabled: false,
      },
      defaults
    ),
    {
      spellCheckEnabled: true,
      showShortcut: "Control+Shift+P",
      zoomFactor: 3,
      vimiumNavigationEnabled: false,
    }
  );
  assert.deepEqual(normalizeSettings({ showShortcut: "", zoomFactor: Number.NaN }, defaults), defaults);
  assert.equal(normalizeSettings({ zoomFactor: 0.1 }, defaults).zoomFactor, 0.5);
});

test("allows only supported external URL protocols", () => {
  assert.equal(isAllowedExternalUrl("https://example.test"), true);
  assert.equal(isAllowedExternalUrl("http://example.test"), true);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("file:///tmp/file"), false);
  assert.equal(isAllowedExternalUrl("not a URL"), false);
});

test("uses a loopback fixture only in test mode", () => {
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.1:3456/fixture" }), "http://127.0.0.1:3456/fixture");
  assert.equal(getInitialUrl({ NODE_ENV: "production", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.1:3456/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://localhost:3456/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "https://chatgpt.com/" }), DEFAULT_INITIAL_URL);
});

test("loads sorted JavaScript customization scripts with content signatures", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-desktop-scripts-"));
  try {
    fs.writeFileSync(path.join(directory, "b.js"), "window.second = true;");
    fs.writeFileSync(path.join(directory, "a.js"), "window.first = true;");
    fs.writeFileSync(path.join(directory, "ignored.txt"), "ignored");

    const manifest = loadScriptManifest(directory);
    assert.deepEqual(manifest.map((script) => script.fileName), ["a.js", "b.js"]);
    assert.match(manifest[0].signature, /^[a-f0-9]{64}$/);
    assert.notEqual(manifest[0].signature, manifest[1].signature);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
