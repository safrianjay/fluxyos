'use strict';

// =============================================================================
// FluxyOS — Commerce Integration Platform pipeline checks (Phase 3)
//
// Two tiers in one file:
//   PURE   (always): crypto round-trip/tamper/rotation, OAuth state
//          sign/verify/expiry, model validation + netRevenue invariant,
//          finance-map fixtures (ids, amounts, decomposition identity),
//          backoff math, registry env gating, mock webhook HMAC.
//   E2E    (only when FIRESTORE_EMULATOR_HOST is set): mock connector →
//          pipeline.syncWindow → commerce docs + ledger docs, idempotent
//          re-run (zero new ledger writes), auto_post=false review hold,
//          token refresh rotation, job queue transitions + webhook coalesce.
//
// Run pure only:   node tests/commerce-pipeline.check.js
// Run full:        firebase emulators:exec --only firestore \
//                    "node tests/commerce-pipeline.check.js"
// =============================================================================

// Deterministic test env BEFORE requiring the modules.
process.env.COMMERCE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.COMMERCE_STATE_SECRET = 'test-state-secret';
process.env.COMMERCE_MOCK_ENABLED = 'true';

const assert = require('assert');
const path = require('path');
const LIB = path.join(__dirname, '..', 'netlify', 'functions', 'lib', 'commerce');

const crypto = require(path.join(LIB, 'crypto'));
const models = require(path.join(LIB, 'models'));
const financeMap = require(path.join(LIB, 'finance-map'));
const { backoffMs } = require(path.join(LIB, 'jobs'));
const registry = require(path.join(LIB, 'registry'));
const mock = require(path.join(LIB, 'connectors', 'mock'));
const nodeCrypto = require('crypto');

let passed = 0;
let failed = 0;
function check(label, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  PASS  ${label}`);
    } catch (e) {
        failed += 1;
        console.error(`  FAIL  ${label} → ${e.message}`);
    }
}
async function checkAsync(label, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  PASS  ${label}`);
    } catch (e) {
        failed += 1;
        console.error(`  FAIL  ${label} → ${e.message}`);
    }
}

// ---------------------------------------------------------------- PURE tier

console.log('\n— crypto —');
check('token round-trip', () => {
    const { plaintext, keyVersion } = crypto.decryptToken(crypto.encryptToken('secret-token-123'));
    assert.strictEqual(plaintext, 'secret-token-123');
    assert.strictEqual(keyVersion, 'a');
});
check('tampered ciphertext throws', () => {
    const ct = crypto.encryptToken('secret');
    const parts = ct.split(':');
    parts[4] = Buffer.from('tampered!').toString('base64');
    assert.throws(() => crypto.decryptToken(parts.join(':')));
});
check('previous-key fallback (lazy rotation)', () => {
    const oldKey = process.env.COMMERCE_TOKEN_KEY;
    const ct = crypto.encryptToken('rotate-me');
    process.env.COMMERCE_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64'); // new active
    process.env.COMMERCE_TOKEN_KEY_PREVIOUS = oldKey;
    const { plaintext, keyVersion } = crypto.decryptToken(ct);
    assert.strictEqual(plaintext, 'rotate-me');
    assert.strictEqual(keyVersion, 'p'); // signals re-encrypt on next write
    process.env.COMMERCE_TOKEN_KEY = oldKey;
    delete process.env.COMMERCE_TOKEN_KEY_PREVIOUS;
});
check('crypto self-test', () => assert.strictEqual(crypto.selfTest(), true));
check('state sign/verify binds uid+ws+platform', () => {
    const { state } = crypto.signState({ uid: 'u1', workspaceId: 'w1', platform: 'mock' });
    const res = crypto.verifyState(state);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.payload.uid, 'u1');
    assert.strictEqual(res.payload.ws, 'w1');
});
check('state signature tamper rejected', () => {
    const { state } = crypto.signState({ uid: 'u1', workspaceId: 'w1', platform: 'mock' });
    assert.strictEqual(crypto.verifyState(state.slice(0, -4) + 'AAAA').ok, false);
});
check('state expires after TTL', () => {
    const { state } = crypto.signState({ uid: 'u1', workspaceId: 'w1', platform: 'mock' });
    const realNow = Date.now;
    Date.now = () => realNow() + crypto.STATE_TTL_MS + 1000;
    try {
        const res = crypto.verifyState(state);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.reason, 'expired');
    } finally {
        Date.now = realNow;
    }
});

