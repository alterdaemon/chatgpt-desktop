const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");
const warmMain = path.join(__dirname, "warm-login-main.js");

// Credentials come from the environment in CI and from the private parent .env
// locally. They are never logged.
function loadCredentials() {
  let email = process.env.CHATGPT_TEST_EMAIL;
  let password = process.env.CHATGPT_TEST_PASSWORD;

  if (!email || !password) {
    try {
      const entries = Object.fromEntries(
        fs
          .readFileSync(path.join(projectRoot, "..", ".env"), "utf8")
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith("#"))
          .map((line) => line.split(/=(.*)/s).slice(0, 2))
      );
      email = email || entries.user;
      password = password || entries.password;
    } catch {}
  }

  if (!email || !password) {
    throw new Error(
      "Missing ChatGPT test credentials. Set CHATGPT_TEST_EMAIL and CHATGPT_TEST_PASSWORD."
    );
  }

  return { email: email.trim(), password: password.trim() };
}

function profileEnv(profileRoot) {
  return {
    XDG_CONFIG_HOME: path.join(profileRoot, "config"),
    XDG_DATA_HOME: path.join(profileRoot, "data"),
    XDG_CACHE_HOME: path.join(profileRoot, "cache"),
  };
}

// main.js pins userData to XDG_DATA_HOME/chatgpt-desktop, so only that jar
// counts; a session stored anywhere else is invisible to the app.
function userDataPath(profileRoot) {
  return path.join(profileRoot, "data", "chatgpt-desktop");
}

// Cookie values are encrypted on disk but names are not, so the presence of the
// NextAuth session cookie is a cheap way to skip a redundant login.
function profileIsAuthenticated(profileRoot) {
  const stack = [userDataPath(profileRoot)];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.name === "Cookies") {
        try {
          if (fs.readFileSync(entryPath).includes("next-auth.session-token")) {
            return true;
          }
        } catch {}
      }
    }
  }

  return false;
}

// Signs in with a debugger-free Electron run so the shared profile holds a live
// session before Playwright attaches. See warm-login-main.js for why the login
// cannot be driven from the automated session itself.
function warmLiveProfile(profileRoot, credentials, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(require("electron"), [warmMain], {
      env: {
        ...process.env,
        ...profileEnv(profileRoot),
        WARM_LOGIN_EMAIL: credentials.email,
        WARM_LOGIN_PASSWORD: credentials.password,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const killTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(killTimer);

      if (code === 0 && profileIsAuthenticated(profileRoot)) {
        resolve();
        return;
      }

      const detail = stderr.replace(/\s+/g, " ").trim();
      reject(
        new Error(
          "Live profile warm-up failed (exit " + code + ")." + (detail ? " " + detail : "")
        )
      );
    });
  });
}

async function ensureAuthenticatedProfile(profileRoot) {
  const credentials = loadCredentials();

  if (!profileIsAuthenticated(profileRoot)) {
    await warmLiveProfile(profileRoot, credentials);
  }

  return credentials;
}

module.exports = {
  ensureAuthenticatedProfile,
  loadCredentials,
  profileEnv,
  profileIsAuthenticated,
  warmLiveProfile,
};
