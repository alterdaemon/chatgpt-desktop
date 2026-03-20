/*
 * ChatGPT Desktop Wrapper
 * Developer: Stephan Coertzen <coertzen.jfs@gmail.com>
 * License: MIT
 */

const path = require("path");
const fs = require("fs");
const {
  app,
  BrowserWindow,
  shell,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  screen,
  dialog,
} = require("electron");

let cachedCss = "";
let cachedScripts = [];
let allowQuit = false;
let mainWindow = null;
let tray = null;
let spellCheckEnabled = false;
let zoomFactor = 1;
const DEFAULT_SHOW_SHORTCUT = "CommandOrControl+Shift+Space";
let showShortcut = DEFAULT_SHOW_SHORTCUT;
const REPO_URL = "https://github.com/alterdaemon/chatgpt-desktop";

app.commandLine.appendSwitch("disable-smooth-scrolling");
app.commandLine.appendSwitch("disable-gpu-vsync");
app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

function getConfigRoot() {
  return process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config");
}

function getDataRoot() {
  return process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
}

function getCacheRoot() {
  return process.env.XDG_CACHE_HOME || path.join(app.getPath("home"), ".cache");
}

const configRoot = getConfigRoot();
const dataRoot = getDataRoot();
const cacheRoot = getCacheRoot();
const appConfigPath = path.join(configRoot, "chatgpt-desktop");
const appDataPath = path.join(dataRoot, "chatgpt-desktop");
const stylesPath = path.join(appConfigPath, "styles");
const scriptsPath = path.join(appConfigPath, "scripts");
const settingsPath = path.join(appConfigPath, "settings.json");
const cachePath = path.join(cacheRoot, "chatgpt-desktop");
const crashDumpsPath = path.join(cachePath, "crashpad");

app.setPath("userData", appDataPath);
app.setPath("crashDumps", crashDumpsPath);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.exit(0);
}

function getExternalCssPath() {
  return path.join(stylesPath, "custom.css");
}

function getBundledCssPath() {
  return path.join(__dirname, "custom.css");
}

function ensureAppPaths() {
  for (const dirPath of [appConfigPath, appDataPath, stylesPath, scriptsPath, cachePath, crashDumpsPath]) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch {}
  }
}

function loadCssOnce() {
  const externalCss = getExternalCssPath();
  const bundledCss = getBundledCssPath();

  try {
    if (fs.existsSync(externalCss)) {
      cachedCss = fs.readFileSync(externalCss, "utf8");
      return;
    }
  } catch {}

  try {
    cachedCss = fs.readFileSync(bundledCss, "utf8");
  } catch {
    cachedCss = "";
  }
}

function loadScriptsOnce() {
  try {
    cachedScripts = fs
      .readdirSync(scriptsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .map((fileName) => ({
        fileName,
        script: fs.readFileSync(path.join(scriptsPath, fileName), "utf8"),
      }));
  } catch {
    cachedScripts = [];
  }
}

function loadSettings() {
  try {
    const rawSettings = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(rawSettings);

    if (typeof settings.spellCheckEnabled === "boolean") {
      spellCheckEnabled = settings.spellCheckEnabled;
    }

    if (typeof settings.showShortcut === "string" && settings.showShortcut.trim()) {
      showShortcut = settings.showShortcut.trim();
    }

    if (typeof settings.zoomFactor === "number" && Number.isFinite(settings.zoomFactor)) {
      zoomFactor = Math.min(3, Math.max(0.5, settings.zoomFactor));
    }
  } catch {}
}

function saveSettings() {
  try {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          spellCheckEnabled,
          showShortcut,
          zoomFactor,
        },
        null,
        2
      ) + "\n"
    );
  } catch {}
}

function temporarilyShowOnAllWorkspaces(window) {
  if (!window || window.isDestroyed() || typeof window.setVisibleOnAllWorkspaces !== "function") {
    return;
  }

  try {
    window.setVisibleOnAllWorkspaces(true);
    setTimeout(() => {
      if (!window.isDestroyed()) {
        try {
          window.setVisibleOnAllWorkspaces(false);
        } catch {}
      }
    }, 1000);
  } catch {}
}

