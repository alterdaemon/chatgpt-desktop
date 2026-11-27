const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");

// The real usage meter keeps its value in a persistent aria-description. Its tooltip text exists
// only while hovered, so none of these tests may depend on a hover to see a percentage.
const marker = "[data-chatgpt-desktop-usage-percent]";

async function open(search, run) {
  const fixture = await startFixtureServer("sidebar-usage-meter-fixture.html");
  const profile = createProfile();
  const url = fixture.url + search;
  const app = await launchApp(profile, url);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(url);
    await run(page, url);
  } finally {
    await app.close();
    await fixture.close();
    profile.remove();
  }
}

test("percentage is visible at idle with zero pointer events, replaces the diamond, and survives hover", async () => {
  await open("?plain", async page => {
    const label = page.locator(marker);
    // No pointer has touched the page: the site's tooltip does not exist yet.
    await expect(label).toHaveText("1%");
    expect(await page.evaluate(() => window.pointerEvents)).toBe(0);
    await expect(page.locator("#tooltip")).toHaveCount(0);
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(label).toHaveCSS("font-size", "18px");
    await expect(label).toHaveCSS("font-weight", "700");
    await expect(label).toHaveCount(1);

    // It covers the button (and its diamond) rather than sitting beside or below it.
    const button = await page.locator("#meter").boundingBox();
    const text = await label.boundingBox();
    expect(text.x).toBeLessThanOrEqual(button.x);
    expect(text.y).toBeLessThanOrEqual(button.y);
    expect(text.x + text.width).toBeGreaterThanOrEqual(button.x + button.width);
    expect(text.y + text.height).toBeGreaterThanOrEqual(button.y + button.height);

    // Hovering shows only the site's tooltip; the percentage neither disappears nor changes.
    await page.locator("#meter").hover();
    await expect(page.locator("#tooltip")).toHaveText("Weekly · 1% left");
    await page.waitForTimeout(1500);
    await expect(label).toHaveText("1%");
    await expect(page.locator("#tooltip")).toBeVisible();

    // Leaving removes the tooltip, not the percentage.
    await page.locator("#outside").hover();
    await expect(page.locator("#tooltip")).toHaveCount(0);
    await page.waitForTimeout(1500);
    await expect(label).toHaveText("1%");
    await expect(label).toBeVisible();

    // The site's own button is never modified by the adapter.
    expect(await page.evaluate(() => document.querySelector("#meter").outerHTML === window.originalMeter)).toBe(true);

    // Updates follow the persistent attribute, without any hover.
    await page.locator("#meter").evaluate(el => el.setAttribute("aria-description", "Weekly usage: 2% left"));
    await expect(label).toHaveText("2%");

    // A fresh document shows it again before any pointer event.
    await page.reload();
    await expect(page.locator(marker)).toHaveText("1%");
    expect(await page.evaluate(() => window.pointerEvents)).toBe(0);
  });
});

test("with two windows the limiting (lower) remaining value is shown", async () => {
  await open("?two", async page => {
    await expect(page.locator(marker)).toHaveText("7%");
    await expect(page.locator(marker)).toHaveCount(1);
  });
});

test("localized descriptions are read without relying on English words", async () => {
  await open("?turkish", async page => {
    await expect(page.locator(marker)).toHaveText("1%");
  });
});

test("the ring's own stroke offset is used when no description is present", async () => {
  await open("?ring", async page => {
    await expect(page.locator("#meter")).not.toHaveAttribute("aria-description");
    await expect(page.locator(marker)).toHaveText("12%");
  });
});

test("only a real meter counts: percent text on other controls and conversation rows is ignored", async () => {
  await open("?plain", async page => {
    await expect(page.locator(marker)).toHaveCount(1);
    await expect(page.locator(marker)).toHaveText("1%");
    // Neither the svg-less button nor the ring-less conversation-row button produced a label.
    const bounds = await page.locator(marker).boundingBox();
    const meter = await page.locator("#meter").boundingBox();
    expect(Math.abs(bounds.y - meter.y)).toBeLessThan(2);
  });
});
