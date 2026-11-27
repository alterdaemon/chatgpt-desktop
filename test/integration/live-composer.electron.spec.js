const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp } = require("../helpers/launch-app");
const { COMPOSER_SELECTOR, getLiveComposer } = require("../helpers/live-composer");
const { getLiveAssistantMessage } = require("../helpers/live-message");

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

test("recognizes a legacy assistant message", async () => {
  await page.locator("main").evaluate((element) => {
    element.innerHTML = '<div data-message-author-role="assistant">LIVE_SMOKE_OK</div>';
  });

  await expect(getLiveAssistantMessage(page)).toHaveText("LIVE_SMOKE_OK");
});

test("recognizes a current assistant response without matching the user prompt", async () => {
  await page.locator("main").evaluate((element) => {
    element.innerHTML = `
      <section aria-label="Conversation">
        <h4>You said:</h4>
        <p>Reply with exactly LIVE_SMOKE_OK and no other text.</p>
        <article>
          <header><h4>ChatGPT said:</h4></header>
          <div><p>LIVE_SMOKE_OK</p></div>
        </article>
      </section>`;
  });

  await expect(getLiveAssistantMessage(page)).toContainText("LIVE_SMOKE_OK");
  await expect(getLiveAssistantMessage(page)).not.toContainText("Reply with exactly");
});

test("does not mistake the user prompt for an assistant response", async () => {
  await page.locator("main").evaluate((element) => {
    element.innerHTML = `
      <section aria-label="Conversation">
        <h4>You said:</h4>
        <p>LIVE_SMOKE_OK</p>
        <header><h4>ChatGPT said:</h4></header>
      </section>`;
  });

  await expect(getLiveAssistantMessage(page)).toHaveCount(0);
});
