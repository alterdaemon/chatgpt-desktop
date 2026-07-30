const crypto = require("crypto");
const fs = require("fs");

const DEFAULT_INITIAL_URL = "https://chatgpt.com";
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["https:", "http:"]);

function clampZoomFactor(value) {
  return Math.min(3, Math.max(0.5, value));
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
  DEFAULT_INITIAL_URL,
  clampZoomFactor,
  getInitialUrl,
  isAllowedExternalUrl,
  loadScriptManifest,
  normalizeSettings,
};
