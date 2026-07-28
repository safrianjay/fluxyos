// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Regression guard: acting before Firebase Auth rehydrates.
 *
 * Firebase restores the signed-in user from IndexedDB asynchronously — ~0.4s on
 * a warm local machine, longer on a cold or slow device. Code that reads
 * `auth.currentUser` synchronously inside that window sees `null` and, if it
 * fails hard, tells a signed-in user to sign in again *and discards what they
 * were doing*. The fix everywhere is to `await auth.authStateReady()` first; it
 * resolves immediately when genuinely signed out, so the real guard still fires.
 *
 * Test 1 is deterministic: it swaps in an auth double whose `currentUser` stays
 * null until `authStateReady()` resolves, so the assertion is exactly "does this
 * code path wait?" — it fails reliably if the await is removed.
 *
 * Test 2 races real timing because getTransactionDataService calls getAuth()
 * itself and cannot be injected. On a warm profile auth sometimes restores
 * before the page is interactive; the window then does not exist and the test
 * skips rather than passing vacuously or failing spuriously.
 *
 * Same fix applied by inspection to getAuthToken in ai-chat.js and
 * ai-command-center.js (both need a composed prompt to trigger, so they are not
 * driven here).
 */

const JPEG_BYTES = [0xFF, 0xD8, 0xFF, 0xDB];

test('scan waits for auth rehydration before calling the extract API', async ({ page }) => {
    await page.route('**/api/v1/bills/extract', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            ok: true,
            extraction_source: 'mock',
            data: {
                document_type: 'receipt', vendor_name: 'Race Vendor', amount: 1000,
                category: 'Operations', confidence: { overall: 0.9 }, warnings: []
            }
        })
    }));

    await page.goto('/ledger.html');
    await page.waitForFunction(() => !!window.__fluxyTxContext?.auth?.currentUser, null, { timeout: 30_000 });

    // Auth double: reproduces the un-rehydrated state deterministically.
    // currentUser reads null until authStateReady() has resolved.
    await page.evaluate(() => {
        const real = window.__fluxyTxContext;
        const realUser = real.auth.currentUser;
        let restored = false;
        window.__authDouble = { readyCalls: 0 };
        window.__fluxyTxContext = Object.assign({}, real, {
            auth: {
                get currentUser() { return restored ? realUser : null; },
                authStateReady() {
                    window.__authDouble.readyCalls += 1;
                    return new Promise((resolve) => setTimeout(() => { restored = true; resolve(); }, 250));
                }
            }
        });
    });

    await page.evaluate((bytes) => {
        const f = new File([new Uint8Array(bytes)], 'race.jpg', { type: 'image/jpeg' });
        window.openScanDrawerWithFile('transaction', f, {});
    }, JPEG_BYTES);
    await page.locator('#scan-start-btn').click();

    // Without the await, currentUser is null at read time → UNAUTHENTICATED →
    // the drawer shows the "session expired" error step instead of review.
    await expect(page.locator('#scan-review-form')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#scan-drawer')).not.toContainText(/session expired|sign in again/i);
    expect(await page.evaluate(() => window.__authDouble.readyCalls),
        'the scan path must consult authStateReady').toBeGreaterThan(0);
});

test('Add Transaction submitted before auth rehydrates saves instead of "session expired"', async ({ page }) => {
    const vendor = `Race tx ${Date.now()}`;

    await page.addInitScript((v) => {
        window.__race2 = { currentUserAtFire: 'unset', fired: false };
        const setValue = (el, value) => {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const tick = () => {
            if (typeof window.showAddTransactionModal === 'function' && document.body) {
                const auth = window.__fluxyTxContext?.auth || window.__fluxyBillsContext?.auth;
                window.showAddTransactionModal({});
                const fill = () => {
                    const amount = document.getElementById('tx-amount');
                    const vend = document.getElementById('tx-vendor');
                    const btn = document.getElementById('tx-submit-btn');
                    if (!amount || !vend || !btn) { requestAnimationFrame(fill); return; }
                    setValue(amount, '77000');
                    setValue(vend, v);
                    if (btn.disabled) { requestAnimationFrame(fill); return; }
                    window.__race2.currentUserAtFire = auth?.currentUser?.uid ?? null;
                    window.__race2.fired = true;
                    btn.click();
                };
                requestAnimationFrame(fill);
                return;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, vendor);

    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.__race2?.fired === true, null, { timeout: 30_000 });
    const race = await page.evaluate(() => window.__race2);

    // Warm profiles can rehydrate auth before the drawer is interactive. When
    // that happens there is no race to observe — skip rather than assert
    // something this run cannot actually prove.
    test.skip(race.currentUserAtFire !== null, 'auth rehydrated before submit — no race window this run');

    // The drawer closes only on a successful save.
    await expect(page.locator('#global-tx-modal')).toHaveCount(0, { timeout: 30_000 });
});
