#!/usr/bin/env node
'use strict';
// =============================================================================
// Netlify build-ignore hook.  exit 0 = SKIP the build,  exit 1 = BUILD.
//
// Two things make this worth having on the Free plan's 300 build minutes:
//
//   1. ONE push builds TWO sites. fluxyos.com and dashboard.fluxyos.com deploy
//      from this repo, selected by SITE_ROLE. A change to a landing page still
//      rebuilt the dashboard, and an accounting change still rebuilt marketing.
//      Roughly half of every push was wasted.
//
//   2. Docs, tests and QA scripts ship nothing. A commit that only touches
//      docs/ or tests/ produced two full builds and changed no served byte.
//
// August 2026 hit 306 of 300 minutes across ~30 commits in two days, which is
// what prompted this.
//
// FAIL-SAFE: anything unrecognised BUILDS. Skipping a build that was needed
// silently serves stale code, which is far worse than spending a minute.
// =============================================================================

const { execSync } = require('child_process');

const ROLE = (process.env.SITE_ROLE || '').toLowerCase();   // marketing | app | ''
const CACHED = process.env.CACHED_COMMIT_REF;
const CURRENT = process.env.COMMIT_REF;

const BUILD = () => { console.log('BUILD'); process.exit(1); };
const SKIP = (why) => { console.log(`SKIP — ${why}`); process.exit(0); };

if (!CACHED || !CURRENT || CACHED === CURRENT) BUILD();

let changed = [];
try {
    changed = execSync(`git diff --name-only ${CACHED} ${CURRENT}`, { encoding: 'utf8' })
        .split('\n').map((f) => f.trim()).filter(Boolean);
} catch (_) {
    // Shallow clone, force-push, or a ref Netlify no longer has. Build.
    BUILD();
}
if (!changed.length) BUILD();

// Files that never reach either site.
const NON_DEPLOYABLE = (f) =>
    f.startsWith('docs/') ||
    f.startsWith('tests/') ||
    f.startsWith('.qa/') ||
    f.startsWith('.claude/') ||
    f.startsWith('.githooks/') ||
    f.startsWith('cbm-extracted/') ||
    f === 'CLAUDE.md' ||
    f.endsWith('.md') ||
    /^scripts\/qa\//.test(f) ||
    /\.check\.js$/.test(f) ||
    /\.spec\.js$/.test(f);

// Anything shared, or anything that changes how a build is produced, rebuilds
// BOTH roles. Being generous here is the point: the cost of a wrong skip is
// stale production code.
const SHARED = (f) =>
    f.startsWith('assets/') ||
    f.startsWith('scripts/') ||          // includes prepare-deploy.js itself
    f.startsWith('deploy/') ||
    f.startsWith('netlify/') ||
    f.startsWith('functions/') ||
    f === 'netlify.toml' ||
    f === 'package.json' ||
    f === 'package-lock.json' ||
    f.endsWith('.rules') ||
    f.endsWith('.json');

const deployable = changed.filter((f) => !NON_DEPLOYABLE(f));
if (!deployable.length) SKIP(`${changed.length} file(s) changed, none deployable (docs/tests/QA)`);

if (!ROLE) BUILD();                      // monolith / preview: always build
if (deployable.some(SHARED)) BUILD();    // shared code affects both roles

// Root pages are split by role. Ask prepare-deploy.js rather than duplicating
// the lists — one source of truth, and an unclassified page is a hard error
// there, so it can never silently land on the wrong side.
// IMPORTED, not scraped — see the note in lint-design.js. A failure here still
// BUILDS rather than skipping: refusing to build because a classification could
// not be read would silently stop deploys, which is far worse than one wasted
// build.
let PAGES_BY_ROLE = null;
try {
    const { pagesFor, ROLES } = require('./prepare-deploy.js');
    if (!ROLES.includes(ROLE)) BUILD();
    PAGES_BY_ROLE = { mine: pagesFor(ROLE), theirs: ROLES.filter((r) => r !== ROLE).flatMap((r) => pagesFor(r)) };
} catch (_) { BUILD(); }

const mine = PAGES_BY_ROLE.mine;
// A page served by BOTH roles is "mine" first — it must never count as foreign,
// or a shared page like pos.html would look unclassified and force a build on
// every site every time it changes.
const theirs = PAGES_BY_ROLE.theirs.filter((f) => !mine.includes(f));

// Build when anything of MINE changed, or anything I cannot classify.
const touchesMine = deployable.some((f) => mine.includes(f));
const allClassified = deployable.every((f) => mine.includes(f) || theirs.includes(f));
if (touchesMine || !allClassified) BUILD();

SKIP(`${deployable.length} page(s) changed, all belong to the other site`);
