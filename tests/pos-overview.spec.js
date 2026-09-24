const { test, expect } = require('@playwright/test');

const stamp = (iso) => iso;

test('POS Overview renders verified metrics, honest gaps, drill-downs and mobile layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/pos?view=overview');
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
    await expect(page.locator('.pos-overview-kpi').nth(0)).toContainText('Rp70.000');
    await expect(page.locator('.pos-overview-kpi').nth(1)).toContainText('1');
    await expect(page.getByText('Unavailable — no visitor source')).toBeVisible();
    await expect(page.getByText('Recorded accounting revenue').locator('..')).toContainText('Rp110.000');
    await expect(page.locator('.pos-overview-chart-table')).toBeVisible();

    await page.getByRole('button',{name:/Dine-in/}).click();
    await expect(page.locator('.pos-view[data-view="orders"]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('mode')).toBe('dine_in');
    expect(new URL(page.url()).searchParams.get('start')).toBe('2026-09-01');

    await page.setViewportSize({ width:375,height:800 });
    await page.evaluate(() => window.__posSeedOverview({ start:'2026-09-01',end:'2026-09-30',orders:[] }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByText('No completed orders in this period.')).toBeVisible();
});
