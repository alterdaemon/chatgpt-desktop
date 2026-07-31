// Two projects so the fixture-backed suite can grow without touching npm
// scripts, while the credential-backed live check stays opt-in and separate.
module.exports = {
  testDir: "./test/integration",
  workers: 1,
  timeout: 30000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  projects: [
    {
      name: "integration",
      testIgnore: "**/live-chatgpt.spec.js",
    },
    {
      name: "live",
      testMatch: "**/live-chatgpt.spec.js",
      timeout: 420000,
    },
  ],
};
