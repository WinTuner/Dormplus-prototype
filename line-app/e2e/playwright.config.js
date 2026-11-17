const { defineConfig, devices } = require("@playwright/test");

// 4317, not the 4173 default of server.js: a foreign dev server on 4173 would silently be reused.
const PORT = Number(process.env.E2E_PORT || 4317);

module.exports = defineConfig({
  testDir: "./tests",
  // One in-memory server shared by every test (see server.js): tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "node server.js",
    url: `http://127.0.0.1:${PORT}/__test/state`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
