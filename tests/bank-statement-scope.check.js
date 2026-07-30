'use strict';

/**
 * Bank statement extraction — scope check. No network, no Firestore.
 *
 * Guards the regression where every statement upload silently did nothing: the
 * panel creates the draft (and uploads the file) under
 * `workspaces/{workspaceId}/bank_statement_imports/…` via DataService._scope,
 * but the extraction worker looked it up under `users/{uid}/…`, found nothing,
 * and returned 404 before doing any work — the draft stayed `pending` and the
 * panel timed out with the manual-review message.
 *
 * Run: node tests/bank-statement-scope.check.js
 */

const assert = require('assert');
const admin = require('firebase-admin');

const { resolveDraft, detectDuplicates } = require('../netlify/functions/bank-statement-extract-background').__test__;

const UID = 'ownerUid';
const WS = 'wsOwner';
const IMPORT_ID = 'imp123';

// In-memory Admin-SDK double: db.doc(path).get() and a chainable
// db.collection(path).where(...).get().
function makeDb({ docs = {}, colls = {} } = {}) {
    const reads = [];
    const collectionHandle = (path) => {
        const filters = [];
        const handle = {
            where(field, op, value) { filters.push([field, op, value]); return handle; },
            async get() {
                reads.push(path);
                const rows = colls[path] || [];
                const kept = rows.filter((r) => filters.every(([field, op, value]) => {
                    const v = r[field];
                    const ms = v && typeof v.toMillis === 'function' ? v.toMillis() : v;
                    const target = value && typeof value.toMillis === 'function' ? value.toMillis() : value;
                    if (op === '>=') return ms >= target;
                    if (op === '<=') return ms <= target;
                    return true;
                }));
                return { docs: kept.map((r) => ({ id: r.id, data: () => r })) };
            },
        };
        return handle;
    };
    return {
        _reads: reads,
        doc: (path) => ({ async get() { reads.push(path); return { exists: Object.prototype.hasOwnProperty.call(docs, path), data: () => docs[path] }; } }),
        collection: collectionHandle,
    };
}

const pointer = (uid, ws) => ({ [`user_workspaces/${uid}`]: { workspaceIds: [ws], default: ws } });
const draftDoc = { file_name: 'statement.csv', storage_path: `workspaces/${WS}/bank_statement_imports/${IMPORT_ID}/statement.csv` };

let failures = 0;
const check = async (label, fn) => {
    try { await fn(); console.log(`✅ ${label}`); } catch (e) { failures += 1; console.log(`❌ ${label} — ${e.message}`); }
};

async function main() {
    // 1) THE REGRESSION: the draft lives in the workspace scope.
    await check('finds the draft in workspaces/{workspaceId}', async () => {
        const db = makeDb({
            docs: { ...pointer(UID, WS), [`workspaces/${WS}/bank_statement_imports/${IMPORT_ID}`]: draftDoc },
        });
        const got = await resolveDraft(db, UID, IMPORT_ID);
        assert.ok(got, 'draft not found — extraction would 404 and never run');
        assert.strictEqual(got.scope, `workspaces/${WS}`);
        assert.strictEqual(got.data.file_name, 'statement.csv');
    });

    // 2) Owner without a pointer: workspaceId == uid (seeding rule).
    await check('finds the draft via the seeding rule (no pointer)', async () => {
        const db = makeDb({ docs: { [`workspaces/${UID}/bank_statement_imports/${IMPORT_ID}`]: draftDoc } });
        const got = await resolveDraft(db, UID, IMPORT_ID);
        assert.ok(got);
        assert.strictEqual(got.scope, `workspaces/${UID}`);
    });

    // 3) Pre-migration draft still under users/{uid}.
    await check('falls back to the legacy users/{uid} draft', async () => {
        const db = makeDb({ docs: { [`users/${UID}/bank_statement_imports/${IMPORT_ID}`]: draftDoc } });
        const got = await resolveDraft(db, UID, IMPORT_ID);
        assert.ok(got);
        assert.strictEqual(got.scope, `users/${UID}`);
    });

    // 4) Genuinely missing draft still 404s (no silent success).
    await check('returns null when the draft does not exist anywhere', async () => {
        const db = makeDb({ docs: pointer(UID, WS) });
        assert.strictEqual(await resolveDraft(db, UID, IMPORT_ID), null);
    });

    // 5) Duplicate detection reads the ledger the statement belongs to — reading
    // users/{uid} there returns the frozen pre-migration copy, so real duplicates
    // stop being flagged and get imported twice.
    await check('duplicate detection reads the draft’s own scope', async () => {
        const when = new Date('2026-07-21T03:00:00Z');
        const db = makeDb({
            colls: {
                [`workspaces/${WS}/transactions`]: [
                    { id: 'tx1', amount: 150000, type: 'expense', timestamp: admin.firestore.Timestamp.fromDate(when) },
                ],
                [`users/${UID}/transactions`]: [],
            },
        });
        const rows = [{ transaction_date: when, debit: 150000, credit: 0 }];
        await detectDuplicates(db, `workspaces/${WS}`, rows, { statement_start_date: when, statement_end_date: when });
        assert.strictEqual(rows[0]._duplicate, true, 'existing ledger entry was not flagged as a duplicate');
        assert.strictEqual(rows[0]._matched_transaction_id, 'tx1');
        assert.ok(db._reads.includes(`workspaces/${WS}/transactions`), 'did not read the workspace ledger');
        assert.ok(!db._reads.includes(`users/${UID}/transactions`), 'read the frozen legacy ledger');
    });

    console.log(failures === 0 ? '\nBANK STATEMENT SCOPE PASS' : `\nBANK STATEMENT SCOPE FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('check crashed:', e); process.exit(1); });
