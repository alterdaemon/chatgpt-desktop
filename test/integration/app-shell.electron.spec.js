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

for (const stylesheet of [undefined, exampleCss]) {
  test(`clicking chat background then f suppresses its sibling focus ring; example stylesheet=${Boolean(stylesheet)}`, async () => {
    const session = await launch(stylesheet);
    const { page } = session;
    try {
      await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); });
      const scroller = page.locator("[data-app-action-timeline-scroll]");
      await scroller.click({ position: { x: 200, y: 150 } });
      await expect(scroller).toBeFocused();
      await page.keyboard.press("f");
      await expect(page.locator("[data-chatgpt-desktop-hints]")).toBeVisible();
      expect(await scroller.evaluate(el => el.matches(":focus-visible"))).toBe(true);
      await expect(page.locator("#transcript-focus-ring")).toHaveCSS("box-shadow", "none");
      await page.keyboard.press("Escape");
      if (!stylesheet) {
        // Original native focus styling returns when hints stop; only the
        // decorative transcript overlay was changed, not keyboard focus itself.
        await expect(page.locator("#transcript-focus-ring")).not.toHaveCSS("box-shadow", "none");
      }
      await page.locator("#header-share").evaluate(el => { el.style.outline = "2px solid rgb(0, 90, 255)"; });
      await page.locator("#header-share").focus();
      await page.keyboard.press("f");
      await expect(page.locator("#header-share")).toHaveCSS("outline-style", "solid");
      await expect(page.locator("#header-share")).toHaveCSS("outline-color", "rgb(0, 90, 255)");
    } finally {
      await session.close();
    }
  });
}

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

  test("removes the fade overlays at the top and bottom of the conversation", async () => {
    const layers = (page) =>
      page.evaluate(() => {
        const bg = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo).backgroundImage;
        const mask = (selector) => {
          const style = getComputedStyle(document.querySelector(selector));
          return style.maskImage !== "none" ? style.maskImage : style.webkitMaskImage;
        };
        return {
          top: bg("#top-fade"),
          bottom: bg("#footer-wrap", "::before"),
          sidebar: mask("[data-app-action-sidebar-scroll]"),
          composer: mask("#composer-row"),
        };
      });

    // Control: without the stylesheet every layer is painted.
    const plain = await launch(undefined);
    try {
      const before = await layers(plain.page);
      expect(before.top).toContain("gradient");
      expect(before.bottom).toContain("gradient");
      expect(before.sidebar).toContain("gradient");
      expect(before.composer).toContain("gradient");
    } finally {
      await plain.close();
    }

    const styled = await launch(exampleCss);
    try {
      expect(await layers(styled.page)).toEqual({ top: "none", bottom: "none", sidebar: "none", composer: "none" });
    } finally {
      await styled.close();
    }
  });

  test("keeps the cover below the composer in step with the dark surface", async () => {
    const cover = (page) =>
      page.evaluate(() => ({
        cover: getComputedStyle(document.querySelector("#footer-wrap"), "::after").backgroundColor,
        main: getComputedStyle(document.querySelector("main")).backgroundColor,
      }));

    // Control: unstyled, the cover is the site's black and does not match the dark surface.
    const plain = await launch(undefined);
    try {
      await plain.page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      expect((await cover(plain.page)).cover).toBe("rgb(0, 0, 0)");
    } finally {
      await plain.close();
    }

    const styled = await launch(exampleCss);
    try {
      await styled.page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      const dark = await cover(styled.page);
      expect(dark.cover).toBe(dark.main);

      // The cover stays a solid fill, so scrolled text cannot show through below the composer.
      expect(dark.cover).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await styled.close();
    }
  });

  test("hides the disclaimer without reserving space or hiding the thread footer", async () => {
    const selector = '[class*="visibility:var(--thread-composer-disclaimer-visibility"]';
    const plain = await launch(undefined);
    try {
      await expect(plain.page.locator(selector)).toBeVisible();
    } finally {
      await plain.close();
    }

    const styled = await launch(exampleCss);
    try {
      await expect(styled.page.locator(selector)).toHaveCSS("display", "none");
      expect(await styled.page.locator(selector).evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
      await expect(styled.page.locator("#footer-wrap")).not.toHaveCSS("display", "none");
    } finally {
      await styled.close();
    }
  });

  test("keeps the title bar opaque over a scrolling thread without restoring the fade", async () => {
    const plain = await launch(undefined);
    try {
      await expect(plain.page.locator("[data-app-shell-main-titlebar]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    } finally {
      await plain.close();
    }

    const styled = await launch(exampleCss);
    const { page } = styled;
    try {
      // Reproduce the site's fixed transparent header over the thread.
      await page.locator("main header").evaluate((el) => {
        Object.assign(el.style, { position: "fixed", left: "300px", right: "0", top: "0", zIndex: "30" });
      });
      for (const [theme, color] of [["light", "rgb(252, 252, 252)"], ["dark", "rgb(10, 10, 10)"]]) {
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        const titlebar = page.locator("[data-app-shell-main-titlebar]");
        const before = await titlebar.boundingBox();
        await page.locator("[data-app-action-timeline-scroll]").evaluate((el) => { el.scrollTop += 200; });
        expect(await titlebar.boundingBox()).toEqual(before);
        await expect(titlebar).toHaveCSS("background-color", color);
        await expect(page.locator("#top-fade")).toHaveCSS("background-image", "none");
      }
    } finally {
      await styled.close();
    }
  });

  test("does not paint over full-bleed Settings when switching away from a conversation", async () => {
    const session = await launch(exampleCss);
    const { page } = session;
    try {
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        const titlebar = page.locator("[data-app-shell-main-titlebar]");
        const layout = page.locator("[data-app-shell-main-content-layout]");
        await layout.evaluate((el) => el.setAttribute("data-app-shell-main-content-layout", "full-bleed"));
        await expect(titlebar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await layout.evaluate((el) => el.setAttribute("data-app-shell-main-content-layout", "thread-edge-scroll"));
        await expect(titlebar).toHaveCSS("background-color", theme === "dark" ? "rgb(10, 10, 10)" : "rgb(252, 252, 252)");
      }
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

  test("does not paint a bright chat-frame focus ring when using hint mode", async () => {
    const session = await launch(exampleCss);
    const { page } = session;
    try {
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "dark");
        for (const element of document.querySelectorAll("main, main [data-app-shell-main-content-layout], main [data-app-action-timeline-scroll]")) {
          element.tabIndex = -1;
          Object.assign(element.style, { border: "1px solid white", outline: "2px solid white", boxShadow: "0 0 0 2px white" });
        }
        document.querySelector("#header-share").style.outline = "2px solid rgb(0, 90, 255)";
      });
      for (const selector of ["main", "[data-app-shell-main-content-layout]", "[data-app-action-timeline-scroll]"]) {
        await page.locator(selector).focus();
        await page.keyboard.press("f");
        await expect(page.locator("[data-chatgpt-desktop-hints]")).toBeVisible();
        await expect(page.locator(selector)).toHaveCSS("border-top-color", "rgb(10, 10, 10)");
        await expect(page.locator(selector)).toHaveCSS("outline-style", "none");
        await expect(page.locator(selector)).toHaveCSS("box-shadow", "none");
        await page.keyboard.press("Escape");
      }
      await page.locator("#header-share").focus();
      await expect(page.locator("#header-share")).toHaveCSS("outline-color", "rgb(0, 90, 255)");
      await expect(page.locator("#header-share")).toHaveCSS("outline-style", "solid");
    } finally {
      await session.close();
    }
  });

  test("applies theme surfaces from html[data-theme]", async () => {
    const session = await launch(exampleCss);
    const { page } = session;
    try {
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await expect(page.locator("#app-shell-sidebar")).toHaveCSS("background-color", "rgb(0, 0, 0)");
      await expect(page.locator("main")).toHaveCSS("background-color", "rgb(10, 10, 10)");
      await expect(page.locator("form[data-chatgpt-composer] > div")).toHaveCSS("background-color", "rgb(36, 36, 36)");

      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await expect(page.locator("form[data-chatgpt-composer] > div")).toHaveCSS("background-color", "rgb(247, 247, 247)");
      // The dark sidebar color must not leak into the light theme.
      await expect(page.locator("#app-shell-sidebar")).not.toHaveCSS("background-color", "rgb(0, 0, 0)");

      // An unrecognized theme leaves the site's colors alone.
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "sepia"));
      await expect(page.locator("main")).not.toHaveCSS("background-color", "rgb(10, 10, 10)");
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
