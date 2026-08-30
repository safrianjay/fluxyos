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
            'safrianjayadi77@gmail.com'
        ],
        // The QA account lives in .qa/firebase-test-account.md, which is
        // GITIGNORED and rotatable — its address must not be hard-coded here.
        // example.com is reserved by RFC 2606 and can never be a real customer,
        // so matching the pattern is safe. Without this every inventory spec
        // fails the moment eligibility ships, which is the intended tripwire if
        // the pattern is ever wrong.
        allowEmailPatterns: [/^fluxyos\.qa\+.*@example\.com$/i],
        // Later: allowCategories: ['fnb', 'retail', 'manufacturing']
        allowCategories: null
    },
    outlet_pnl: {
        label: 'Outlet P&L',
        allowEmails: [
            'renatakurniawan1501@gmail.com',
            'randikaisraj07@gmail.com',
            'safrianjayadi77@gmail.com'
        ],
        allowEmailPatterns: [/^fluxyos\.qa\+.*@example\.com$/i],
        allowCategories: null
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
        // F&B is the initial segment. Retail and other categories run tills too;
        // they are deliberately NOT listed until someone decides to serve them,
        // because the till's F&B assumptions (tables, covers) are visible in the UI.
        //
        // ⚠️ DO NOT REMOVE allowEmails ABOVE. The 2026-08-30 backfill finished, so
        // the old reason ("workspaces are unstamped") is gone — but it uncovered a
        // better one: this list is NARROWER than the allowlist it was meant to
        // replace. TB Bangun Utama is a building-supplies RETAILER already running
        // the till (2 pos_orders, 1 paid, 1 table). Dropping allowEmails today
        // removes POS from a live user. Widening to ['fnb', 'retail'] is a product
        // decision, not a cleanup. See docs/data-model/onboarding.md.
        allowCategories: ['fnb']
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

    const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const snap = await getDoc(doc(getFirestore(app), `workspaces/${wsId}/members/${wsId}`));
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

export async function canUseFeature(app, user, feature) {
    const rule = FEATURE_RULES[feature];
    if (!rule) return true;            // unknown feature: never gate by accident
    try {
        return matches(rule, await ownerEmail(app, user));
    } catch (_) {
        return true;                   // fail open
    }
}

// Reset point for tests, which stub FEATURE_RULES to prove the negative case.
export function _resetFeatureAccessCache() { ownerEmailPromise = null; }

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
