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
    const original = await page.locator("#native-usage").boundingBox();
    for (const compact of [true, false]) {
      await page.locator("aside").evaluate((el, value) => el.classList.toggle("compact", value), compact);
      await expect(label).toBeVisible();
      const bounds = await label.boundingBox();
      const sidebar = await page.locator("aside").boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(sidebar.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
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