console.log('\n— models / normalization —');
check('toIntIDR coerces marketplace formats', () => {
    assert.strictEqual(models.toIntIDR('Rp12.500'), 12500);
    assert.strictEqual(models.toIntIDR(150000.0), 150000);
    assert.strictEqual(models.toIntIDR(''), null);
});
check('netRevenue invariant rejects inconsistent money', () => {
    const bad = models.validateCommerceTransaction({
        platform: 'mock', shop_id: 's1', order_id: 'o1',
        grossRevenue: 150000, netRevenue: 999999,
    });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.some((e) => /invariant/.test(e)));
});
check('valid commerce transaction passes + cleans', () => {
    const good = models.validateCommerceTransaction({
        platform: 'mock', shop_id: 's1', order_id: 'o1',
        grossRevenue: 150000, discount: 10000, shippingIncome: 12000,
        commissionFee: 7000, platformFee: 2000, paymentFee: 1500,
        affiliateFee: 0, refundAmount: 0, tax: 0, netRevenue: 141500,
    });
    assert.strictEqual(good.ok, true);
    assert.strictEqual(good.value.account_id, 'mock_s1');
});

console.log('\n— finance mapping —');
check('order decomposition: income − fee − refund = netRevenue', () => {
    const tx = models.validateCommerceTransaction({
        platform: 'mock', shop_id: 's1', order_id: 'o2',
        grossRevenue: 90000, discount: 0, shippingIncome: 10000,
        commissionFee: 5400, platformFee: 0, paymentFee: 900,
        affiliateFee: 500, refundAmount: 25000, tax: 0, netRevenue: 68200,
    }).value;
    const entries = financeMap.mapCommerceTransaction(tx, { account: { shop_name: 'Toko Uji' } });
    const byType = Object.fromEntries(entries.map((e) => [e.data.type, e]));
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(byType.income.data.amount, 100000);       // 90000 − 0 + 10000 − 0
    assert.strictEqual(byType.fee.data.amount, 6800);            // 5400 + 0 + 900 + 500
    assert.strictEqual(byType.refund.data.amount, 25000);
    assert.strictEqual(byType.income.data.amount - byType.fee.data.amount - byType.refund.data.amount, tx.netRevenue);
    assert.strictEqual(byType.income.id, 'cm_mock_s1_o2_rev');
    assert.strictEqual(byType.income.data.vendor_name, 'Mock Marketplace — Toko Uji');
    assert.strictEqual(byType.income.data.accounting_status, 'pending'); // journals stay client-swept
    assert.strictEqual(byType.income.data.commerce_account_id, 'mock_s1');
});
check('zero-amount entries are skipped', () => {
    const tx = models.validateCommerceTransaction({
        platform: 'mock', shop_id: 's1', order_id: 'o3',
        grossRevenue: 50000, netRevenue: 50000,
    }).value;
    const entries = financeMap.mapCommerceTransaction(tx, {});
    assert.strictEqual(entries.length, 1); // income only — no fees, no refund
});
check('settlement maps to neutral cash movement', () => {
    const stl = models.validateCommerceSettlement({
        platform: 'mock', shop_id: 's1', settlement_id: 'stl9', amount: 180000, bank: 'BCA', status: 'paid',
    }).value;
    const entries = financeMap.mapSettlement(stl, {});
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].id, 'cm_mock_s1_stl_stl9');
    assert.strictEqual(entries[0].data.type, 'transfer');
    assert.strictEqual(entries[0].data.cash_direction, 'in');
    assert.strictEqual(entries[0].data.cash_source, 'integration');
    assert.strictEqual(entries[0].data.accounting_status, 'excluded'); // no P&L journal
});

