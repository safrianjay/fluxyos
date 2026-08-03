const { test, expect } = require('@playwright/test');

// Pure-logic unit tests for the duplicate detection engine
// (docs/DUPLICATE_PREVENTION.md). Same pattern as recon-engine.spec.js —
// import the ESM module in the browser, no I/O.
//
// The suppression cases matter as much as the detection cases: a false positive
// on a monthly subscription or on a re-entry after a void teaches users to click
// through the warning, which costs more than the duplicates it catches.

test('duplicate engine scores records through deterministic tiers', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/duplicate-engine.js');
        const day = (d) => new Date(`2026-06-${String(d).padStart(2, '0')}T05:00:00Z`);
        const tx = (id, over = {}) => ({
            id, amount: 450000, type: 'expense', timestamp: day(10),
            vendor_name: 'PT Sumber Makmur', category: 'Operations', ...over
        });
        const one = (incoming, existing, opts = {}) =>
            e.findDuplicates({ incoming, candidates: [existing], kind: 'transactions', ...opts })[0] || null;

        return {
            // --- D0 identity keys ---------------------------------------
            d0file: one(tx('a', { source_file_hash: 'sha-1' }), tx('b', { source_file_hash: 'sha-1' })),
            d0order: one(
                tx('a', { commerce_order_id: 'o1', commerce_account_id: 'acc1' }),
                tx('b', { commerce_order_id: 'o1', commerce_account_id: 'acc1' })),
            // Same order id but a DIFFERENT marketplace account is not identity.
            d0orderMiss: one(
                tx('a', { commerce_order_id: 'o1', commerce_account_id: 'acc1' }),
                tx('b', { commerce_order_id: 'o1', commerce_account_id: 'acc2', timestamp: day(28) })),

            // --- D1 counterparty document number ------------------------
            // Punctuation is insignificant: vendors write one number many ways.
            d1: one(tx('a', { invoice_number: 'INV/2026/VIII/119' }),
                tx('b', { invoice_number: 'inv-2026-viii-119' })),
            // D1 fires across a DIFFERENT amount — a repeated vendor number with a
            // different figure is a keying error, not two genuine bills.
            d1Vendor: one(tx('a', { invoice_number: 'X99' }),
                tx('b', { invoice_number: 'X99', vendor_name: 'Totally Different Co' })),

            // --- D2/D3/D4/D5/D6 -----------------------------------------
            d2: one(tx('a'), tx('b')),
            d3: one(tx('a'), tx('b', { timestamp: day(13) })),
            d3edge: one(tx('a'), tx('b', { timestamp: day(14) })),
            d4: one(tx('a', { vendor_name: 'Sumber Makmur Jaya' }), tx('b')),
            d5: one(
                tx('a', { vendor_name: 'Andi', notes: 'catering workshop bandung', timestamp: day(15) }),
                tx('b', { vendor_name: 'Budi', notes: 'catering workshop bandung', timestamp: day(10) })),
            d6: one(
                tx('a', { vendor_name: 'Andi', account_code: '6100', timestamp: day(14) }),
                tx('b', { vendor_name: 'Budi', account_code: '6100', timestamp: day(10) })),
            amtMiss: one(tx('a', { amount: 450001 }), tx('b')),

            // --- Suppression --------------------------------------------
            // A monthly subscription renewal sharing a vendor reference.
            recurring: one(tx('a', { invoice_number: 'SUB-1', timestamp: day(10) }),
                { ...tx('b', { invoice_number: 'SUB-1' }), timestamp: new Date('2026-05-11T05:00:00Z') }),
            // Transfers between the user's own accounts repeat by design.
            transfer: one(tx('a', { type: 'transfer' }), tx('b', { type: 'transfer' })),
            // Re-entering a corrected version of a voided record must stay silent
            // on the pre-save path...
            voidedHidden: one(tx('a'), tx('b', { is_voided: true })),
            // ...but the cleanup scan opts back in, at a reduced score.
            voidedShown: one(tx('a'), tx('b', { is_voided: true }), { includeVoided: true }),
            // A bill and the transaction that settled it are one flow, not two.
            linked: one(tx('a'), tx('b', { linked_transaction_id: 'a' })),
            // A decision already recorded for this pair is never re-asked.
            decided: one(tx('a'), tx('b'), { decisions: { [e.pairKey('a', 'b')]: 'kept_both' } }),
            // Digits in a counterparty name are an IDENTIFIER, not noise.
            // "Client 1" and "Client 2" are two customers, however identical the
            // amount and date — regression for the bug the invoices spec caught,
            // where the shared tokenizer stripped the only distinguishing part.
            digitId: one(tx('a', { vendor_name: 'QA Customer 123456' }),
                tx('b', { vendor_name: 'QA Customer 654321' })),
            digitSame: one(tx('a', { vendor_name: 'Toko 88' }), tx('b', { vendor_name: 'Toko 88' })),
            partyKeys: [
                e.normalizeParty('PT. Sumber Makmur'), e.normalizeParty('pt sumber makmur,'),
                e.normalizeParty('Client 1'), e.normalizeParty('Client 2')
            ],
            // A pending decision does NOT suppress — it was never resolved.
            pending: one(tx('a'), tx('b'), { decisions: { [e.pairKey('a', 'b')]: 'pending' } }),

            // --- Instalments are not duplicates --------------------------
            // Two PARTIAL PAYMENTS carry the same invoice number for provenance
            // and differ in amount. Found against real data, where a partially
            // paid invoice reported as a 98% duplicate of itself.
            instalments: one(
                tx('a', { invoice_number: 'INV-202608-0022', amount: 400000 }),
                tx('b', { invoice_number: 'INV-202608-0022', amount: 600000 })),
            // The same collision on an ACCRUAL document IS a keying error: a
            // vendor does not bill two different amounts under one number.
            billNumberClash: e.findDuplicates({
                incoming: { id: 'b1', vendor_name: 'PT Sumber', invoice_number: 'V-9', amount: 400000, due_date: day(10) },
                candidates: [{ id: 'b2', vendor_name: 'PT Sumber', invoice_number: 'V-9', amount: 600000, due_date: day(10) }],
                kind: 'bills'
            })[0],
            // Two payments settling the same bill are instalments by definition.
            sameBill: one(tx('a', { linked_bill_id: 'bill-1', amount: 300000 }),
                tx('b', { linked_bill_id: 'bill-1', amount: 300000 })),

            // --- Bands ---------------------------------------------------
            bands: [e.classifyBand(100), e.classifyBand(90), e.classifyBand(75),
                e.classifyBand(60), e.classifyBand(30), e.classifyBand(10)],

            // --- Per-kind field mapping ----------------------------------
            // Invoices key on customer_name/total_amount/issue_date, and our own
            // invoice_number series colliding is an integrity failure (D0).
            invoiceDup: e.findDuplicates({
                incoming: { id: 'i1', customer_name: 'PT Klien', total_amount: 9000000, issue_date: day(10) },
                candidates: [{ id: 'i2', customer_name: 'PT Klien', total_amount: 9000000, issue_date: day(10) }],
                kind: 'invoices'
            })[0],
            invoiceNumberClash: e.findDuplicates({
                incoming: { id: 'i1', invoice_number: 'INV-202606-0001', customer_name: 'A', total_amount: 1 },
                candidates: [{ id: 'i2', invoice_number: 'INV-202606-0001', customer_name: 'B', total_amount: 2 }],
                kind: 'invoices'
            })[0],

            // --- Ranking + pairwise scan ---------------------------------
            ranked: e.findDuplicates({
                incoming: tx('a'),
                candidates: [tx('weak', { vendor_name: 'Andi', account_code: '6100', timestamp: day(14) }),
                    tx('strong')],
                kind: 'transactions'
            }).map((m) => m.existing_id),
            scan: e.scanForDuplicates({
                records: [tx('old', { timestamp: day(5) }), tx('new', { timestamp: day(5) }), tx('lonely', { amount: 7 })],
                kind: 'transactions'
            }),
            explain: e.explain(one(tx('a'), tx('b')))
        };
    });

    // D0 — identity is certain and blocking.
    expect(r.d0file.rule).toBe('D0');
    expect(r.d0file.score).toBe(100);
    expect(r.d0file.band).toBe('high');
    expect(r.d0order.rule).toBe('D0');
    expect(r.d0orderMiss).toBeNull();

    // D1 — the vendor's document number, compared on significant chars only.
    expect(r.d1.rule).toBe('D1');
    expect(r.d1.evidence[0]).toContain('already exists');
    // Different vendor → the number alone is not enough.
    expect(r.d1Vendor).toBeNull();

    // D2–D6 tiers and their windows.
    expect(r.d2.rule).toBe('D2');
    expect(r.d2.band).toBe('high');
    expect(r.d3.rule).toBe('D3');
    expect(r.d3.band).toBe('medium');
    expect(r.d3edge).toBeNull();       // 4 days apart, past NEAR_DATE_WINDOW_DAYS
    expect(r.d4.rule).toBe('D4');
    expect(r.d5.rule).toBe('D5');
    expect(r.d6.rule).toBe('D6');
    expect(r.d6.band).toBe('low');
    expect(r.amtMiss).toBeNull();

    // Suppression.
    expect(r.recurring).toBeNull();
    expect(r.transfer).toBeNull();
    expect(r.voidedHidden).toBeNull();
    expect(r.voidedShown.score).toBe(r.d2.score - 15);
    expect(r.linked).toBeNull();
    expect(r.decided).toBeNull();
    expect(r.pending).not.toBeNull();
    // Differing identifiers → different counterparties, no flag.
    expect(r.digitId).toBeNull();
    // The same identifier on both sides still matches.
    expect(r.digitSame.rule).toBe('D2');
    // Legal-form noise collapses; identifiers do not.
    expect(r.partyKeys[0]).toBe(r.partyKeys[1]);
    expect(r.partyKeys[2]).not.toBe(r.partyKeys[3]);

    // Instalments: same document number, different amounts, on a ledger
    // transaction → normal partial payment, not a duplicate.
    expect(r.instalments).toBeNull();
    // The same collision on a bill is still a keying error.
    expect(r.billNumberClash.rule).toBe('D1');
    // Two settlements of one bill are never duplicates of each other.
    expect(r.sameBill).toBeNull();

    expect(r.bands).toEqual(['high', 'high', 'medium', 'medium', 'low', 'none']);

    // Per-kind mapping.
    expect(r.invoiceDup.rule).toBe('D2');
    expect(r.invoiceNumberClash.rule).toBe('D0');

    // Strongest match first.
    expect(r.ranked[0]).toBe('strong');
    // Pairwise scan pairs the two matching records and leaves the third alone.
    expect(r.scan.groups).toHaveLength(1);
    expect([r.scan.groups[0].primary_id, r.scan.groups[0].duplicate_id].sort()).toEqual(['new', 'old']);
    expect(r.scan.scanned).toBe(3);

    expect(r.explain).toContain('% match');
});

