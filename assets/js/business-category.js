// =============================================================================
// FluxyOS — Business category
//
// The workspace's declared line of business, captured once at onboarding and
// stored on `workspaces/{id}` beside `country` and `base_currency`.
//
// WHY THE WORKSPACE DOC AND NOT `settings`.
//
// `settings` is USER-scoped (PROJECT_BACKGROUND §4 rule 3), so storing the
// category there would let two members of one company disagree about what the
// business is — and eligibility resolves from the OWNER, whose user-scoped docs
// a member cannot read. The same reasoning already put `country` and
// `base_currency` on the workspace doc; this field follows it exactly.
//
// `settings/company.business_type` still exists and is UNRELATED: free text, no
// vocabulary, and descriptive only. It is never read for gating and must not be.
//
// WHY IT IS NOT SET-ONCE.
//
// `base_currency` is set-once because it decides how every stored integer is
// READ — changing it silently re-prices history. A category decides nothing
// retroactively: a retail shop that adds a cafe genuinely changes category, and
// refusing the edit forever would be wrong. Rules therefore allow an owner to
// change it (admins stay restricted to `name`), and no history moves.
//
// THE VOCABULARY IS MIRRORED IN FOUR PLACES, ON PURPOSE.
//
//   1. here                                — the client's single source
//   2. `db-service.js`  ensureWorkspace     — a LOCAL allowlist, deliberately not
//                                             deferring to this module: if the
//                                             seam failed to load, deferring
//                                             would silently drop the category
//                                             (the same trap that nearly left a
//                                             Philippine workspace on rupiah)
//   3. `firestore.rules` isValidWorkspaceProfile — the real boundary
//   4. `onboarding.html` — the <option> list the custom select reads from
//
// Four copies drift. `tests/structure-drift.check.js` asserts all four agree and
// fails the build if they do not — the same treatment the finance-collection
// registries get.
// =============================================================================

// Order is the order shown in the picker. `other` stays last.
export const BUSINESS_CATEGORIES = [
    { id: 'fnb',           label: 'Food & Beverage', label_id: 'Makanan & Minuman' },
    { id: 'startup',       label: 'Startup',         label_id: 'Startup' },
    { id: 'technology',    label: 'Technology',      label_id: 'Teknologi' },
    { id: 'manufacturing', label: 'Manufacturing',   label_id: 'Manufaktur' },
    { id: 'retail',        label: 'Retail',          label_id: 'Ritel' },
    { id: 'services',      label: 'Services',        label_id: 'Jasa' },
    { id: 'other',         label: 'Other',           label_id: 'Lainnya' },
];

export const BUSINESS_CATEGORY_IDS = BUSINESS_CATEGORIES.map((c) => c.id);

/** Is this a category we recognise? Unknown values fail closed. */
export function isValidBusinessCategory(id) {
    return BUSINESS_CATEGORY_IDS.includes(String(id || '').trim().toLowerCase());
}

/**
 * Display label for a category id.
 *
 * Returns the ENGLISH label; callers render it through the page's `t()` so the
 * Bahasa pair in `dashboard-i18n.js` applies. `label_id` above is the reference
 * copy for that dictionary, not a second translation path — one translation
 * mechanism, or the two drift.
 */
export function businessCategoryLabel(id) {
    const found = BUSINESS_CATEGORIES.find((c) => c.id === String(id || '').trim().toLowerCase());
    return found ? found.label : '';
}

// Classic-script consumers (onboarding.html loads money-format.js the same way,
// and settings-business.html is not a module).
if (typeof window !== 'undefined') {
    window.FluxyBusinessCategory = {
        CATEGORIES: BUSINESS_CATEGORIES,
        IDS: BUSINESS_CATEGORY_IDS,
        isValid: isValidBusinessCategory,
        label: businessCategoryLabel,
    };
}
