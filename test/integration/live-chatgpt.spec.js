const path = require("path");
const { test, expect, _electron: electron } = require("@playwright/test");
const {
  ensureAuthenticatedProfile,
  loadCredentials,
  profileEnv,
  warmLiveProfile,
} = require("../helpers/warm-live-profile");

const projectRoot = path.join(__dirname, "..", "..");
const profileRoot =
  process.env.CHATGPT_DESKTOP_LIVE_PROFILE || path.join(projectRoot, ".live-chatgpt-profile");

test.setTimeout(420000);

function launchLiveApp() {
  return electron.launch({
    executablePath: require("electron"),
    args: [projectRoot],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ...profileEnv(profileRoot),
    },
  });
}

async function openSignedInApp() {
  const app = await launchLiveApp();
  const page = await app.firstWindow();
  await page.waitForURL(/^https:\/\/chatgpt\.com\//, { timeout: 30000 });

  const composer = page.locator("#prompt-textarea");
  const ready = await composer
    .waitFor({ state: "visible", timeout: 45000 })
    .then(() => true)
    .catch(() => false);

  return { app, page, composer, ready };
}

test("signs in and sends a real ChatGPT smoke prompt with production security settings", async () => {
  // The login itself runs in a debugger-free warm-up; Playwright only ever
  // attaches to an already-authenticated profile.
  await ensureAuthenticatedProfile(profileRoot);

  let session = await openSignedInApp();

  // A stored session can expire between runs; re-warm once before failing.
  if (!session.ready) {
    await session.app.close();
    await warmLiveProfile(profileRoot, loadCredentials());
    session = await openSignedInApp();
  }

  const { app, page, composer, ready } = session;

  try {
    expect(
      ready,
      "ChatGPT never rendered the composer for the warmed session. If this persists, the egress IP " +
        "is being challenged by Cloudflare or the stored session could not be refreshed."
    ).toBe(true);

    await composer.fill("Reply with exactly LIVE_SMOKE_OK and no other text.");
    await composer.press("Enter");

    const assistantMessage = page.locator("[data-message-author-role='assistant']").last();
    await expect(assistantMessage).toContainText("LIVE_SMOKE_OK", { timeout: 120000 });

    expect(await page.evaluate(() => typeof process)).toBe("undefined");
    expect(await page.evaluate(() => typeof require)).toBe("undefined");

    const preferences = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    );
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
  } finally {
    await app.close();
  }
});
