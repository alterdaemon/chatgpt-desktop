const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect, _electron: electron } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");

const projectRoot = path.join(__dirname, "..", "..");

test.describe.configure({ mode: "serial" });

let app;
let page;
let fixture;
let temporaryRoot;

test.beforeAll(async () => {
  fixture = await startFixtureServer();
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-desktop-e2e-"));
  const configPath = path.join(temporaryRoot, "config", "chatgpt-desktop");
  fs.mkdirSync(path.join(configPath, "styles"), { recursive: true });
  fs.mkdirSync(path.join(configPath, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(configPath, "styles", "custom.css"), "#thread { border-top: 7px solid rgb(1, 2, 3) !important; }");
  fs.writeFileSync(
    path.join(configPath, "scripts", "test-script.js"),
    "window.__chatgptDesktopTestScriptRuns = (window.__chatgptDesktopTestScriptRuns || 0) + 1;"
  );
  app = await electron.launch({
    executablePath: require("electron"),
    args: [projectRoot],
    env: {
      ...process.env,
      NODE_ENV: "test",
      CHATGPT_DESKTOP_E2E_URL: fixture.url,
      XDG_CONFIG_HOME: path.join(temporaryRoot, "config"),
      XDG_DATA_HOME: path.join(temporaryRoot, "data"),
      XDG_CACHE_HOME: path.join(temporaryRoot, "cache"),
    },
  });
  page = await app.firstWindow();
  await page.waitForURL(fixture.url);
  await page.waitForFunction(() => Boolean(window.__chatgptDesktopVimiumNavigation));
  await page.waitForFunction(() => window.__chatgptDesktopTestScriptRuns === 1);
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("uses the isolated fixture while retaining the production window security model", async () => {
  expect(page.url()).toBe(fixture.url);
  await expect(page.locator("#thread")).toBeVisible();
  expect(await page.evaluate(() => typeof process)).toBe("undefined");
  expect(await page.evaluate(() => typeof require)).toBe("undefined");
  await expect(page.locator("#thread")).toHaveCSS("border-top-width", "7px");
  expect(await page.evaluate(() => window.__chatgptDesktopTestScriptRuns)).toBe(1);

  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  expect(preferences.contextIsolation).toBe(true);
  expect(preferences.nodeIntegration).toBe(false);
  expect(preferences.sandbox).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened())).toBe(false);
});

test("persists Vimium menu changes and reapplies the page controller", async () => {
  const toggleVimium = (enabled) => app.evaluate(({ Menu }, checked) => {
    const menuItem = Menu.getApplicationMenu().items[0].submenu.items.find((item) => item.label === "Vimium-Style Navigation");
    menuItem.click({ checked });
  }, enabled);

  await toggleVimium(false);
  await expect.poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled())).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(temporaryRoot, "config", "chatgpt-desktop", "settings.json"), "utf8")).vimiumNavigationEnabled).toBe(false);

  await toggleVimium(true);
  await expect.poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled())).toBe(true);
});

test("injects Vimium navigation without intercepting prompt typing", async () => {
  await page.evaluate(() => {
    document.activeElement.blur();
    document.querySelector("#scroll-root").scrollTop = 0;
  });
  await page.keyboard.press("j");
  await expect.poll(() => page.locator("#scroll-root").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.locator("#prompt-textarea").fill("");
  await page.locator("#prompt-textarea").focus();
  const scrollPosition = await page.locator("#scroll-root").evaluate((element) => element.scrollTop);
  await page.keyboard.type("j");
  await expect(page.locator("#prompt-textarea")).toHaveValue("j");
  expect(await page.locator("#scroll-root").evaluate((element) => element.scrollTop)).toBe(scrollPosition);
});

test("handles Vimium sequences, hints, and route cleanup", async () => {
  await page.evaluate(() => {
    document.activeElement.blur();
    document.querySelector("#scroll-root").scrollTop = 500;
  });
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect.poll(() => page.locator("#scroll-root").evaluate((element) => element.scrollTop)).toBe(0);

  await page.keyboard.press("G");
  await expect.poll(() => page.locator("#scroll-root").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect.poll(() => page.locator("#scroll-root").evaluate((element) => element.scrollTop)).toBe(0);
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page.locator("#prompt-textarea")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#prompt-textarea")).not.toBeFocused();

  await page.keyboard.press("f");
  const overlay = page.locator("[data-chatgpt-desktop-hints='true']");
  await expect(overlay).toBeVisible();
  await page.keyboard.type("a");
  await expect(page.locator("#activation-count")).toHaveText("1");
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press("f");
  await expect(overlay).toBeVisible();
  await page.evaluate(() => history.pushState({}, "", "/new-route"));
  await expect(overlay).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__chatgptDesktopTestScriptRuns)).toBe(2);
});