// Phase 2 — the Accounting Center cleanup surface. Verifies the section mounts,
// the scan runs against the real workspace, and the resolution controls the
// accounting rules allow are the ones actually offered.
test('Accounting Center exposes a duplicate review in Cleanup', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto('/accounting');
    await page.waitForTimeout(2500);
    if (await page.locator('[data-fluxy-paywall]').count()) {
        test.skip(true, 'QA account is paywalled (expired trial).');
    }

    // Close group → Cleanup view.
    await page.locator('[data-acct-group="close"]').click();
    await page.locator('[data-acct-tab="cleanup"]').click();

    const section = page.locator('[data-acct-panel="cleanup"]');
    await expect(section).toBeVisible();
    await expect(page.locator('#duplicate-review-content')).toBeVisible();
    await expect(page.locator('#dup-rescan-btn')).toBeVisible();

    // The scan is lazy — it starts when the tab opens. Wait for it to settle
    // into either a result list or its empty state.
    await expect(page.locator('#duplicate-review-content')).not.toContainText('Scanning', { timeout: 20_000 });

    const groups = page.locator('[data-dup-group]');
    if (await groups.count()) {
        const first = groups.first();
        // Posted records are voided, never deleted — Firestore denies the delete
        // outright, so offering one would be a lie.
        await expect(first.locator('[data-dup-action="void"]')).toBeVisible();
        await expect(first.locator('[data-dup-action="valid"]')).toBeVisible();
        await expect(first.locator('[data-dup-action="ignored"]')).toBeVisible();
        await expect(first.locator('button:has-text("Delete")')).toHaveCount(0);
    } else {
        await expect(page.locator('#duplicate-review-content')).toContainText(/No duplicates found|Could not scan/);
    }

    // A rescan must not throw.
    await page.locator('#dup-rescan-btn').click();
    await expect(page.locator('#duplicate-review-content')).not.toContainText('Scanning', { timeout: 20_000 });

    expect(errors.filter(e => /duplicate/i.test(e))).toEqual([]);
});
