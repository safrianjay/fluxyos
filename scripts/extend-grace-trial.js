'use strict';

// =============================================================================
// FluxyOS — support-granted trial extension (one-shot, run by hand).
//
// Grants a special 1-month trial extension to a single workspace OWNER by
// writing their canonical user-scoped subscription doc
// (users/{uid}/billing_subscription/current). Trial/billing state is
// user-scoped by design (see docs/PROJECT_BACKGROUND.md §4k), and the trial
// guard is owner-scoped (assets/js/sidebar-loader.js) — so extending the
// owner's doc is what drives the owner's trial banner + access. This script
// does NOT implement workspace-shared trial inheritance for members.
//
// It also best-effort re-syncs the denormalized workspace plan summary
// (workspaces/{uid}, what members read) and the internal ops-console access
// mirror (internal_users/{uid}) so both reflect "trialing" again.
//
// Two commands:
//   extend  (default) — write the extended trial + audit log + mirrors.
//   email             — send the "trial extended" notice via Resend
//                       (hello@fluxyos.com). Run this only AFTER you have
//                       confirmed `extend` applied.
//
// Usage:
//   # 1) Dry-run against prod (prints the planned write, writes nothing):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/extend-grace-trial.js extend --dry-run
//
//   # 2) Apply the extension:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/extend-grace-trial.js extend
//
//   # 3) After confirming, send the customer email:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json RESEND_API_KEY=re_xxx \
//     node scripts/extend-grace-trial.js email
//
// Flags:
//   --email <addr>   target account email   (default grace@get-pipeline.com)
//   --name <name>    greeting name          (default Grace)
//   --months <n>     extension length       (default 1)
//   --locale <id|en> email language         (default en)
//   --dry-run        plan only, no writes / no send
// =============================================================================

const admin = require('firebase-admin');
const { Resend } = require('resend');
const { buildEmail } = require('../functions/lib/templates');

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_FROM = 'FluxyOS <hello@fluxyos.com>';
const REPLY_TO = 'hello@fluxyos.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';

const args = process.argv.slice(2);
const COMMAND = (args.find((a) => !a.startsWith('--')) || 'extend').toLowerCase();
const DRY_RUN = args.includes('--dry-run');
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const TARGET_EMAIL = flag('email', 'grace@get-pipeline.com');
const GREETING_NAME = flag('name', 'Grace');
const MONTHS = Math.max(1, parseInt(flag('months', '1'), 10) || 1);
const LOCALE = flag('locale', 'en') === 'id' ? 'id' : 'en';

if (admin.apps.length === 0) {
    admin.initializeApp(
        process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {}
    );
}
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

function fmtDate(date, locale) {
    return date.toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-US', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
}

async function resolveOwner(email) {
    const user = await admin.auth().getUserByEmail(email);
    return { uid: user.uid, email: user.email || email, displayName: user.displayName || null };
}

