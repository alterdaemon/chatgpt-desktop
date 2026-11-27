const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const {
  clickMenuItem,
  clickZoomItem,
  createProfile,
  getZoomFactor,
  launchApp,
} = require("../helpers/launch-app");

test.describe.configure({ mode: "serial" });

const DEFAULT_SETTINGS = {
  spellCheckEnabled: false,
  showShortcut: "CommandOrControl+Shift+Space",
  zoomFactor: 1,
  vimiumNavigationEnabled: true,
  trustedNavigationHosts: [],
};

for (const [name, editor, modifiers] of [
  ["Control+,", "#prompt-textarea", ["control"]],
  ["Control+, in the current composer", "#composer-input", ["control"]],
]) test(`${name} opens actual Settings while typing without a global shortcut`, async () => {
  const fixture = await startFixtureServer("settings-navigation-fixture.html");
  const profile = createProfile({ css: "body { font-family: monospace !important; font-size: 19px !important; }", settings: JSON.stringify({ ...DEFAULT_SETTINGS, zoomFactor: 1.25 }) });
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.evaluate(() => { window.__settingsDocumentMarker = true; });
    let documentRequests = 0;
    page.on("request", request => { if (request.resourceType() === "document") documentRequests++; });
    await page.locator(editor).focus();
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+,"))).toBe(false);
    expect(await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu().getMenuItemById("chatgpt-settings");
      return { accelerator: item.accelerator, enabled: item.enabled };
    })).toEqual({ accelerator: "Control+,", enabled: true });
    // CDP keyboard events bypass before-input-event; use Electron's input pipeline.
    await app.evaluate(({ BrowserWindow }, modifiers) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers });
    }, modifiers);
    await expect(page).toHaveURL(new URL("/settings/account", fixture.url).href);
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    await expect(page.locator('[data-app-shell-main-content-layout="full-bleed"] input')).toBeVisible();
    await expect(page.locator(editor)).toHaveCount(0);
    expect(await page.evaluate(() => window.__settingsDocumentMarker)).toBe(true);
    expect(documentRequests).toBe(0);
    expect(await getZoomFactor(app)).toBe(1.25);
    await expect(page.locator("body")).toHaveCSS("font-family", "monospace");
    await expect(page.locator("body")).toHaveCSS("font-size", "19px");
    await page.goBack();
    await expect(page.locator(editor)).toBeVisible();
    // The old shortcut is not intercepted and must not reopen Settings.
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.sendInputEvent({ type: "keyDown", keyCode: ".", modifiers: ["control"] });
      wc.sendInputEvent({ type: "keyUp", keyCode: ".", modifiers: ["control"] });
    });
    expect(page.url()).toBe(fixture.url);
    expect(await page.evaluate(() => window.__settingsDocumentMarker)).toBe(true);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});

test("ChatGPT Settings menu fallback opens Settings and is disabled outside the application origin", async () => {
  const fixture = await startFixtureServer("settings-navigation-fixture.html");
  const profile = createProfile({ settings: JSON.stringify({ trustedNavigationHosts: ["localhost"] }) });
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.evaluate(() => { window.__settingsDocumentMarker = true; });
    await clickMenuItem(app, "ChatGPT Settings");
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__settingsDocumentMarker)).toBe(true);
    await page.goto(fixture.altUrl);
    await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("chatgpt-settings").enabled)).toBe(false);
    const prevented = await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.once("before-input-event", event => resolve(event.defaultPrevented));
      wc.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["control"] });
      wc.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["control"] });
    }));
    expect(prevented).toBe(false);
    expect(page.url()).toBe(fixture.altUrl);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});

