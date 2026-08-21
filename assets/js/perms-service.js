// FluxyOS — Permission service (RBAC capability matrix)
//
// Single source of truth for "what can a role do" in the dashboard UI. This is
// the UX layer of role enforcement; the hard security boundary is `firestore.rules`
// (which mirrors this matrix via hasRole()). Never rely on this alone for security.
//
// Roles (this phase): owner, admin, finance, accountant, viewer, cashier.
// See docs/SECURITY_SYSTEM.md §4–5 for the full role/capability model. We ship a
// 6-role subset per the Team Management spec; approver/employee are reserved.
//
// ⚠️ `cashier` is the first role that is NOT a finance role, and it is defined by
// what it cannot do. Every other role is built on READ_CAPS, which carries
// `transactions.read` and `accounting.read` — so granting a waiter `viewer` would
// hand them the ledger. Cashier therefore starts from an empty set and is given
// the till and nothing else. It must never be folded into READ_CAPS "for
// convenience"; that single edit would expose every workspace's books to its
// floor staff. See docs/POS_IMPLEMENTATION_PLAN.md §9.2.
//
// Usage:
//   import { can, ROLES, roleMeta } from '/assets/js/perms-service.js';
//   if (can(role, 'transactions.create')) { ... }
// Or as a global (loaded as a classic script): window.FluxyPerms.can(role, action).

const ROLES = ['owner', 'admin', 'finance', 'accountant', 'viewer', 'cashier'];

// Human-facing metadata for each role (used by settings-team.html).
const ROLE_META = {
    owner:      { label: 'Owner',      description: 'Full access. Billing, ownership transfer, and workspace deletion.' },
    admin:      { label: 'Admin',      description: 'Invite teammates, manage settings, and all finance records. Only the Owner changes roles or removes members.' },
    finance:    { label: 'Finance',    description: 'Add and edit finance records, mark bills paid, export, and use Fluxy AI.' },
    accountant: { label: 'Accountant', description: 'Everything Finance can do, plus the accounting toolkit: post and reverse manual journals and close periods.' },
    viewer:     { label: 'Viewer',     description: 'Read-only access to dashboards and records.' },
    cashier:    { label: 'Cashier',    description: 'The point of sale only — take orders and record payment. Cannot see the ledger, reports, bank accounts, or any other part of the finances.' },
};

// Every capability the dashboard knows about. Keep names aligned with
// docs/SECURITY_SYSTEM.md §5 and the firestore.rules hasRole() checks.
const CAPABILITIES = [
    'transactions.read', 'transactions.create', 'transactions.update', 'transactions.delete',
    'bills.read', 'bills.create', 'bills.update', 'bills.mark_paid',
    'subscriptions.read', 'subscriptions.create', 'subscriptions.update',
    'budgets.read', 'budgets.manage',
    'invoices.read', 'invoices.manage',
    'vendors.manage',
    'exports.create',
    'ai.use',
    'accounting.read',   // view Accounting Center: journals, GL, trial balance, CoA
    'accounting.post',   // post/manage journals + chart of accounts (finance+)
    'journals.manual',   // create/edit/post/reverse manual journals (finance/accountant)
    'period.close',      // close an accounting period (finance+)
    'period.lock',       // lock a closed period (owner/admin only)
    'integrations.manage',
    'pos.use',           // operate the till: open orders, add items, take payment
    'pos.void',          // void an UNPAID order (routine floor correction)
    'pos.refund',        // hand money back on a PAID order — finance+ only, see below
    'pos.manage',        // tables, outlets, menu pricing and visibility (finance+)
    'team.invite',          // invite members + revoke pending invites (owner + admin)
    'team.manage_members',  // change roles / remove members / transfer (owner ONLY)
    'settings.manage',
    'audit.read',
    'billing.manage',     // owner only
    'workspace.delete',   // owner only
    'ownership.transfer', // owner only
];

// Read capabilities every active member (including viewer) has.
const READ_CAPS = [
    'transactions.read', 'bills.read', 'subscriptions.read', 'budgets.read', 'invoices.read',
    'accounting.read',
];

