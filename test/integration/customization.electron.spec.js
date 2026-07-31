const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");

test.describe.configure({ mode: "serial" });

const scripts = {
  // Sorted by file name, so "01" runs before "02" regardless of write order.
  "02-second.js":
    "window.__order = (window.__order || []); window.__order.push('second');" +
    "window.__secondRuns = (window.__secondRuns || 0) + 1;",
  "01-first.js":
    "window.__order = (window.__order || []); window.__order.push('first');" +
    "window.__firstRuns = (window.__firstRuns || 0) + 1;",
  "ignored.txt": "window.__ignoredRan = true;",
};

test.describe("with customization files present", () => {
  let app;
  let page;
  let fixture;
  let profile;

  test.beforeAll(async () => {
    fixture = await startFixtureServer();
    profile = createProfile({
      css: "#thread { border-top: 7px solid rgb(1, 2, 3) !important; }",
      scripts,
    });
    app = await launchApp(profile, fixture.url);
    page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.waitForFunction(() => window.__firstRuns === 1 && window.__secondRuns === 1);
  });

  test.afterAll(async () => {
    await app?.close();
    await fixture?.close();
    profile?.remove();
  });

  test("applies the external stylesheet to the page", async () => {
    await expect(page.locator("#thread")).toHaveCSS("border-top-width", "7px");
    await expect(page.locator("#thread")).toHaveCSS("border-top-color", "rgb(1, 2, 3)");
  });

  test("runs user scripts in sorted order and ignores non-JavaScript files", async () => {
    expect(await page.evaluate(() => window.__order)).toEqual(["first", "second"]);
    expect(await page.evaluate(() => window.__ignoredRan)).toBeUndefined();
  });

  test("does not re-run a script when the in-page route is unchanged", async () => {
    await page.evaluate(() => history.pushState({}, "", location.pathname));
    // Negative assertion, so give the injection pipeline time to misbehave.
    await page.waitForTimeout(750);

    expect(await page.evaluate(() => window.__firstRuns)).toBe(1);
    expect(await page.evaluate(() => window.__secondRuns)).toBe(1);
  });

  test("re-runs every script after an in-page route change", async () => {
    await page.evaluate(() => history.pushState({}, "", "/route-b"));

    await expect.poll(() => page.evaluate(() => window.__firstRuns)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__secondRuns)).toBe(2);
    expect(await page.evaluate(() => window.__order)).toEqual(["first", "second", "first", "second"]);
  });

  test("keeps injected CSS applied across in-page navigation", async () => {
    await expect(page.locator("#thread")).toHaveCSS("border-top-width", "7px");
  });
});

test.describe("without customization files", () => {
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

  test("starts cleanly and injects no stylesheet or user script", async () => {
    await expect(page.locator("#thread")).toBeVisible();
    await expect(page.locator("#thread")).toHaveCSS("border-top-width", "0px");
    expect(await page.evaluate(() => window.__order)).toBeUndefined();
  });

  test("creates the settings file with defaults on first run", async () => {
    await expect.poll(() => profile.readSettings()).toEqual({
      spellCheckEnabled: false,
      showShortcut: "CommandOrControl+Shift+Space",
      zoomFactor: 1,
      vimiumNavigationEnabled: true,
    });
  });
});
