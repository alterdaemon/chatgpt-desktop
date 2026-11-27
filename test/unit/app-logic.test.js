const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  DEFAULT_INITIAL_URL,
  clampZoomFactor,
  getBrowserUserAgent,
  getInitialUrl,
  getPermissionDecision,
  isAllowedExternalUrl,
  isApplicationUrl,
  isChatGPTSettingsShortcut,
  isTrustedNavigationUrl,
  loadScriptManifest,
  normalizeSettings,
  normalizeTrustedHosts,
} = require("../../app-logic");

const defaults = {
  spellCheckEnabled: false,
  showShortcut: "CommandOrControl+Shift+Space",
  zoomFactor: 1,
  vimiumNavigationEnabled: true,
};

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-desktop-scripts-"));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

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

test("falls back to defaults for non-object settings payloads", () => {
  for (const payload of [null, undefined, 42, "settings", true, []]) {
    assert.deepEqual(normalizeSettings(payload, defaults), defaults, `payload: ${JSON.stringify(payload)}`);
  }
});

test("ignores settings fields that have the wrong type", () => {
  const normalized = normalizeSettings(
    {
      spellCheckEnabled: "true",
      showShortcut: 123,
      zoomFactor: "2",
      vimiumNavigationEnabled: 1,
    },
    defaults
  );

  assert.deepEqual(normalized, defaults);
});

test("rejects blank shortcuts and non-finite zoom factors", () => {
  assert.equal(normalizeSettings({ showShortcut: "   " }, defaults).showShortcut, defaults.showShortcut);
  assert.equal(normalizeSettings({ zoomFactor: Number.POSITIVE_INFINITY }, defaults).zoomFactor, 1);
  assert.equal(normalizeSettings({ zoomFactor: Number.NEGATIVE_INFINITY }, defaults).zoomFactor, 1);
});

test("returns a fresh settings object instead of mutating the defaults", () => {
  const normalized = normalizeSettings({ spellCheckEnabled: true }, defaults);
  normalized.showShortcut = "Control+Alt+Z";

  assert.notEqual(normalized, defaults);
  assert.equal(defaults.showShortcut, "CommandOrControl+Shift+Space");
  assert.equal(defaults.spellCheckEnabled, false);
});

test("clamps the zoom factor to the supported range", () => {
  assert.equal(clampZoomFactor(1), 1);
  assert.equal(clampZoomFactor(0.5), 0.5);
  assert.equal(clampZoomFactor(3), 3);
  assert.equal(clampZoomFactor(0.4), 0.5);
  assert.equal(clampZoomFactor(-10), 0.5);
  assert.equal(clampZoomFactor(3.5), 3);
  assert.equal(clampZoomFactor(Number.POSITIVE_INFINITY), 3);
  assert.equal(clampZoomFactor(Number.NEGATIVE_INFINITY), 0.5);
  // NaN passes straight through, so callers must screen it first; normalizeSettings does.
  assert.equal(Number.isNaN(clampZoomFactor(Number.NaN)), true);
});

test("removes native app markers without changing the browser or platform version", () => {
  for (const chromeVersion of ["156.0.8078.109", "160.0.1234.5"]) {
    const browser = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    const native = browser.replace(" Chrome/", " chatgpt-desktop/1.8.0-renderdiag.2 Chrome/") + " Electron/45.5.0";
    assert.equal(getBrowserUserAgent(native), browser);
    assert.equal(getBrowserUserAgent(browser), browser);
    assert.equal(getBrowserUserAgent(getBrowserUserAgent(native)), browser);
    assert.equal(getBrowserUserAgent(browser + " eLeCtRoN/45.5.0 CHATGPT-DESKTOP/1.8.0"), browser);
  }
});

test("preserves unrelated user-agent tokens", () => {
  const agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/160.0.0.0 Safari/537.36 OtherElectron/1.0";
  assert.equal(getBrowserUserAgent(agent), agent);
});

test("Settings shortcut accepts Control+comma but not the old Control+period", () => {
  const base = { type: "keyDown", key: ",", code: "Comma", control: true };
  assert.equal(isChatGPTSettingsShortcut(base), true);
  assert.equal(isChatGPTSettingsShortcut({ ...base, code: "KeyM", shift: true }), true);
  assert.equal(isChatGPTSettingsShortcut({ ...base, key: "localized-character" }), true);
  for (const changes of [
    { control: false }, { alt: true }, { meta: true }, { type: "keyUp" }, { isAutoRepeat: true },
    { key: "<", shift: true }, { key: ".", code: "Period" },
  ]) assert.equal(isChatGPTSettingsShortcut({ ...base, ...changes }), false);
});

