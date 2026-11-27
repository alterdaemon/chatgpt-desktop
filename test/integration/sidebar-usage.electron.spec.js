const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");

test("usage percentage is visible without hover and preserves native tooltip and click behavior", async () => {
  const fixture = await startFixtureServer("sidebar-usage-fixture.html");
  const profile = createProfile();
  const app = await launchApp(profile, fixture.url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    let usageRequests = 0;
    page.on("request", request => { if (["xhr", "fetch"].includes(request.resourceType())) usageRequests++; });
    const marker = "[data-chatgpt-desktop-usage-percent]";
    const number = page.locator(marker).nth(0);
    await expect(number).toHaveText("3%");
    await expect(number).toBeVisible();
    await expect(page.locator(marker).nth(1)).toHaveText("75%");
    await expect(page.locator(`#unrelated ${marker}`)).toHaveCount(0);
    await expect(page.locator(`#conversation ${marker}`)).toHaveCount(0);
    await expect(page.locator("#usage-tooltip")).toBeHidden();
    for (const compact of [true, false]) {
      await page.locator("aside").evaluate((element, value) => element.classList.toggle("compact", value), compact);
      await expect(number).toBeVisible();
      const rect = await number.boundingBox();
      const sidebar = await page.locator("aside").boundingBox();
      expect(rect.x + rect.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
    }
    await page.locator("#usage").hover();
    await expect(page.locator("#usage-tooltip")).toBeVisible();
    await expect(page.locator("#usage-tooltip")).toHaveText("Weekly · 3% left");
    await expect(number).toHaveText("3%");
    await page.locator("#usage").click();
    expect(await page.evaluate(() => window.usageClicked)).toBe(true);
    expect(await page.evaluate(() => document.querySelector("#usage") === window.originalUsageTrigger)).toBe(true);
    await page.locator("#outside").hover();
    await expect(page.locator("#usage-tooltip")).toBeHidden();
    await expect(number).toBeVisible();
    await page.locator("#usage-tooltip").evaluate(element => { element.textContent = "Weekly · 0% left"; });
    await expect(number).toHaveText("0%");
    await page.locator("#react-usage").evaluate(element => {
      element.__reactFiber$fixture.memoizedProps.content.props.values.remainingPercent = 12;
    });
    await expect(page.locator(marker).nth(1)).toHaveText("12%");
    await page.locator("#react-usage").evaluate(element => {
      const original = element.__reactFiber$fixture;
      const currentRoot = { stateNode: {}, return: null };
      const oldRoot = { stateNode: currentRoot.stateNode, return: null };
      currentRoot.stateNode.current = currentRoot;
      original.return = oldRoot;
      original.alternate = { memoizedProps: { content: { props: { values: { remainingPercent: 9 } } } }, return: currentRoot };
    });
    await expect(page.locator(marker).nth(1)).toHaveText("9%");
    await page.evaluate(() => { history.pushState({}, "", "/c/fixture"); });
    await expect(number).toHaveCount(1);
    await page.evaluate(() => window.__chatgptDesktopSidebarUsage.refresh());
    await expect(page.locator(marker)).toHaveCount(2);
    // React can replace its children; the adapter restores only its own label.
    await number.evaluate(element => element.remove());
    await expect(page.locator(marker)).toHaveText(["9%", "0%"]);
    await page.locator("#usage-tooltip").evaluate(element => { element.textContent = "Usage unavailable"; });
    await expect(page.locator(marker)).toHaveCount(1);
    await expect(page.locator(marker)).toHaveText("9%");
    await expect(page.locator("#usage")).toHaveCSS("height", "32px");
    await page.evaluate(() => window.__chatgptDesktopSidebarUsage.destroy());
    await expect(page.locator(marker)).toHaveCount(0);
    expect(usageRequests).toBe(0);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});