console.log('\n— jobs backoff —');
check('exponential backoff with jitter bounds', () => {
    const fixed = () => 0.5; // zero jitter
    assert.strictEqual(backoffMs(1, { rand: fixed }), 60000);
    assert.strictEqual(backoffMs(3, { rand: fixed }), 240000);
    const jittered = backoffMs(2, { rand: () => 1 }); // +20%
    assert.strictEqual(jittered, 144000);
});

console.log('\n— registry gating —');
check('mock connector only registered behind its flag', () => {
    assert.ok(registry.list().includes('mock'));
    assert.strictEqual(registry.isConfigured('mock'), true);
    process.env.COMMERCE_MOCK_ENABLED = 'false';
    assert.ok(!registry.list().includes('mock'));
    assert.strictEqual(registry.get('mock'), null);
    process.env.COMMERCE_MOCK_ENABLED = 'true';
});
check('unknown platform is null / unconfigured', () => {
    assert.strictEqual(registry.get('lazada'), null);
    assert.strictEqual(registry.isConfigured('lazada'), false);
});

console.log('\n— mock webhook HMAC —');
check('valid signature accepted, bad rejected, parse works', () => {
    const body = Buffer.from(JSON.stringify({ shop_id: 'mockshop01', event: 'ORDER_PAID', event_id: 'ev1', order_ids: ['MO-1'] }));
    const sig = nodeCrypto.createHmac('sha256', mock._WEBHOOK_SECRET).update(body).digest('hex');
    assert.strictEqual(mock.verifyWebhook({ headers: { 'x-mock-signature': sig }, rawBody: body }).ok, true);
    const bad = nodeCrypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    assert.strictEqual(mock.verifyWebhook({ headers: { 'x-mock-signature': bad }, rawBody: body }).ok, false);
    const parsed = mock.parseWebhookEvent(body);
    assert.strictEqual(parsed.shopId, 'mockshop01');
    assert.deepStrictEqual(parsed.orderIds, ['MO-1']);
});

// ----------------------------------------------------------------- E2E tier

