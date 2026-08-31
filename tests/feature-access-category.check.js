// =============================================================================
// Business-category eligibility — precedence between category and allowlist.
//
// `tests/feature-access.spec.js` covers the browser directions: an eligible
// workspace sees the nav, an ineligible one does not. It cannot cover THIS,
// because the interesting cases all return the same boolean from the outside:
//
//   - an F&B workspace with no allowlisted email must be granted (the new path)
//   - an UNSTAMPED workspace with an allowlisted email must still be granted
//     (the backfill-safety property — the whole reason the two signals are OR'd)
//
// Both are `true`. A browser assertion cannot tell which branch produced it, so
// flipping the OR to an AND, or dropping the allowlist early, would pass there
// and silently remove a live module from every workspace predating the field.
//
// Run: node tests/feature-access-category.check.js
// =============================================================================

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const QA_EMAIL = 'fluxyos.qa+seed@example.com';   // matches allowEmailPatterns
const STRANGER = 'someone@nowhere.test';

let failures = 0;
function check(label, fn) {
    try { fn(); console.log(`  ✓ ${label}`); }
    catch (e) { failures += 1; console.error(`  ✗ ${label}\n      ${e.message}`); }
}

// `matches()` reads window.FluxyWorkspace at call time, so the stub is just a
// global the module can see.
function withCategory(category, fn) {
    global.window = { FluxyWorkspace: category ? { businessCategory: category } : {} };
    try { return fn(); } finally { delete global.window; }
}

(async () => {
    // The module publishes to `window` on import; give it one to write to.
    global.window = {};
    const mod = await import(pathToFileURL(path.join(ROOT, 'assets/js/feature-access.js')).href);
    delete global.window;

    const { FEATURE_RULES, _matchesForTest: matches } = mod;
    const pos = FEATURE_RULES.pos;

    console.log('\nbusiness-category eligibility\n');

    // Retail joined F&B on 2026-08-31, once POS_PROFILES gave a retail workspace
    // a pay-first counter instead of the F&B ladder. The assertion is pinned to
    // the exact list rather than "contains fnb": widening this hands a live
    // module to a whole segment, and it should never happen as a side effect of
    // some other edit.
    check('the pos rule is gated on the categories the till actually serves', () => {
        assert.ok(Array.isArray(pos.allowCategories), 'pos.allowCategories must be an array');
        assert.deepStrictEqual(pos.allowCategories, ['fnb', 'retail']);
    });

    check('an F&B workspace qualifies with NO allowlisted email', () => {
        withCategory('fnb', () => {
            assert.strictEqual(matches(pos, STRANGER), true);
        });
    });

    check('a RETAIL workspace qualifies with no allowlisted email', () => {
        withCategory('retail', () => {
            assert.strictEqual(matches(pos, STRANGER), true);
        });
    });

    check('a category the till does not serve is still refused', () => {
        withCategory('services', () => {
            assert.strictEqual(matches(pos, STRANGER), false);
        });
    });

    // The backfill-safety property. If this ever fails, every workspace that
    // predates business_category silently loses Point of Sale.
    check('an UNSTAMPED workspace keeps access through the email allowlist', () => {
        withCategory(null, () => {
            assert.strictEqual(matches(pos, QA_EMAIL), true);
        });
    });

    check('an unstamped workspace with no allowlisted email is refused', () => {
        withCategory(null, () => {
            assert.strictEqual(matches(pos, STRANGER), false);
        });
    });

    // Absent category must never fall back to a default. Country does (absent =
    // ID) because there is a defensible baseline market; there is no defensible
    // baseline line of business, and guessing would hand a till to an agency.
    check('an unrecognised category is refused rather than defaulted', () => {
        withCategory('restaurant', () => {   // plausible, but not in the vocabulary
            assert.strictEqual(matches(pos, STRANGER), false);
        });
    });

    // A country-decided rule must ignore category entirely — it returns before
    // the category branch, and an F&B workspace outside Indonesia must not
    // acquire the Indonesian Tax Center.
    check('a country rule is unaffected by category', () => {
        global.window = { FluxyWorkspace: { businessCategory: 'fnb', country: 'PH' } };
        try {
            assert.strictEqual(matches(FEATURE_RULES.tax_center, QA_EMAIL), false,
                'a Philippine workspace must not get the Indonesian Tax Center');
        } finally { delete global.window; }
    });

    check('rules with no category clause are untouched by this change', () => {
        withCategory('fnb', () => {
            // Inventory is still allowlist-only; an F&B category alone must not
            // silently switch it on for everyone.
            assert.strictEqual(FEATURE_RULES.inventory.allowCategories, null);
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), false);
            assert.strictEqual(matches(FEATURE_RULES.inventory, QA_EMAIL), true);
        });
    });

    if (failures) {
        console.error(`\n${failures} check(s) failed.\n`);
        process.exit(1);
    }
    console.log('\nbusiness-category eligibility: clean\n');
})().catch((e) => {
    console.error('category check crashed:', e && e.stack ? e.stack : e);
    process.exit(1);
});
