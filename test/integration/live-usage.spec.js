const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { test, expect } = require("@playwright/test");
const { ensureAuthenticatedProfile, profileEnv } = require("../helpers/warm-live-profile");

// Exercises the genuine signed-in usage meter (see test/helpers/live-usage-main.js for how the
// account's own responses are adjusted in the test session so the site renders it). The earlier
// fixtures put the value somewhere the site never does; this is the check that cannot be fooled
// that way: the percentage must be there with no pointer input, through hover, and after reload.
test("the real usage meter shows its percentage at idle, during and after hover, and after reload", async () => {
  const projectRoot = path.resolve(__dirname, "../..");
  const profileRoot = process.env.CHATGPT_DESKTOP_LIVE_PROFILE || path.join(projectRoot, ".live-chatgpt-profile");
  await ensureAuthenticatedProfile(profileRoot);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-usage-audit-"));
  const output = path.join(temporary, "result.json");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(projectRoot, "test/helpers/live-usage-main.js")], {
        env: { ...process.env, ...profileEnv(profileRoot), USAGE_AUDIT_OUT: output },
        stdio: "ignore",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 200000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    expect(fs.existsSync(output), "The debugger-free usage audit produced no structural result.").toBe(true);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(result.error, "The site's usage meter did not render: its component or response shape changed.").toBeUndefined();
    expect(result.stubbedResponses).toBeGreaterThan(0);

    const shown = (state, where) => {
      expect(state.labels, `${where}: exactly one persistent percentage`).toBe(1);
      expect(state.text, `${where}: remaining percentage`).toBe("1%");
      expect(state.visible, `${where}: visible`).toBe(true);
      expect(state.covers, `${where}: replaces the diamond in place`).toBe(true);
      expect(state.readable, `${where}: high-contrast text on an opaque backing that hides the diamond`).toBe(true);
      expect(state.bold, `${where}: bold`).toBe(true);
      expect(state.sameFamily, `${where}: same font family as the sidebar`).toBe(true);
      expect(state.size, `${where}: same size as the sidebar text`).toBe(Math.min(16, state.sidebarSize));
      expect(state.fits, `${where}: the whole text fits inside the meter`).toBe(true);
    };

    // The decisive case: no pointer input at all, so the hover tooltip does not exist.
    expect(result.idle.pointerEvents, "idle snapshot must be taken with no pointer input").toBe(0);
    expect(result.idle.tooltipWithPercent, "idle: the site's tooltip must not be mounted").toBe(false);
    shown(result.idle, "idle");
    expect(result.idleLater.runs, "no refresh work while the real page is idle (no polling)").toBe(result.idle.runs);
    shown(result.idleLater, "still idle");

    expect(result.hover.tooltipWithPercent, "hovering must still open the site's original tooltip").toBe(true);
    shown(result.hoverLater, "while hovering");
    expect(result.afterHover.tooltipWithPercent, "the tooltip must close after hover").toBe(false);
    shown(result.afterHover, "after hover");

    expect(result.reloadedHadLabel).toBe(true);
    shown(result.reloaded, "after reload");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
