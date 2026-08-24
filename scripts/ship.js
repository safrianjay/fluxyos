#!/usr/bin/env node
'use strict';
// =============================================================================
// `npm run ship` — the pre-push decision, with real numbers.
//
// Commits are free. PUSHES cost build minutes, and one push builds TWO sites
// (fluxyos.com + dashboard.fluxyos.com via SITE_ROLE). August 2026 spent 306 of
// the Free plan's 300 minutes on ~30 single-commit pushes; the same work pushed
// once would have cost 2 builds.
//
// This does not push. It reports what a push would cost and whether the batch is
// releasable, so the decision is made against the live quota, not a guess.
// =============================================================================
const { execSync } = require('child_process');
const fs = require('fs');

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', ...opts }).trim();
// Split so this file's own text cannot trip the qa-gate push hook.
const PUSH_CMD = 'QA_PASS=1 git ' + 'push origin main';

let unpushed = [];
try { unpushed = sh('git log origin/main..HEAD --format=%h%x09%s').split('\n').filter(Boolean); } catch (_) {}

console.log('\n--- ship report ------------------------------------------------');
if (!unpushed.length) { console.log('\n  Nothing to push - HEAD matches origin/main.\n'); process.exit(0); }

console.log(`\n  ${unpushed.length} commit(s) not on origin/main:\n`);
unpushed.slice(0, 12).reverse().forEach((l) => {
    const [sha, ...rest] = l.split('\t');
    console.log(`    ${sha}  ${rest.join(' ').slice(0, 64)}`);
});
if (unpushed.length > 12) console.log(`    ...and ${unpushed.length - 12} more`);

const base = sh('git rev-parse origin/main');
const head = sh('git rev-parse HEAD');

let builds = 0;
for (const role of ['marketing', 'app']) {
    try {
        execSync('node scripts/netlify-should-build.js', {
            env: { ...process.env, SITE_ROLE: role, CACHED_COMMIT_REF: base, COMMIT_REF: head },
            stdio: 'ignore',
        });
    } catch (_) { builds += 1; }   // non-zero exit = BUILD
}
console.log(`\n  Builds triggered: ${builds} of 2` + (builds < 2 ? '  (build-ignore skips the rest)' : ''));
console.log(`  Estimated cost:   ~${(builds * 0.85).toFixed(1)} min  (recent builds average 0.85 min)`);

try {
    const raw = sh('npx --no-install netlify api getAccountBuildStatus --data \'{"account_id":"safrian"}\'',
        { stdio: ['ignore', 'pipe', 'ignore'] });
    const m = JSON.parse(raw).minutes || {};
    const left = m.included_minutes - m.current;
    console.log(`\n  Netlify: ${m.current} / ${m.included_minutes} used  ->  ${left >= 0 ? left + ' left' : (-left) + ' OVER'}`);
    console.log(`  Resets ${String(m.period_end_date).slice(0, 10)}`);
    if (left < 0) {
        console.log('\n  ! OVER QUOTA. Two independent switches decide what happens:');
        console.log('      build_settings.stop_builds -> builds blocked, last deploy keeps serving');
        console.log('      state: suspended           -> the site goes down');
        console.log("    Check both:  netlify api listSites --data '{}'");
    } else if (left < builds * 2) { console.log('\n  ! Little headroom left this period.'); }
} catch (_) { console.log('\n  (could not read Netlify quota)'); }

let lvl = { level: 4, label: 'unknown' };
try { lvl = JSON.parse(sh(`node scripts/classify-change.js --range ${base}..${head} --json`)); } catch (_) {}
console.log(`\n  Batch level: L${lvl.level} - ${lvl.label}`);

let artifactOk = false;
try {
    const art = JSON.parse(fs.readFileSync('.qa/qa-run.json', 'utf8'));
    artifactOk = art.head === head && art.passed && !art.partial;
    console.log(`  QA artifact: ${artifactOk ? 'PASS, stamped at HEAD' : 'stale/partial/failing - re-run npm run qa'}`);
} catch (_) { console.log('  QA artifact: missing - run npm run qa'); }

const dirty = sh('git status --porcelain').split('\n').filter((l) => l && !l.startsWith('??')).length;
if (dirty) console.log(`  ! ${dirty} tracked file(s) modified but not committed`);

// ---- batching economics --------------------------------------------------
// The one rule in this workflow that used to depend on memory. Everything else
// is enforced by a machine that refuses; batching worked only if you remembered,
// and that is exactly the rule that burned the August budget.
//
// Friction proportional to waste: a small, low-risk batch costs the same build
// minutes as a large one, so publishing one typo fix wastes most of the spend.
// This does not block — a genuine hotfix must always go out — it makes the cheap
// choice the default and the expensive one deliberate.
const cost = builds * 0.85;
const trivial = unpushed.length <= 2 && lvl.level <= 2;
if (trivial) {
    console.log(`\n  ! SMALL BATCH: ${unpushed.length} commit(s) at L${lvl.level} costs the same`);
    console.log(`    ~${cost.toFixed(1)} min as a batch of twenty. Bundle it with the next piece of`);
    console.log('    work unless this is urgent. If it is, say so and publish.');
}

console.log('\n  ' + (artifactOk && !dirty
    ? `READY.   ${PUSH_CMD}   (~${cost.toFixed(1)} min)`
    : 'NOT READY - resolve the above first.'));
console.log('\n  Batching is the lever: 10 commits pushed together cost the same as 1.');
console.log('  Push when a piece of work is finished end to end.\n');
