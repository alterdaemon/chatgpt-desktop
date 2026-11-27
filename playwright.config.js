// Two projects so the fixture-backed suite can grow without touching npm
// scripts, while the credential-backed live checks stay opt-in and separate.
const liveSpecs = ["**/live-chatgpt.spec.js", "**/live-dom-canary.spec.js", "**/live-settings.spec.js", "**/live-usage.spec.js"];

module.exports = {
  testDir: "./test/integration",
  workers: 1,
  timeout: 30000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  projects: [
    {
      name: "integration",
      testIgnore: liveSpecs,
    },
    {
      name: "live",
      testMatch: liveSpecs,
      timeout: 420000,
    },
  ],
};
