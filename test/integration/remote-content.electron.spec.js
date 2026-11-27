const { test, expect } = require("@playwright/test");
const { startFixtureServer } = require("../helpers/fixture-server");
const {
  createProfile,
  launchApp,
  readExternalOpens,
  trackExternalOpens,
} = require("../helpers/launch-app");

test.describe.configure({ mode: "serial" });

test.describe("navigation, permissions and customization scope", () => {
  let app;
  let page;
  let fixture;
  let profile;

  test.beforeAll(async () => {
    fixture = await startFixtureServer();
    profile = createProfile({
      css: "#thread { border-top: 7px solid rgb(1, 2, 3) !important; }",
      scripts: { "01-marker.js": "window.__customMarker = true;" },
      settings: JSON.stringify({ trustedNavigationHosts: ["LocalHost", "SSO.Example.com", "10.0.0.1", "*.bad.test"] }),
    });
    app = await launchApp(profile, fixture.url);
    page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.waitForFunction(() => window.__customMarker === true);
    await trackExternalOpens(app);
  });

  test.afterAll(async () => {
    await app?.close();
    await fixture?.close();
    profile?.remove();
  });

  test("persists only the validated trusted host list", async () => {
    expect(profile.readSettings().trustedNavigationHosts).toEqual(["localhost", "sso.example.com"]);
  });

  test("cancels a script navigation to an untrusted site and opens it externally", async () => {
    const before = (await readExternalOpens(app)).length;
    await page.evaluate(() => {
      window.location.href = "https://untrusted.example.test/script";
    });

    await expect.poll(() => readExternalOpens(app)).toContain("https://untrusted.example.test/script");
    expect((await readExternalOpens(app)).length).toBe(before + 1);
    expect(page.url()).toBe(fixture.url);
  });

  test("cancels a clicked link to an untrusted site", async () => {
    await page.evaluate(() => {
      const anchor = document.createElement("a");
      anchor.href = "https://untrusted.example.test/link";
      anchor.textContent = "out";
      document.body.appendChild(anchor);
      anchor.click();
    });

    await expect.poll(() => readExternalOpens(app)).toContain("https://untrusted.example.test/link");
    expect(page.url()).toBe(fixture.url);
  });

  test("cancels a form submission to an untrusted site", async () => {
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "post";
      form.action = "https://untrusted.example.test/form";
      document.body.appendChild(form);
      form.submit();
    });

    await expect.poll(() => readExternalOpens(app)).toContain("https://untrusted.example.test/form");
    expect(page.url()).toBe(fixture.url);
  });

  test("cancels a server redirect that leaves the trusted hosts", async () => {
    await page.evaluate(() => {
      window.location.href = "/redirect-out";
    });

    await expect.poll(() => readExternalOpens(app)).toContain("https://untrusted.example.test/redirected");
    expect(page.url()).toBe(fixture.url);
  });

  test("refuses plain HTTP to a host that is not trusted", async () => {
    const before = (await readExternalOpens(app)).length;
    await page.evaluate(() => {
      window.location.href = "http://untrusted.example.test/plain";
    });

    await expect.poll(() => readExternalOpens(app).then((opens) => opens.length)).toBe(before + 1);
    expect(page.url()).toBe(fixture.url);
  });

  test("grants notifications to the application origin and denies other permissions", async () => {
    const result = await page.evaluate(async () => {
      const notifications = await Notification.requestPermission();
      const geolocation = await new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          () => resolve("granted"),
          (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : `error-${error.code}`)
        )
      );
      const queriedNotifications = (await navigator.permissions.query({ name: "notifications" })).state;
      const queriedGeolocation = (await navigator.permissions.query({ name: "geolocation" })).state;
      return { notifications, geolocation, queriedNotifications, queriedGeolocation };
    });

    expect(result).toEqual({
      notifications: "granted",
      geolocation: "denied",
      queriedNotifications: "granted",
      queriedGeolocation: "denied",
    });
  });

  test("denies permissions to a cross-origin frame", async () => {
    await page.evaluate((src) => {
      const frame = document.createElement("iframe");
      frame.id = "alt-frame";
      frame.src = src;
      document.body.appendChild(frame);
    }, fixture.altUrl);

    const frame = await expect
      .poll(() => page.frames().find((candidate) => candidate.url().startsWith(fixture.altUrl)) || null)
      .not.toBeNull()
      .then(() => page.frames().find((candidate) => candidate.url().startsWith(fixture.altUrl)));

    const result = await frame.evaluate(async () => ({
      requested: await Notification.requestPermission(),
      queried: (await navigator.permissions.query({ name: "notifications" })).state,
    }));
    expect(result.requested).not.toBe("granted");
    expect(result.queried).not.toBe("granted");
  });

  test("keeps customizations off a trusted page outside the application origin", async () => {
    await page.evaluate((url) => {
      window.location.href = url;
    }, fixture.altUrl);
    await page.waitForURL(fixture.altUrl);

    // Negative assertions: give the injection pipeline time to misbehave.
    await page.waitForTimeout(1500);

    const state = await page.evaluate(() => ({
      marker: window.__customMarker,
      vimium: Boolean(window.__chatgptDesktopVimiumNavigation),
      border: getComputedStyle(document.querySelector("#thread")).borderTopWidth,
    }));
    expect(state.marker).toBeUndefined();
    expect(state.vimium).toBe(false);
    expect(state.border).not.toBe("7px");
  });

  test("applies customizations again after returning to the application origin", async () => {
    await page.evaluate((url) => {
      window.location.href = url;
    }, fixture.url);
    await page.waitForURL(fixture.url);

    await page.waitForFunction(() => window.__customMarker === true);
    await expect(page.locator("#thread")).toHaveCSS("border-top-width", "7px");
  });
});
