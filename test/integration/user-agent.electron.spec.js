const http = require("http");
const { test, expect } = require("@playwright/test");
const { createProfile, launchApp } = require("../helpers/launch-app");

test("uses a browser-compatible agent for initial navigation, page scripts, fetches and reloads", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, agent: request.headers["user-agent"] });
    if (request.url === "/agent") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agent: request.headers["user-agent"] }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<!doctype html><html><body><script>window.initialAgent = navigator.userAgent;</script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = createProfile();
  let app;
  try {
    app = await launchApp(profile, url);
    const page = await app.firstWindow();
    await page.waitForURL(url);
    const agent = await page.evaluate(() => window.initialAgent);
    const runtime = await app.evaluate(({ app, BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      return {
        chrome: process.versions.chrome,
        fallback: app.userAgentFallback,
        contents: contents.getUserAgent(),
        session: contents.session.getUserAgent(),
      };
    });
    expect(agent).toContain(`Chrome/${runtime.chrome}`);
    expect(agent).not.toMatch(/(?:Electron|chatgpt-desktop)\//i);
    expect(runtime.fallback).toBe(agent);
    expect(runtime.contents).toBe(agent);
    expect(runtime.session).toBe(agent);
    expect(requests.find((request) => request.path === "/").agent).toBe(agent);
    expect(await page.evaluate(() => fetch("/agent").then((response) => response.json()))).toEqual({ agent });
    await page.reload();
    expect(await page.evaluate(() => window.initialAgent)).toBe(agent);
    await page.goto(`${url}next`);
    expect(await page.evaluate(() => window.initialAgent)).toBe(agent);
    expect(requests.every((request) => request.agent === agent)).toBe(true);
  } finally {
    await app?.close();
    await new Promise((resolve) => server.close(resolve));
    profile.remove();
  }
});
