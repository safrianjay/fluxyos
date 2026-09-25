const { test, expect } = require('./qa-test');

const stamp = (iso) => iso;

test('POS Overview renders verified metrics, honest gaps, drill-downs and mobile layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // The outlet setup prompt is intentionally asynchronous. It is unrelated
    // to the read-only Overview and must not intercept the period controls.
    await page.addLocatorHandler(page.locator('#pos-onboarding:not(.hidden)'), async () => {
        await page.locator('#pos-onboarding-close').click({ force: true });
    });
    await page.goto('/pos?view=overview', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#pos-shell[data-pos-ready="true"]')).toBeVisible({ timeout: 40_000 });
    const setup = page.locator('#pos-onboarding:not(.hidden)');
    if (await setup.isVisible().catch(() => false)) {
        await page.locator('#pos-onboarding-close').click({ force: true });
        await expect(setup).toBeHidden();
    }
    // The host is deliberately hidden for Today, but the shared picker must
    // already be mounted before the Custom interaction is exercised.
    await expect(page.locator('#pos-overview-date [data-drp-trigger]')).toBeAttached();
    await page.waitForFunction(() => typeof window.__posSeedOverview === 'function');
    await page.evaluate(({ paid, refunded }) => window.__posSeedOverview({
        start:'2026-09-01',end:'2026-09-30',
        orders:[{
            id:'sale-1',channel:'staff',table_id:'table-1',status:'paid',paid_at:paid,updated_at:paid,
            subtotal:120000,discount_amount:10000,discount_total:10000,total_amount:122000,
            service_charge_amount:2000,tax_amount:10000,
            lines:[{item_id:'coffee',item_name:'Coffee',quantity:2,gross_amount:120000,discount_amount:0}],
            payments:[{method:'cash',amount:122000,status:'settled'}]
        },{
            id:'refund-1',channel:'staff',table_id:null,status:'paid',paid_at:'2026-08-20T03:00:00Z',refunded_at:refunded,refund_transaction_id:'tx-refund',updated_at:refunded,
            subtotal:40000,discount_amount:0,discount_total:0,total_amount:44000,service_charge_amount:0,tax_amount:4000,
            lines:[{item_id:'tea',item_name:'Tea',quantity:1,gross_amount:40000,discount_amount:0}],payments:[{method:'qris',amount:44000,status:'settled'}]
        }],
        accounting:[{type:'income',amount:110000,pos_order_id:'sale-1'}]
    }), { paid:stamp('2026-09-10T03:00:00Z'), refunded:stamp('2026-09-12T03:00:00Z') });

    await expect(page.locator('#pos-view-title')).toHaveText('POS Overview');
    await expect(page.locator('#pos-overview-date')).toBeHidden();
    await expect(page.locator('#pos-overview-period-selector [data-pos-period="today"]')).toHaveClass(/is-active/);
    await expect(page.locator('#pos-overview-period-selector')).toBeVisible();
    await page.locator('#pos-overview-period-selector [data-pos-period="custom"]').click();
    await expect(page.locator('#pos-overview-date')).toBeVisible();
    await expect(page.locator('#pos-overview-period-selector [data-pos-period="custom"]')).toHaveClass(/is-active/);
    const calendar = page.locator('[data-drp-panel]');
    await expect(calendar).toBeHidden();
    await page.locator('#pos-overview-date [data-drp-trigger]').click();
    await expect(calendar).toBeVisible();
    await page.locator('#pos-view-title').click();
    await expect(calendar).toBeHidden();
    await expect(page.locator('.pos-overview-kpi').nth(0)).toContainText('Rp70.000');
    await page.locator('.pos-overview-kpi .metric-info').first().focus();
    await expect(page.locator('.metric-tooltip.is-visible')).toContainText('Gross merchandise sales');
    await page.locator('.pos-overview-kpi .metric-info').first().blur();
    await page.mouse.move(4, 4);
    await expect(page.locator('.metric-tooltip.is-visible')).toHaveCount(0);
    await page.waitForTimeout(180);
    await expect(page.locator('.pos-overview-kpi').nth(1)).toContainText('1');
    await expect(page.getByText('Unavailable — no visitor source')).toBeVisible();
    await expect(page.getByText('Recorded accounting revenue').locator('..')).toContainText('Rp110.000');
    await expect(page.locator('.pos-overview-chart-table')).not.toBeVisible();
    await expect(page.locator('.pos-overview-bar.is-negative')).toHaveCount(1);
    await page.screenshot({ path: '.qa/pos-overview-desktop.png', fullPage: true });
    await page.getByText('View data', { exact: true }).click();
    await expect(page.locator('.pos-overview-chart-table')).toBeVisible();
    await page.setViewportSize({ width:375,height:800 });
    await page.screenshot({ path: '.qa/pos-overview-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width:1280,height:900 });

    await page.getByRole('button',{name:/Coffee/}).click();
    await expect(page.locator('.pos-view[data-view="orders"]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('product')).toBe('coffee');
    expect(new URL(page.url()).searchParams.get('start')).toBe('2026-09-01');

    await page.setViewportSize({ width:375,height:800 });
    await page.evaluate(() => window.__posSeedOverview({ start:'2026-09-01',end:'2026-09-30',orders:[] }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByText('No completed orders in this period.')).toBeVisible();
});

test('month-long POS trend scrolls within its card at desktop and mobile widths', async ({ page }) => {
    await page.goto('/pos?view=overview', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__posSeedOverview === 'function');
    await page.evaluate(() => window.__posSeedOverview({
        start:'2026-09-01', end:'2026-09-30',
        orders:Array.from({ length:30 }, (_, i) => {
            const amount = 45000 + (i % 7) * 15000;
            return { id:`visual-${i}`, channel:'staff', status:'paid', table_id:i % 2 ? null : 'table-1',
                paid_at:`2026-09-${String(i + 1).padStart(2,'0')}T03:00:00Z`,
                subtotal:amount, total_amount:amount, discount_total:0,
                lines:[{item_id:'coffee',item_name:'Coffee',quantity:1,gross_amount:amount}],
                payments:[{method:'cash',amount,status:'settled'}] };
        })
    }));
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height:900 });
        await expect(page.locator('.pos-overview-column')).toHaveCount(30);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        const scroller = page.locator('.pos-overview-scroll');
        expect(await scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        await page.locator('.pos-overview-stage').scrollIntoViewIfNeeded();
        await page.screenshot({ path:`.qa/pos-overview-month-${width}.png` });
        await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await expect(page.locator('.pos-overview-dates span').last()).toHaveText(/30/);
    }
    await page.getByText('View data', {exact:true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.pos-overview-chart-table tbody tr')).toHaveCount(30);
    await expect(page.locator('.pos-overview-chart-table')).toBeVisible();
});