test.describe("menus, zoom and spellcheck", () => {
  let app;
  let page;
  let fixture;
  let profile;

  test.beforeAll(async () => {
    fixture = await startFixtureServer();
    profile = createProfile();
    app = await launchApp(profile, fixture.url);
    page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.waitForFunction(() => Boolean(window.__chatgptDesktopVimiumNavigation));
  });

  test.afterAll(async () => {
    await app?.close();
    await fixture?.close();
    profile?.remove();
  });

  test("exposes the expected application menu with accelerators", async () => {
    const menu = await app.evaluate(({ Menu }) => {
      const root = Menu.getApplicationMenu().items[0];
      return {
        rootLabel: root.label,
        labels: root.submenu.items.map((item) => item.label),
        quitAccelerator: root.submenu.items.find((item) => item.label === "Quit").accelerator,
        zoom: root.submenu.items
          .find((item) => item.label === "Zoom")
          .submenu.items.map((item) => ({ label: item.label, accelerator: item.accelerator })),
      };
    });

    expect(menu.rootLabel).toBe("Application");
    expect(menu.labels).toEqual([
      "Show",
      "Hide",
      "Refresh",
      "ChatGPT Settings",
      "Zoom",
      "Spellcheck",
      "Vimium-Style Navigation",
      "Save Settings",
      "About",
      "Help",
      "Quit",
    ]);
    expect(menu.quitAccelerator).toBe("CommandOrControl+Q");
    expect(menu.zoom).toEqual([
      { label: "Actual", accelerator: null },
      { label: "Zoom In", accelerator: "CommandOrControl+Plus" },
      { label: "Zoom Out", accelerator: "CommandOrControl+-" },
      { label: "Full Screen", accelerator: null },
    ]);
  });

  test("zooms in, out and back to actual size", async () => {
    expect(await getZoomFactor(app)).toBeCloseTo(1, 5);

    await clickZoomItem(app, "Zoom In");
    expect(await getZoomFactor(app)).toBeCloseTo(1.1, 5);

    await clickZoomItem(app, "Zoom In");
    expect(await getZoomFactor(app)).toBeCloseTo(1.2, 5);

    await clickZoomItem(app, "Zoom Out");
    expect(await getZoomFactor(app)).toBeCloseTo(1.1, 5);

    await clickZoomItem(app, "Actual");
    expect(await getZoomFactor(app)).toBeCloseTo(1, 5);
  });

  test("clamps zoom to the supported range in both directions", async () => {
    for (let index = 0; index < 25; index += 1) {
      await clickZoomItem(app, "Zoom In");
    }
    expect(await getZoomFactor(app)).toBeCloseTo(3, 5);

    for (let index = 0; index < 40; index += 1) {
      await clickZoomItem(app, "Zoom Out");
    }
    expect(await getZoomFactor(app)).toBeCloseTo(0.5, 5);

    await clickZoomItem(app, "Actual");
    expect(await getZoomFactor(app)).toBeCloseTo(1, 5);
  });

  test("persists the current zoom factor through Save Settings", async () => {
    await clickZoomItem(app, "Zoom In");
    await clickZoomItem(app, "Zoom In");
    await clickMenuItem(app, "Save Settings");

    await expect.poll(() => profile.readSettings().zoomFactor).toBeCloseTo(1.2, 5);

    await clickZoomItem(app, "Actual");
    await clickMenuItem(app, "Save Settings");
    await expect.poll(() => profile.readSettings().zoomFactor).toBeCloseTo(1, 5);
  });

  test("toggles spellcheck through the menu and applies it to the page", async () => {
    expect(await page.locator("#prompt-textarea").getAttribute("spellcheck")).not.toBe("true");

    await clickMenuItem(app, "Spellcheck", { checked: true });
    await expect.poll(() => profile.readSettings().spellCheckEnabled).toBe(true);
    await expect
      .poll(() => page.locator("#prompt-textarea").getAttribute("spellcheck"))
      .toBe("true");

    await clickMenuItem(app, "Spellcheck", { checked: false });
    await expect.poll(() => profile.readSettings().spellCheckEnabled).toBe(false);
    await expect
      .poll(() => page.locator("#prompt-textarea").getAttribute("spellcheck"))
      .toBe("false");
  });

  test("keeps the menu checkbox state in step with the stored settings", async () => {
    await clickMenuItem(app, "Spellcheck", { checked: true });
    await expect
      .poll(() =>
        app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu().items[0].submenu.items.find(
            (item) => item.label === "Spellcheck"
          ).checked
        )
      )
      .toBe(true);

    await clickMenuItem(app, "Spellcheck", { checked: false });
    await expect
      .poll(() =>
        app.evaluate(({ Menu }) =>
          Menu.getApplicationMenu().items[0].submenu.items.find(
            (item) => item.label === "Spellcheck"
          ).checked
        )
      )
      .toBe(false);
  });
});

test.describe("settings file handling at startup", () => {
  let fixture;

  test.beforeAll(async () => {
    fixture = await startFixtureServer();
  });

  test.afterAll(async () => {
    await fixture?.close();
  });

  test("applies a valid settings file on launch", async () => {
    const profile = createProfile({
      settings: JSON.stringify({
        spellCheckEnabled: true,
        showShortcut: "Control+Alt+G",
        zoomFactor: 1.5,
        vimiumNavigationEnabled: false,
      }),
    });
    const app = await launchApp(profile, fixture.url);

    try {
      const page = await app.firstWindow();
      await page.waitForURL(fixture.url);
      await page.waitForFunction(() => Boolean(window.__chatgptDesktopVimiumNavigation));

      expect(await getZoomFactor(app)).toBeCloseTo(1.5, 5);
      await expect
        .poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled()))
        .toBe(false);
      await expect
        .poll(() => page.locator("#prompt-textarea").getAttribute("spellcheck"))
        .toBe("true");
      expect(profile.readSettings().showShortcut).toBe("Control+Alt+G");
    } finally {
      await app.close();
      profile.remove();
    }
  });

  test("recovers from a malformed settings file by rewriting defaults", async () => {
    const profile = createProfile({ settings: "{ this is not json" });
    const app = await launchApp(profile, fixture.url);

    try {
      const page = await app.firstWindow();
      await page.waitForURL(fixture.url);
      await expect(page.locator("#thread")).toBeVisible();

      await expect.poll(() => profile.readSettings()).toEqual(DEFAULT_SETTINGS);
    } finally {
      await app.close();
      profile.remove();
    }
  });

  test("clamps an out-of-range persisted zoom factor", async () => {
    const profile = createProfile({ settings: JSON.stringify({ zoomFactor: 99 }) });
    const app = await launchApp(profile, fixture.url);

    try {
      const page = await app.firstWindow();
      await page.waitForURL(fixture.url);
      await expect(page.locator("#thread")).toBeVisible();

      expect(await getZoomFactor(app)).toBeCloseTo(3, 5);
      await expect.poll(() => profile.readSettings().zoomFactor).toBe(3);
    } finally {
      await app.close();
      profile.remove();
    }
  });
});
