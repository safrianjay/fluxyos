const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'currency-landing.spec.js',
  outputDir: '../test-results/currency-landing',
  reporter: 'list',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:8765' },
  webServer: {
    command: 'node tests/qa-static-server.js',
    cwd: require('path').resolve(__dirname, '..'),
    url: 'http://127.0.0.1:8765/multi-currency',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