async function e2e() {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        console.log('\n(E2E skipped — set FIRESTORE_EMULATOR_HOST / run under emulators:exec)');
        return;
    }
    console.log('\n— E2E (Firestore emulator) —');
    // MUST be the same firebase-admin instance the lib modules resolve (root
    // node_modules) — mixing instances breaks FieldValue sentinel recognition.
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ projectId: 'fluxyos' });
    const db = admin.firestore();

    const tokenManager = require(path.join(LIB, 'token-manager'));
    const store = require(path.join(LIB, 'store'));
    const jobs = require(path.join(LIB, 'jobs'));
    const pipeline = require(path.join(LIB, 'pipeline'));

    const WS = 'ws_pipeline_test';
    const ACC = 'mock_mockshop01';

    // Simulate the connect tail (what commerce.js finishConnect does).
    await tokenManager.storeCredentials(db, {
        workspaceId: WS, accountId: ACC, platform: 'mock', shopId: 'mockshop01',
        tokens: {
            accessToken: 'mock-access-seed', refreshToken: 'mock-refresh-seed',
            accessExpiresAt: Date.now() + 4 * 3600 * 1000, refreshExpiresAt: Date.now() + 30 * 24 * 3600 * 1000,
        },
        platformMeta: {},
    });
    await store.upsertAccount(db, WS, {
        platform: 'mock', shop_id: 'mockshop01', shop_name: 'Toko Mock', region: 'ID', currency: 'IDR',
        status: 'connected', auto_post: true, initial_sync: { status: 'done', progress_pct: 100 },
        connected_by: 'test', connected_at: new Date(),
    });
    await store.setShopDirectory(db, { platform: 'mock', shopId: 'mockshop01', workspaceId: WS, accountId: ACC });

    const account = await store.getAccount(db, WS, ACC);
    const since = new Date(Date.UTC(2026, 6, 1));
    const until = new Date(Date.UTC(2026, 6, 2, 23, 59)); // 2 UTC days → 4 orders

    await checkAsync('syncWindow writes commerce docs + ledger', async () => {
        const stats = await pipeline.syncWindow(db, { workspaceId: WS, account, since, until });
        assert.strictEqual(stats.orders, 4);
        assert.strictEqual(stats.refunds, 2);
        assert.strictEqual(stats.settlements, 2);
        // Per day: order1 → rev+fee (2), order2 → rev+fee+refund (3), settlement (1) = 6.
        assert.strictEqual(stats.ledger_writes, 12);
        assert.strictEqual(stats.rejects, 0);
        const orders = await db.collection(`workspaces/${WS}/commerce_orders`).get();
        assert.strictEqual(orders.size, 4);
        const ctx = await db.collection(`workspaces/${WS}/commerce_transactions`).get();
        assert.strictEqual(ctx.size, 4);
        ctx.docs.forEach((d) => assert.strictEqual(d.get('ledger_status'), 'posted'));
        const ledger = await db.collection(`workspaces/${WS}/transactions`).get();
        assert.strictEqual(ledger.size, 12);
        ledger.docs.forEach((d) => {
            assert.strictEqual(d.get('source'), 'commerce');
            assert.strictEqual(d.get('created_via'), 'integration');
            assert.ok(d.get('amount') > 0);
        });
    });

    await checkAsync('re-run is idempotent: zero new ledger writes, no dupes', async () => {
        const stats = await pipeline.syncWindow(db, { workspaceId: WS, account, since, until });
        assert.strictEqual(stats.ledger_writes, 0); // every create() skipped
        const ledger = await db.collection(`workspaces/${WS}/transactions`).get();
        assert.strictEqual(ledger.size, 12);
        const orders = await db.collection(`workspaces/${WS}/commerce_orders`).get();
        assert.strictEqual(orders.size, 4); // upserts, not inserts
    });

    await checkAsync('auto_post=false holds transactions for review', async () => {
        await store.updateAccount(db, WS, ACC, { auto_post: false });
        const held = await store.getAccount(db, WS, ACC);
        const day3 = { since: new Date(Date.UTC(2026, 6, 3)), until: new Date(Date.UTC(2026, 6, 3, 23, 59)) };
        const stats = await pipeline.syncWindow(db, { workspaceId: WS, account: held, ...day3 });
        assert.strictEqual(stats.ledger_writes, 0);
        const heldTx = await db.doc(`workspaces/${WS}/commerce_transactions/mock_mockshop01_MO-20260703-1`).get();
        assert.strictEqual(heldTx.get('ledger_status'), 'pending_review');
        const ledger = await db.collection(`workspaces/${WS}/transactions`).get();
        assert.strictEqual(ledger.size, 12); // unchanged
        await store.updateAccount(db, WS, ACC, { auto_post: true });
    });

    await checkAsync('a forbidden (missing-scope) refunds failure does NOT block orders/ledger', async () => {
        // Regression for the live 2026-07-20 bug: a connector's optional
        // fetch (refunds/settlements) throwing a scope-denial must degrade
        // gracefully — orders still sync and post to the ledger, the gap is
        // logged, and the account is NOT touched (definitely not expired).
        const original = mock.fetchRefunds;
        mock.fetchRefunds = async () => {
            const e = new Error('mock scope denied');
            e.code = 'forbidden';
            throw e;
        };
        try {
            const day5 = { since: new Date(Date.UTC(2026, 6, 5)), until: new Date(Date.UTC(2026, 6, 5, 23, 59)) };
            const acc = await store.getAccount(db, WS, ACC);
            const stats = await pipeline.syncWindow(db, { workspaceId: WS, account: acc, ...day5 });
            assert.strictEqual(stats.refunds, 0, 'refunds fetch was skipped, not attempted');
            assert.strictEqual(stats.orders, 2, 'orders still synced');
            assert.strictEqual(stats.ledger_writes, 6, 'orders still posted to the ledger');
            const errors = await db.collection(`workspaces/${WS}/commerce_sync_errors`)
                .where('code', '==', 'scope_missing_refunds').get();
            assert.ok(errors.size >= 1, 'scope gap was logged');
            const accAfter = await store.getAccount(db, WS, ACC);
            assert.strictEqual(accAfter.status, 'connected', 'account must NOT be expired over a scope gap');
        } finally {
            mock.fetchRefunds = original;
        }
    });

    await checkAsync('expiring token triggers serialized refresh + rotation', async () => {
        const ref = tokenManager.credRef(db, WS, 'mock', 'mockshop01');
        await ref.update({ access_expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 1000) });
        const creds = await tokenManager.getValidCredentials(db, {
            workspaceId: WS, platform: 'mock', shopId: 'mockshop01', connector: mock,
        });
        assert.ok(creds.accessToken.startsWith('mock-access-'));
        assert.notStrictEqual(creds.accessToken, 'mock-access-seed');
        const after = await ref.get();
        assert.ok(after.get('access_expires_at').toMillis() > Date.now() + 3 * 3600 * 1000);
        assert.strictEqual(after.get('refresh_lock_at'), null);
    });

    await checkAsync('job queue: enqueue idempotent, claim/complete/fail, coalesce', async () => {
        const r1 = await jobs.enqueueJob(db, WS, { accountId: ACC, platform: 'mock', type: 'incremental' }, { jobId: 'inc_test_1' });
        const r2 = await jobs.enqueueJob(db, WS, { accountId: ACC, platform: 'mock', type: 'incremental' }, { jobId: 'inc_test_1' });
        assert.strictEqual(r1.created, true);
        assert.strictEqual(r2.created, false); // deterministic id dedupe
        assert.strictEqual(await jobs.hasActiveJob(db, WS, ACC), true);

        const jobRef = jobs.jobsCol(db, WS).doc('inc_test_1');
        const claimed = await jobs.claimJob(db, jobRef);
        assert.ok(claimed && claimed.attempts === 1);
        assert.strictEqual(await jobs.claimJob(db, jobRef), null); // second claim loses

        const { dead } = await jobs.failJob(jobRef, claimed, new Error('transient'));
        assert.strictEqual(dead, false); // retries with backoff
        const pendingAgain = await jobRef.get();
        assert.strictEqual(pendingAgain.get('status'), 'pending');
        assert.ok(pendingAgain.get('next_attempt_at').toMillis() > Date.now());

        const authFail = await jobs.failJob(jobRef, { ...claimed, attempts: 1 }, Object.assign(new Error('invalid_grant'), { code: 'auth' }), { authError: true });
        assert.strictEqual(authFail.dead, true); // auth errors never retry

        const w1 = await jobs.enqueueWebhookJob(db, WS, { accountId: ACC, platform: 'mock', orderIds: ['A'] });
        const w2 = await jobs.enqueueWebhookJob(db, WS, { accountId: ACC, platform: 'mock', orderIds: ['B'] });
        assert.strictEqual(w1.created, true);
        assert.strictEqual(w2.created, false); // coalesced
        assert.strictEqual(w1.id, w2.id);
        const merged = await jobs.jobsCol(db, WS).doc(w1.id).get();
        assert.deepStrictEqual([...merged.get('order_ids')].sort(), ['A', 'B']);
    });

    await checkAsync('webhook log dedupes redeliveries', async () => {
        const body = Buffer.from(JSON.stringify({ shop_id: 'mockshop01', event: 'ORDER_PAID', event_id: 'ev42' }));
        const first = await store.logWebhook(db, WS, { platform: 'mock', shopId: 'mockshop01', eventType: 'ORDER_PAID', eventId: 'ev42', rawBody: body });
        const second = await store.logWebhook(db, WS, { platform: 'mock', shopId: 'mockshop01', eventType: 'ORDER_PAID', eventId: 'ev42', rawBody: body });
        assert.strictEqual(first.duplicate, false);
        assert.strictEqual(second.duplicate, true);
    });

    await checkAsync('shop directory lookup honors disconnected status', async () => {
        assert.ok(await store.lookupShopDirectory(db, 'mock', 'mockshop01'));
        await store.setShopDirectory(db, { platform: 'mock', shopId: 'mockshop01', workspaceId: WS, accountId: ACC, status: 'disconnected' });
        assert.strictEqual(await store.lookupShopDirectory(db, 'mock', 'mockshop01'), null);
    });
}

e2e().then(() => {
    console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
    process.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
