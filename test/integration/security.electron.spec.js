const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const {
  clickMenuItem,
  createProfile,
  launchApp,
  readExternalOpens,
  trackExternalOpens,
} = require("../helpers/launch-app");

test.describe.configure({ mode: "serial" });

test.describe("window security model and external link policy", () => {
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
    await trackExternalOpens(app);
  });

  test.afterAll(async () => {
    await app?.close();
    await fixture?.close();
    profile?.remove();
  });

  test("keeps Node out of the renderer", async () => {
    expect(await page.evaluate(() => typeof process)).toBe("undefined");
    expect(await page.evaluate(() => typeof require)).toBe("undefined");
    expect(await page.evaluate(() => typeof module)).toBe("undefined");
    expect(await page.evaluate(() => typeof globalThis.electron)).toBe("undefined");
  });

  test("retains the hardened web preferences", async () => {
    const preferences = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    );

    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    // getLastWebPreferences() does not report devTools; the next test asserts
    // the behaviour that actually matters instead.
  });

  test("cannot open developer tools", async () => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.openDevTools();
    });
    await page.waitForTimeout(300);

    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()
      )
    ).toBe(false);
  });

  test("sends http and https popups to the system browser without opening a window", async () => {
    await page.evaluate(() => window.open("https://example.test/allowed", "_blank"));
    await page.evaluate(() => window.open("http://example.test/plain", "_blank"));

    await expect.poll(() => readExternalOpens(app)).toEqual([
      "https://example.test/allowed",
      "http://example.test/plain",
    ]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test("refuses to hand non-web protocols to the system browser", async () => {
    const before = (await readExternalOpens(app)).length;

    await page.evaluate(() => {
      window.open("javascript:alert(1)", "_blank");
      window.open("file:///etc/passwd", "_blank");
      window.open("mailto:someone@example.test", "_blank");
      window.open("data:text/html,<h1>x</h1>", "_blank");
    });
    await page.waitForTimeout(500);

    expect((await readExternalOpens(app)).length).toBe(before);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  });

  test("applies the same policy to target=_blank anchors", async () => {
    const before = (await readExternalOpens(app)).length;

    await page.evaluate(() => {
      const anchor = document.createElement("a");
      anchor.href = "https://example.test/anchor";
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.textContent = "external";
      document.body.appendChild(anchor);
      anchor.click();
    });

    await expect.poll(() => (readExternalOpens(app)).then((opens) => opens.length)).toBe(before + 1);
    await expect.poll(() => readExternalOpens(app)).toContain("https://example.test/anchor");
  });

  test("opens the repository from the Help menu item", async () => {
    await clickMenuItem(app, "Help");

    await expect
      .poll(() => readExternalOpens(app))
      .toContain("https://github.com/alterdaemon/chatgpt-desktop");
  });

  test("never navigates the main window away from the fixture origin", async () => {
    expect(page.url().startsWith(fixture.url)).toBe(true);
  });
});

test.describe("quit shortcut", () => {
  test("quits the app when Control+Q is pressed in the page", async () => {
    const fixture = await startFixtureServer();
    const profile = createProfile();
    const app = await launchApp(profile, fixture.url);

    try {
      const page = await app.firstWindow();
      await page.waitForURL(fixture.url);
      await page.waitForFunction(() => Boolean(window.__chatgptDesktopVimiumNavigation));

      const closed = new Promise((resolve) => app.on("close", resolve));

      // before-input-event only sees events that travel through Electron's own
      // input pipeline, which CDP-injected keys bypass. The evaluate call is not
      // awaited because the app may exit before it can answer.
      app
        .evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          contents.sendInputEvent({ type: "keyDown", keyCode: "q", modifiers: ["control"] });
        })
        .catch(() => {});

      await expect(
        Promise.race([
          closed.then(() => "closed"),
          new Promise((resolve) => setTimeout(() => resolve("still running"), 10000)),
        ])
      ).resolves.toBe("closed");
    } finally {
      await app.close().catch(() => {});
      await fixture.close();
      profile.remove();
    }
  });
});
