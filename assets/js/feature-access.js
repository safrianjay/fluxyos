// =============================================================================
// FluxyOS — feature eligibility
//
// Not every business needs every module. A GTM/sales-led startup has no use for
// Inventory or Outlet P&L, and showing them dilutes the dashboard for that user.
//
// The long-term goal is personalisation driven by BUSINESS CATEGORY. This is the
// seam for that, shipped with an explicit allowlist behind it, so switching to
// category rules later changes FEATURE_RULES and nothing else.
//
// ⚠️ THIS IS A UI GUARD, NOT A SECURITY BOUNDARY.
//
// Exactly the status of the Activity Log nav gate in sidebar-loader.js. An
// ineligible user who calls DataService directly still reads and writes
// inventory. `firestore.rules` enforces the real boundary — by workspace and
// role — and is untouched by any of this. Never describe it as access control.
//
// ELIGIBILITY IS A PROPERTY OF THE BUSINESS, NOT THE PERSON.
//
// It resolves from the workspace OWNER, so an enabled workspace's accountant and
// shift lead can use the stock data that is already there. Gating on the
// signed-in user instead would hide the count sheet from the very people who do
// the counting.
//
// Note the field this is meant to grow into does not exist yet: onboarding never
// asks for a business category, and `settings/company.business_type` is free
// text ("Agency, retail, services"). A category rule needs a controlled
// vocabulary captured at onboarding first — see `allowCategories` below.
// =============================================================================

export const FEATURE_RULES = {
    // The Tax Center is Indonesian tax law end to end — 83 references to PPN, 31
    // to PPh, plus NPWP, DJP and e-Faktur. There is no Philippine equivalent to
    // rename it to: a PH business files 12% VAT and BIR forms, which this module
    // does not implement. Showing it to them would misrepresent what the product
    // does, so it is ABSENT for other markets rather than shown-and-wrong.
    //
    // This is a scope statement, not a permanent decision. When BIR/IRAS/LHDN
    // support ships, add the country here and nothing else changes.
    tax_center: {
        label: 'Tax Center',
        allowCountries: ['ID'],
    },
    // PPN/PPh fields on invoices and bills. Indonesian tax MECHANICS, not just
    // Indonesian words: PH VAT is 12% with BIR 2307 withholding, SG GST and MY
    // SST are different regimes again. Relabelling "PPN rate" to "VAT rate" while
    // keeping Indonesian arithmetic would produce confidently wrong tax numbers,
    // which is worse than not offering the field. So it is ABSENT elsewhere until
    // a real local tax engine exists — same call as the Tax Center.
    transaction_tax: {
        label: 'Transaction tax (PPN/PPh)',
        allowCountries: ['ID'],
    },
    inventory: {
        label: 'Inventory',
        // Reached by /inventory and /inventory-count.
        allowEmails: [
            'renatakurniawan1501@gmail.com',
            'randikaisraj07@gmail.com',
            'safrianjayadi77@gmail.com',
            // TB Bangun Utama — building supplies, already running the till.
            // Listed as well as covered by `retail` below, deliberately: the
            // category only grants access once THIS workspace's doc actually
            // carries `business_category: 'retail'`, and whether it does is a
            // data question this file cannot answer. The email makes it certain
            // today; the category is what makes the email removable later.
            'tbbangunutama@gmail.com'
        ],
        // The QA account lives in .qa/firebase-test-account.md, which is
        // GITIGNORED and rotatable — its address must not be hard-coded here.
        // example.com is reserved by RFC 2606 and can never be a real customer,
        // so matching the pattern is safe. Without this every inventory spec
        // fails the moment eligibility ships, which is the intended tripwire if
        // the pattern is ever wrong.
        allowEmailPatterns: [/^fluxyos\.qa\+.*@example\.com$/i],
        // Retail added 2026-08-30. A shop holds stock — that was never in
        // question; the module was simply still on the allowlist while the
        // category field bedded in. POS made the same move first and this
        // follows it, so a retail workspace now gets the till AND the stock
        // behind it rather than one without the other.
        //
        // `manufacturing` added 2026-08-30: raw materials, WIP and finished
        // goods are inventory by definition. NOT given POS in the same move — a
        // factory sells B2B on invoices, not over a counter.
        allowCategories: ['fnb', 'retail', 'manufacturing']
    },
    // Outlet P&L compares outlets to each other. Its precondition is therefore
    // not an industry but a COUNT — and that count is a fact already in the
    // data, not a guess. A one-store shop and a forty-store chain are both
    // `retail`, and only one of them has anything to compare; gating this on
    // category would show the smaller one a page comparing an outlet to nothing.
    //
    // `minDimensions` is read from `dimensions` (type outlet/branch). Two,
    // not one: a single outlet is what every workspace has by default once it
    // records anything, so one would gate on nothing at all.
    outlet_pnl: {
        label: 'Outlet P&L',
        allowEmails: [
            'renatakurniawan1501@gmail.com',
            'randikaisraj07@gmail.com',
            'safrianjayadi77@gmail.com'
        ],
        allowEmailPatterns: [/^fluxyos\.qa\+.*@example\.com$/i],
        allowCategories: null,
        minDimensions: { types: ['outlet', 'branch'], count: 2 }
    },
    // Point of sale. Same eligibility shape as Inventory, and for the same
    // reason: an agency has nothing to ring up.
    //
    // ⚠️ A `cashier` may not match this rule — eligibility resolves from the
    // workspace OWNER's email, and a cashier is not the owner. `sidebar-loader.js`
    // force-reveals the POS entry for a POS-only role rather than relying on
    // this, because a till operator who cannot reach the till has no product at
    // all. Same for the page guard: `pos.html` passes no `feature`.
    pos: {
        label: 'Point of Sale',
        // Kept alongside allowCategories on purpose, and removable only once every
        // workspace on it carries a category. See matches() — the two are OR'd.
        allowEmails: [
            'renatakurniawan1501@gmail.com',
            'randikaisraj07@gmail.com',
            'safrianjayadi77@gmail.com'
        ],
        allowEmailPatterns: [/^fluxyos\.qa\+.*@example\.com$/i],
        // Retail added 2026-08-31, once the till stopped being F&B-shaped. The
        // reason it was withheld — "the till's F&B assumptions (tables, covers)
        // are visible in the UI" — is what POS_PROFILES in pos.js now fixes: a
        // retail workspace gets a pay-first counter with no floor plan and no
        // kitchen ladder. See docs/POS_BUSINESS_TYPE_STRATEGY.md.
        //
        // ⚠️ allowEmails STAYS. Widening to include retail removes the reason
        // that was BLOCKING its removal (TB Bangun Utama, a building-supplies
        // retailer already running the till, is now covered by category) — but
        // "the blocker is gone" is not "the list is empty". Dropping it needs
        // proof that no OTHER allowlisted workspace carries a third category,
        // and that is a data question, not a code one. Removing it on the
        // assumption would take a live module off a paying user in silence.
        allowCategories: ['fnb', 'retail']
    }
};

