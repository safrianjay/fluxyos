// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Transaction Detail → Journal Information.
 *
 * Single responsibility: Transaction Detail explains the BUSINESS event and links
 * to the journal; Journal Detail explains the ACCOUNTING event. So this card must
 * carry journal metadata and a deep link, and must NOT duplicate journal lines,
 * debits/credits, or totals.
 */

async function openLedgerDrawer(page, rowPatch = null) {
    await page.goto('/ledger.html');
    await page.waitForSelector('#sidebar', { timeout: 30000 });
    await page.waitForFunction(() => Object.keys(window.__ledgerRowMap || {}).length > 0, { timeout: 30000 });
    const info = await page.evaluate((patch) => {
        const rows = Object.values(window.__ledgerRowMap || {});
        const base = rows.find(r => r.journal_ref) || rows[0];
        const row = patch ? { ...base, ...patch } : base;
        window.openTxDetailDrawer(row);
        return { id: row.id, journal_ref: row.journal_ref || null };
    }, rowPatch);
    await page.waitForSelector('#tx-detail-overlay:not(.hidden)', { timeout: 15000 });
    await page.waitForTimeout(1800);
    return info;
}

test('a posted transaction shows journal metadata and deep-links to Journal Detail', async ({ page }) => {
    const bad = [];
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    const info = await openLedgerDrawer(page);
    test.skip(!info.journal_ref, 'no posted transaction in this workspace');

    const card = page.locator('#tx-detail-journal-card');
    await expect(card).toBeVisible();

    // Labels are CSS-uppercased, so innerText returns them in caps — match
    // case-insensitively rather than asserting the authored casing.
    const text = await card.innerText();
    expect(text, 'section label').toMatch(/journal information/i);
    expect(text, 'journal number').toMatch(/JE-\d{4}-\d{6}|Not numbered/i);
    expect(text, 'posting status').toMatch(/posted|draft|reversal|reversed/i);
    expect(text, 'posting method').toMatch(/automatically generated|manual/i);
    expect(text, 'posting date').toMatch(/posting date/i);

    // Deep link to the existing Journal Detail page.
    const href = await card.locator('a').getAttribute('href');
    expect(href, 'must link to Journal Detail').toMatch(/^accounting-journal\.html\?id=.+/);

    // A visual affordance that it opens.
    await expect(card.locator('svg')).toHaveCount(1);

    // Single responsibility: the accounting detail stays on Journal Detail. Check
    // for the things that would actually constitute duplication — a lines table and
    // debit/credit totals — rather than the words, since the card's own helper text
    // legitimately says "debits and credits" while pointing at the journal.
    await expect(card.locator('table'), 'must not render journal lines').toHaveCount(0);
    expect(text, 'must not duplicate journal totals').not.toMatch(/total\s+(debit|credit)/i);
    // No bare money amounts: the card carries metadata, not figures.
    expect(text, 'must not duplicate journal amounts').not.toMatch(/Rp[\d.,]/);

    expect(bad, `page errors:\n${bad.join('\n')}`).toEqual([]);
});

test('the deep link opens the matching Journal Detail page', async ({ page }) => {
    const info = await openLedgerDrawer(page);
    test.skip(!info.journal_ref, 'no posted transaction in this workspace');

    const href = await page.locator('#tx-detail-journal-card a').getAttribute('href');
    const number = (await page.locator('#tx-detail-journal-card').innerText()).match(/JE-\d{4}-\d{6}/)?.[0];

    await page.goto('/' + href);
    await page.waitForSelector('#sidebar', { timeout: 30000 });
    await page.waitForTimeout(2500);
    // The journal we linked to is the one that opened.
    if (number) await expect(page.locator('body')).toContainText(number, { timeout: 20000 });
});

test('explains why a journal is absent rather than showing a bare empty state', async ({ page }) => {
    // Never queued, postable type → generic "not generated yet".
    await openLedgerDrawer(page, { journal_ref: null, accounting_status: null, type: 'expense', void_status: null });
    await expect(page.locator('#tx-detail-journal-card'))
        .toContainText('No journal has been generated for this transaction yet.');

    // Queued for the sweep → says so, and says where to post it.
    await openLedgerDrawer(page, { journal_ref: null, accounting_status: 'pending', type: 'expense', void_status: null });
    await expect(page.locator('#tx-detail-journal-card')).toContainText('queued for posting');

    // Deliberately outside the IDR kernel.
    await openLedgerDrawer(page, { journal_ref: null, accounting_status: 'excluded', type: 'expense', void_status: null });
    await expect(page.locator('#tx-detail-journal-card')).toContainText('outside the IDR ledger');

    // A type the posting engine never posts.
    await openLedgerDrawer(page, { journal_ref: null, accounting_status: null, type: 'transfer', void_status: null });
    await expect(page.locator('#tx-detail-journal-card')).toContainText('do not post to the ledger');
});
