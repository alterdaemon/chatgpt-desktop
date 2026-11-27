/*
 * ChatGPT Desktop Wrapper
 * Developer: alter.daemon <alter.daemon.ivytq@passmail.com>
 * License: MIT
 */

const path = require("path");
const fs = require("fs");
const {
  clampZoomFactor,
  getInitialUrl,
  getPermissionDecision,
  isAllowedExternalUrl,
  isApplicationUrl,
  isTrustedNavigationUrl,
  loadScriptManifest,
  normalizeSettings,
} = require("./app-logic");
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
let vimiumNavigationEnabled = true;
let trustedNavigationHosts = [];
const initialUrl = getInitialUrl(process.env);
const deniedPermissionsLogged = new Set();
const DEFAULT_SHOW_SHORTCUT = "CommandOrControl+Shift+Space";
let showShortcut = DEFAULT_SHOW_SHORTCUT;
const REPO_URL = "https://github.com/alterdaemon/chatgpt-desktop";
let cachedVimiumNavigationModule = "";

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
const vimiumNavigationModulePath = path.join(__dirname, "page-modules", "vimium-navigation.js");

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
  cachedScripts = loadScriptManifest(scriptsPath);
}

function loadVimiumNavigationModuleOnce() {
  try {
    cachedVimiumNavigationModule = fs.readFileSync(vimiumNavigationModulePath, "utf8");
  } catch {
    cachedVimiumNavigationModule = "";
  }
}

function loadSettings() {
  try {
    const rawSettings = fs.readFileSync(settingsPath, "utf8");
    const settings = normalizeSettings(JSON.parse(rawSettings), {
      spellCheckEnabled,
      showShortcut,
      zoomFactor,
      vimiumNavigationEnabled,
      trustedNavigationHosts,
    });
    trustedNavigationHosts = settings.trustedNavigationHosts;
    spellCheckEnabled = settings.spellCheckEnabled;
    showShortcut = settings.showShortcut;
    zoomFactor = settings.zoomFactor;
    vimiumNavigationEnabled = settings.vimiumNavigationEnabled;
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
          vimiumNavigationEnabled,
          trustedNavigationHosts,
        },
        null,
        2
      ) + "\n"
    );
  } catch {}
}

function isOnApplicationPage(window = mainWindow) {
  if (!window || window.isDestroyed()) {
    return false;
  }

  try {
    return isApplicationUrl(window.webContents.getURL(), initialUrl);
  } catch {
    return false;
  }
}

function handOffToSystemBrowser(url) {
  if (isAllowedExternalUrl(url)) {
    shell.openExternal(url).catch(() => {});
  }
}

function logDeniedPermission(permission) {
  if (!deniedPermissionsLogged.has(permission)) {
    deniedPermissionsLogged.add(permission);
    console.warn(`Denied web permission request: ${permission}`);
  }
}

function installSessionSecurity(window) {
  const { session } = window.webContents;

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const granted = getPermissionDecision({
      permission,
      requestingUrl: details && details.requestingUrl,
      topLevelUrl: webContents.getURL(),
      initialUrl,
    });
    if (!granted) {
      logDeniedPermission(permission);
    }
    callback(granted);
  });

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    getPermissionDecision({
      permission,
      requestingUrl: (details && details.requestingUrl) || requestingOrigin,
      topLevelUrl: webContents ? webContents.getURL() : "",
      initialUrl,
    })
  );

  session.setDevicePermissionHandler(() => false);
  session.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    callback();
  });
  session.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    callback();
  });
  session.on("select-serial-port", (event, portList, webContents, callback) => {
    event.preventDefault();
    callback("");
  });
  window.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    callback("");
  });
}

function guardNavigation(window) {
  const guard = (event, url) => {
    const target = url || event.url;
    if (isTrustedNavigationUrl(target, { initialUrl, trustedHosts: trustedNavigationHosts })) {
      return;
    }

    event.preventDefault();
    handOffToSystemBrowser(target);
  };

  window.webContents.on("will-navigate", guard);
  window.webContents.on("will-redirect", guard);
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
  zoomFactor = clampZoomFactor(value);

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
    return Promise.resolve();
  }

  const { session } = window.webContents;

  if (typeof session.setSpellCheckerEnabled === "function") {
    session.setSpellCheckerEnabled(spellCheckEnabled);
  }

  if (!isOnApplicationPage(window)) {
    return Promise.resolve();
  }

  return window.webContents
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
  applySpellCheckEnabled().catch(() => {});
  createAppMenu();
  updateTrayMenu();
}

function ensureVimiumNavigationModule(window = mainWindow) {
  if (!window || window.isDestroyed() || !cachedVimiumNavigationModule) {
    return Promise.resolve(false);
  }

  return window.webContents.executeJavaScript(
    "Boolean(window.__chatgptDesktopVimiumNavigation)",
    true
  ).then((installed) => {
    if (installed) {
      return true;
    }

    return window.webContents.executeJavaScript(cachedVimiumNavigationModule, true).then(() => true);
  });
}

function applyVimiumNavigationEnabled(window = mainWindow) {
  if (!window || window.isDestroyed() || !cachedVimiumNavigationModule || !isOnApplicationPage(window)) {
    return Promise.resolve();
  }

  const enabledLiteral = vimiumNavigationEnabled ? "true" : "false";

  return ensureVimiumNavigationModule(window).then((installed) => {
    if (!installed) {
      return undefined;
    }

    return window.webContents.executeJavaScript(
      `(() => {
        if (window.__chatgptDesktopVimiumNavigation) {
          window.__chatgptDesktopVimiumNavigation.setEnabled(${enabledLiteral});
        }
      })();`,
      true
    );
  });
}

