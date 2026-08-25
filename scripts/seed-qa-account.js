#!/usr/bin/env node
'use strict';
// =============================================================================
// seed-qa-account.js — provision (or repair) a QA account for one country.
//
// WHY THIS EXISTS
// The QA account is an Indonesian workspace, so no browser test can catch a bug
// that only appears outside Indonesia. On 2026-08-23 a peso workspace was quoted
// in rupiah at checkout and every check passed, because every check ran against
// an IDR account. A non-IDR QA account is the only thing that closes that.
//
// WHY IT NEEDS THE ADMIN SDK
// A QA account has to clear three gates that the app deliberately will not let a
// script clear from the client side:
//   1. KYC review — locks the app until a human approves in /internal. There is
//      no auto-approve, by design.
//   2. Onboarding — the gate holds every page until progress is complete.
//   3. base_currency — set ONCE, enforced in firestore.rules. A workspace seeded
//      with the wrong currency cannot be corrected through the app at all. The
//      Admin SDK bypasses rules, which is exactly why the repair path lives here
//      and not in a page.
//
// This writes ONLY to accounts whose email matches QA_EMAIL_PATTERN. It refuses
// to touch anything else, so it cannot be pointed at a customer by accident.
//
// Usage:
//   # 1) Dry-run (prints every planned write, writes nothing):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/seed-qa-account.js --country PH --dry-run
//
//   # 2) Apply:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/seed-qa-account.js --country PH
//
//   # 3) Write the Playwright credentials file it prints:
//   #    .qa/firebase-test-account-ph.md   (gitignored, like the ID one)
//
// Flags:
//   --country <ID|PH|SG|MY>   which market to seed        (required)
//   --email <addr>            override the derived email
//   --password <pw>           override the generated password
//   --dry-run                 plan only, no writes
// =============================================================================
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Money = require('../assets/js/money-format.js');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const COUNTRY = String(flag('country', '')).toUpperCase();
// Only ever act on addresses that look like QA fixtures.
const QA_EMAIL_PATTERN = /^qa\+[a-z]{2}@fluxyos\.com$/;

const PROFILES = {
    ID: { name: 'QA Indonesia',   business: 'Kopi Senja QA' },
    PH: { name: 'QA Philippines', business: 'Manila Coffee QA' },
    SG: { name: 'QA Singapore',   business: 'Marina Trading QA' },
    MY: { name: 'QA Malaysia',    business: 'KL Supply QA' }
};

if (!PROFILES[COUNTRY]) {
    console.error(`--country must be one of ${Object.keys(PROFILES).join(', ')} (got ${COUNTRY || 'nothing'})`);
    process.exit(1);
}

const EMAIL = flag('email', `qa+${COUNTRY.toLowerCase()}@fluxyos.com`);
if (!QA_EMAIL_PATTERN.test(EMAIL)) {
    console.error(`Refusing to touch ${EMAIL} — this script only writes to qa+<cc>@fluxyos.com.`);
    console.error('That guard is the only thing standing between a typo and a customer account.');
    process.exit(1);
}

const CURRENCY = Money.currencyForCountry(COUNTRY);
const PASSWORD = flag('password', `QA-${COUNTRY}-${crypto.randomBytes(9).toString('base64url')}`);
const PROFILE = PROFILES[COUNTRY];

admin.initializeApp();
const auth = admin.auth();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const plan = [];
const note = (what) => { plan.push(what); console.log(`  ${DRY_RUN ? 'would' : 'will'} ${what}`); };

