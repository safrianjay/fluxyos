// FluxyOS — Permission service (RBAC capability matrix)
//
// Single source of truth for "what can a role do" in the dashboard UI. This is
// the UX layer of role enforcement; the hard security boundary is `firestore.rules`
// (which mirrors this matrix via hasRole()). Never rely on this alone for security.
//
// Roles (this phase): owner, admin, finance, viewer.
// See docs/SECURITY_SYSTEM.md §4–5 for the full role/capability model. We ship a
// 4-role subset per the Team Management spec; approver/employee are reserved.
//
// Usage:
//   import { can, ROLES, roleMeta } from '/assets/js/perms-service.js';
//   if (can(role, 'transactions.create')) { ... }
// Or as a global (loaded as a classic script): window.FluxyPerms.can(role, action).

const ROLES = ['owner', 'admin', 'finance', 'viewer'];

// Human-facing metadata for each role (used by settings-team.html).
const ROLE_META = {
    owner:   { label: 'Owner',   description: 'Full access. Billing, ownership transfer, and workspace deletion.' },
    admin:   { label: 'Admin',   description: 'Manage the team, settings, and all finance records.' },
    finance: { label: 'Finance', description: 'Add and edit finance records, mark bills paid, export, and use Fluxy AI.' },
    viewer:  { label: 'Viewer',  description: 'Read-only access to dashboards and records.' },
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
    'integrations.manage',
    'team.manage',        // invite/remove members, change roles
    'settings.manage',
    'audit.read',
    'billing.manage',     // owner only
    'workspace.delete',   // owner only
    'ownership.transfer', // owner only
];

// Read capabilities every active member (including viewer) has.
const READ_CAPS = [
    'transactions.read', 'bills.read', 'subscriptions.read', 'budgets.read', 'invoices.read',
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
];

// Admin = all Finance capabilities + team/settings/integrations/audit + delete,
// but NOT billing, workspace deletion, or ownership transfer (owner only).
const ADMIN_CAPS = [
    ...FINANCE_CAPS,
    'transactions.delete',
    'integrations.manage',
    'team.manage', 'settings.manage', 'audit.read',
];

// role -> Set(capabilities). Owner is handled as "all" in can().
const ROLE_CAPS = {
    owner: new Set(CAPABILITIES),
    admin: new Set(ADMIN_CAPS),
    finance: new Set(FINANCE_CAPS),
    viewer: new Set(READ_CAPS),
};

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

export { ROLES, CAPABILITIES, ROLE_META, can, isValidRole, roleMeta };

// Also expose as a global for classic-script consumers (sidebar-loader,
// shared-dashboard) that don't use ES imports.
if (typeof window !== 'undefined') {
    window.FluxyPerms = { ROLES, CAPABILITIES, ROLE_META, can, isValidRole, roleMeta };
}