// Finance can create/edit finance records + export + AI, but not delete, not
// manage the team, settings, integrations, billing, or workspace lifecycle.
const FINANCE_CAPS = [
    ...READ_CAPS,
    'transactions.create', 'transactions.update',
    'bills.create', 'bills.update', 'bills.mark_paid',
    'subscriptions.create', 'subscriptions.update',
    'budgets.manage', 'invoices.manage', 'vendors.manage',
    'exports.create', 'ai.use',
    'accounting.post', 'journals.manual', 'period.close',
    'pos.use', 'pos.void', 'pos.refund', 'pos.manage',
];

// Cashier = the till, and deliberately nothing else. NOT built on READ_CAPS —
// see the header. A cashier gets no `transactions.read`, no `accounting.read`, no
// reports, no bank accounts.
//
// `pos.refund` is withheld on purpose. Voiding an unpaid order is a routine floor
// correction; handing cash back out of a paid one moves money in the direction
// that cannot be undone by another void, and it is the classic till-fraud path.
// A shift lead who needs it gets `finance` — an explicit decision by the owner,
// not a default.
const CASHIER_CAPS = [
    'pos.use', 'pos.void',
];

// Admin = all Finance capabilities + team/settings/integrations/audit + delete,
// but NOT billing, workspace deletion, or ownership transfer (owner only).
const ADMIN_CAPS = [
    ...FINANCE_CAPS,
    'transactions.delete',
    'integrations.manage',
    'period.lock',
    // Admins may invite + revoke invites, but NOT change roles or remove members
    // (that is owner-only via 'team.manage_members', granted by owner = all caps).
    'team.invite', 'settings.manage', 'audit.read',
];

// Accountant = all Finance capabilities (same finance-record + posting access);
// the named accounting persona. Manual-journal + period-close rights come with
// FINANCE_CAPS. Period lock stays owner/admin only.
const ACCOUNTANT_CAPS = [...FINANCE_CAPS];

// role -> Set(capabilities). Owner is handled as "all" in can().
const ROLE_CAPS = {
    owner: new Set(CAPABILITIES),
    admin: new Set(ADMIN_CAPS),
    finance: new Set(FINANCE_CAPS),
    accountant: new Set(ACCOUNTANT_CAPS),
    viewer: new Set(READ_CAPS),
    cashier: new Set(CASHIER_CAPS),
};

// Roles that cannot use the rest of the dashboard and must be routed to their own
// surface at sign-in. Without this a cashier lands on /dashboard and meets a wall
// of permission-denied — the page reads collections their role was never granted.
// `onboarding-gate.js` consults this before any finance read.
const POS_ONLY_ROLES = ['cashier'];
const POS_ONLY_HOME = '/pos';

/** Is this role confined to the point of sale? */
function isPosOnlyRole(role) {
    return POS_ONLY_ROLES.includes(String(role || '').trim().toLowerCase());
}

/**
 * Can `role` perform `capability`?
 * Unknown roles are treated as no access (fail closed).
 */
function can(role, capability) {
    if (!role || !capability) return false;
    if (role === 'owner') return true; // owner has everything
    const caps = ROLE_CAPS[role];
    return !!caps && caps.has(capability);
}

/** Is this a role we recognise? */
function isValidRole(role) {
    return ROLES.includes(role);
}

/** Display metadata for a role, with a safe fallback. */
function roleMeta(role) {
    return ROLE_META[role] || { label: role || 'Unknown', description: '' };
}

export { ROLES, CAPABILITIES, ROLE_META, can, isValidRole, roleMeta, isPosOnlyRole, POS_ONLY_HOME };

// Also expose as a global for classic-script consumers (sidebar-loader,
// shared-dashboard) that don't use ES imports.
if (typeof window !== 'undefined') {
    window.FluxyPerms = { ROLES, CAPABILITIES, ROLE_META, can, isValidRole, roleMeta, isPosOnlyRole, POS_ONLY_HOME };
}
