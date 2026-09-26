const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'erp-intelligence.spec.js',
  outputDir: '../test-results/erp-intelligence',
  reporter: 'list',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:8765' },
  webServer: { command: 'node tests/qa-static-server.js', cwd: require('path').resolve(__dirname, '..'), url: 'http://127.0.0.1:8765/erp-intelligence', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
});
