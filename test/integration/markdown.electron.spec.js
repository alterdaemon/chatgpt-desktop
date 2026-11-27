const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp, projectRoot } = require("../helpers/launch-app");

for (const styled of [false, true]) test(`preserves Markdown semantics and legitimate fallback content; example stylesheet=${styled}`, async () => {
  const fixture = await startFixtureServer("markdown-fixture.html");
  const css = styled ? fs.readFileSync(path.join(projectRoot, "resources/examples/styles/custom.css"), "utf8") : undefined;
  const profile = createProfile({ css });
  let app;
  try {
    app = await launchApp(profile, fixture.url);
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
      await expect(page.getByRole("heading", { name: "Fixture heading" })).toBeVisible();
      await expect(page.locator("strong")).toHaveCSS("font-weight", "700");
      await expect(page.locator("em")).toHaveCSS("font-style", "italic");
      for (const selector of ["ul li", "ol li"]) {
        await expect(page.locator(selector)).toBeVisible();
        await expect(page.locator(selector)).toHaveCSS("display", "list-item");
      }
      await expect(page.locator("#inline-code")).toBeVisible();
      await expect(page.locator("pre")).toHaveCSS("white-space", "pre");
      expect(await page.locator("#fenced-code").textContent()).toBe("const answer = 42;\n  return answer;\n");
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Fixture column" })).toBeVisible();
      await expect(page.getByRole("cell", { name: "42", exact: true })).toBeVisible();
      await expect(page.locator("blockquote")).toBeVisible();
      await expect(page.locator("blockquote")).toHaveCSS("border-left-width", "3px");
      await expect(page.getByRole("link", { name: "Fixture reference" })).toBeVisible();
      await expect(page.locator("[data-fixture-fallback]")).toBeVisible();
      await expect(page.locator("[data-fixture-fallback]")).toHaveText("Current selection unavailable");
      await expect(page.locator("#fenced-code")).toHaveCSS("color", theme === "dark" ? "rgb(238, 238, 238)" : "rgb(17, 17, 17)");
      if (styled) await expect(page.locator("pre")).toHaveCSS("border-top-left-radius", "0px");
    }
  } finally {
    await app?.close();
    await fixture.close();
    profile.remove();
  }
});