test("allows only supported external URL protocols", () => {
  assert.equal(isAllowedExternalUrl("https://example.test"), true);
  assert.equal(isAllowedExternalUrl("http://example.test"), true);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl("file:///tmp/file"), false);
  assert.equal(isAllowedExternalUrl("not a URL"), false);
});

test("rejects every non-web protocol and malformed input", () => {
  for (const rawUrl of [
    "mailto:someone@example.test",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.test/file",
    "chrome://settings",
    "about:blank",
    "ws://example.test",
    "",
    "   ",
    "//example.test",
  ]) {
    assert.equal(isAllowedExternalUrl(rawUrl), false, `expected ${JSON.stringify(rawUrl)} to be rejected`);
  }

  for (const rawUrl of [null, undefined, 42, {}]) {
    assert.equal(isAllowedExternalUrl(rawUrl), false, `expected ${String(rawUrl)} to be rejected`);
  }
});

test("normalizes protocol casing when checking external URLs", () => {
  assert.equal(isAllowedExternalUrl("HTTPS://example.test"), true);
  assert.equal(isAllowedExternalUrl("HtTp://example.test"), true);
  assert.equal(isAllowedExternalUrl("JAVASCRIPT:alert(1)"), false);
});

test("uses a loopback fixture only in test mode", () => {
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.1:3456/fixture" }), "http://127.0.0.1:3456/fixture");
  assert.equal(getInitialUrl({ NODE_ENV: "production", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.1:3456/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://localhost:3456/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "https://chatgpt.com/" }), DEFAULT_INITIAL_URL);
});

test("requires an explicit loopback port and plain http for the fixture override", () => {
  assert.equal(getInitialUrl({}), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.1/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "https://127.0.0.1:3456/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.2:3456/" }), DEFAULT_INITIAL_URL);
  assert.equal(getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "not a url" }), DEFAULT_INITIAL_URL);
});

test("preserves the fixture path and query when the override is accepted", () => {
  assert.equal(
    getInitialUrl({ NODE_ENV: "test", CHATGPT_DESKTOP_E2E_URL: "http://127.0.0.1:3456/page?route=a#top" }),
    "http://127.0.0.1:3456/page?route=a#top"
  );
});

test("loads sorted JavaScript customization scripts with content signatures", () => {
  withTempDirectory((directory) => {
    fs.writeFileSync(path.join(directory, "b.js"), "window.second = true;");
    fs.writeFileSync(path.join(directory, "a.js"), "window.first = true;");
    fs.writeFileSync(path.join(directory, "ignored.txt"), "ignored");

    const manifest = loadScriptManifest(directory);
    assert.deepEqual(manifest.map((script) => script.fileName), ["a.js", "b.js"]);
    assert.match(manifest[0].signature, /^[a-f0-9]{64}$/);
    assert.notEqual(manifest[0].signature, manifest[1].signature);
  });
});

test("returns an empty manifest for missing or empty script directories", () => {
  assert.deepEqual(loadScriptManifest("/definitely/not/a/real/directory"), []);
  withTempDirectory((directory) => {
    assert.deepEqual(loadScriptManifest(directory), []);
  });
});

test("skips directories and non-JavaScript entries in the script manifest", () => {
  withTempDirectory((directory) => {
    fs.mkdirSync(path.join(directory, "nested.js"));
    fs.writeFileSync(path.join(directory, "nested.js", "inner.js"), "window.inner = true;");
    fs.writeFileSync(path.join(directory, "notes.md"), "# notes");
    fs.writeFileSync(path.join(directory, "styles.css"), "body {}");
    fs.writeFileSync(path.join(directory, "UPPER.JS"), "window.upper = true;");
    fs.writeFileSync(path.join(directory, "real.js"), "window.real = true;");

    // The extension filter is case sensitive, so only "real.js" qualifies.
    assert.deepEqual(loadScriptManifest(directory).map((script) => script.fileName), ["real.js"]);
  });
});

test("gives identical content identical signatures and orders names with localeCompare", () => {
  withTempDirectory((directory) => {
    fs.writeFileSync(path.join(directory, "10-second.js"), "window.same = true;");
    fs.writeFileSync(path.join(directory, "2-first.js"), "window.same = true;");
    fs.writeFileSync(path.join(directory, "a-third.js"), "window.different = true;");

    const manifest = loadScriptManifest(directory);
    assert.deepEqual(manifest.map((script) => script.fileName), ["10-second.js", "2-first.js", "a-third.js"]);
    assert.equal(manifest[0].signature, manifest[1].signature);
    assert.notEqual(manifest[0].signature, manifest[2].signature);
    assert.equal(manifest[0].script, "window.same = true;");
  });
});

