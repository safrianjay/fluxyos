'use strict';

// =============================================================================
// FluxyOS — KYC internal-alert backfill guard
//
// The KYC gate blocks the whole product until a reviewer approves, so every new
// signup and submission emails the reviewer. The danger is the FIRST sweep after
// deploy: every user already on the roster sits at kyc_status 'submitted',
// unreviewed, so a status-only condition would send one email per existing user.
//
// This asserts the recency guard in notify-core.internalAlertFlags holds for the
// real roster shape. Pure function, no network, no Firebase — runs in CI.
//
//   node tests/kyc-alert-backfill.check.js
// =============================================================================

// Pin the env the guard reads BEFORE requiring the module (it reads at load).
process.env.WELCOME_AFTER = process.env.WELCOME_AFTER || '2026-06-14T07:45:09Z';
process.env.NOTIFY_AFTER = process.env.NOTIFY_AFTER || '2026-06-14T08:32:50Z';

const { internalAlertFlags } = require('../netlify/functions/lib/notify-core');

const NOW = Date.parse('2026-08-08T12:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Admin-SDK Timestamp shape — only toMillis() is used.
const ts = (ms) => (ms == null ? null : { toMillis: () => ms });

let passed = 0, failed = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log(`  PASS  ${label}`); }
    else { failed++; console.error(`  FAIL  ${label} → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

// --- THE CASE THAT MATTERS: the existing production roster ------------------
// Signed up and submitted weeks/months ago, never reviewed. Must stay silent.
check('legacy roster user (submitted 30d ago, unreviewed) → no alerts',
    internalAlertFlags({ kyc_status: 'submitted', created_at: ts(NOW - 30 * DAY), kyc_submitted_at: ts(NOW - 30 * DAY) }, NOW),
    { signup: false, submission: false });

check('legacy roster user with NO kyc_submitted_at → no alerts',
    internalAlertFlags({ kyc_status: 'submitted', created_at: ts(NOW - 60 * DAY), kyc_submitted_at: null }, NOW),
    { signup: false, submission: false });

check('pre-cutoff user submitted before NOTIFY_AFTER → no alerts',
    internalAlertFlags({ kyc_status: 'submitted', created_at: ts(Date.parse('2026-05-01T00:00:00Z')), kyc_submitted_at: ts(Date.parse('2026-05-02T00:00:00Z')) }, NOW),
    { signup: false, submission: false });

check('submitted 7h ago (just outside the 6h window) → no alerts',
    internalAlertFlags({ kyc_status: 'submitted', created_at: ts(NOW - 7 * HOUR), kyc_submitted_at: ts(NOW - 7 * HOUR) }, NOW),
    { signup: false, submission: false });

// --- The events that SHOULD alert -------------------------------------------
check('brand-new signup (10 min ago, not yet submitted) → signup alert only',
    internalAlertFlags({ kyc_status: 'not_started', created_at: ts(NOW - 10 * MIN), kyc_submitted_at: null }, NOW),
    { signup: true, submission: false });

check('signup + submission in the same session → both alerts',
    internalAlertFlags({ kyc_status: 'submitted', created_at: ts(NOW - 20 * MIN), kyc_submitted_at: ts(NOW - 5 * MIN) }, NOW),
    { signup: true, submission: true });

check('submitted 2h ago by a user who signed up 3 days ago → submission alert only',
    internalAlertFlags({ kyc_status: 'submitted', created_at: ts(NOW - 3 * DAY), kyc_submitted_at: ts(NOW - 2 * HOUR) }, NOW),
    { signup: false, submission: true });

// --- Non-submitted states never fire the submission alert -------------------
for (const status of ['approved', 'rejected', 'needs_revision', 'in_progress', 'not_started']) {
    check(`kyc_status '${status}' (fresh timestamp) → no submission alert`,
        internalAlertFlags({ kyc_status: status, created_at: ts(NOW - 30 * DAY), kyc_submitted_at: ts(NOW - 5 * MIN) }, NOW).submission,
        false);
}

console.log(`\nKYC alert backfill guard: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
