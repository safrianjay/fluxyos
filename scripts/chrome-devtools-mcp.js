#!/usr/bin/env node
/**
 * Launcher for chrome-devtools-mcp, pinned to Playwright's Chromium.
 *
 * chrome-devtools-mcp defaults to the `stable` Chrome channel and hard-fails
 * when /Applications/Google Chrome.app is absent — which it is on this machine.
 * Playwright is already a devDependency here and ships its own Chromium, so
 * this reuses that download instead of asking anyone to install a second
 * browser just to debug.
 *
 * Resolved at runtime rather than written into .mcp.json as a literal path:
 * Playwright's build directory carries its revision (chromium-1223), so a
 * hardcoded path silently breaks on the next `npm install`.
 *
 * If Playwright's browser is missing, fall through with no --executablePath and
 * let chrome-devtools-mcp find a real Chrome — someone running this on a
 * machine WITH Chrome installed should not be forced onto Playwright's copy.
 */

'use strict';

const { spawn } = require('child_process');

const passthrough = process.argv.slice(2);
const args = ['-y', 'chrome-devtools-mcp@1.6.0', '--isolated', '--viewport', '1280x720'];

try {
  const fs = require('fs');
  const exe = require('playwright').chromium.executablePath();
  if (exe && fs.existsSync(exe)) args.push('--executablePath', exe);
} catch {
  // Playwright not installed or no browser downloaded — let the server pick.
}

const child = spawn('npx', [...args, ...passthrough], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
child.on('error', (err) => {
  console.error(`chrome-devtools-mcp launcher: ${err.message}`);
  process.exit(1);
});