function moveWindowToCurrentDisplay(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  try {
    const currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    moveWindowToDisplay(window, currentDisplay);
  } catch {}
}

function moveWindowToDisplay(window, display) {
  if (!window || window.isDestroyed() || !display) {
    return;
  }

  try {
    const bounds = window.getBounds();
    const workArea = display.workArea;
    const x = Math.round(workArea.x + Math.max(0, (workArea.width - bounds.width) / 2));
    const y = Math.round(workArea.y + Math.max(0, (workArea.height - bounds.height) / 2));

    window.setPosition(x, y);
  } catch {}
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  if (!mainWindow.isFocused() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  moveWindowToDisplay(mainWindow, currentDisplay);
  temporarilyShowOnAllWorkspaces(mainWindow);
  mainWindow.show();

  if (typeof mainWindow.moveTop === "function") {
    try {
      mainWindow.moveTop();
    } catch {}
  }

  try {
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    } else {
      app.focus();
    }
  } catch {}

  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }

  revealMainWindow();
}

function requestQuit() {
  allowQuit = true;
  app.quit();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
}

function refreshMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.reload();
}

function getCurrentZoomFactor() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return zoomFactor;
  }

  try {
    return mainWindow.webContents.getZoomFactor();
  } catch {
    return zoomFactor;
  }
}

function applyZoomFactor(value) {
  zoomFactor = Math.min(3, Math.max(0.5, value));

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    mainWindow.webContents.setZoomFactor(zoomFactor);
  } catch {}
}

function zoomIn() {
  applyZoomFactor(getCurrentZoomFactor() + 0.1);
}

function zoomOut() {
  applyZoomFactor(getCurrentZoomFactor() - 0.1);
}

function resetZoom() {
  applyZoomFactor(1);
}

function toggleFullScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

function saveCurrentSettings() {
  zoomFactor = getCurrentZoomFactor();
  saveSettings();
}

function showAbout() {
  dialog.showMessageBox({
    type: "info",
    title: "About ChatGPT Desktop",
    message: "ChatGPT Desktop (Unofficial)",
    detail: [
      `Version: ${app.getVersion()}`,
      `Node: ${process.versions.node}`,
      `V8: ${process.versions.v8}`,
      `Chrome: ${process.versions.chrome}`,
      `Electron: ${process.versions.electron}`,
    ].join("\n"),
    buttons: ["OK"],
  }).catch(() => {});
}

function openHelp() {
  shell.openExternal(REPO_URL);
}

function getZoomSubmenu() {
  return [
    {
      label: "Actual",
      click: () => resetZoom(),
    },
    {
      label: "Zoom In",
      accelerator: "CommandOrControl+Plus",
      click: () => zoomIn(),
    },
    {
      label: "Zoom Out",
      accelerator: "CommandOrControl+-",
      click: () => zoomOut(),
    },
    {
      label: "Full Screen",
      click: () => toggleFullScreen(),
    },
  ];
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, "build", "icons", "icon.png");
  return nativeImage.createFromPath(iconPath);
}

function applySpellCheckEnabled(window = mainWindow) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const { session } = window.webContents;

  if (typeof session.setSpellCheckerEnabled === "function") {
    session.setSpellCheckerEnabled(spellCheckEnabled);
  }

  window.webContents
    .executeJavaScript(
      `(() => {
        const enabled = ${spellCheckEnabled ? "true" : "false"};
        const selectors = [
          'textarea',
          'input[type="text"]',
          'input[type="search"]',
          '[contenteditable="true"]',
          '[role="textbox"]'
        ];

        for (const element of document.querySelectorAll(selectors.join(','))) {
          element.spellcheck = enabled;
          element.setAttribute('spellcheck', String(enabled));
        }
      })();`,
      true
    )
    .catch(() => {});
}

