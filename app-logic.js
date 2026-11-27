const crypto = require("crypto");
const fs = require("fs");

const DEFAULT_INITIAL_URL = "https://chatgpt.com";
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);

const BUILT_IN_TRUSTED_HOSTS = [
  "chatgpt.com",
  "auth.openai.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "account.live.com",
  "appleid.apple.com",
];
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "notifications",
  "clipboard-sanitized-write",
  "fullscreen",
]);
const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeTrustedHosts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const hosts = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const host = entry.trim().toLowerCase();
    // Reject IP literals, wildcards, schemes, ports and paths: only plain DNS names.
    if (!HOST_PATTERN.test(host) || /^[0-9.]+$/.test(host) || !host.includes(".") && host !== "localhost") {
      continue;
    }
    if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

function hostMatches(host, entry) {
  return host === entry || host.endsWith(`.${entry}`);
}

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isApplicationUrl(rawUrl, initialUrl = DEFAULT_INITIAL_URL) {
  const url = parseUrl(rawUrl);
  const application = parseUrl(initialUrl);
  return Boolean(url && application && url.origin === application.origin);
}

function isTrustedNavigationUrl(rawUrl, { initialUrl = DEFAULT_INITIAL_URL, trustedHosts = [] } = {}) {
  const url = parseUrl(rawUrl);
  if (!url) {
    return false;
  }

  if (isApplicationUrl(rawUrl, initialUrl)) {
    return true;
  }

  // Plain HTTP is only accepted when the app itself was pointed at an HTTP
  // loopback fixture, which getInitialUrl() allows under NODE_ENV=test only.
  const application = parseUrl(initialUrl);
  const allowInsecure = Boolean(application && application.protocol === "http:");
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    return false;
  }

  const host = url.hostname.toLowerCase();
  return [...BUILT_IN_TRUSTED_HOSTS, ...trustedHosts].some((entry) => hostMatches(host, entry));
}

function getPermissionDecision({ permission, requestingUrl, topLevelUrl, initialUrl = DEFAULT_INITIAL_URL }) {
  return (
    ALLOWED_PERMISSIONS.has(permission) &&
    isApplicationUrl(requestingUrl, initialUrl) &&
    isApplicationUrl(topLevelUrl, initialUrl)
  );
}

function clampZoomFactor(value) {
  return Math.min(3, Math.max(0.5, value));
}

function getBrowserUserAgent(userAgent) {
  return userAgent.replace(/\s(?:Electron|chatgpt-desktop)\/\S+/gi, "");
}

function isChatGPTSettingsShortcut(input) {
  return input.type === "keyDown" && input.control && !input.alt && !input.meta && !input.isAutoRepeat &&
    (input.key === "," || (input.code === "Comma" && !input.shift));
}

function normalizeSettings(settings, defaults) {
  const normalized = { ...defaults };

  if (!settings || typeof settings !== "object") {
    return normalized;
  }

  if (typeof settings.spellCheckEnabled === "boolean") {
    normalized.spellCheckEnabled = settings.spellCheckEnabled;
  }

  if (typeof settings.showShortcut === "string" && settings.showShortcut.trim()) {
    normalized.showShortcut = settings.showShortcut.trim();
  }

  if (typeof settings.zoomFactor === "number" && Number.isFinite(settings.zoomFactor)) {
    normalized.zoomFactor = clampZoomFactor(settings.zoomFactor);
  }

  if (typeof settings.vimiumNavigationEnabled === "boolean") {
    normalized.vimiumNavigationEnabled = settings.vimiumNavigationEnabled;
  }

  if (Object.prototype.hasOwnProperty.call(settings, "trustedNavigationHosts")) {
    normalized.trustedNavigationHosts = normalizeTrustedHosts(settings.trustedNavigationHosts);
  }

  return normalized;
}

function loadScriptManifest(directoryPath) {
  try {
    return fs
      .readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
      .map((fileName) => {
        const script = fs.readFileSync(`${directoryPath}/${fileName}`, "utf8");
        return {
          fileName,
          script,
          signature: crypto.createHash("sha256").update(script, "utf8").digest("hex"),
        };
      });
  } catch {
    return [];
  }
}

function isAllowedExternalUrl(rawUrl) {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function getInitialUrl(environment = process.env) {
  if (environment.NODE_ENV !== "test" || !environment.CHATGPT_DESKTOP_E2E_URL) {
    return DEFAULT_INITIAL_URL;
  }

  try {
    const url = new URL(environment.CHATGPT_DESKTOP_E2E_URL);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port) {
      return url.href;
    }
  } catch {}

  return DEFAULT_INITIAL_URL;
}

module.exports = {
  BUILT_IN_TRUSTED_HOSTS,
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
};
