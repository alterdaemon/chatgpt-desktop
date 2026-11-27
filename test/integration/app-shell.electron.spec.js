const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { clickMenuItem, createProfile, launchApp, projectRoot } = require("../helpers/launch-app");

// Fixture that mirrors the signed-in app's structure: a sidebar with its own scroller, a header
// inside main, a scrolling thread and a composer form. See test/fixtures/app-shell-fixture.html.
const exampleCss = fs.readFileSync(
  path.join(projectRoot, "resources", "examples", "styles", "custom.css"),
  "utf8"
);

const overlayMarkers = "[data-chatgpt-desktop-hints='true'] > div";

async function launch(css) {
  const fixture = await startFixtureServer("app-shell-fixture.html");
  const profile = createProfile({ css });
  const app = await launchApp(profile, fixture.url);
  const page = await app.firstWindow();
  await page.waitForURL(fixture.url);
  await page.waitForFunction(() => Boolean(window.__chatgptDesktopVimiumNavigation));
  return {
    app,
    page,
    async close() {
      await app.close();
      await fixture.close();
      profile.remove();
    },
  };
}

// Visible, non-avatar elements that still have a corner radius.
const roundedElements = (page) =>
  page.evaluate(() => {
    const found = [];
    for (const element of document.querySelectorAll("body *")) {
      if (element.tagName === "IMG") continue;
      const style = getComputedStyle(element);
      if (style.borderTopLeftRadius === "0px") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 14 || rect.height < 14 || style.display === "none") continue;
      found.push(`${element.tagName.toLowerCase()}#${element.id || "-"} ${style.borderTopLeftRadius}`);
    }
    return found;
  });

test.describe("example stylesheet", () => {
  test.describe.configure({ mode: "serial" });

  test("without a stylesheet the fixture is rounded (control)", async () => {
    const session = await launch(undefined);
    try {
      expect((await roundedElements(session.page)).length).toBeGreaterThan(5);
    } finally {
      await session.close();
    }
  });

  test("squares every non-avatar surface in both themes and keeps avatars circular", async () => {
    const session = await launch(exampleCss);
    const { page } = session;
    try {
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        expect(await roundedElements(page), `rounded elements in the ${theme} theme`).toEqual([]);
      }

      await expect(page.locator(".avatar")).toHaveCSS("border-top-left-radius", "9999px");
    } finally {
      await session.close();
    }
  });

  test("squares transient surfaces such as an open menu", async () => {
    const session = await launch(exampleCss);
    const { page } = session;
    try {
      await page.evaluate(() => document.querySelector("#menu").showPopover());
      expect(await roundedElements(page)).toEqual([]);
      await expect(page.locator("#menu")).toHaveCSS("border-top-left-radius", "0px");
    } finally {
      await session.close();
    }
  });

  test("applies theme surfaces from html[data-theme]", async () => {
    const session = await launch(exampleCss);
    const { page } = session;
    try {
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await expect(page.locator("#app-shell-sidebar")).toHaveCSS("background-color", "rgb(20, 20, 20)");
      await expect(page.locator("main")).toHaveCSS("background-color", "rgb(26, 26, 26)");
      await expect(page.locator("form[data-chatgpt-composer] > div")).toHaveCSS("background-color", "rgb(20, 20, 20)");

      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await expect(page.locator("form[data-chatgpt-composer] > div")).toHaveCSS("background-color", "rgb(247, 247, 247)");
      // The dark sidebar color must not leak into the light theme.
      await expect(page.locator("#app-shell-sidebar")).not.toHaveCSS("background-color", "rgb(20, 20, 20)");

      // An unrecognized theme leaves the site's colors alone.
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "sepia"));
      await expect(page.locator("main")).not.toHaveCSS("background-color", "rgb(26, 26, 26)");
    } finally {
      await session.close();
    }
  });
});

