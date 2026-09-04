const { test, expect } = require('@playwright/test');

// Two first-load glitches reported after a KYC approval, both real and both
// with the same shape: something painted before the thing that sizes or decides
// it had run.

test.describe.configure({ timeout: 150_000 });

test('sidebar icons have an intrinsic size, so a slow Tailwind cannot inflate them', async ({ page }) => {
    // App pages load Tailwind from the CDN, which GENERATES its CSS at runtime.
    // Until it does, `w-3 h-3` styles nothing and an SVG with no width/height
    // attribute paints at its intrinsic replaced size — measured at 163x163 for
    // the entity-switcher chevron, which is the "big dropdown icon" reported.
    // Blocking the CDN reproduces that window deterministically.
    await page.route('**cdn.tailwindcss.com**', (r) => r.abort());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard.html');
    await page.waitForSelector('.entity-chevron', { timeout: 40000 });

    const sizes = await page.evaluate(() => {
        const out = {};
        const chevron = document.querySelector('.entity-chevron');
        const r = chevron.getBoundingClientRect();
        out.chevron = [Math.round(r.width), Math.round(r.height)];
        // Nothing in the sidebar may exceed its intended box without Tailwind.
        out.oversized = Array.from(document.querySelectorAll('#sidebar svg'))
            .filter((s) => {
                const b = s.getBoundingClientRect();
                return b.width > 48 || b.height > 48;
            })
            .map((s) => s.getAttribute('class') || '(no class)');
        return out;
    });

    expect(sizes.chevron).toEqual([12, 12]);
    // The logo is deliberately fluid; everything else is pinned by attribute.
    expect(sizes.oversized).toEqual([]);
});

test('the KYC gate decides once per page load, not once per caller', async ({ page }) => {
    // The gate has TWO callers on the dashboard: onboarding-gate.applyToPage(),
    // which every app page awaits, and sidebar-loader.js, the catch-all for the
    // fifteen pages that never call it. Deciding twice means two independent
    // pairs of Firestore reads that can DISAGREE — the first opens the page, the
    // dashboard paints, and the second drops a review screen over it.
    await page.goto('/dashboard.html');
    await page.waitForFunction(() => window.FluxyKycGate, { timeout: 40000 });

    const r = await page.evaluate(async () => {
        const gate = window.FluxyKycGate;
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const user = getAuth(getApps()[0]).currentUser;
        // Two callers, same tick — exactly what the dashboard does.
        const [a, b] = await Promise.all([gate.applyToPage(user), gate.applyToPage(user)]);
        // …and a third, later, which must also reuse the verdict.
        const c = await gate.applyToPage(user);
        return { a, b, c, same: a === b && b === c };
    });

    // Whatever the verdict is for this account, all three callers get the SAME
    // one. Disagreement is the bug; the value itself is not the point.
    expect(r.same).toBe(true);
});

test('an approved account is never shown a review screen', async ({ page }) => {
    // The end-to-end assertion behind both fixes: the QA account is approved, so
    // a normal dashboard load must never paint the lock — not even briefly.
    const seen = [];
    await page.goto('/dashboard.html');
    // Poll across the whole boot, because the reported symptom was a FLASH: a
    // single check after load would miss a screen that appeared and vanished.
    for (let i = 0; i < 40; i++) {
        seen.push(await page.locator('[data-fluxy-kyc]').count());
        await page.waitForTimeout(150);
    }
    expect(Math.max(...seen)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains('fluxy-kyc-lock'))).toBe(false);
});
