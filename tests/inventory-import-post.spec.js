const { test, expect } = require('@playwright/test');

// The WRITE path — `DataService.importInventoryItems` — against the real QA
// workspace, in the same style as inventory-cogs.spec.js.
//
// This is the part of the feature that touches money:
//
//   opening stock   Dr 1200 Inventory / Cr 3900 Opening Balance Equity
//
// It is the first caller of `buildOpeningJournal`, which shipped with the chart
// and had never run. Everything it can get wrong is silent — a journal that
// balances but credits the wrong account, movements that do not sum to what
// 1200 was debited, two journals sharing one number, a second run doubling the
// stock. None of those throw; they just leave the books wrong.
//
// Items and journals cannot be deleted (`allow delete: if false` — they are
// referenced by immutable movements and lines), so this leaves tagged rows
// behind, same convention as the COGS spec.

test.describe.configure({ timeout: 150_000 });

test('an import creates the items, posts one opening journal, and ties 1200 to the subledger', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const tag = `QA-IMP-${Date.now()}`;
        const out = { error: null };
        try {
            // Today's month is always open, so the import is not at the mercy of
            // whichever periods the QA workspace happens to have closed.
            const now = new Date();
            const dayKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), '01'].join('-');

            const draft = (name, extra) => Object.assign({
                name, type: 'stock', base_unit: 'g', units: [],
                sku: `${name.replace(/\s+/g, '')}`,
                track_stock: true, tracking_type: 'qty',
                is_sold: false, is_purchased: true,
                default_cogs_account_code: '5100'
            }, extra || {});

            const result = await ds.importInventoryItems(uid, {
                rows: [
                    // 1.000 g at Rp250 = Rp250.000
                    {
                        draft: draft(`${tag} Kopi`, {
                            barcode: '8991234567890',
                            categories: ['Bahan Baku', 'Kopi'],
                            default_inventory_account_code: '1200',
                            source_account_codes: { cogs: '5-50000' },
                            custom_fields: { 'asal daerah': 'Aceh' },
                            reorder_point: 2000
                        }),
                        opening: { quantity: 1000, unit_price_minor: 250, amount_minor: 250000, date_key: dayKey }
                    },
                    // 500 g at Rp100 = Rp50.000, SAME date -> must share one journal.
                    {
                        draft: draft(`${tag} Gula`),
                        opening: { quantity: 500, unit_price_minor: 100, amount_minor: 50000, date_key: dayKey }
                    },
                    // No opening balance at all.
                    { draft: draft(`${tag} Garam`, { track_stock: false, tracking_type: null }), opening: null }
                ]
            });

            const items = await ds.getItems(uid, { includeArchived: true });
            const mine = items.filter((i) => String(i.name || '').startsWith(tag));
            const kopi = mine.find((i) => i.name.endsWith('Kopi'));
            const garam = mine.find((i) => i.name.endsWith('Garam'));

            // getJournalById, NOT a guarded optional call: an accessor that does
            // not exist would leave `journal` null and quietly skip the only
            // assertions that check WHICH accounts were posted. A test that
            // passes by not looking is worse than no test.
            const journal = await ds.getJournalById(uid, result.journals[0].id);

            const onHand = await ds.getStockOnHand(uid, {});

            out.created = result.totals.items;
            out.journalCount = result.journals.length;
            out.journalAmount = result.journals[0].amount;
            out.journalNumbers = result.journals.map((j) => j.journal_number);
            out.itemCount = mine.length;
            // The template fields must survive the write untouched.
            out.kopi = {
                barcode: kopi.barcode,
                categories: kopi.categories,
                track_stock: kopi.track_stock,
                tracking_type: kopi.tracking_type,
                reorder_point: kopi.reorder_point,
                sourceCogs: (kopi.source_account_codes || {}).cogs,
                custom: (kopi.custom_fields || {})['asal daerah'],
                batch: kopi.import_batch_id
            };
            out.garamTracked = garam.track_stock;
            out.kopiOnHand = onHand[kopi.id] ? onHand[kopi.id].quantity : null;
            out.kopiValue = onHand[kopi.id] ? onHand[kopi.id].value : null;
            out.journal = journal ? {
                debit: journal.total_debit, credit: journal.total_credit,
                balanced: journal.is_balanced, rule: journal.posting_rule_id,
                accounts: (journal.lines || []).map((l) => `${l.account_code}:${l.debit}/${l.credit}`).sort()
            } : null;

            // Re-running the SAME file must not double the stock.
            const second = await ds.importInventoryItems(uid, {
                rows: [{ draft: draft(`${tag} Kopi`), opening: { quantity: 1000, unit_price_minor: 250, amount_minor: 250000, date_key: dayKey } },
                    { draft: draft(`${tag} Baru`), opening: null }]
            }).catch((e) => ({ error: e.message }));
            out.secondCreated = second.totals ? second.totals.items : null;
            out.secondSkipped = second.skipped ? second.skipped.length : null;
            const onHand2 = await ds.getStockOnHand(uid, {});
            out.kopiOnHandAfterRerun = onHand2[kopi.id] ? onHand2[kopi.id].quantity : null;
        } catch (err) {
            out.error = (err && err.message) || String(err);
        }
        return out;
    });

    expect(r.error).toBeNull();

    // Three items in, three items created.
    expect(r.created).toBe(3);
    expect(r.itemCount).toBe(3);

    // Two opening balances on ONE date share ONE journal — and one journal
    // number. Numbering them per-journal hands them the same number silently.
    expect(r.journalCount).toBe(1);
    expect(r.journalAmount).toBe(300000);
    expect(new Set(r.journalNumbers).size).toBe(r.journalNumbers.length);

    // The journal itself: balanced, and crediting 3900 rather than 2050 GRNI.
    // Nobody is owed for stock the business already had.
    expect(r.journal).not.toBeNull();
    expect(r.journal.balanced).toBe(true);
    expect(r.journal.debit).toBe(300000);
    expect(r.journal.credit).toBe(300000);
    expect(r.journal.rule).toBe('OPENING');
    expect(r.journal.accounts).toEqual(['1200:300000/0', '3900:0/300000']);

    // The subledger agrees with what 1200 was debited: 1.000 g worth Rp250.000.
    expect(r.kopiOnHand).toBe(1000);
    expect(r.kopiValue).toBe(250000);

    // Every template field survived the write.
    expect(r.kopi.barcode).toBe('8991234567890');
    expect(r.kopi.categories).toEqual(['Bahan Baku', 'Kopi']);
    expect(r.kopi.track_stock).toBe(true);
    expect(r.kopi.tracking_type).toBe('qty');
    expect(r.kopi.reorder_point).toBe(2000);
    // The client's own unresolvable code is kept beside ours, never mangled.
    expect(r.kopi.sourceCogs).toBe('5-50000');
    expect(r.kopi.custom).toBe('Aceh');
    expect(r.kopi.batch).toMatch(/^imp_/);
    // Untrack survives as a real flag, not a default.
    expect(r.garamTracked).toBe(false);

    // Re-running the same file creates only what is new and skips the rest —
    // and, critically, does NOT post the opening balance a second time.
    expect(r.secondCreated).toBe(1);
    expect(r.secondSkipped).toBe(1);
    expect(r.kopiOnHandAfterRerun).toBe(1000);
});