function updateVimiumNavigation(enabled) {
  vimiumNavigationEnabled = enabled;
  saveSettings();
  applyVimiumNavigationEnabled().catch(() => {});
  createAppMenu();
  updateTrayMenu();
}

function getTraySpellCheckLabel() {
  return spellCheckEnabled ? "Spellcheck ✓" : "Spellcheck";
}

function getTrayVimiumNavigationLabel() {
  return vimiumNavigationEnabled ? "Vimium-Style Navigation ✓" : "Vimium-Style Navigation";
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
          label: "Vimium-Style Navigation",
          type: "checkbox",
          checked: vimiumNavigationEnabled,
          click: (menuItem) => updateVimiumNavigation(menuItem.checked),
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
      label: getTrayVimiumNavigationLabel(),
      click: () => updateVimiumNavigation(!vimiumNavigationEnabled),
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
  if (tray) {
    return true;
  }

  try {
    tray = new Tray(getTrayIcon());
    tray.setToolTip("ChatGPT");
    tray.setTitle("ChatGPT");
    updateTrayMenu();
    tray.on("click", () => {
      revealMainWindow();
    });
    return true;
  } catch (error) {
    tray = null;
    console.warn("Tray integration unavailable in this session:", error);
    return false;
  }
}

function registerGlobalShortcut(accelerator, handler, label) {
  try {
    const registered = globalShortcut.register(accelerator, handler);

    if (!registered) {
      console.warn(`Global shortcut unavailable for ${label}: ${accelerator}`);
    }

    return registered;
  } catch (error) {
    console.warn(`Failed to register global shortcut for ${label}: ${accelerator}`, error);
    return false;
  }
}

async function runCustomizationStep(label, action) {
  try {
    await action();
  } catch (error) {
    console.error(`Failed to apply ${label}:`, error);
  }
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

  mainWindow.on("close", (e) => {
    if (!allowQuit && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    if (input.key === "." && input.control && !input.alt && !input.shift && !input.meta && isOnApplicationPage()) {
      event.preventDefault();
      mainWindow.loadURL(new URL("/settings/account", initialUrl).href).catch((error) => {
        console.error("Failed to open ChatGPT Settings:", error);
      });
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
    handOffToSystemBrowser(url);
    return { action: "deny" };
  });

  installSessionSecurity(mainWindow);
  guardNavigation(mainWindow);

  const injectScripts = async () => {
    if (!mainWindow || mainWindow.isDestroyed() || cachedScripts.length === 0 || !isOnApplicationPage()) {
      return;
    }

    for (const { fileName, script, signature } of cachedScripts) {
      try {
        const shouldRun = await mainWindow.webContents.executeJavaScript(`
          (() => {
            const registry = window.__chatgptDesktopUserScriptRegistry || (window.__chatgptDesktopUserScriptRegistry = Object.create(null));
            const routeKey = location.href;
            const fileKey = ${JSON.stringify(fileName)};
            const scriptSignature = ${JSON.stringify(signature)};
            const previousRun = registry[fileKey];

            if (previousRun && previousRun.routeKey === routeKey && previousRun.scriptSignature === scriptSignature) {
              return false;
            }

            return { fileKey, routeKey, scriptSignature };
          })();
        `);

        if (!shouldRun) {
          continue;
        }

        await mainWindow.webContents.executeJavaScript(script);
        await mainWindow.webContents.executeJavaScript(`
          (() => {
            const registry = window.__chatgptDesktopUserScriptRegistry || (window.__chatgptDesktopUserScriptRegistry = Object.create(null));
            registry[${JSON.stringify(fileName)}] = {
              routeKey: ${JSON.stringify(shouldRun.routeKey)},
              scriptSignature: ${JSON.stringify(shouldRun.scriptSignature)}
            };
          })();
        `);
      } catch (error) {
        try {
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              const registry = window.__chatgptDesktopUserScriptRegistry;
              if (registry) {
                delete registry[${JSON.stringify(fileName)}];
              }
            })();
          `);
        } catch {}
        console.error(`Failed to execute script ${fileName}:`, error);
      }
    }
  };

  const applyCustomizations = async () => {
    applyZoomFactor(zoomFactor);
    await runCustomizationStep("spellcheck", () => applySpellCheckEnabled(mainWindow));
    await runCustomizationStep("Vimium navigation", () => applyVimiumNavigationEnabled(mainWindow));

    if (cachedCss && isOnApplicationPage()) {
      await runCustomizationStep("custom CSS", () => mainWindow.webContents.insertCSS(cachedCss));
    }
    await runCustomizationStep("custom scripts", () => injectScripts());

    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };

  mainWindow.webContents.on("did-finish-load", () => {
    applyCustomizations().catch(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    });
  });

  mainWindow.webContents.on("did-navigate-in-page", () => {
    applyZoomFactor(zoomFactor);
    runCustomizationStep("Vimium navigation", () => applyVimiumNavigationEnabled(mainWindow));
    runCustomizationStep("custom scripts", () => injectScripts());
  });

  mainWindow.loadURL(getInitialUrl(process.env));
}

app.whenReady().then(() => {
  ensureAppPaths();
  loadSettings();
  saveSettings();
  loadCssOnce();
  loadScriptsOnce();
  loadVimiumNavigationModuleOnce();
  createAppMenu();
  createWindow();
  createTray();

  registerGlobalShortcut(showShortcut, () => {
    toggleMainWindow();
  }, "show or hide");

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
  if (!tray) {
    app.quit();
  }
});
