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
        allowEmails: [
            'renatakurniawan1501@gmail.com',
            'randikaisraj07@gmail.com',
            'safrianjayadi77@gmail.com'
        ],
        allowEmailPatterns: [/^fluxyos\.qa\+.*@example\.com$/i],
        allowCategories: null
    }
};

const norm = (email) => String(email || '').trim().toLowerCase();

function matches(rule, email) {
    if (!rule || !email) return false;
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

// sidebar-loader.js is a classic script that runs before page modules, so it
// cannot import this. Same reason FluxyAIContext is published this way.
if (typeof window !== 'undefined') {
    window.FluxyFeatures = {
        RULES: FEATURE_RULES,
        can: canUseFeature,
        _reset: _resetFeatureAccessCache
    };
}
