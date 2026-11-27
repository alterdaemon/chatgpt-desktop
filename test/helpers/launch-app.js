const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("@playwright/test");

const projectRoot = path.join(__dirname, "..", "..");

// Every spec gets its own XDG root so settings written by one test can never
// leak into another, and so the developer's real profile is never touched.
function createProfile({ css, scripts = {}, settings } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-desktop-e2e-"));
  const configPath = path.join(root, "config", "chatgpt-desktop");
  fs.mkdirSync(path.join(configPath, "styles"), { recursive: true });
  fs.mkdirSync(path.join(configPath, "scripts"), { recursive: true });

  if (typeof css === "string") {
    fs.writeFileSync(path.join(configPath, "styles", "custom.css"), css);
  }

  for (const [fileName, source] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(configPath, "scripts", fileName), source);
  }

  if (typeof settings === "string") {
    fs.writeFileSync(path.join(configPath, "settings.json"), settings);
  }

  return {
    root,
    configPath,
    settingsPath: path.join(configPath, "settings.json"),
    readSettings() {
      return JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
    },
    remove() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function launchApp(profile, fixtureUrl, { appRoot = projectRoot, args = [] } = {}) {
  return electron.launch({
    executablePath: require("electron"),
    args: [appRoot, ...args],
    env: {
      ...process.env,
      NODE_ENV: "test",
      CHATGPT_DESKTOP_E2E_URL: fixtureUrl,
      XDG_CONFIG_HOME: path.join(profile.root, "config"),
      XDG_DATA_HOME: path.join(profile.root, "data"),
      XDG_CACHE_HOME: path.join(profile.root, "cache"),
    },
  });
}

// main.js calls shell.openExternal by property lookup, so replacing the property
// captures every external-open attempt without changing production code.
async function trackExternalOpens(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__externalOpens = [];
    shell.openExternal = (url) => {
      globalThis.__externalOpens.push(url);
      return Promise.resolve();
    };
  });
}

function readExternalOpens(app) {
  return app.evaluate(() => globalThis.__externalOpens || []);
}

function clickMenuItem(app, label, options) {
  return app.evaluate(({ Menu }, payload) => {
    const item = Menu.getApplicationMenu().items[0].submenu.items.find(
      (entry) => entry.label === payload.label
    );
    if (!item) {
      throw new Error(`Menu item not found: ${payload.label}`);
    }
    item.click(payload.options);
  }, { label, options });
}

function clickZoomItem(app, label) {
  return app.evaluate(({ Menu }, payload) => {
    const zoom = Menu.getApplicationMenu().items[0].submenu.items.find(
      (entry) => entry.label === "Zoom"
    );
    const item = zoom.submenu.items.find((entry) => entry.label === payload.label);
    if (!item) {
      throw new Error(`Zoom item not found: ${payload.label}`);
    }
    item.click();
  }, { label });
}

function getZoomFactor(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
  );
}

module.exports = {
  clickMenuItem,
  clickZoomItem,
  createProfile,
  getZoomFactor,
  launchApp,
  projectRoot,
  readExternalOpens,
  trackExternalOpens,
};