const norm = (email) => String(email || '').trim().toLowerCase();

function matches(rule, email) {
    if (!rule) return false;
    // A country rule is about the BUSINESS, not the person, so it is evaluated
    // independently of the email allowlist. A rule carrying allowCountries is
    // decided entirely by country.
    if (rule.allowCountries) {
        const country = (typeof window !== 'undefined' && window.FluxyWorkspace && window.FluxyWorkspace.country) || null;
        // Absent country = the Indonesian baseline, matching every other default
        // in the currency work: an unstamped legacy workspace is Indonesian.
        return rule.allowCountries.includes(country || 'ID');
    }
    // Business category, the intended long-term signal. ADDITIVE to the email
    // allowlist rather than replacing it: a workspace stamped `fnb` qualifies on
    // category, and an existing allowlisted workspace that has not been stamped
    // yet keeps its access. Flipping to category-only in one step would silently
    // remove a live module from every workspace that predates the field — the
    // exact regression the backfill exists to prevent.
    //
    // Absent category = NO match. Unlike country, there is no sensible default
    // line of business, and guessing one would hand a till to an agency.
    if (rule.allowCategories) {
        const category = (typeof window !== 'undefined' && window.FluxyWorkspace
            && window.FluxyWorkspace.businessCategory) || null;
        if (category && rule.allowCategories.includes(category)) return true;
    }
    if (!email) return false;
    if ((rule.allowEmails || []).some((e) => norm(e) === email)) return true;
    return (rule.allowEmailPatterns || []).some((re) => re.test(email));
}

// The owner's email, resolved once per page load. Both the sidebar and the page
// guard call in, and a shared promise keeps that to a single document read.
let ownerEmailPromise = null;

async function resolveOwnerEmail(app, user) {
    const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || {};
    const ownUid = user && user.uid;
    const ownEmail = norm(user && user.email);

    // workspaces/{id} is created as workspaces/{ownerUid} (`ensureWorkspace`),
    // so the workspace id IS the owner's uid and their member doc carries the
    // email. A solo owner reading their own workspace hits the same path.
    const wsId = ws.id || ownUid;
    if (!wsId) return ownEmail;
    if (wsId === ownUid) return ownEmail;   // owner: no read needed

    // Route through the shared long-polling initializer, NOT a bare
    // getFirestore(). `initializeFirestore` can only run once per app and the
    // FIRST Firestore touch on a page decides the transport for everything
    // after it — so this one read, on a member's page, was enough to put the
    // whole app back on the streaming WebChannel that ad blockers, Brave
    // Shields and corporate proxies break. The symptom is a 400 on
    // `/Listen/channel`, a stream that retries forever, and writes that take
    // seconds. Same reason onboarding-gate.js routes through it.
    const [{ doc, getDoc }, { resolveDb }] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
        import('./firestore-db.js')
    ]);
    const snap = await getDoc(doc(resolveDb(app), `workspaces/${wsId}/members/${wsId}`));
    // Fall back to the member's own address rather than treating an unreadable
    // owner doc as "no owner" — that would hide the module from a whole team on
    // a single failed read.
    return snap.exists() ? norm(snap.data().email) || ownEmail : ownEmail;
}

