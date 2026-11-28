const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");
const { observeIdleEvents } = require("../helpers/live-usage-events");

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
    await expect(label).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await expect(label).toHaveCSS("font-weight", "700");
    await expect(label).toHaveCount(1);
    // It looks native: the sidebar's own font family and size, not a larger bolder outlier.
    const sidebarFont = await page.locator("aside").evaluate(el => ({ family: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
    await expect(label).toHaveCSS("font-family", sidebarFont.family);
    await expect(label).toHaveCSS("font-size", sidebarFont.size);

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

for (const [value, big] of [["1", false], ["12", false], ["100", false], ["1", true], ["12", true], ["100", true]]) {
  test(`${value}% fits in the meter and uses the sidebar's font; large sidebar font=${big}`, async () => {
    await open(`?plain&pct=${value}${big ? "&big" : ""}`, async page => {
      const label = page.locator(marker);
      await expect(label).toHaveText(`${value}%`);
      const measured = await page.evaluate(() => {
        const text = document.querySelector("[data-chatgpt-desktop-usage-percent]");
        const aside = getComputedStyle(document.querySelector("aside"));
        const meter = document.querySelector("#meter").getBoundingClientRect();
        const content = document.createRange(); content.selectNodeContents(text);
        return { textWidth: content.getBoundingClientRect().width, meterWidth: meter.width, size: parseFloat(getComputedStyle(text).fontSize),
          sidebarSize: parseFloat(aside.fontSize), box: text.getBoundingClientRect().width, family: getComputedStyle(text).fontFamily === aside.fontFamily };
      });
      expect(measured.family).toBe(true);
      // The whole text, including three digits, sits inside the meter without spilling over it.
      expect(measured.textWidth).toBeLessThanOrEqual(measured.meterWidth);
      expect(measured.box).toBeLessThanOrEqual(measured.meterWidth + 1);
      // Never larger than the sidebar's text (capped), reduced only as far as needed, never tiny.
      expect(measured.size).toBeLessThanOrEqual(Math.min(16, measured.sidebarSize));
      expect(measured.size).toBeGreaterThanOrEqual(10);
      if (!big || value !== "100") expect(measured.size).toBe(Math.min(16, measured.sidebarSize));
    });
  });
}

test("the percentage stays inside the sidebar when it switches between compact and wide", async () => {
  await open("?plain&pct=100", async page => {
    const label = page.locator(marker);
    for (const wide of [true, false, true, false]) {
      await page.locator("aside").evaluate((el, value) => el.classList.toggle("wide", value), wide);
      await expect(label).toHaveText("100%");
      await expect(label).toHaveCount(1);
      const text = await label.boundingBox();
      const aside = await page.locator("aside").boundingBox();
      const meter = await page.locator("#meter").boundingBox();
      expect(text.x).toBeGreaterThanOrEqual(aside.x);
      expect(text.x + text.width).toBeLessThanOrEqual(aside.x + aside.width);
      expect(text.y).toBeLessThanOrEqual(meter.y);
      expect(text.y + text.height).toBeGreaterThanOrEqual(meter.y + meter.height);
    }
  });
});

test("it never polls: no timer, and no work for streaming, scrolling or an idle page", async () => {
  await open("?plain", async page => {
    await expect(page.locator(marker)).toHaveText("1%");
    await page.waitForTimeout(400);
    const runs = () => page.evaluate(() => window.__chatgptDesktopSidebarUsage.runs);
    const base = await runs();
    expect(await page.evaluate(() => window.intervals), "the adapter must not create an interval").toBe(0);

    // A long idle period costs nothing.
    await page.waitForTimeout(3000);
    expect(await runs()).toBe(base);

    // Streaming a reply: hundreds of DOM changes inside the conversation do not wake it.
    await page.evaluate(async () => {
      const thread = document.querySelector("#thread");
      for (let i = 0; i < 300; i++) {
        const node = document.createElement("span"); node.textContent = "token "; thread.appendChild(node);
        if (i % 25 === 0) await new Promise(requestAnimationFrame);
      }
      thread.firstChild.textContent = "changed";
    });
    await page.waitForTimeout(300);
    expect(await runs()).toBe(base);

    // Scrolling anywhere does not wake it either.
    await page.evaluate(async () => {
      const scroller = document.querySelector("#scroller");
      for (let top = 0; top < 1500; top += 100) { scroller.scrollTop = top; await new Promise(requestAnimationFrame); }
    });
    await page.waitForTimeout(300);
    expect(await runs()).toBe(base);

    // A relevant change does: a burst of sidebar changes is coalesced into very few refreshes.
    await page.evaluate(() => { for (let i = 0; i < 20; i++) document.querySelector("aside").appendChild(document.createElement("span")); });
    await expect.poll(runs).toBeGreaterThan(base);
    await page.waitForTimeout(300);
    expect(await runs()).toBeLessThanOrEqual(base + 3);
    expect(await page.evaluate(() => window.intervals)).toBe(0);
  });
});

test("the live idle budget counts site changes but catches unexplained adapter polling", async () => {
  await open("?plain", async page => {
    await expect(page.locator(marker)).toHaveText("1%");
    const begin = async () => {
      await page.evaluate(`window.__idleBudget = (${observeIdleEvents})(); void 0`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return page.evaluate(() => { window.__idleBudget.begin(); return window.__chatgptDesktopSidebarUsage.runs; });
    };
    let base = await begin();
    await page.evaluate(() => {
      document.querySelector("#thread").appendChild(document.createElement("span"));
      document.querySelector("#scroller").scrollTop = 100;
    });
    await page.waitForTimeout(150);
    let sample = await page.evaluate(base => ({ delta: window.__chatgptDesktopSidebarUsage.runs - base, events: window.__idleBudget.end() }), base);
    expect(sample).toEqual({ delta: 0, events: 0 });

    base = await begin();
    await page.evaluate(() => {
      document.querySelector("aside").appendChild(document.createElement("span"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(150);
    sample = await page.evaluate(base => ({ delta: window.__chatgptDesktopSidebarUsage.runs - base, events: window.__idleBudget.end() }), base);
    expect(sample.delta).toBeGreaterThan(0);
    expect(sample.delta).toBeLessThanOrEqual(sample.events);

    base = await begin();
    await page.evaluate(() => { window.__deliberatePoll = setInterval(() => window.__chatgptDesktopSidebarUsage.refresh(), 25); });
    await page.waitForTimeout(250);
    sample = await page.evaluate(base => {
      clearInterval(window.__deliberatePoll);
      return { delta: window.__chatgptDesktopSidebarUsage.runs - base, events: window.__idleBudget.end() };
    }, base);
    expect(sample.delta).toBeGreaterThan(sample.events);
  });
});

test("on a light sidebar the backing matches it and the text is dark, so no black box appears", async () => {
  await open("?plain&light", async page => {
    const label = page.locator(marker);
    await expect(label).toHaveText("1%");
    await expect(label).toHaveCSS("background-color", "rgb(249, 249, 249)");
    await expect(label).toHaveCSS("color", "rgb(17, 17, 17)");
  });
});

test("the site's animated diamond and ring are stopped and hidden, not just covered, and return with the meter", async () => {
  await open("?plain", async page => {
    await expect(page.locator(marker)).toHaveText("1%");
    // The fixture's arc pulses forever like the real low-usage meter; while the percentage is shown
    // neither the glyphs nor their animation may remain.
    await expect(page.locator("#diamond")).toHaveCSS("visibility", "hidden");
    await expect(page.locator("#arc")).toHaveCSS("visibility", "hidden");
    await expect(page.locator("#arc")).toHaveCSS("animation-name", "none");
    // The button itself keeps its size and stays hoverable, so the native tooltip still works.
    expect(await page.locator("#meter").boundingBox()).toMatchObject({ width: 36, height: 36 });
    await page.locator("#meter").hover();
    await expect(page.locator("#tooltip")).toHaveText("Weekly · 1% left");
    await page.locator("#outside").hover();

    // Teardown only: with the adapter destroyed, nothing stays hidden or stopped.
    await page.evaluate(() => window.__chatgptDesktopSidebarUsage.destroy());
    await expect(page.locator(marker)).toHaveCount(0);
    await expect(page.locator("#diamond")).toHaveCSS("visibility", "visible");
    await expect(page.locator("#arc")).toHaveCSS("animation-name", "pulse");
    await expect(page.locator("[data-chatgpt-desktop-usage-style]")).toHaveCount(0);
  });
});

// Not normal use (there the percentage never goes away): this is the safety net for the site itself
// removing its value or meter, where we must neither keep a stale number nor leave a blank button.
test("if the site stops providing a value, no stale number is kept and the site's own diamond returns", async () => {
  await open("?plain", async page => {
    await expect(page.locator(marker)).toHaveText("1%");
    // The SITE drops its value (no description, ring gone): nothing is left to show, so the label
    // goes and the site's own glyphs are visible again.
    await page.locator("#meter").evaluate(el => { el.removeAttribute("aria-description"); el.querySelector("#arc").remove(); });
    await expect(page.locator(marker)).toHaveCount(0);
    await expect(page.locator("#diamond")).toHaveCSS("visibility", "visible");
  });
});
