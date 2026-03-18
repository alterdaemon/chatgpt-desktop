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
} = require("electron");

let cachedCss = "";
let allowQuit = false;
let mainWindow = null;
let tray = null;

app.commandLine.appendSwitch("disable-smooth-scrolling");
app.commandLine.appendSwitch("disable-gpu-vsync");

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

function getLegacyExternalCssPath() {
  const appImagePath = process.env.APPIMAGE || app.getPath("exe");
  return path.join(path.dirname(appImagePath), "custom.css");
}

function getBundledCssPath() {
  return path.join(__dirname, "custom.css");
}

function ensureAppPaths() {
  for (const dirPath of [appConfigPath, appDataPath, stylesPath, cachePath, crashDumpsPath]) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch {}
  }
}

function loadCssOnce() {
  const externalCss = getExternalCssPath();
  const legacyExternalCss = getLegacyExternalCssPath();
  const bundledCss = getBundledCssPath();

  try {
    if (fs.existsSync(externalCss)) {
      cachedCss = fs.readFileSync(externalCss, "utf8");
      return;
    }
  } catch {}

  try {
    if (fs.existsSync(legacyExternalCss)) {
      cachedCss = fs.readFileSync(legacyExternalCss, "utf8");
      return;
    }
  } catch {}

  try {
    cachedCss = fs.readFileSync(bundledCss, "utf8");
  } catch {
    cachedCss = "";
  }
}

function showMainWindow() {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function requestQuit() {
  allowQuit = true;
  app.quit();
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, "build", "icons", "icon.png");
  return nativeImage.createFromPath(iconPath);
}

function createAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "Application",
      submenu: [
        {
          label: "Show",
          click: () => showMainWindow(),
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

function createTray() {
  if (tray) return;

  tray = new Tray(getTrayIcon());

  tray.setToolTip("ChatGPT");
  tray.setTitle("ChatGPT");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => showMainWindow(),
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => requestQuit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    showMainWindow();
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
      devTools: false,
    },
  });

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
    if (cachedCss) {
      mainWindow.webContents.insertCSS(cachedCss).catch(() => {});
    }
  });

  mainWindow.loadURL("https://chatgpt.com");
}

app.whenReady().then(() => {
  ensureAppPaths();
  loadCssOnce();
  createAppMenu();
  createWindow();
  createTray();

  globalShortcut.register("CommandOrControl+Q", () => {
    requestQuit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on("second-instance", () => {
  showMainWindow();
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
