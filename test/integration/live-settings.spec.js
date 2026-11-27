const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { test, expect } = require("@playwright/test");
const { ensureAuthenticatedProfile, profileEnv } = require("../helpers/warm-live-profile");

test("Ctrl+, and the menu open the real signed-in Settings UI", async () => {
  const projectRoot = path.resolve(__dirname, "../..");
  const profileRoot = process.env.CHATGPT_DESKTOP_LIVE_PROFILE || path.join(projectRoot, ".live-chatgpt-profile");
  await ensureAuthenticatedProfile(profileRoot);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-settings-audit-"));
  const output = path.join(temporary, "result.json");
  try {
    const status = await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(projectRoot, "test/helpers/live-settings-main.js")], {
        env: { ...process.env, ...profileEnv(profileRoot), SETTINGS_AUDIT_OUT: output },
        stdio: "ignore",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 200000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); resolve(code); });
    });
    expect(fs.existsSync(output), "The debugger-free Settings audit produced no structural result.").toBe(true);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(result, "Settings must actually render; a changed URL alone is not success.").toMatchObject({
      menu: true, checks: [{ mode: "shortcut", settingsReady: true }, { mode: "menu", settingsReady: true }],
    });
    expect(result.error).toBeUndefined();
    expect(status).toBe(0);
    expect(result.menu).toBe(true);
    expect(result.checks).toHaveLength(2);
    for (const check of result.checks) {
      expect(check.settingsReady, `Settings rendering through ${check.mode}`).toBe(true);
      expect(check.composer).toBe(false);
      expect(check.sameDocument).toBe(true);
      expect(check.zoomPreserved).toBe(true);
      expect(check.fontPreserved).toBe(true);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
