const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { test, expect } = require("@playwright/test");
const {
  ensureAuthenticatedProfile,
  loadCredentials,
  profileEnv,
  warmLiveProfile,
} = require("../helpers/warm-live-profile");

// Early warning for site redesigns. It audits the signed-in app with the example stylesheet
// applied and checks that the anchors we rely on still match, that no non-avatar surface is
// rounded in either theme, and that Vimium-style hints and scrolling reach the sidebar.
//
// The audit runs in a debugger-free Electron process (test/helpers/live-dom-audit-main.js), not
// through Playwright: a CDP-attached launch is served Cloudflare's challenge page by chatgpt.com
// itself, while the same profile loads the signed-in app without a debugger. It records structure
// only and sends no prompt.
const projectRoot = path.join(__dirname, "..", "..");
const profileRoot =
  process.env.CHATGPT_DESKTOP_LIVE_PROFILE || path.join(projectRoot, ".live-chatgpt-profile");
const exampleCss = path.join(projectRoot, "resources", "examples", "styles", "custom.css");

test.setTimeout(420000);

function runAudit() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-desktop-audit-"));
  const outPath = path.join(workDir, "audit.json");

  return new Promise((resolve, reject) => {
    const child = spawn(require("electron"), [path.join(projectRoot, "test", "helpers", "live-dom-audit-main.js")], {
      env: {
        ...process.env,
        ...profileEnv(profileRoot),
        AUDIT_OUT: outPath,
        AUDIT_CSS: exampleCss,
        AUDIT_THEMES: "light,dark",
        AUDIT_CONVERSATION: "1",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });

    const killTimer = setTimeout(() => child.kill("SIGKILL"), 240000);
    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.on("exit", () => {
      clearTimeout(killTimer);
      try {
        const result = JSON.parse(fs.readFileSync(outPath, "utf8"));
        fs.rmSync(workDir, { recursive: true, force: true });
        resolve(result);
      } catch (error) {
        fs.rmSync(workDir, { recursive: true, force: true });
        reject(new Error("The DOM audit produced no result."));
      }
    });
  });
}

test("the signed-in app still matches the stylesheet and Vimium assumptions", async () => {
  await ensureAuthenticatedProfile(profileRoot);

  let audit = await runAudit();

  // Never turn a challenge, DOM error or selector change into another sign-in.
  if (audit.requiresLogin === true) {
    await warmLiveProfile(profileRoot, loadCredentials());
    audit = await runAudit();
  }

  expect(
    audit.error,
    "The signed-in DOM audit failed. A site challenge is not evidence that authentication expired."
  ).toBeUndefined();
  expect(audit.routes.length).toBeGreaterThan(0);
  test.info().annotations.push({
    type: "coverage-boundary",
    description: "The usage snapshots here check structure/format only. Persistence (idle, hover, after hover, reload) is verified against the real meter by live-usage.spec.js.",
  });

  for (const route of audit.routes) {
    for (const [theme, result] of Object.entries(route.themes)) {
      const where = `${route.route} page, ${theme} theme`;

      expect(result.dataTheme, `${where}: html[data-theme] should report the forced theme`).toBe(theme);
      expect(result.sidebarUsage.valid, `${where}: usage labels must contain only a valid percentage`).toBe(true);
      expect(result.sidebarUsage.visible, `${where}: available usage labels must be visible without hover`).toBe(result.sidebarUsage.total);

      const missing = Object.entries(result.anchors)
        .filter(([, count]) => count < 1)
        .map(([name]) => name);
      expect(missing, `${where}: anchors that no longer match the site's markup`).toEqual([]);

      expect(
        result.rounded.groups,
        `${where}: surfaces that are still rounded with the example stylesheet applied`
      ).toEqual([]);
      expect(result.rounded.total).toBe(0);

      expect(
        result.fadeLayers,
        `${where}: wide fade or shadow layers still painted with the example stylesheet applied`
      ).toEqual([]);

      if (result.surfaces.footerCover !== null) {
        expect(
          result.surfaces.footerCover,
          `${where}: the cover below the composer should match the chat surface, otherwise it shows as a band`
        ).toBe(result.surfaces.main);
      }

      if (theme === "dark") {
        expect(result.surfaces.sidebar, `${where}: sidebar surface`).toBe("rgb(0, 0, 0)");
        expect(result.surfaces.main, `${where}: main surface`).toBe("rgb(10, 10, 10)");
        expect(result.surfaces.composer, `${where}: composer surface`).toBe("rgb(36, 36, 36)");
      } else {
        expect(result.surfaces.composer, `${where}: composer surface`).toBe("rgb(247, 247, 247)");
      }
    }

    // Hints must reach the sidebar, the header and the composer, not only the conversation.
    expect(route.hints.regions.sidebar || 0, `${route.route} page: sidebar hints`).toBeGreaterThanOrEqual(10);
    expect(route.hints.regions.header || 0, `${route.route} page: header hints`).toBeGreaterThanOrEqual(1);
    expect(route.hints.regions.composer || 0, `${route.route} page: composer hints`).toBeGreaterThanOrEqual(1);
    expect(route.hints.frameOutlines, `${route.route} page: hint mode must not paint a bright frame outline`).toBe(0);
    expect(route.hints.siblingFrameRings, `${route.route} page: the decorative transcript peer ring must not be painted`).toBe(0);
    if (route.route === "conversation") expect(route.transcriptFocused, "background click must focus the real transcript before f").toBe(true);

    // With the pointer over the sidebar list, j scrolls the list and leaves the thread alone.
    if (route.sidebarScroll) {
      expect(route.sidebarScroll.sidebarMoved, `${route.route} page: sidebar scroll by pointer`).toBe(true);
      expect(route.sidebarScroll.threadMoved, `${route.route} page: thread must not move`).toBe(false);
    }
  }
});
