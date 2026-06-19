// =============================================================================
// FluxyOS — voucher firestore.rules behavioral test (emulator-only)
//
// Verifies that the voucher enforcement in firestore.rules actually holds:
// a correct voucher checkout commit is ALLOWED, and every forged/ineligible
// variant is DENIED. Run via:
//
//   firebase emulators:exec --only firestore,auth \
//     "node tests/voucher-rules-emulator-test.mjs"
//
// Not part of the Playwright suite (those hit production Firestore); this
// script talks only to the local emulators and exits non-zero on any failure.
// =============================================================================

import { initializeApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs,
    setDoc, deleteDoc, writeBatch, serverTimestamp, arrayRemove
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';

const app = initializeApp({ projectId: 'fluxyos', apiKey: 'emulator-fake-key' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

let passed = 0;
let failed = 0;

async function expectOutcome(label, shouldAllow, run) {
    try {
        await run();
        if (shouldAllow) { passed++; console.log(`  PASS (allowed)  ${label}`); }
        else { failed++; console.error(`  FAIL (should have been DENIED)  ${label}`); }
    } catch (err) {
        const denied = err?.code === 'permission-denied' || /permission|PERMISSION/.test(String(err?.message));
        if (!shouldAllow && denied) { passed++; console.log(`  PASS (denied)   ${label}`); }
        else { failed++; console.error(`  FAIL ${shouldAllow ? '(should have been ALLOWED)' : '(unexpected error)'}  ${label} → ${err?.code || err?.message}`); }
    }
}

function voucherPayload(code, overrides = {}) {
    return {
        code,
        discount_type: 'percentage',
        discount_value: 20,
        status: 'active',
        max_redemptions: null,
        redemption_count: 0,
        valid_from: null,
        valid_until: null,
        allowed_plan_ids: null,
        allowed_billing_frequencies: null,
        created_by: 'fluxyos admin',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        disabled_at: null,
        disabled_by: null,
        notes: null,
        ...overrides
    };
}

// Growth monthly @ 20%: subtotal 8.500.000, discount 1.700.000,
// tax = 11% of 6.800.000 = 748.000, total 7.548.000.
const AMOUNTS = { subtotal: 8500000, discount: 1700000, tax: 748000, total: 7548000 };

function paymentRequestPayload(voucherCode, overrides = {}) {
    return {
        plan_id: 'growth',
        plan_name: 'Growth Engine',
        billing_frequency: 'monthly',
        subtotal_amount: AMOUNTS.subtotal,
        estimated_tax_amount: AMOUNTS.tax,
        total_amount: AMOUNTS.total,
        currency: 'IDR',
        payment_method: 'va',
        payment_status: 'pending_verification',
        provider: 'manual',
        provider_payment_id: null,
        provider_invoice_url: null,
        submitted_at: serverTimestamp(),
        verified_at: null,
        failed_at: null,
        expires_at: null,
        user_confirmed_payment_at: null,
        submitted_for_verification_at: null,
        proof_document_id: null,
        proof_file_name: null,
        proof_uploaded_at: null,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        prev_plan_id: null,
        prev_plan_name: null,
        prev_status: null,
        prev_billing_frequency: null,
        voucher_id: voucherCode,
        voucher_code: voucherCode,
        voucher_discount_percent: 20,
        voucher_discount_amount: AMOUNTS.discount,
        ...overrides
    };
}

// Builds the full voucher checkout commit the way db-service.js does, with
// hooks to forge individual pieces. Uses a fresh anonymous user per call so
// the prev-subscription snapshot is always the empty case.
async function attemptVoucherCheckout(voucherCode, {
    requestOverrides = {},
    redemptionUserId = null,
    skipRedemption = false,
    skipCounterBump = false,
    counterFrom = 0
} = {}) {
    // signInAnonymously reuses the current anonymous user — sign out first so
    // every attempt gets a fresh uid (and therefore an empty prev-subscription
    // snapshot), keeping each case isolated.
    await auth.signOut().catch(() => {});
    const { user } = await signInAnonymously(auth);
    const uid = user.uid;
    const requestRef = doc(collection(db, `users/${uid}/billing_payment_requests`));
    const batch = writeBatch(db);
    const requestPayload = paymentRequestPayload(voucherCode, requestOverrides);
    batch.set(requestRef, requestPayload);
    batch.set(doc(db, `users/${uid}/billing_subscription/current`), {
        plan_id: 'growth',
        plan_name: 'Growth Engine',
        status: 'pending_verification',
        billing_frequency: 'monthly',
        current_payment_request_id: requestRef.id,
        trial_started_at: null,
        trial_ends_at: null,
        current_period_start: null,
        current_period_end: null,
        updated_at: serverTimestamp()
    });
    batch.set(doc(collection(db, `users/${uid}/audit_logs`)), {
        actor_uid: uid,
        actor_role: null,
        action: 'billing.payment_request_created',
        target_collection: 'billing_payment_requests',
        target_id: requestRef.id,
        before: null,
        after: { plan_id: 'growth', total_amount: requestPayload.total_amount },
        reason: null,
        source: 'dashboard',
        created_at: serverTimestamp()
    });
    if (!skipRedemption && voucherCode) {
        batch.set(doc(db, `voucher_redemptions/${requestRef.id}`), {
            voucher_id: voucherCode,
            code: voucherCode,
            user_id: redemptionUserId || uid,
            checkout_session_id: requestRef.id,
            plan_id: 'growth',
            billing_frequency: 'monthly',
            original_amount: requestPayload.subtotal_amount,
            discount_amount: requestPayload.voucher_discount_amount ?? AMOUNTS.discount,
            final_amount: requestPayload.total_amount,
            currency: 'IDR',
            status: 'reserved',
            created_at: serverTimestamp(),
            redeemed_at: null
        });
    }
    if (!skipCounterBump && voucherCode) {
        batch.update(doc(db, `voucher_codes/${voucherCode}`), {
            redemption_count: counterFrom + 1,
            updated_at: serverTimestamp()
        });
    }
    await batch.commit();
}

async function main() {
    // Seed identity for voucher creation (rules don't gate it, but reads of
    // voucher docs at checkout require nothing either — MVP posture).
    await signInAnonymously(auth);

    console.log('\n— voucher_codes create rules —');
    await expectOutcome('valid voucher create', true,
        () => setDoc(doc(db, 'voucher_codes/TESTV20'), voucherPayload('TESTV20')));
    await expectOutcome('discount_value 0 rejected', false,
        () => setDoc(doc(db, 'voucher_codes/TESTZERO'), voucherPayload('TESTZERO', { discount_value: 0 })));
    await expectOutcome('discount_value 101 rejected', false,
        () => setDoc(doc(db, 'voucher_codes/TESTBIG'), voucherPayload('TESTBIG', { discount_value: 101 })));
    await expectOutcome('code/doc-id mismatch rejected', false,
        () => setDoc(doc(db, 'voucher_codes/TESTMISMATCH'), voucherPayload('OTHERCODE')));
    await expectOutcome('lowercase doc id rejected', false,
        () => setDoc(doc(db, 'voucher_codes/lower20'), voucherPayload('lower20')));
    await expectOutcome('non-zero initial redemption_count rejected', false,
        () => setDoc(doc(db, 'voucher_codes/TESTCOUNT'), voucherPayload('TESTCOUNT', { redemption_count: 5 })));

    console.log('\n— voucher_codes read rules —');
    await expectOutcome('single get allowed', true,
        async () => { const s = await getDoc(doc(db, 'voucher_codes/TESTV20')); if (!s.exists()) throw new Error('missing'); });
    await expectOutcome('list query denied', false,
        () => getDocs(collection(db, 'voucher_codes')));

    console.log('\n— checkout commit (growth monthly, TESTV20 @20%) —');
    await expectOutcome('correct voucher checkout commit', true,
        () => attemptVoucherCheckout('TESTV20', { counterFrom: 0 }));
    await expectOutcome('no-voucher checkout with null voucher fields', true,
        () => attemptVoucherCheckout(null, {
            requestOverrides: {
                voucher_id: null, voucher_code: null,
                voucher_discount_percent: null, voucher_discount_amount: null,
                estimated_tax_amount: 935000, total_amount: 9435000
            }
        }));

    console.log('\n— forged commits must be denied —');
    await expectOutcome('inflated discount amount', false,
        () => attemptVoucherCheckout('TESTV20', {
            counterFrom: 1,
            requestOverrides: { voucher_discount_amount: 8000000, estimated_tax_amount: 55000, total_amount: 555000 }
        }));
    await expectOutcome('tax computed on undiscounted subtotal', false,
        () => attemptVoucherCheckout('TESTV20', {
            counterFrom: 1,
            requestOverrides: { estimated_tax_amount: 935000, total_amount: 7735000 }
        }));
    await expectOutcome('bare discount without voucher_id', false,
        () => attemptVoucherCheckout('TESTV20', {
            counterFrom: 1,
            requestOverrides: { voucher_id: null, voucher_code: null, voucher_discount_percent: null }
        }));
    await expectOutcome('nonexistent voucher code', false,
        () => attemptVoucherCheckout('NOSUCHCODE', { counterFrom: 0 }));
    await expectOutcome('missing redemption doc in commit', false,
        () => attemptVoucherCheckout('TESTV20', { counterFrom: 1, skipRedemption: true }));
    await expectOutcome('missing counter bump in commit', false,
        () => attemptVoucherCheckout('TESTV20', { skipCounterBump: true }));
    await expectOutcome('counter bumped by 2', false,
        () => attemptVoucherCheckout('TESTV20', { counterFrom: 2 }));
    await expectOutcome('redemption user_id != auth uid', false,
        () => attemptVoucherCheckout('TESTV20', { counterFrom: 1, redemptionUserId: 'someone-else' }));

    console.log('\n— eligibility states —');
    await setDoc(doc(db, 'voucher_codes/TESTOFF'), voucherPayload('TESTOFF'));
    await expectOutcome('admin disable (status + stamps)', true, async () => {
        const batch = writeBatch(db);
        batch.update(doc(db, 'voucher_codes/TESTOFF'), {
            status: 'disabled', disabled_at: serverTimestamp(),
            disabled_by: 'fluxyos admin', updated_at: serverTimestamp()
        });
        await batch.commit();
    });
    await expectOutcome('disabled voucher rejected at checkout', false,
        () => attemptVoucherCheckout('TESTOFF', { counterFrom: 0 }));
    await expectOutcome('discount_value immutable post-create', false,
        () => setDoc(doc(db, 'voucher_codes/TESTV20'), { discount_value: 90, updated_at: serverTimestamp() }, { merge: true }));

    await setDoc(doc(db, 'voucher_codes/TESTFULL'), voucherPayload('TESTFULL', { max_redemptions: 1, redemption_count: 0 }));
    await expectOutcome('last slot redeemable (0 of 1)', true,
        () => attemptVoucherCheckout('TESTFULL', { counterFrom: 0 }));
    await expectOutcome('over-limit redemption rejected (1 of 1)', false,
        () => attemptVoucherCheckout('TESTFULL', { counterFrom: 1 }));

    await setDoc(doc(db, 'voucher_codes/TESTPLAN'), voucherPayload('TESTPLAN', { allowed_plan_ids: ['core'] }));
    await expectOutcome('plan-restricted voucher rejected for growth', false,
        () => attemptVoucherCheckout('TESTPLAN', { counterFrom: 0 }));

    await setDoc(doc(db, 'voucher_codes/TESTANNUAL'), voucherPayload('TESTANNUAL', { allowed_billing_frequencies: ['annually'] }));
    await expectOutcome('frequency-restricted voucher rejected for monthly', false,
        () => attemptVoucherCheckout('TESTANNUAL', { counterFrom: 0 }));

    await setDoc(doc(db, 'voucher_codes/TESTPAST'), voucherPayload('TESTPAST', { valid_until: new Date(Date.now() - 86400000) }));
    await expectOutcome('date-expired voucher rejected', false,
        () => attemptVoucherCheckout('TESTPAST', { counterFrom: 0 }));

    await setDoc(doc(db, 'voucher_codes/TESTSOON'), voucherPayload('TESTSOON', { valid_from: new Date(Date.now() + 86400000) }));
    await expectOutcome('not-yet-started voucher rejected', false,
        () => attemptVoucherCheckout('TESTSOON', { counterFrom: 0 }));

    console.log('\n— registry + redemption lifecycle —');
    await expectOutcome('registry write allowed', true,
        () => setDoc(doc(db, 'voucher_code_index/registry'), { codes: ['TESTV20'], updated_at: serverTimestamp() }));
    await expectOutcome('registry extra fields rejected', false,
        () => setDoc(doc(db, 'voucher_code_index/registry'), { codes: [], secret: true, updated_at: serverTimestamp() }));

    console.log('\n— internal-console hard delete —');
    await setDoc(doc(db, 'voucher_codes/TESTDEL'), voucherPayload('TESTDEL'));
    await expectOutcome('voucher hard delete allowed', true,
        () => deleteDoc(doc(db, 'voucher_codes/TESTDEL')));
    await expectOutcome('deleted voucher get returns missing', true,
        async () => { const s = await getDoc(doc(db, 'voucher_codes/TESTDEL')); if (s.exists()) throw new Error('still exists'); });
    await expectOutcome('registry arrayRemove allowed', true,
        () => setDoc(doc(db, 'voucher_code_index/registry'), { codes: arrayRemove('TESTDEL'), updated_at: serverTimestamp() }, { merge: true }));
    await expectOutcome('registry index hard delete denied', false,
        () => deleteDoc(doc(db, 'voucher_code_index/registry')));

    // Faithful replica of DataService.deleteVoucherCode: voucher delete +
    // registry arrayRemove + audit log in ONE writeBatch. A denial on any
    // single write fails the whole commit, so this is the true production path.
    await setDoc(doc(db, 'voucher_codes/TESTDELB'), voucherPayload('TESTDELB'));
    await setDoc(doc(db, 'voucher_code_index/registry'), { codes: ['TESTDELB'], updated_at: serverTimestamp() });
    await expectOutcome('deleteVoucherCode full batch allowed', true, () => {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'voucher_codes/TESTDELB'));
        batch.set(doc(db, 'voucher_code_index/registry'),
            { codes: arrayRemove('TESTDELB'), updated_at: serverTimestamp() }, { merge: true });
        batch.set(doc(collection(db, 'internal_audit_logs')), {
            actor_uid: null,
            actor_username: 'fluxyos admin',
            actor_role: 'internal_admin',
            action: 'voucher.delete',
            target_user_id: 'TESTDELB',
            before: { status: 'active', discount_value: 20, redemption_count: 0 },
            after: null,
            reason: null,
            source: 'internal_dashboard',
            created_at: serverTimestamp()
        });
        return batch.commit();
    });

    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('Test runner crashed:', err); process.exit(1); });