function ownerEmail(app, user) {
    if (!ownerEmailPromise) {
        ownerEmailPromise = resolveOwnerEmail(app, user).catch(() => norm(user && user.email));
    }
    return ownerEmailPromise;
}

/**
 * Is this workspace eligible for `feature`?
 *
 * Fails CLOSED on an unknown owner (the feature stays hidden) but OPEN on a
 * thrown error, matching applyToPage's "a module load failure must never lock a
 * user out" stance. Hiding a live module on a network blip is a bug; briefly
 * showing one is merely untidy.
 *
 * @param {object} app      Firebase app
 * @param {object} user     Firebase auth user
 * @param {string} feature  a FEATURE_RULES key
 * @returns {Promise<boolean>}
 */
/**
 * Synchronous eligibility, for COUNTRY rules only.
 *
 * Render toggles cannot await, and a country rule needs no document read — the
 * workspace is resolved before any page renders. Returns true for a rule this
 * cannot decide synchronously (an email rule), so it never hides by accident.
 */
export function canUseFeatureSync(feature) {
    const rule = FEATURE_RULES[feature];
    if (!rule || !rule.allowCountries) return true;
    const country = (typeof window !== 'undefined' && window.FluxyWorkspace && window.FluxyWorkspace.country) || null;
    return rule.allowCountries.includes(country || 'ID');
}

/*
 * How many dimensions of the given types this workspace has.
 *
 * Cached per page load like the owner email, for the same reason: the sidebar
 * and the page guard both ask, and this must stay one read.
 *
 * Fails OPEN (returns Infinity) on any error. Every other signal in this file
 * fails open too, and the consequence of guessing wrong is asymmetric: showing a
 * module to a business that does not need it is untidy, while hiding one from a
 * business that is mid-shift is a broken product.
 */
let dimensionCountPromise = null;

async function countDimensions(app, user, types) {
    if (!dimensionCountPromise) {
        dimensionCountPromise = (async () => {
            const [{ collection, getDocs }, { resolveDb }] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'),
                // Same reason as resolveOwnerEmail below: the FIRST Firestore
                // touch on a page decides the transport for everything after it,
                // so this must not be a bare getFirestore().
                import('./firestore-db.js')
            ]);
            const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || {};
            const scope = ws.id ? `workspaces/${ws.id}` : `users/${user && user.uid}`;
            const snap = await getDocs(collection(resolveDb(app), `${scope}/dimensions`));
            return snap.docs.map((d) => d.data());
        })();
    }
    try {
        const dims = await dimensionCountPromise;
        return dims.filter((d) => !types || types.includes(d && d.type)).length;
    } catch (_) {
        dimensionCountPromise = null;
        return Infinity;               // fail open
    }
}

export async function canUseFeature(app, user, feature) {
    const rule = FEATURE_RULES[feature];
    if (!rule) return true;            // unknown feature: never gate by accident
    try {
        // Email / category / country first — they are free once resolved, and an
        // allowlisted workspace should never pay for a collection read.
        if (matches(rule, await ownerEmail(app, user))) return true;
        // A count rule is OR'd with the rest, exactly like category: having two
        // outlets grants the module on its own, and an allowlisted workspace
        // keeps it whether or not it has any.
        if (rule.minDimensions) {
            const n = await countDimensions(app, user, rule.minDimensions.types);
            return n >= rule.minDimensions.count;
        }
        return false;
    } catch (_) {
        return true;                   // fail open
    }
}

// Reset point for tests, which stub FEATURE_RULES to prove the negative case.
export function _resetFeatureAccessCache() { ownerEmailPromise = null; dimensionCountPromise = null; }

// Exported for `tests/feature-access-category.check.js`, which asserts the
// category/allowlist precedence directly. Worth exporting: the branch that
// matters most is the one where an UNSTAMPED workspace keeps its module through
// the email allowlist, and that is invisible from the outside — both paths
// return true, so a browser test cannot tell which one granted it.
export const _matchesForTest = matches;

// sidebar-loader.js is a classic script that runs before page modules, so it
// cannot import this. Same reason FluxyAIContext is published this way.
if (typeof window !== 'undefined') {
    window.FluxyFeatures = {
        RULES: FEATURE_RULES,
        can: canUseFeature,
        canSync: canUseFeatureSync,
        _reset: _resetFeatureAccessCache
    };
}
