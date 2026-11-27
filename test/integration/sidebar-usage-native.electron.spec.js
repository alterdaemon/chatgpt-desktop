const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");

test("lazy native usage tooltip stays open and a percentage is visible before and after hover without modifying its trigger", async () => {
  const fixture = await startFixtureServer("sidebar-usage-native-fixture.html");
  const profile = createProfile();
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    const label = page.locator("[data-chatgpt-desktop-usage-percent]");
    await test.step("percentage exists before any hover", async () => {
      await expect(label).toHaveText("3%");
    });
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(label).toHaveCSS("font-size", "18px");
    await expect(label).toHaveCSS("font-weight", "700");
    await expect(label).toHaveCSS("background-color", "rgb(0, 0, 0)");
    const original = await page.locator("#native-usage").boundingBox();
    for (const compact of [true, false]) {
      await page.locator("aside").evaluate((el, value) => el.classList.toggle("compact", value), compact);
      await expect(label).toBeVisible();
      const bounds = await label.boundingBox();
      const sidebar = await page.locator("aside").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(sidebar.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
      // The persistent number replaces the diamond at the same position. A
      // visible span below the icon is not a successful replacement.
      expect(bounds.x).toBeLessThanOrEqual(original.x);
      expect(bounds.y).toBeLessThanOrEqual(original.y);
      expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(original.x + original.width);
      expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(original.y + original.height);
      await test.step("open native hover tooltip", async () => {
        await page.locator("#native-usage").hover();
        await expect.poll(() => page.locator("#native-tooltip").evaluate(el => el.matches(":popover-open"))).toBe(true);
      });
      // Multiple refreshes and real elapsed interest delays must not dismiss or
      // rebuild a native popover while the pointer stays on its original icon.
      await page.waitForTimeout(1600);
      await page.evaluate(() => window.__chatgptDesktopSidebarUsage.refresh());
      expect(await page.locator("#native-tooltip").evaluate(el => el.matches(":popover-open"))).toBe(true);
      await expect(page.locator("#native-tooltip")).toHaveText("Weekly · 3% left");
      expect(await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(
        await page.locator("#native-tooltip").evaluate(el => parseFloat(getComputedStyle(el).fontSize))
      );
      expect(await page.locator("#native-usage").boundingBox()).toEqual(original);
      await page.locator("#outside").hover();
      await expect.poll(() => page.locator("#native-tooltip").evaluate(el => el.matches(":popover-open"))).toBe(false);
      await expect(label).toHaveText("3%");
      await expect(label).toBeVisible();
    }
    expect(await page.evaluate(() => document.querySelector("#native-usage").outerHTML === window.originalUsageHTML)).toBe(true);
    expect(await page.evaluate(() => window.usageMutations)).toBe(0);
    await page.locator("#native-usage").evaluate(el => {
      el.__reactFiber$fixture.memoizedProps.content.props.children = ["Weekly · ", { props: { children: ["12", "%"] } }, " left"];
    });
    await expect(label).toHaveText("12%");
    await page.locator("#native-usage").evaluate(el => {
      el.__reactFiber$fixture.memoizedProps.content.props.children = ["Weekly · -1% left"];
    });
    await expect(label).toHaveCount(0);
    expect(await page.evaluate(() => window.usageMutations)).toBe(0);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});

test("white percentage replaces the icon at idle through tooltip wrappers and fits 100% in the compact sidebar", async () => {
  const fixture = await startFixtureServer("sidebar-usage-native-fixture.html");
  const profile = createProfile();
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.locator("#outside").hover();
    await page.locator("#native-usage").evaluate(el => {
      let fiber = { memoizedProps: { tooltip: { props: { values: { remainingPercent: 1 } } } }, return: null };
      window.usageValueProps = fiber.memoizedProps.tooltip.props.values;
      for (let depth = 0; depth < 20; depth++) fiber = { memoizedProps: {}, return: fiber };
      el.__reactFiber$fixture = fiber;
      const row = document.createElement("div");
      row.setAttribute("data-sidebar-archive-chatgpt-id", "fixture");
      el.before(row);
      row.appendChild(el);
    });
    const label = page.locator("[data-chatgpt-desktop-usage-percent]");
    await expect(label).toHaveText("1%");
    await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(label).toHaveCSS("font-size", "18px");
    await page.waitForTimeout(1200);
    await expect(label).toHaveText("1%");
    expect(await page.locator("#native-tooltip").evaluate(el => el.matches(":popover-open"))).toBe(false);
    await page.locator("aside").evaluate(el => el.classList.add("compact"));
    await page.evaluate(() => { window.usageValueProps.remainingPercent = 100; });
    await expect(label).toHaveText("100%");
    const bounds = await label.boundingBox();
    const icon = await page.locator("#native-usage").boundingBox();
    const sidebar = await page.locator("aside").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(sidebar.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
    expect(bounds.y).toBe(icon.y);
    expect(bounds.height).toBe(icon.height);
    expect(await page.evaluate(() => window.usageMutations)).toBe(0);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});

test("replacing a row's usage glyph does not cover its neighboring conversation title", async () => {
  const fixture = await startFixtureServer("sidebar-usage-native-fixture.html");
  const profile = createProfile();
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.evaluate(() => {
      const row = document.createElement("div");
      row.setAttribute("role", "button");
      row.setAttribute("data-sidebar-archive-chatgpt-id", "fixture");
      row.style.cssText = "display:flex;align-items:center;gap:12px;width:280px;height:36px";
      row.innerHTML = '<span aria-describedby="native-tooltip" style="display:flex;align-items:center;justify-content:center;width:36px;height:32px"><svg width="20" height="20"><path d="M10 0 20 10 10 20 0 10Z"></path></svg></span><span id="row-title">Fixture row</span>';
      row.firstElementChild.__reactFiber$fixture = { memoizedProps: { content: { props: { remainingPercent: 1 } } }, return: null };
      document.querySelector("#native-usage").replaceWith(row);
    });
    const label = page.locator("[data-chatgpt-desktop-usage-percent]");
    await expect(label).toHaveText("1%");
    const bounds = await label.boundingBox();
    const glyph = await page.locator("aside svg").boundingBox();
    const title = await page.locator("#row-title").boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(64);
    expect(bounds.x).toBeLessThanOrEqual(glyph.x);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(glyph.x + glyph.width);
    expect(bounds.x + bounds.width).toBeLessThan(title.x);
    expect(await page.locator("#native-tooltip").evaluate(el => el.matches(":popover-open"))).toBe(false);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});