const fixtureUrl = "http://127.0.0.1:4010/";

test("normalizes trusted navigation hosts to plain lowercase DNS names", () => {
  assert.deepEqual(normalizeTrustedHosts(["SSO.Example.com", " sso.example.com ", "idp.corp.test"]), [
    "sso.example.com",
    "idp.corp.test",
  ]);
  assert.deepEqual(
    normalizeTrustedHosts([
      "https://evil.test",
      "*.example.com",
      "10.0.0.1",
      "example.com/path",
      "example.com:8443",
      "",
      42,
      null,
      "localhost",
    ]),
    ["localhost"]
  );
  assert.deepEqual(normalizeTrustedHosts("example.com"), []);
});

test("settings keep a validated trusted host list and omit it when absent", () => {
  assert.deepEqual(
    normalizeSettings({ trustedNavigationHosts: ["SSO.Example.com", "10.0.0.1"] }, defaults).trustedNavigationHosts,
    ["sso.example.com"]
  );
  assert.equal("trustedNavigationHosts" in normalizeSettings({}, defaults), false);
});

test("treats only the exact application origin as the application", () => {
  assert.equal(isApplicationUrl("https://chatgpt.com/c/1"), true);
  assert.equal(isApplicationUrl("https://auth.openai.com/"), false);
  assert.equal(isApplicationUrl("http://chatgpt.com/"), false);
  assert.equal(isApplicationUrl("https://sora.chatgpt.com/"), false);
  assert.equal(isApplicationUrl("not a url"), false);
  assert.equal(isApplicationUrl(`${fixtureUrl}x`, fixtureUrl), true);
});

test("allows navigation only to HTTPS trusted hosts and their subdomains", () => {
  const options = { trustedHosts: ["sso.example.com"] };
  for (const url of [
    "https://chatgpt.com/",
    "https://sora.chatgpt.com/",
    "https://auth.openai.com/authorize",
    "https://accounts.google.com/o/oauth2",
    "https://login.microsoftonline.com/",
    "https://appleid.apple.com/auth",
    "https://sso.example.com/login",
    "https://idp.sso.example.com/login",
  ]) {
    assert.equal(isTrustedNavigationUrl(url, options), true, url);
  }

  for (const url of [
    "http://chatgpt.com/",
    "https://evilchatgpt.com/",
    "https://chatgpt.com.example.net/",
    "https://openai.com/",
    "https://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:a@b.test",
    "garbage",
  ]) {
    assert.equal(isTrustedNavigationUrl(url, options), false, url);
  }
});

test("accepts plain HTTP trusted hosts only in the loopback test fixture mode", () => {
  const options = { initialUrl: fixtureUrl, trustedHosts: ["localhost"] };
  assert.equal(isTrustedNavigationUrl(`${fixtureUrl}page`, options), true);
  assert.equal(isTrustedNavigationUrl("http://localhost:4011/", options), true);
  assert.equal(isTrustedNavigationUrl("http://example.com/", options), false);
  assert.equal(isTrustedNavigationUrl("http://localhost:4011/", { trustedHosts: ["localhost"] }), false);
});

test("grants only the supported permissions to the top-level application origin", () => {
  const base = { requestingUrl: "https://chatgpt.com/c/1", topLevelUrl: "https://chatgpt.com/" };
  for (const permission of ["media", "notifications", "clipboard-sanitized-write", "fullscreen"]) {
    assert.equal(getPermissionDecision({ ...base, permission }), true, permission);
  }
  for (const permission of ["geolocation", "midi", "display-capture", "clipboard-read", "openExternal", "usb", "unknown"]) {
    assert.equal(getPermissionDecision({ ...base, permission }), false, permission);
  }
  assert.equal(
    getPermissionDecision({ permission: "media", requestingUrl: "https://auth.openai.com/", topLevelUrl: "https://chatgpt.com/" }),
    false
  );
  assert.equal(
    getPermissionDecision({ permission: "media", requestingUrl: "https://chatgpt.com/", topLevelUrl: "https://auth.openai.com/" }),
    false
  );
  assert.equal(
    getPermissionDecision({ permission: "notifications", requestingUrl: "https://ads.example.com/", topLevelUrl: "https://chatgpt.com/" }),
    false
  );
});