function updateSpellCheck(enabled) {
  spellCheckEnabled = enabled;
  saveSettings();
  applySpellCheckEnabled();
  createAppMenu();
  updateTrayMenu();
}

function getTraySpellCheckLabel() {
  return spellCheckEnabled ? "Spellcheck ✓" : "Spellcheck";
}

function createAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "Application",
      submenu: [
        {
          label: "Show",
          click: () => revealMainWindow(),
        },
        {
          label: "Hide",
          click: () => hideMainWindow(),
        },
        {
          label: "Refresh",
          click: () => refreshMainWindow(),
        },
        {
          label: "Zoom",
          submenu: getZoomSubmenu(),
        },
        {
          label: "Spellcheck",
          type: "checkbox",
          checked: spellCheckEnabled,
          click: (menuItem) => updateSpellCheck(menuItem.checked),
        },
        {
          label: "Save Settings",
          click: () => saveCurrentSettings(),
        },
        {
          label: "About",
          click: () => showAbout(),
        },
        {
          label: "Help",
          click: () => openHelp(),
        },
        {
          label: "Quit",
          accelerator: "CommandOrControl+Q",
          click: () => requestQuit(),
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => revealMainWindow(),
    },
    {
      label: "Hide",
      click: () => hideMainWindow(),
    },
    {
      label: "Refresh",
      click: () => refreshMainWindow(),
    },
    {
      label: "Zoom",
      submenu: getZoomSubmenu(),
    },
    {
      label: getTraySpellCheckLabel(),
      click: () => updateSpellCheck(!spellCheckEnabled),
    },
    {
      label: "Save Settings",
      click: () => saveCurrentSettings(),
    },
    {
      label: "About",
      click: () => showAbout(),
    },
    {
      label: "Help",
      click: () => openHelp(),
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => requestQuit(),
    },
  ]);
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  if (tray) return;

  tray = new Tray(getTrayIcon());

  tray.setToolTip("ChatGPT");
  tray.setTitle("ChatGPT");

  updateTrayMenu();

  tray.on("click", () => {
    revealMainWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: spellCheckEnabled,
      devTools: false,
    },
  });

  applySpellCheckEnabled(mainWindow);
  applyZoomFactor(zoomFactor);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (e) => {
    if (!allowQuit) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    const isQuitShortcut =
      input.key.toLowerCase() === "q" && (input.control || input.meta);

    if (isQuitShortcut) {
      event.preventDefault();
      requestQuit();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", () => {
    applyZoomFactor(zoomFactor);
    applySpellCheckEnabled(mainWindow);

    if (cachedCss) {
      mainWindow.webContents.insertCSS(cachedCss).catch(() => {});
    }
  });

  const injectScripts = async () => {
    if (!mainWindow || mainWindow.isDestroyed() || cachedScripts.length === 0) {
      return;
    }

    for (const { fileName, script } of cachedScripts) {
      try {
        await mainWindow.webContents.executeJavaScript(script);
      } catch (error) {
        console.error(`Failed to execute script ${fileName}:`, error);
      }
    }
  };

  mainWindow.webContents.on("did-finish-load", () => {
    injectScripts().catch(() => {});
  });

  mainWindow.webContents.on("did-navigate-in-page", () => {
    applyZoomFactor(zoomFactor);
    injectScripts().catch(() => {});
  });

  mainWindow.loadURL("https://chatgpt.com");
}

app.whenReady().then(() => {
  ensureAppPaths();
  loadSettings();
  saveSettings();
  loadCssOnce();
  loadScriptsOnce();
  createAppMenu();
  createWindow();
  createTray();

  globalShortcut.register("CommandOrControl+Q", () => {
    requestQuit();
  });

  globalShortcut.register(showShortcut, () => {
    toggleMainWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      revealMainWindow();
    }
  });
});

app.on("second-instance", () => {
  revealMainWindow();
});

app.on("before-quit", () => {
  allowQuit = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // keep app alive for tray
});
