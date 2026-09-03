// FluxyOS — Account-mapping recommendations by business category
//
// Pure. No Firestore, no DOM.
//
// ── What this is for ─────────────────────────────────────────────────────────
// `ACCOUNTING_CATEGORY_DEFAULTS` maps a spend category to an account the same
// way for every business on the platform: Operations → 6400 Operations Expense,
// Infrastructure → 6300. That is a safe default and a poor answer, because the
// same category means different things to different businesses:
//
//   • A restaurant's "Operations" spend is mostly ingredients. Ingredients are
//     COST OF REVENUE, not overhead.
//   • A shop's is goods bought for resale. Same.
//   • A SaaS company's "Infrastructure" is the hosting that serves its
//     customers — cost of revenue again, and the reason a contribution-margin
//     read is possible at all.
//
// ── Why it matters more than it looks ────────────────────────────────────────
// Gross margin is computed from accounts whose `sak_category` is `cogs`
// (`_incomeStatementCogsKeys`). A workspace with NOTHING mapped to a
// cost-of-revenue account has no COGS to subtract, so `(revenue − 0) / revenue`
// would report a flat 100% margin — which is why the Overview card renders a
// setup state instead of a number (PROJECT_BACKGROUND §3a).
//
// So for a restaurant whose every cost sits in 6400, the product cannot show
// gross margin at all. Not because the data is missing, but because the default
// filed it as overhead.
//
// ── These RECOMMEND. They never post. ────────────────────────────────────────
// The default map is mirrored in two places — `ACCOUNTING_CATEGORY_DEFAULTS`
// (db-service, drives the preview) and `CATEGORY_DEFAULTS` (accounting-engine,
// drives POSTING). Changing either by business category would silently move
// costs between overhead and cost of revenue on books that already exist, and
// restate every gross margin ever shown.
//
// So nothing here changes a default. A recommendation becomes real only when the
// user saves it as an `accounting_mappings` row, which `resolveExpenseAccount`
// consults BEFORE the defaults — explicit, opt-in, and applying only to
// postings made after it. Existing journals never move.

/**
 * category → recommendation, per business category.
 *
 * `why` is shown to the user, so it says what changes rather than restating the
 * mapping. A recommendation nobody understands is one nobody applies.
 */
export const MAPPING_RECOMMENDATIONS = {
    fnb: {
        Operations: {
            code: '5100',
            why: 'Ingredients are the cost of what you sell, not overhead. Filed here, gross margin can be read; under Operations Expense it cannot.'
        }
    },
    retail: {
        Operations: {
            code: '5100',
            why: 'Goods bought for resale are the cost of what you sell. Filed here, gross margin can be read; under Operations Expense it cannot.'
        }
    },
    manufacturing: {
        Operations: {
            code: '5100',
            why: 'Raw materials and production spend are the cost of what you make. Filed here, gross margin can be read; under Operations Expense it cannot.'
        }
    },
    startup: {
        Infrastructure: {
            code: '5100',
            why: 'Hosting that serves your customers scales with them, so it is a cost of revenue rather than overhead. This is what makes a contribution-margin read possible.'
        }
    },
    technology: {
        Infrastructure: {
            code: '5100',
            why: 'Hosting that serves your customers scales with them, so it is a cost of revenue rather than overhead. This is what makes a contribution-margin read possible.'
        }
    }
    // `services` and `other` deliberately have none. An agency's delivery cost is
    // often subcontractors — genuinely cost of revenue — but "Operations" is far
    // too broad to assume that from, and a recommendation that is wrong half the
    // time teaches people to dismiss the whole feature. No guess is better than
    // a coin flip wearing a reason.
};

/**
 * The recommendation for one source, or null.
 *
 * `currentCode` is what the row resolves to today (a saved mapping, or the
 * platform default). A recommendation that agrees with it is not a
 * recommendation — returning one would put "apply this" next to something
 * already applied.
 */
export function recommendationFor({ businessCategory, sourceType, sourceValue, currentCode } = {}) {
    if (sourceType !== 'transaction_category') return null;
    const byCategory = MAPPING_RECOMMENDATIONS[String(businessCategory || '').trim()];
    if (!byCategory) return null;
    const rec = byCategory[String(sourceValue || '').trim()];
    if (!rec) return null;
    if (String(currentCode || '') === rec.code) return null;
    return { code: rec.code, why: rec.why };
}

/** Does this business category carry any recommendations at all? */
export function hasRecommendations(businessCategory) {
    return !!MAPPING_RECOMMENDATIONS[String(businessCategory || '').trim()];
}