async function main() {
    console.log(`\nSeeding QA account for ${COUNTRY} (${PROFILE.name})`);
    console.log(`  email     ${EMAIL}`);
    console.log(`  currency  ${CURRENCY}  (derived from country — never passed in)\n`);

    // ---- 1. auth user --------------------------------------------------------
    let user = null;
    try { user = await auth.getUserByEmail(EMAIL); } catch (_) { /* create below */ }
    if (user) {
        note(`reuse existing auth user ${user.uid}`);
        if (!DRY_RUN) await auth.updateUser(user.uid, { password: PASSWORD, emailVerified: true });
        note('reset its password to the value printed below');
    } else {
        note(`create auth user ${EMAIL}`);
        if (!DRY_RUN) {
            user = await auth.createUser({
                email: EMAIL, password: PASSWORD, emailVerified: true, displayName: PROFILE.name
            });
        }
    }
    const uid = user ? user.uid : '(dry-run-uid)';
    const workspaceId = uid;   // owner-bootstrapped workspaces use the owner uid

    const now = FieldValue.serverTimestamp();
    const trialEnds = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

    // ---- 2. KYC — approved, so the app is not locked -------------------------
    note(`internal_users/${uid}: kyc_status=approved, trialing for 365d`);
    const internalDoc = {
        email: EMAIL,
        full_name: PROFILE.name,
        company_name: PROFILE.business,
        country: COUNTRY,
        kyc_status: 'approved',
        kyc_reviewed_at: now,
        kyc_reviewed_by: 'seed-qa-account.js',
        plan_id: 'trial',
        status: 'trialing',
        trial_started_at: now,
        trial_ends_at: trialEnds,
        is_qa_account: true,
        updated_at: now
    };

    // ---- 3. workspace — country + base_currency, the whole point -------------
    note(`workspaces/${workspaceId}: country=${COUNTRY}, base_currency=${CURRENCY}`);
    const workspaceDoc = {
        owner_uid: uid,
        name: PROFILE.business,
        country: COUNTRY,
        base_currency: CURRENCY,
        plan_id: 'trial',
        plan_name: 'Trial',
        subscription_status: 'trialing',
        billing_frequency: null,
        plan_synced_at: now,
        trial_started_at: now,
        trial_ends_at: trialEnds,
        current_period_end: trialEnds,
        created_at: now,
        updated_at: now
    };

    // ---- 4. membership + reverse lookup -------------------------------------
    note(`workspaces/${workspaceId}/members/${uid}: owner/active`);
    note(`user_workspaces/${uid}: default=${workspaceId}`);

    // ---- 5. onboarding — completed, or every page stays gated ---------------
    note(`users/${uid}/onboarding/progress: onboarding_completed=true`);
    note(`users/${uid}/onboarding/profile: country=${COUNTRY}, currency=${CURRENCY}`);

    if (DRY_RUN) {
        console.log(`\nDry run — ${plan.length} writes planned, none applied.`);
        console.log('Re-run without --dry-run to apply.\n');
        return;
    }

    const batch = db.batch();
    batch.set(db.doc(`internal_users/${uid}`), internalDoc, { merge: true });
    batch.set(db.doc(`workspaces/${workspaceId}`), workspaceDoc, { merge: true });
    batch.set(db.doc(`workspaces/${workspaceId}/members/${uid}`), {
        role: 'owner', status: 'active', email: EMAIL, joined_at: now, updated_at: now
    }, { merge: true });
    batch.set(db.doc(`user_workspaces/${uid}`), {
        workspaceIds: [workspaceId], default: workspaceId, updated_at: now
    }, { merge: true });
    batch.set(db.doc(`users/${uid}/onboarding/progress`), {
        onboarding_completed: true,
        // kyc-gate.js opens for anyone whose progress doc lacks this flag, so a
        // seeded account without it can never exercise the review lock — the
        // gate's own tests would pass while proving nothing.
        kyc_enforced: true,
        completed_at: now, updated_at: now
    }, { merge: true });
    batch.set(db.doc(`users/${uid}/onboarding/profile`), {
        business_name: PROFILE.business,
        country: COUNTRY,
        currency: CURRENCY,
        owner_name: PROFILE.name,
        completed_at: now,
        updated_at: now
    }, { merge: true });
    await batch.commit();

    // Read the workspace back from the SERVER. base_currency is immutable, so a
    // silently-wrong value here is not fixable through the app later — this is
    // the one place it can still be caught cheaply.
    const check = await db.doc(`workspaces/${workspaceId}`).get();
    const got = check.get('base_currency');
    if (got !== CURRENCY) {
        console.error(`\n✗ workspace base_currency reads ${got}, expected ${CURRENCY}. Investigate before using this account.`);
        process.exit(1);
    }

    const credsPath = path.join('.qa', `firebase-test-account-${COUNTRY.toLowerCase()}.md`);
    const creds = `# FluxyOS QA test account — ${COUNTRY}\n\n`
        + `Seeded by scripts/seed-qa-account.js. Gitignored: never commit this file.\n\n`
        + `- Email: \`${EMAIL}\`\n- Password: \`${PASSWORD}\`\n`
        + `- Country: \`${COUNTRY}\`\n- Base currency: \`${CURRENCY}\`\n- Workspace: \`${workspaceId}\`\n`;
    fs.mkdirSync('.qa', { recursive: true });
    fs.writeFileSync(credsPath, creds);

    console.log(`\n✓ ${COUNTRY} QA account ready — workspace verified at base_currency=${CURRENCY}`);
    console.log(`✓ credentials written to ${credsPath} (gitignored)\n`);
}

main().catch((err) => { console.error('\nseed-qa-account failed:', err.message); process.exit(1); });
