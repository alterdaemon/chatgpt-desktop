const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");

for (const formatted of [false, true]) for (const roleless of [false, true]) for (const hoverFirst of [false, true]) {
  test(`usage persists independently of a mounted tooltip or description attribute; formatted=${formatted}, roleless=${roleless}, hover first=${hoverFirst}`, async () => {
    const fixture = await startFixtureServer("sidebar-usage-lifecycle-fixture.html");
    const profile = createProfile();
    const url = fixture.url + `?${roleless ? "roleless&" : ""}${formatted ? "formatted" : "plain"}`;
    const app = await launchApp(profile, url);
    try {
      const page = await app.firstWindow();
      await page.waitForURL(url);
      const label = page.locator("[data-chatgpt-desktop-usage-percent]");
      if (!hoverFirst) {
        await page.locator("#outside").hover();
        expect(await page.evaluate(() => window.hoverCount)).toBe(0);
        await expect(page.locator("#usage-tooltip")).toHaveCount(0);
        await expect(page.locator("#usage")).not.toHaveAttribute("aria-describedby");
        await expect(label).toHaveText("1%");
        await expect(label).toBeVisible();
        await page.evaluate(() => window.setRemaining(2));
        await expect(label).toHaveText("2%");
      }
      await page.locator("#usage").hover();
      await expect(page.locator("#usage-tooltip")).toBeVisible();
      await expect(label).toHaveText(hoverFirst ? "1%" : "2%");
      await page.evaluate(() => window.setRemaining(3));
      await expect(label).toHaveText("3%");
      // The original tooltip is deliberately not re-rendered here: mounting it
      // must not replace the live prop value with its older DOM text.
      await expect(page.locator("#usage-tooltip")).toHaveText(`Weekly · ${hoverFirst ? 1 : 2}% left`);
      await page.locator("#outside").hover();
      await expect(page.locator("#usage-tooltip")).toHaveCount(0);
      await expect(page.locator("#usage")).not.toHaveAttribute("aria-describedby");
      await page.waitForTimeout(1200);
      await expect(label).toHaveText("3%");
      await expect(label).toBeVisible();
      await page.evaluate(() => window.setRemaining(0));
      await expect(label).toHaveText("0%");
      expect(await page.evaluate(() => window.hoverCount)).toBe(1);
      if (formatted) {
        await page.evaluate(() => {
          window.tooltipMessageProps.defaultMessage = "{percent, number, percent} left";
          window.tooltipMessageProps.values.percent = 0.01;
        });
        await expect(label).toHaveText("1%");
      }
      await page.evaluate(() => { history.pushState({}, "", "/after-hover" + location.search); });
      await expect(label).toHaveCount(1);
      await expect(label).toHaveText(formatted ? "1%" : "0%");
      await page.reload();
      await expect(label).toHaveText("1%");
      await expect(label).toBeVisible();
      expect(await page.evaluate(() => window.hoverCount)).toBe(0);
      await expect(page.locator("#usage-tooltip")).toHaveCount(0);
    } finally {
      await app.close();
      await fixture.close();
      profile.remove();
    }
  });
}

test("the percentage does not inherit the original icon's hover-only visibility", async () => {
  const fixture = await startFixtureServer("sidebar-usage-lifecycle-fixture.html");
  const profile = createProfile();
  const app = await launchApp(profile, fixture.url + "?hoverhidden");
  try {
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url + "?hoverhidden");
    await page.locator("#outside").hover();
    const label = page.locator("[data-chatgpt-desktop-usage-percent]");
    await expect(page.locator("#usage")).toHaveCSS("visibility", "hidden");
    await expect(label).toHaveText("1%");
    await expect(label).toBeVisible();
    expect(await page.evaluate(() => window.hoverCount)).toBe(0);
    const bounds = await label.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.locator("#usage-tooltip")).toBeVisible();
    await page.locator("#outside").hover();
    await expect(page.locator("#usage-tooltip")).toHaveCount(0);
    await expect(page.locator("#usage")).toHaveCSS("visibility", "hidden");
    await expect(label).toBeVisible();
    await page.locator("aside").evaluate(el => { el.style.visibility = "hidden"; });
    await expect(label).toBeHidden();
    await page.locator("aside").evaluate(el => { el.style.visibility = "visible"; });
    await expect(label).toBeVisible();
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
});
