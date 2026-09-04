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
// One stub for the whole workspace snapshot. `withCategory` used to replace
// global.window outright, so nesting two of these clobbered the outer one —
// which would have made every combined case silently test the wrong thing.
function withWorkspace(props, fn) {
    global.window = { FluxyWorkspace: { ...props } };
    try { return fn(); } finally { delete global.window; }
}

function withCategory(category, fn) {
    return withWorkspace(category ? { businessCategory: category } : {}, fn);
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

    check('inventory serves the categories that actually hold stock', () => {
        // Widened 2026-08-30. A shop holds stock, so a retail workspace gets the
        // stock behind the till it already had, rather than one without the other.
        assert.deepStrictEqual(FEATURE_RULES.inventory.allowCategories, ['fnb', 'retail', 'manufacturing']);
        withCategory('retail', () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), true);
        });
        withCategory('fnb', () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), true);
        });
    });

    check('a category that does not hold stock is still refused inventory', () => {
        // The point of a category gate is that it EXCLUDES. An agency has no
        // stock, and widening to retail must not quietly widen to everyone.
        withCategory('services', () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), false);
            // …while an allowlisted workspace keeps access regardless of category.
            assert.strictEqual(matches(FEATURE_RULES.inventory, QA_EMAIL), true);
        });
    });

    check('an unstamped workspace keeps inventory through the allowlist', () => {
        // The backfill-safety property, now that inventory has a category clause:
        // a workspace predating the field must not lose a live module.
        withCategory(null, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, QA_EMAIL), true);
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), false);
        });
    });

    check('inventory serves manufacturing too', () => {
        // Raw materials, WIP and finished goods are inventory by definition.
        assert.deepStrictEqual(
            FEATURE_RULES.inventory.allowCategories, ['fnb', 'retail', 'manufacturing']);
        withCategory('manufacturing', () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), true);
            // …but NOT the till. A factory sells B2B on invoices, not over a
            // counter, so widening one must not widen the other.
            assert.strictEqual(matches(FEATURE_RULES.pos, STRANGER), false);
        });
    });

    check('outlet p&l is gated on a COUNT, not a category', () => {
        // Its precondition is having outlets to compare, which is a fact in the
        // data. A one-store shop and a forty-store chain are both `retail`.
        assert.strictEqual(FEATURE_RULES.outlet_pnl.allowCategories, null);
        assert.deepStrictEqual(
            FEATURE_RULES.outlet_pnl.minDimensions, { types: ['outlet', 'branch'], count: 2 });
        // `matches` covers email/category/country only — the count is evaluated
        // in canUseFeature, so category alone must still refuse here.
        withCategory('retail', () => {
            assert.strictEqual(matches(FEATURE_RULES.outlet_pnl, STRANGER), false);
            assert.strictEqual(matches(FEATURE_RULES.outlet_pnl, QA_EMAIL), true);
        });
    });

    check('a direct YES beats a category that would refuse', () => {
        // The whole reason for asking: a D2C startup that holds stock picks
        // `startup` and would otherwise lose Inventory.
        withWorkspace({ businessCategory: 'startup', holdsStock: true }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), true);
        });
    });

    check('a direct NO beats a category that would grant', () => {
        // A signal you only honour when it agrees with your guess is not a
        // signal. A catering agency that subcontracts every kitchen is `fnb` and
        // holds nothing.
        withWorkspace({ businessCategory: 'fnb', holdsStock: false }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), false);
        });
    });

    check('a direct NO never revokes an ALLOWLISTED workspace', () => {
        // The allowlist is evaluated first, deliberately. Otherwise a "no"
        // answer would take Inventory off a hand-listed customer — and off the
        // QA account, which every inventory spec depends on.
        withWorkspace({ businessCategory: 'services', holdsStock: false }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, QA_EMAIL), true);
            assert.strictEqual(matches(FEATURE_RULES.inventory, 'tbbangunutama@gmail.com'), true);
        });
    });

    check('unanswered falls through to the category, unchanged', () => {
        // Every workspace predating the question keeps exactly what it had.
        withWorkspace({ businessCategory: 'retail', holdsStock: null }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), true);
        });
        withWorkspace({ businessCategory: 'services', holdsStock: null }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), false);
        });
    });

    check('the stock answer does not leak into POS', () => {
        // Only Inventory declares requiresStock. Holding stock says nothing
        // about whether you sell over a counter.
        withWorkspace({ businessCategory: 'manufacturing', holdsStock: true }, () => {
            assert.strictEqual(matches(FEATURE_RULES.pos, STRANGER), false);
        });
    });

    check('a direct YES on counter sales beats a category that would refuse', () => {
        // A salon doing walk-in trade is `services` and absolutely wants a till.
        withWorkspace({ businessCategory: 'services', sellsAtCounter: true }, () => {
            assert.strictEqual(matches(FEATURE_RULES.pos, STRANGER), true);
        });
    });

    check('a direct NO on counter sales beats a category that would grant', () => {
        // A cloud kitchen is `fnb` and sells only through delivery apps.
        withWorkspace({ businessCategory: 'fnb', sellsAtCounter: false }, () => {
            assert.strictEqual(matches(FEATURE_RULES.pos, STRANGER), false);
        });
    });

    check('the two direct questions do not leak into each other', () => {
        // Holding stock says nothing about selling over a counter, and vice
        // versa. A manufacturer holds plenty and has no till.
        withWorkspace({ businessCategory: 'manufacturing', holdsStock: true, sellsAtCounter: false }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), true);
            assert.strictEqual(matches(FEATURE_RULES.pos, STRANGER), false);
        });
        withWorkspace({ businessCategory: 'services', holdsStock: false, sellsAtCounter: true }, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, STRANGER), false);
            assert.strictEqual(matches(FEATURE_RULES.pos, STRANGER), true);
        });
    });

    check('a direct NO on counter sales never revokes an ALLOWLISTED workspace', () => {
        withWorkspace({ businessCategory: 'services', sellsAtCounter: false }, () => {
            assert.strictEqual(matches(FEATURE_RULES.pos, QA_EMAIL), true);
        });
    });

    check('TB Bangun Utama can reach inventory even if unstamped', () => {
        // Listed as well as covered by `retail`, because whether that workspace's
        // doc actually carries the category is a data question this file cannot
        // answer. The email is what makes it certain today.
        withCategory(null, () => {
            assert.strictEqual(matches(FEATURE_RULES.inventory, 'tbbangunutama@gmail.com'), true);
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