// One calendar month per --months step, from `start`.
function addMonths(start, months) {
    const d = new Date(start.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
}

async function commandExtend() {
    const owner = await resolveOwner(TARGET_EMAIL);
    console.log(`\nAccount: ${owner.email}  uid=${owner.uid}`);

    const subRef = db.doc(`users/${owner.uid}/billing_subscription/current`);
    const snap = await subRef.get();
    const before = snap.exists ? snap.data() : null;

    const beforeStatus = before ? before.status : '(no subscription doc)';
    const beforeEnds = before && before.trial_ends_at && before.trial_ends_at.toDate
        ? fmtDate(before.trial_ends_at.toDate(), 'en') : '(none)';
    console.log(`  before: status=${beforeStatus}  trial_ends_at=${beforeEnds}`);

    const now = new Date();
    const endDate = addMonths(now, MONTHS);
    const startTs = Timestamp.fromDate(now);
    const endTs = Timestamp.fromDate(endDate);

    console.log(`  after:  status=trialing  trial_ends_at=${fmtDate(endDate, 'en')}  (+${MONTHS} month)`);

    if (DRY_RUN) {
        console.log('\n(dry-run) no writes performed.');
        return;
    }

    // 1) Canonical owner subscription — the source of truth for the trial guard.
    await subRef.set({
        plan_id: 'trial',
        plan_name: 'Trial',
        status: 'trialing',
        trial_started_at: startTs,
        trial_ends_at: endTs,
        updated_at: FieldValue.serverTimestamp()
    }, { merge: true });

    // 2) Audit trail (mirrors the system trial.created / trial.expired logs).
    await db.collection(`users/${owner.uid}/audit_logs`).add({
        actor_uid: owner.uid,
        actor_role: 'owner',
        action: 'trial.extended',
        target_collection: 'billing',
        target_id: 'current',
        before: { status: beforeStatus, trial_ends_at: before ? (before.trial_ends_at || null) : null },
        after: { status: 'trialing', trial_ends_at: endTs },
        reason: `Support-granted ${MONTHS}-month trial extension`,
        source: 'system',
        created_at: FieldValue.serverTimestamp()
    });

    // 3) Best-effort: workspace plan summary members read (workspaceId == uid).
    try {
        await db.doc(`workspaces/${owner.uid}`).set({
            plan_id: 'trial',
            plan_name: 'Trial',
            subscription_status: 'trialing',
            plan_synced_at: FieldValue.serverTimestamp()
        }, { merge: true });
        console.log('  synced workspace plan summary.');
    } catch (e) { console.warn('  workspace plan sync skipped:', e.message); }

    // 4) Best-effort: internal ops-console access mirror.
    try {
        const daysRemaining = Math.ceil(Math.max(0, endTs.toMillis() - Date.now()) / DAY_MS);
        await db.doc(`internal_users/${owner.uid}`).set({
            access_status: 'trialing',
            trial_started_at: startTs,
            trial_ends_at: endTs,
            trial_days_remaining: daysRemaining,
            updated_at: FieldValue.serverTimestamp()
        }, { merge: true });
        console.log('  synced internal access mirror.');
    } catch (e) { console.warn('  internal mirror skipped:', e.message); }

    console.log('\nDone. Trial extended. Verify in-app, then run the `email` command.');
}

async function commandEmail() {
    const owner = await resolveOwner(TARGET_EMAIL);
    const subRef = db.doc(`users/${owner.uid}/billing_subscription/current`);
    const snap = await subRef.get();
    const sub = snap.exists ? snap.data() : null;

    if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) {
        console.error(`\nRefusing to send: ${owner.email} is not in an active trialing state ` +
            `(status=${sub ? sub.status : 'none'}). Run \`extend\` first and confirm.`);
        process.exit(1);
    }

    const endDate = sub.trial_ends_at.toDate();
    const trialEndsLabel = fmtDate(endDate, LOCALE);
    const { subject, html, text } = buildEmail('trial_extended', LOCALE, {
        name: GREETING_NAME,
        trialEndsLabel,
        baseUrl: APP_BASE_URL,
        dashboardUrl: `${APP_BASE_URL}/dashboard`
    });

    console.log(`\nTo:      ${owner.email}`);
    console.log(`Subject: ${subject}`);
    console.log(`Trial ends: ${trialEndsLabel}`);

    if (DRY_RUN) {
        console.log('\n(dry-run) email not sent. Text body:\n');
        console.log(text);
        return;
    }
    if (!process.env.RESEND_API_KEY) {
        console.error('\nRESEND_API_KEY is not set — cannot send.');
        process.exit(1);
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const res = await resend.emails.send({
        from: EMAIL_FROM, to: owner.email, reply_to: REPLY_TO, subject, html, text
    });
    if (res && res.error) throw new Error(res.error.message || 'Resend send error');
    console.log(`\nSent. id=${(res && res.data && res.data.id) || '(unknown)'}`);
}

(async () => {
    if (!['extend', 'email'].includes(COMMAND)) {
        console.error('Usage: node scripts/extend-grace-trial.js <extend|email> [--dry-run] [--email addr] [--name N] [--months N] [--locale id|en]');
        process.exit(2);
    }
    if (COMMAND === 'extend') await commandExtend();
    else await commandEmail();
    process.exit(0);
})().catch((e) => { console.error('\nFailed:', e && e.message ? e.message : e); process.exit(1); });
