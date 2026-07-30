module.exports = {
  testDir: "./test/integration",
  workers: 1,
  timeout: 30000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
};