test.describe("Vimium-style navigation across the application window", () => {
  test.describe.configure({ mode: "serial" });

  let session;
  let page;

  const scrollTops = () =>
    page.evaluate(() => ({
      list: document.querySelector("[data-app-action-sidebar-scroll]").scrollTop,
      thread: document.querySelector("[data-app-action-timeline-scroll]").scrollTop,
    }));

  const hintRegions = () =>
    page.evaluate((selector) => {
      const regions = {};
      for (const marker of document.querySelectorAll(selector)) {
        if (marker.style.display === "none") continue;
        const x = parseFloat(marker.style.left);
        const y = parseFloat(marker.style.top);
        const target = document
          .elementsFromPoint(x + 8, y + 8)
          .find((element) => !element.closest("[data-chatgpt-desktop-hints='true']"));
        const region = !target ? "none"
          : target.closest("#app-shell-sidebar") ? "sidebar"
          : target.closest("main > header") ? "header"
          : target.closest("form") ? "composer"
          : target.closest("[data-app-action-timeline-scroll]") ? "thread"
          : target.closest("[popover]") ? "menu" : "other";
        regions[region] = (regions[region] || 0) + 1;
      }
      return regions;
    }, overlayMarkers);

  const markerCount = () => page.locator(overlayMarkers).filter({ visible: true }).count();

  test.beforeAll(async () => {
    session = await launch(undefined);
    page = session.page;
  });

  test.afterAll(async () => {
    await session?.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => {
      if (document.querySelector("#menu").matches(":popover-open")) {
        document.querySelector("#menu").hidePopover();
      }
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      document.querySelector("[data-app-action-sidebar-scroll]").scrollTop = 0;
      document.querySelector("[data-app-action-timeline-scroll]").scrollTop = 0;
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
    });
    await page.keyboard.press("Escape");
    // Park the pointer over the thread so scroll-region selection is deterministic.
    await page.mouse.move(800, 400);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  });

  test("labels actionable elements in the sidebar, header, thread and composer", async () => {
    await page.keyboard.press("f");
    await expect.poll(markerCount).toBeGreaterThan(0);

    const regions = await hintRegions();
    expect(regions.sidebar).toBeGreaterThanOrEqual(10);
    expect(regions.header).toBe(2);
    expect(regions.thread).toBe(2);
    expect(regions.composer).toBe(2);
    expect(regions.other).toBeUndefined();
  });

  test("does not label elements in a region that scrolled out of view", async () => {
    await page.keyboard.press("f");
    await expect.poll(markerCount).toBeGreaterThan(0);
    // 40 rows exist, the sidebar fits fewer than that, so off-screen rows are not hinted.
    expect((await hintRegions()).sidebar).toBeLessThan(40);
  });

  test("labels an open menu and not the page elements it covers", async () => {
    await page.keyboard.press("f");
    await expect.poll(markerCount).toBeGreaterThan(0);
    const withoutMenu = await markerCount();
    await page.keyboard.press("Escape");

    // Cover both thread buttons with a three-item menu.
    await page.evaluate(() => {
      const first = document.querySelector("#thread-btn-1").getBoundingClientRect();
      const menu = document.querySelector("#menu");
      menu.style.position = "fixed";
      menu.style.left = `${first.left - 10}px`;
      menu.style.top = `${first.top - 10}px`;
      menu.style.width = "260px";
      menu.showPopover();
    });
    await page.keyboard.press("f");
    await expect.poll(markerCount).toBeGreaterThan(0);

    // Two covered buttons are replaced by three menu items.
    expect(await markerCount()).toBe(withoutMenu - 2 + 3);
    const regions = await hintRegions();
    expect(regions.menu).toBe(3);
    expect(regions.thread).toBeUndefined();
  });

  test("scrolls the thread by default", async () => {
    await page.keyboard.press("j");
    await expect.poll(async () => (await scrollTops()).thread).toBeGreaterThan(0);
    expect((await scrollTops()).list).toBe(0);
  });

  test("scrolls the sidebar list when the pointer is over it", async () => {
    await page.mouse.move(150, 300);
    await page.keyboard.press("j");
    await expect.poll(async () => (await scrollTops()).list).toBeGreaterThan(0);
    expect((await scrollTops()).thread).toBe(0);

    await page.keyboard.press("G");
    await expect.poll(async () => (await scrollTops()).list).toBeGreaterThan(100);
    expect((await scrollTops()).thread).toBe(0);
  });

  test("focus wins over the pointer", async () => {
    await page.locator("#sidebar-link-3").focus();
    // The pointer is parked over the thread.
    await page.keyboard.press("j");
    await expect.poll(async () => (await scrollTops()).list).toBeGreaterThan(0);
    expect((await scrollTops()).thread).toBe(0);
  });

  test("a key that cannot scroll its region does not move another region", async () => {
    await page.evaluate(() => {
      const list = document.querySelector("[data-app-action-sidebar-scroll]");
      list.scrollTop = list.scrollHeight;
    });
    const before = await scrollTops();
    await page.mouse.move(150, 300);
    await page.evaluate(() => {
      window.__bubbledKeys = [];
      document.addEventListener("keydown", (event) => window.__bubbledKeys.push(event.key));
    });

    await page.keyboard.press("j");
    await page.waitForTimeout(300);

    expect(await scrollTops()).toEqual(before);
    // The key is consumed, so it does not reach the page.
    expect(await page.evaluate(() => window.__bubbledKeys)).toEqual([]);
  });

  test("falls back to the thread after the feature is toggled and the pointer forgotten", async () => {
    await page.mouse.move(150, 300);
    await clickMenuItem(session.app, "Vimium-Style Navigation", { checked: false });
    await expect
      .poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled()))
      .toBe(false);
    await clickMenuItem(session.app, "Vimium-Style Navigation", { checked: true });
    await expect
      .poll(() => page.evaluate(() => window.__chatgptDesktopVimiumNavigation.isEnabled()))
      .toBe(true);

    // Disabling dropped the remembered pointer position, so the main region is chosen.
    await page.keyboard.press("j");
    await expect.poll(async () => (await scrollTops()).thread).toBeGreaterThan(0);
    expect((await scrollTops()).list).toBe(0);
  });

  test("gi focuses the message composer rather than another field", async () => {
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page.locator("#composer-input")).toBeFocused();
    await expect(page.locator("#sidebar-search")).not.toBeFocused();
  });
});
