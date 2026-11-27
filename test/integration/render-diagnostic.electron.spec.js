const path = require("path");
const { test, expect } = require("@playwright/test");
const { prepareStage } = require("../../diagnostics/rendering/build");
const { startFixtureServer } = require("../helpers/fixture-server");
const { createProfile, launchApp, projectRoot } = require("../helpers/launch-app");

for (const browserAgent of [false, true]) test(`diagnostic history observation is private and read-only; browser agent=${browserAgent}`, async () => {
  const fixture = await startFixtureServer();
  const profile = createProfile();
  const stage = path.join(profile.root, "diagnostic-source");
  prepareStage(projectRoot, stage, "renderdiag.99");
  let app;
  try {
    app = await launchApp(profile, fixture.url, { appRoot: stage, args: ["--diagnose-rendering", ...(browserAgent ? ["--diagnose-browser-agent"] : [])] });
    const page = await app.firstWindow();
    await page.waitForURL(fixture.url);
    await page.waitForFunction(() => Boolean(window.__chatgptRenderDiagnostics));
    expect(await page.evaluate(() => /Electron\//.test(navigator.userAgent))).toBe(!browserAgent);
    const secret = "PRIVATE_VALUE_MUST_NOT_BE_RECORDED";
    const requests = [];
    let affected = false;
    await page.route("https://chatgpt.com/backend-api/**", route => {
      const legacy = route.request().url().includes("/conversation/");
      requests.push({ legacy, method: route.request().method() });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ messages: [{ id: secret, author: { role: "assistant" },
          content: { content_type: "text", parts: [affected ? "Current selection unavailable" : secret] },
          metadata: affected && !legacy ? {} : { model_dil_v2: { code: secret, fallbackMarkdown: secret, fallbackMarkdownVersion: 1 } },
        }] }) });
    });
    for (const endpoint of ["conversation", "conversations"]) {
      await page.evaluate(async endpoint => {
        window.__chatgptRenderDiagnostics.queue.length = 0;
        await fetch(`https://chatgpt.com/backend-api/${endpoint}/00000000-0000-0000-0000-000000000000`).then(r => r.json());
      }, endpoint);
      await page.waitForFunction(() => window.__chatgptRenderDiagnostics.queue.some(row => row.event === "response-shape"));
      const rows = await page.evaluate(() => window.__chatgptRenderDiagnostics.queue);
      expect(rows.find(row => row.event === "response-shape").messages[0].richCode).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(secret);
    }
    affected = true;
    requests.length = 0;
    await page.evaluate(async () => {
      window.__chatgptRenderDiagnostics.queue.length = 0;
      await fetch("https://chatgpt.com/backend-api/conversations/00000000-0000-0000-0000-000000000000").then(r => r.json());
    });
    await page.waitForFunction(() => window.__chatgptRenderDiagnostics.queue.some(row => row.transport === "legacy-comparison"));
    const rows = await page.evaluate(() => window.__chatgptRenderDiagnostics.queue);
    expect(rows.find(row => row.transport === "fetch").messages[0].richCode).toBe(false);
    expect(rows.find(row => row.transport === "legacy-comparison").messages[0].richCode).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(requests).toEqual([{ legacy: false, method: "GET" }, { legacy: true, method: "GET" }]);
    requests.length = 0;
    await page.evaluate(async () => {
      window.__chatgptRenderDiagnostics.queue.length = 0;
      for (const digit of ["1", "2"]) {
        await fetch(`https://chatgpt.com/backend-api/conversations/00000000-0000-0000-0000-00000000000${digit}`).then(r => r.json());
      }
    });
    await page.waitForFunction(() => {
      const rows = window.__chatgptRenderDiagnostics.queue;
      return rows.filter(row => row.transport === "fetch").length === 2 && rows.filter(row => row.transport === "legacy-comparison").length === 1;
    });
    // One comparison above plus one here: never more than two per document.
    expect(requests.filter(request => request.legacy)).toHaveLength(1);
    affected = false;
    await page.evaluate(() => new Promise(resolve => {
      window.__chatgptRenderDiagnostics.queue.length = 0;
      const request = new XMLHttpRequest();
      request.open("GET", "https://chatgpt.com/backend-api/conversations/00000000-0000-0000-0000-000000000000/messages");
      request.onload = resolve;
      request.send();
    }));
    await page.waitForFunction(() => window.__chatgptRenderDiagnostics.queue.some(row => row.transport === "xhr"));
    expect(JSON.stringify(await page.evaluate(() => window.__chatgptRenderDiagnostics.queue))).not.toContain(secret);
    await page.evaluate(async () => {
      window.__chatgptRenderDiagnostics.queue.length = 0;
      await fetch("https://chatgpt.com/backend-api/conversations/00000000-0000-0000-0000-000000000000", { method: "POST" });
      await fetch("https://chatgpt.com/backend-api/me").then(r => r.json());
    });
    expect(await page.evaluate(() => window.__chatgptRenderDiagnostics.queue.some(row => row.event === "response-shape"))).toBe(false);
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  } finally {
    await app?.close();
    await fixture.close();
    profile.remove();
  }
});
