#!/usr/bin/env node
'use strict';
// =============================================================================
// Cascade account delete — Auth user AND their Firestore footprint.
//
// WHY THIS EXISTS
// Deleting a user in the Firebase Auth console does NOT touch Firestore. The
// login disappears; internal_users, workspaces/{uid} and everything under
// users/{uid} stay behind. The person signs up again, gets a new uid, and the
// old documents become permanently unreachable ghosts — still counted by every
// query, still sitting in the KYC review queue where nothing can ever approve
// or reject them.
//
// By 2026-08-25 that had produced 13 orphans out of 39 internal_users rows.
//
// SAFETY
//   * dry-run is the DEFAULT. --apply is required to write anything.
//   * --orphans only touches rows whose Auth user is already gone. An account
//     someone can still log into is never deleted without an explicit --uid.
//   * every account is counted BEFORE deletion and printed, so a workspace with
//     real ledger data cannot be removed without it showing up in the plan.
//   * --skip-with-data refuses any account holding transactions or journals.
//
// Usage:
//   node scripts/delete-account.js --orphans                    # plan only
//   node scripts/delete-account.js --orphans --email x@y.com    # narrow it
//   node scripts/delete-account.js --orphans --email x@y.com --apply
//   node scripts/delete-account.js --uid <uid> --apply          # one account
// =============================================================================
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ORPHANS = args.includes('--orphans');
const SKIP_WITH_DATA = args.includes('--skip-with-data');
const flag = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const ONLY_EMAIL = flag('email');
const ONLY_UID = flag('uid');

if (!ORPHANS && !ONLY_UID) {
    console.error('Refusing to run without --orphans or --uid. This deletes real data.');
    process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// Everything a signup creates. Kept in one place so a new collection cannot be
// silently missed by the cleanup and become the next generation of orphans.
const USER_SUBS = ['onboarding', 'settings', 'ai_chats', 'billing_subscription',
    'billing_payment_requests', 'usage_limits', 'receipts', 'platform_learning',
    'payment_verifications', 'email_preferences', 'audit_logs'];
const WS_SUBS = ['members', 'transactions', 'bills', 'invoices', 'journals',
    'chart_of_accounts', 'budgets', 'budget_allocations', 'subscriptions',
    'bank_accounts', 'documents', 'periods', 'ledger_balances', 'counters',
    'business_categories', 'accounting_mappings', 'audit_logs'];

async function countSub(base, subs) {
    let total = 0; const detail = {};
    for (const s of subs) {
        try {
            const snap = await db.collection(`${base}/${s}`).limit(500).get();
            if (snap.size) { detail[s] = snap.size; total += snap.size; }
        } catch (_) { /* absent subcollection */ }
    }
    return { total, detail };
}

async function deleteSub(base, subs) {
    for (const s of subs) {
        try {
            let snap;
            do {
                snap = await db.collection(`${base}/${s}`).limit(400).get();
                if (!snap.size) break;
                const batch = db.batch();
                snap.docs.forEach((d) => batch.delete(d.ref));
                await batch.commit();
            } while (snap.size === 400);
        } catch (_) { /* absent */ }
    }
}

(async () => {
    const iu = await db.collection('internal_users').get();
    const targets = [];

    for (const d of iu.docs) {
        const email = d.get('email') || '(none)';
        if (ONLY_UID && d.id !== ONLY_UID) continue;
        if (ONLY_EMAIL && email !== ONLY_EMAIL) continue;

        let authExists = true;
        try { await auth.getUser(d.id); } catch (_) { authExists = false; }
        if (ORPHANS && authExists && !ONLY_UID) continue;

        const u = await countSub(`users/${d.id}`, USER_SUBS);
        const w = await countSub(`workspaces/${d.id}`, WS_SUBS);
        targets.push({ uid: d.id, email, kyc: d.get('kyc_status'), authExists,
            userDocs: u, wsDocs: w });
    }

    if (!targets.length) { console.log('\n  Nothing matches. Nothing to do.\n'); return; }

    console.log(`\n  ${targets.length} account(s) ${APPLY ? 'TO DELETE' : 'in plan (dry run)'}:\n`);
    let blocked = 0;
    for (const t of targets) {
        const ledger = (t.wsDocs.detail.transactions || 0) + (t.wsDocs.detail.journals || 0)
            + (t.wsDocs.detail.invoices || 0) + (t.wsDocs.detail.bills || 0);
        const risky = ledger > 0;
        if (risky) blocked += 1;
        console.log(`   ${t.uid}  ${t.email}`);
        console.log(`     kyc=${t.kyc}  auth=${t.authExists ? 'LIVE' : 'deleted'}  `
            + `user docs=${t.userDocs.total}  workspace docs=${t.wsDocs.total}`
            + (risky ? `   ⚠ HOLDS LEDGER DATA (${ledger})` : ''));
        const dd = { ...t.userDocs.detail, ...t.wsDocs.detail };
        if (Object.keys(dd).length) console.log('     ' + JSON.stringify(dd));
    }

    if (!APPLY) {
        console.log(`\n  Dry run — nothing deleted.${blocked ? `  ${blocked} hold ledger data.` : ''}`);
        console.log('  Re-run with --apply to delete.\n');
        return;
    }

    let done = 0;
    for (const t of targets) {
        const ledger = (t.wsDocs.detail.transactions || 0) + (t.wsDocs.detail.journals || 0)
            + (t.wsDocs.detail.invoices || 0) + (t.wsDocs.detail.bills || 0);
        if (SKIP_WITH_DATA && ledger > 0) { console.log(`   skip ${t.uid} (holds ${ledger} ledger docs)`); continue; }
        await deleteSub(`users/${t.uid}`, USER_SUBS);
        await deleteSub(`workspaces/${t.uid}`, WS_SUBS);
        await db.doc(`workspaces/${t.uid}`).delete().catch(() => {});
        await db.doc(`user_workspaces/${t.uid}`).delete().catch(() => {});
        await db.doc(`users/${t.uid}`).delete().catch(() => {});
        await db.doc(`internal_users/${t.uid}`).delete().catch(() => {});
        if (t.authExists) { try { await auth.deleteUser(t.uid); } catch (_) {} }
        done += 1;
        console.log(`   ✓ deleted ${t.uid}  ${t.email}`);
    }
    console.log(`\n  ${done} account(s) removed.\n`);
})().catch((e) => { console.error('delete-account failed:', e.message); process.exit(1); });
