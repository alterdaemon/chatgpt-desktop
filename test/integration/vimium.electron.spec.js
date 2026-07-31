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

let app;
let page;
let fixture;
let profile;

const scrollTop = () => page.locator("#scroll-root").evaluate((element) => element.scrollTop);
const scrollLeft = () => page.locator("#scroll-root").evaluate((element) => element.scrollLeft);
const overlay = () => page.locator("[data-chatgpt-desktop-hints='true']");

async function resetPage() {
  await page.evaluate(() => {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    const root = document.querySelector("#scroll-root");
    root.scrollTop = 0;
    root.scrollLeft = 0;
    document.querySelector("#activation-log").textContent = "";
    document.querySelector("#prompt-textarea").value = "";
    document.querySelector("#editable").textContent = "editable";
    // A caret left inside the contenteditable keeps isEditableContext() true
    // even after blur, which would suppress navigation keys in the next test.
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
  });
  await page.keyboard.press("Escape");
}

test.beforeAll(async () => {
  fixture = await startFixtureServer("vimium-fixture.html");
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

test.beforeEach(async () => {
  await resetPage();
});

test("scrolls vertically with j and k", async () => {
  await page.keyboard.press("j");
  await expect.poll(scrollTop).toBeGreaterThan(0);

  const afterDown = await scrollTop();
  await page.keyboard.press("j");
  await expect.poll(scrollTop).toBeGreaterThan(afterDown);

  await page.keyboard.press("k");
  await expect.poll(scrollTop).toBeLessThan(await Promise.resolve(afterDown * 2));
});

test("scrolls horizontally with h and l", async () => {
  await page.keyboard.press("l");
  await expect.poll(scrollLeft).toBeGreaterThan(0);

  await page.keyboard.press("h");
  await expect.poll(scrollLeft).toBe(0);
});

test("scrolls half a viewport with d and u", async () => {
  await page.keyboard.press("d");
  await expect.poll(scrollTop).toBeGreaterThan(100);

  const afterHalfPageDown = await scrollTop();
  await page.keyboard.press("u");
  await expect.poll(scrollTop).toBeLessThan(afterHalfPageDown);
});

test("jumps to the top with gg and the bottom with G", async () => {
  await page.evaluate(() => {
    document.querySelector("#scroll-root").scrollTop = 400;
  });

  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect.poll(scrollTop).toBe(0);

  await page.keyboard.press("G");
  await expect.poll(scrollTop).toBeGreaterThan(0);
});

test("abandons a pending g sequence after the timeout", async () => {
  await page.evaluate(() => {
    document.querySelector("#scroll-root").scrollTop = 400;
  });

  await page.keyboard.press("g");
  // KEY_SEQUENCE_TIMEOUT_MS is 1500ms, so this second g starts a new sequence.
  await page.waitForTimeout(1800);
  await page.keyboard.press("g");
  await page.waitForTimeout(300);

  expect(await scrollTop()).toBe(400);
});

test("focuses the prompt with gi and releases it with Escape", async () => {
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page.locator("#prompt-textarea")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator("#prompt-textarea")).not.toBeFocused();
});

test("does not intercept typing inside the prompt textarea", async () => {
  await page.locator("#prompt-textarea").focus();
  const before = await scrollTop();

  await page.keyboard.type("jkgg");

  await expect(page.locator("#prompt-textarea")).toHaveValue("jkgg");
  expect(await scrollTop()).toBe(before);
});

test("does not intercept typing inside a contenteditable region", async () => {
  await page.locator("#editable").click();
  const before = await scrollTop();

  await page.keyboard.type("jj");

  await expect(page.locator("#editable")).toContainText("jj");
  expect(await scrollTop()).toBe(before);
});

test("swallows printable keys outside editable context but not inside it", async () => {
  await page.evaluate(() => {
    window.__bubbledKeys = [];
    document.addEventListener("keydown", (event) => window.__bubbledKeys.push(event.key));
  });

  await page.keyboard.press("z");
  expect(await page.evaluate(() => window.__bubbledKeys)).toEqual([]);

  await page.locator("#prompt-textarea").focus();
  await page.keyboard.press("z");
  expect(await page.evaluate(() => window.__bubbledKeys)).toEqual(["z"]);
});

test("shows hints with f and activates the chosen target", async () => {
  await page.keyboard.press("f");
  await expect(overlay()).toBeVisible();
  await expect(page.locator("[data-hint-code='a']")).toBeVisible();

  await page.keyboard.press("a");
  await expect(page.locator("#activation-log")).toHaveText("btn-one");
  await expect(overlay()).toHaveCount(0);
});

test("activates a different target for a different hint code", async () => {
  await page.keyboard.press("f");
  await expect(overlay()).toBeVisible();

  await page.keyboard.press("s");
  await expect(page.locator("#activation-log")).toHaveText("btn-two");
  await expect(overlay()).toHaveCount(0);
});

test("exits hint mode with Escape without activating anything", async () => {
  await page.keyboard.press("f");
  await expect(overlay()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(overlay()).toHaveCount(0);
  await expect(page.locator("#activation-log")).toHaveText("");
});

test("exits hint mode when no hint matches the typed key", async () => {
  await page.keyboard.press("f");
  await expect(overlay()).toBeVisible();

  // Only a, s and d are assigned, so q cannot match any hint.
  await page.keyboard.press("q");
  await expect(overlay()).toHaveCount(0);
  await expect(page.locator("#activation-log")).toHaveText("");
});

test("routes alternate hints for links through the external open policy", async () => {
  await page.keyboard.press("F");
  await expect(overlay()).toBeVisible();

  await page.keyboard.press("d");
  await expect(overlay()).toHaveCount(0);

  await expect
    .poll(() => readExternalOpens(app))
    .toContain("https://example.test/opened");
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test("stops handling keys entirely while the feature is disabled", async () => {
  await clickMenuItem(app, "Vimium-Style Navigation", { checked: false });
  await expect
    .poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled()))
    .toBe(false);

  const before = await scrollTop();
  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  expect(await scrollTop()).toBe(before);

  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  await expect(overlay()).toHaveCount(0);

  await clickMenuItem(app, "Vimium-Style Navigation", { checked: true });
  await expect
    .poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled()))
    .toBe(true);

  await page.keyboard.press("j");
  await expect.poll(scrollTop).toBeGreaterThan(before);
});

test("closes hint mode when an in-page route change occurs", async () => {
  await page.keyboard.press("f");
  await expect(overlay()).toBeVisible();

  await page.evaluate(() => history.pushState({}, "", "/vimium-route"));
  await expect(overlay()).toHaveCount(0);
});
