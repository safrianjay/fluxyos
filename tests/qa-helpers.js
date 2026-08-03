// @ts-check
/**
 * Shared QA helpers.
 *
 * The shared QA Firebase account runs on a short (3-day) trial that
 * periodically lapses to `expired`. When it does, `assets/js/trial-access.js`
 * renders a full-screen, non-dismissable billing paywall over every
 * authenticated app page, which intercepts all pointer events and breaks any
 * interaction-based spec (filters, drawers, etc.). The paywall is UX-only
 * enforcement and is orthogonal to the feature behavior these specs verify, so
 * tests neutralize it in the browser context. Resetting the trial properly
 * requires Admin SDK access the local harness does not have.
 *
 * Call `installTrialPaywallBypass(page)` in a beforeEach (before the first
 * goto). It runs at document-start on every navigation and continuously strips
 * the paywall overlay + scroll-lock as soon as the guard injects them.
 */
async function installTrialPaywallBypass(page) {
    await page.addInitScript(() => {
        const strip = () => {
            document.querySelectorAll('[data-fluxy-paywall]').forEach((el) => el.remove());
            document.documentElement.classList.remove('fluxy-paywall-lock');
        };
        try {
            const observer = new MutationObserver(strip);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (_) { /* documentElement always exists at document-start, but stay safe */ }
        document.addEventListener('DOMContentLoaded', strip);
    });
}

/**
 * Answer the duplicate review dialog if it appears (docs/DUPLICATE_PREVENTION.md).
 *
 * The shared QA account accumulates records across runs, so a spec that creates
 * a fixture with a recognisable vendor + amount + today's date is now — quite
 * correctly — flagged as a possible duplicate before it saves. Specs that only
 * need the record to exist should call this right after submitting; specs that
 * test the duplicate flow itself should drive the dialog explicitly.
 *
 * Races the dialog against `settled` (the element that disappears on a clean
 * save) rather than waiting a fixed interval: a clean save returns immediately,
 * and a slow candidate query still gets answered. Guessing one timeout can only
 * be too slow for every passing spec or too fast for the one that matters.
 *
 * Chooses "keep both", supplying the written reason the dialog demands when the
 * confidence is high. Returns true if a dialog was answered.
 */
async function dismissDuplicateDialogIfPresent(page, { timeout = 15_000, settled = '#global-tx-modal' } = {}) {
    const dialog = page.locator('#fluxy-dialog.fluxy-dialog--duplicate');
    const pending = page.locator(settled);
    const deadline = Date.now() + timeout;
    let shown = false;
    while (Date.now() < deadline) {
        shown = await dialog.isVisible().catch(() => false);
        if (shown) break;
        if (await pending.count().catch(() => 1) === 0) return false; // saved cleanly
        await page.waitForTimeout(150);
    }
    if (!shown) return false;

    await page.locator('#fluxy-dialog [data-dialog-action="keep_both"]').click();

    // High-confidence pairs require a reason before both records are kept.
    const reason = page.locator('#fluxy-dialog.fluxy-dialog--reason');
    if (await reason.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await page.locator('#fluxy-dialog-reason-select').selectOption({ index: 1 }).catch(() => {});
        await page.locator('#fluxy-dialog [data-dialog-action="confirm"]').click();
    }
    return true;
}

module.exports = { installTrialPaywallBypass, dismissDuplicateDialogIfPresent };
