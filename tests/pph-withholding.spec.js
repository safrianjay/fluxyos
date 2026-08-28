const { test, expect } = require('@playwright/test');

// PPh withholding on a vendor bill.
//
// The posting already existed — `buildTaxAppendix` grafts a 2110 line onto
// BILL-ACCRUE from `withholding_rate`. What did not exist was any way to know
// the rate: the drawer asked for "PPh withholding (%)" as a bare number, so the
// person recording the bill had to already know whether jasa konsultasi is 2%
// or 15%. A mistyped rate is invisible — it posts a smaller liability, the bill
// still balances, and nothing says the withholding was short.
//
// These tests are about the rates being RIGHT and the arithmetic being VISIBLE.

test.describe.configure({ timeout: 150_000 });

async function openBillDrawer(page) {
    await page.goto('/bill');
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.showAddTransactionModal({
        title: 'Add Bill', submitLabel: 'Save Bill', context: 'bill', defaultCategory: 'Operations'
    }));
    await page.waitForSelector('#tx-bill-wht-object', { timeout: 20000 });
    await page.waitForFunction(
        () => document.querySelectorAll('#tx-bill-wht-object option').length > 1,
        undefined, { timeout: 20000 }
    );
}

test('the rate table matches the published DJP rates', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/pph-objects.js');
        const rate = (id) => m.pphObject(id).rate;
        return {
            jasa: rate('PPH23_JASA'),
            sewa: rate('PPH23_SEWA'),
            dividen: rate('PPH23_DIVIDEN'),
            sewaTB: rate('PPH42_SEWA_TB'),
            konKecil: rate('PPH42_KONSTRUKSI_KECIL'),
            konMenengah: rate('PPH42_KONSTRUKSI_MENENGAH'),
            konTanpa: rate('PPH42_KONSTRUKSI_TANPA'),
            konPerancang: rate('PPH42_KONSTRUKSI_PERANCANG'),
            pph26: rate('PPH26_UMUM'),
            // No-NPWP doubles PPh 23 and does NOT apply to final PPh 4(2).
            jasaNoNpwp: m.effectiveRate('PPH23_JASA', { hasNpwp: false }),
            sewaTBNoNpwp: m.effectiveRate('PPH42_SEWA_TB', { hasNpwp: false })
        };
    });

    expect(r.jasa).toBe(2);
    expect(r.sewa).toBe(2);
    expect(r.dividen).toBe(15);
    expect(r.sewaTB).toBe(10);
    // Jasa konstruksi is four rates by certification — not one number.
    expect(r.konKecil).toBe(1.75);
    expect(r.konMenengah).toBe(2.65);
    expect(r.konTanpa).toBe(4);
    expect(r.konPerancang).toBe(6);
    expect(r.pph26).toBe(20);

    // The most common silent error in Indonesian withholding: a vendor with no
    // NPWP is withheld at double, and forgetting it leaves the company owing the
    // difference at audit.
    expect(r.jasaNoNpwp.rate).toBe(4);
    expect(r.jasaNoNpwp.surcharged).toBe(true);
    // PPh 4(2) is final at a fixed rate regardless — no surcharge.
    expect(r.sewaTBNoNpwp.rate).toBe(10);
    expect(r.sewaTBNoNpwp.surcharged).toBe(false);
});

test('the fields it writes are the ones the posting engine already reads', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/pph-objects.js');
        return {
            withNpwp: m.withholdingFieldsFor('PPH23_JASA', { hasNpwp: true }),
            without: m.withholdingFieldsFor('PPH23_JASA', { hasNpwp: false })
        };
    });
    // buildTaxAppendix reads withholding_rate and nothing else to size the 2110
    // line; withholding_code is what the Tax Center and the Bukti Potong export
    // group by. Renaming either silently detaches the picker from the posting.
    expect(r.withNpwp.withholding_rate).toBe(2);
    expect(r.withNpwp.withholding_code).toBe('PPH23');
    expect(r.withNpwp.withholding_type).toContain('PPh 23');
    expect(r.without.withholding_rate).toBe(4);
});

test('choosing what the payment IS fills the rate, and says what will be paid', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error' && !/sendOobCode|favicon/i.test(m.text())) errors.push(m.text());
    });

    await openBillDrawer(page);

    // Every option names the object AND its rate, so the choice is checkable
    // without opening a hint.
    const options = await page.locator('#tx-bill-wht-object option').allTextContents();
    expect(options.length).toBeGreaterThan(10);
    expect(options.some((o) => /PPh 23 · Jasa lainnya \(2%\)/.test(o))).toBe(true);
    expect(options.some((o) => /PPh 4\(2\) Final · Sewa tanah & bangunan \(10%\)/.test(o))).toBe(true);

    await page.fill('#tx-amount', '10000000');
    await page.selectOption('#tx-bill-wht-object', 'PPH23_JASA');
    await page.waitForTimeout(400);

    await expect(page.locator('#tx-bill-wht-rate')).toHaveValue('2');
    // The number a person acts on is what the vendor gets, not the percentage.
    const preview = page.locator('#tx-bill-wht-preview');
    await expect(preview).toContainText('Rp200.000');
    await expect(preview).toContainText('Dibayar ke vendor');
    await expect(preview).toContainText('Rp9.800.000');

    expect(errors).toEqual([]);
});

test('no NPWP doubles the rate and explains why it changed', async ({ page }) => {
    await openBillDrawer(page);
    await page.fill('#tx-amount', '10000000');
    await page.selectOption('#tx-bill-wht-object', 'PPH23_JASA');
    await page.waitForTimeout(300);

    await page.uncheck('#tx-bill-wht-npwp');
    await page.waitForTimeout(400);

    await expect(page.locator('#tx-bill-wht-rate')).toHaveValue('4');
    // A rate that doubles with no explanation reads as a bug.
    await expect(page.locator('#tx-bill-wht-preview')).toContainText('tanpa NPWP');
    await expect(page.locator('#tx-bill-wht-preview')).toContainText('Rp9.600.000');
});

test('the NPWP switch is hidden where the surcharge does not apply', async ({ page }) => {
    await openBillDrawer(page);
    await page.selectOption('#tx-bill-wht-object', 'PPH23_JASA');
    await page.waitForTimeout(300);
    await expect(page.locator('#tx-bill-wht-npwp-row')).toBeVisible();

    // PPh 4(2) is final at a fixed rate. A toggle that changes nothing teaches
    // people to ignore the one that matters.
    await page.selectOption('#tx-bill-wht-object', 'PPH42_SEWA_TB');
    await page.waitForTimeout(300);
    await expect(page.locator('#tx-bill-wht-npwp-row')).toBeHidden();
    await expect(page.locator('#tx-bill-wht-rate')).toHaveValue('10');
});

test('the rate stays editable, because two objects cannot be one number', async ({ page }) => {
    await openBillDrawer(page);
    await page.fill('#tx-amount', '100000000');

    // PPh 21 bukan pegawai is DPP 50% × the Pasal 17 scale — 2,5% is only the
    // first bracket, and the field must let somebody correct it upward.
    await page.selectOption('#tx-bill-wht-object', 'PPH21_BUKAN_PEGAWAI');
    await page.waitForTimeout(300);
    await expect(page.locator('#tx-bill-wht-rate')).toHaveValue('2,5');
    await expect(page.locator('#tx-bill-wht-hint')).toContainText('Pasal 17');

    await page.fill('#tx-bill-wht-rate', '7,5');
    await page.waitForTimeout(400);
    // The typed rate drives the preview, not the object's default.
    await expect(page.locator('#tx-bill-wht-preview')).toContainText('Rp7.500.000');
});
