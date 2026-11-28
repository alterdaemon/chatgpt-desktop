const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { test, expect } = require("@playwright/test");
const { ensureAuthenticatedProfile, loadCredentials, profileEnv, warmLiveProfile } = require("../helpers/warm-live-profile");

const projectRoot = path.resolve(__dirname, "../..");
const profileRoot = process.env.CHATGPT_DESKTOP_LIVE_PROFILE || path.join(projectRoot, ".live-chatgpt-profile");

test("signs in and sends a real ChatGPT smoke prompt with production security settings", async () => {
  await ensureAuthenticatedProfile(profileRoot);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-live-smoke-"));
  const output = path.join(temporary, "result.json");
  const run = async () => {
    fs.rmSync(output, { force: true });
    await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(projectRoot, "test/helpers/live-smoke-main.js")], {
        env: { ...process.env, ...profileEnv(profileRoot), SMOKE_AUDIT_OUT: output }, stdio: "ignore",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 230000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    expect(fs.existsSync(output), "The debugger-free real ChatGPT smoke check produced no structural result.").toBe(true);
    return JSON.parse(fs.readFileSync(output, "utf8"));
  };
  try {
    let result = await run();
    // Only an explicit sign-in screen justifies warming. A challenge, selector
    // failure or missing reply is not evidence of expired authentication.
    if (result.error === "sign-in-required") {
      await warmLiveProfile(profileRoot, loadCredentials());
      result = await run();
    }
    expect(result.error, `Real ChatGPT smoke failed (promptSent=${Boolean(result.promptSent)}, replyVerified=${Boolean(result.replyVerified)}, messageCounts=${JSON.stringify(result.messageCounts || {})}); a site challenge must not trigger another login.`).toBeUndefined();
    expect(result.debuggerAttached).toBe(false);
    expect(result.promptSent).toBe(true);
    expect(result.replyVerified).toBe(true);
    expect(result.security).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, processHidden: true, requireHidden: true });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
