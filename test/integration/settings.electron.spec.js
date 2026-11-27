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

test("Control+. opens ChatGPT Settings while typing without a global shortcut", async () => {
  const fixture = await startFixtureServer();
  const profile = createProfile();
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.locator("#prompt-textarea").focus();
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+."))).toBe(false);
    // CDP keyboard events bypass before-input-event; use Electron's input pipeline.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode: ".", modifiers: ["control"] });
      contents.sendInputEvent({ type: "keyUp", keyCode: ".", modifiers: ["control"] });
    });
    await expect(page).toHaveURL(new URL("/settings/account", fixture.url).href);
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