test('an opening balance in a closed period is refused, and nothing is written', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const auth = getAuth(app);
        const user = auth.currentUser || await new Promise((res) => {
            const un = onAuthStateChanged(auth, (u) => { if (u) { un(); res(u); } });
        });
        const uid = user.uid;
        const ds = new DataService(app);
        ds.actorUid = uid;

        const tag = `QA-IMPCLOSED-${Date.now()}`;
        const out = {};
        // A period this workspace has actually closed, if there is one. With no
        // closed period the assertion below is skipped rather than faked.
        const periods = await ds.listPeriods(uid);
        const closed = periods.find((p) => p.status === 'closed' || p.status === 'locked');
        out.closedKey = closed ? closed.period_key : null;
        if (!closed) return out;

        try {
            await ds.importInventoryItems(uid, {
                rows: [{
                    draft: { name: `${tag} Item`, type: 'stock', base_unit: 'g', units: [], sku: tag },
                    opening: { quantity: 10, unit_price_minor: 100, amount_minor: 1000, date_key: `${closed.period_key}-15` }
                }]
            });
            out.threw = false;
        } catch (err) {
            out.threw = true;
            out.code = err && err.code;
        }
        // The refusal must happen BEFORE anything is staged.
        const items = await ds.getItems(uid, { includeArchived: true });
        out.leaked = items.some((i) => String(i.name || '').startsWith(tag));
        return out;
    });

    test.skip(!r.closedKey, 'the QA workspace has no closed period to test against');
    expect(r.threw).toBe(true);
    // A closed period is a refusal, never a silent re-date to today.
    expect(String(r.code || '')).toMatch(/PERIOD/);
    // And the items must not exist: the check runs in front of the batch.
    expect(r.leaked).toBe(false);
});
