// =============================================================================
// No page decides "signed out" by a stopwatch
//
// 23 pages armed `setTimeout(() => location.replace('/login'), 2000)` and relied
// on onAuthStateChanged cancelling it. Firebase restores a session
// asynchronously, so a restore slower than the guess — a slow phone, weak wifi,
// a busy machine — bounced a SIGNED-IN user to /login. The timer may stay as a
// backstop, but its callback must wait for `authStateReady()` and redirect only
// when there is genuinely no `currentUser`. The behaviour is proven in
// tests/auth-guard-slow-restore.spec.js; this keeps the pattern from returning.
// =============================================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const files = [
    ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')),
    ...fs.readdirSync(path.join(ROOT, 'assets/js')).filter((f) => f.endsWith('.js')).map((f) => `assets/js/${f}`)
];

// A timer whose callback goes straight to /login, with nothing in between.
const BLIND = /setTimeout\(\s*\(\)\s*=>\s*\{?\s*window\.location\.(?:replace|assign)\(\s*['"]\/login['"]\s*\);?\s*\}?\s*,\s*\d+\s*\)/;
const BLIND_HREF = /setTimeout\(\s*\(\)\s*=>\s*\{?\s*window\.location\.href\s*=\s*['"]\/login['"];?\s*\}?\s*,\s*\d+\s*\)/;

let failures = 0;
let guarded = 0;
console.log('\nauth guard\n');
files.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (BLIND.test(src) || BLIND_HREF.test(src)) {
        failures += 1;
        console.log(`  ✗ ${f} sends users to /login on a timer without asking Firebase`);
    }
    guarded += (src.match(/await auth\.authStateReady\(\); \} catch \(_\) \{ \/\* fall through \*\/ \}\n\s*if \(!auth\.currentUser\) window\.location\.replace\('\/login'\);/g) || []).length;
});
const okCount = guarded >= 23;
if (!okCount) failures += 1;
console.log(`  ${okCount ? '✓' : '✗'} ${guarded} timed guards wait for the session before redirecting`);
console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nauth guard: clean\n');
process.exit(failures ? 1 : 0);
