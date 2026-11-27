const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");
const { COMPOSER_SELECTOR, getLiveComposer } = require("../helpers/live-composer");

let fixture;
let profile;
let app;
let page;

test.beforeAll(async () => {
  fixture = await startFixtureServer();
});

test.beforeEach(async () => {
  profile = createProfile();
  app = await launchApp(profile, fixture.url);
  page = await app.firstWindow();
  await page.waitForURL(fixture.url);
});

test.afterEach(async () => {
  await app?.close();
  profile?.remove();
});

test.afterAll(async () => {
  await fixture?.close();
});

test("recognizes the legacy ChatGPT composer", async () => {
  expect(await page.evaluate((selector) => Boolean(document.querySelector(selector)), COMPOSER_SELECTOR)).toBe(true);
  await getLiveComposer(page).fill("fixture input");
  await expect(getLiveComposer(page)).toHaveValue("fixture input");
});

test("recognizes the current role-based composer without a legacy id", async () => {
  await page.locator("#prompt-textarea").evaluate((element) => {
    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("contenteditable", "true");
    element.replaceWith(editor);
  });

  expect(await page.evaluate((selector) => Boolean(document.querySelector(selector)), COMPOSER_SELECTOR)).toBe(true);
  await getLiveComposer(page).fill("fixture input");
  await expect(getLiveComposer(page)).toHaveText("fixture input");
});

test("ignores a hidden legacy composer when a current editor is visible", async () => {
  await page.locator("#prompt-textarea").evaluate((element) => {
    element.hidden = true;
    element.style.display = "none";
    const editor = document.createElement("div");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("contenteditable", "true");
    element.after(editor);
  });

  await getLiveComposer(page).fill("fixture input");
  await expect(getLiveComposer(page)).toHaveText("fixture input");
});
