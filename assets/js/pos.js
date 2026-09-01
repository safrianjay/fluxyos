// =============================================================================
// FluxyOS — Point of Sale
//
// The till. Designed at 375px and widened, because unlike every other app page
// this one is used standing up, one-handed, during service.
//
// Three rules this file exists to keep:
//
//   1. ONE PRIMARY ACTION. The order panel has a single advancing button whose
//      label changes with status (Send → Serve → Bill → Take payment). Two
//      equal-weight buttons on a till is how the wrong one gets pressed.
//
//   2. THE FIGURE HERE IS OPERATIONAL, NOT ACCOUNTING. "Sales today" sums
//      pos_orders; the dashboard sums the ledger. They differ until posting
//      runs, and a product with two revenue numbers is what PRODUCT_STRATEGY §6
//      forbids — so this page labels its figure as the till's and links to the
//      accounting one, and surfaces anything unposted rather than hiding it.
//
//   3. WHAT IS WRONG MUST BE VISIBLE. A menu item with no cost basis sells at
//      100% margin and inflates gross profit exactly the way marketplace orders
//      did before per-sale relief existed. It is counted and named on this page.
//
// Design: docs/POS_IMPLEMENTATION_PLAN.md
// =============================================================================

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import DataService from './db-service.js';
import { applyToPage } from './onboarding-gate.js';
// The availability rule, shared with the DAL and therefore with the floor plan,
// the Create Order dialog and the reservations board. One answer to "can this
// table take someone", or the room gets sold twice.
import {
    HOLDING_STATUSES, DEFAULT_DURATION_MIN,
    toMs, reservationWindow, reservationConflicts, isLate,
    tableStateAt, walkInBlockedReason,
    formatClock, formatWindow, dayKey, startOfDay, startOfWeek, addDays
} from './pos-availability.js';

const firebaseConfig = {
    apiKey: 'AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA',
    authDomain: 'fluxyos.com',
    projectId: 'fluxyos',
    storageBucket: 'fluxyos.firebasestorage.app',
    messagingSenderId: '1084252368929',
    appId: '1:1084252368929:web:da73dc0db83fe592c7f360'
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const ds = new DataService(app);

const OUTLET_KEY = 'fluxyos-pos-outlet';

const state = {
    uid: null,
    outlets: [],
    outletId: null,
    tables: [],
    menu: [],
    orders: [],
    orderId: null,
    order: null,
    overview: null,
    shift: null,
    unwatch: null,
    busy: false,
    // Catalogue filters. Client-side on purpose: the menu is already fully
    // loaded (getPosMenu), so filtering is a paint, not a query — a till must
    // not wait on the network to narrow a list the cashier can already see.
    menuQuery: '',
    menuCategory: null,
    view: 'till',
    zone: null,
    // ── Reservations ────────────────────────────────────────────────────
    // The board's own view state. `resAnchor` is any moment inside the range
    // being shown; the range itself is derived from it, so moving a week and
    // switching to Month cannot disagree about where the user is.
    reservations: [],
    resRange: [],
    resPeriod: 'week',
    resLayout: 'calendar',
    resAnchor: Date.now(),
    resQuery: '',
    orderTab: 'all',
    orderQuery: '',
    // Longest-waiting FIRST by default. The board's whole purpose is "what needs
    // attention next", and newest-first answers the opposite question.
    orderSort: 'waiting',
    orderDate: 'today',
    orderService: 'all',
    // Floor-plan arrange mode. Drags are STAGED here and unsaved until Save, so
    // one mis-drag is not a trip to the database and Cancel has something to
    // undo. Keyed by table id → { x, y } in canvas percent.
    arranging: false,
    floorMoves: {},
    floorReset: false,
    // The automatic ledger sweep runs once per page load, not once per refresh —
    // the sweep ends in a refresh, and a refresh that swept would not stop.
    sweptOnce: false
};

// The till's own views. No new routes — the brief requires the existing ones
// preserved, and a cashier gains nothing from four URLs they never type.
// ── Business-type profiles ───────────────────────────────────────────────────
//
// One POS, several ways of selling. The workflow is verticalized by business
// type; the transaction engine, the posting rules and the inventory relief stay
// shared and know nothing about any of this.
//
// The important one is `ladder`. Every order used to walk the dine-in chain
// (open → sent → served → awaiting_payment → paid) because it was the only chain
// there was — correct for a restaurant, where the customer eats and then pays.
// It is wrong for every counter transaction, where the customer pays BEFORE they
// get the goods: a retail cashier pressed "Send to kitchen", "Mark served" and
// "Request bill" before reaching the one button that meant anything, on every
// single sale.
//
// This is UI only. `recordPosPayment` has no status precondition and
// `wsValidPosOrderUpdate` imposes no ordering, so `open → paid` was always legal
// at the data layer — which is why pay-first needs no schema change and no rules
// deploy. See docs/POS_BUSINESS_TYPE_STRATEGY.md.
// Translate a string built at runtime. The i18n MutationObserver only watches
// childList, so anything written into an existing node's ATTRIBUTE has to ask
// for itself. Falls back to English when the dictionary has not loaded.
const tr = (s) => (window.FluxyI18n && window.FluxyI18n.t ? window.FluxyI18n.t(s) : s);

const POS_PROFILES = {
    fnb: {
        ladder: { open: 'sent', submitted: 'sent', sent: 'ready', ready: 'served', served: 'awaiting_payment' },
        views: ['till', 'tables', 'orders', 'reservations', 'shift'],
        payFirst: false,
        // "Create Order" rather than "Takeaway": the button opens a choice now,
        // and naming it after one of the two options hid the other.
        startLabel: 'Create Order',
        closeLabel: 'Close',
        emptyTitle: 'No order open',
        // The SAME action as the topbar CTA, deliberately. Create Order is the
        // single entry point, and the dialog behind it already asks dine-in or
        // take away — so the one control on an empty panel is that, not a
        // detour into table setup.
        emptyAction: 'Create Order'
    },
    retail: {
        // Empty on purpose: there is no step between opening a sale and charging
        // for it. `advance()` reads "no next step" as "the only thing left is to
        // take the money", which is exactly what a counter sale is.
        ladder: {},
        views: ['till', 'orders', 'shift'],
        payFirst: true,
        startLabel: 'New sale',
        closeLabel: 'New sale',
        emptyTitle: 'No sale open',
        emptyAction: 'New sale'
    }
};

// Unknown or absent category falls back to F&B — today's behaviour, unchanged.
// An unstamped workspace reaching the till through the legacy email allowlist
// must not have its workflow altered by a field it does not carry.
function posProfile() {
    const cat = (typeof window !== 'undefined' && window.FluxyWorkspace
        && window.FluxyWorkspace.businessCategory) || null;
    return POS_PROFILES[cat] || POS_PROFILES.fnb;
}

// Title and subtext for every view, both shown in the page header.
//
// The subtext replaced a breadcrumb that read "FluxyOS • Orders" above a 24px
// heading that already said "Orders" — no information, and no trail to retrace
// either, since all four views live behind one URL. Each view now says what it
// is for in the one place a person looks first.
const VIEWS = {
    till:   { title: 'Point of Sale (POS)', sub: 'Ring up a sale — scan, search or tap a product.' },
    tables: { title: 'Tables',              sub: 'Tap a table to open or continue its order.' },
    orders: { title: 'Orders',              sub: 'Every order on the floor today, and everything already settled.' },
    // Named for the claim it makes, not the calendar it draws: a booking takes a
    // table out of supply, which is the only thing the rest of the till cares
    // about.
    reservations: { title: 'Reservations', sub: 'Bookings hold their table — the floor plan and the till will not sell it twice.' },
    shift:  { title: 'Shift',               sub: 'The cash drawer — what was counted against what was expected.' }
};

function setView(name) {
    if (!VIEWS[name]) name = 'till';
    state.view = name;
    document.querySelectorAll('.pos-view').forEach((v) => {
        v.classList.toggle('hidden', v.dataset.view !== name);
    });
    // `dashboard-active` is the SHARED sidebar's active class (orange text +
    // icon under .app-sidebar-light). Using a page-local `is-active` here gave
    // the till a nav with no visible current item — the styling lives in
    // shared-dashboard.css, so the class has to be the one it styles.
    document.querySelectorAll('#nav-container [data-view]').forEach((b) => {
        b.classList.toggle('dashboard-active', b.dataset.view === name);
    });
    $('pos-view-title').textContent = VIEWS[name].title;
    // A counter has no floor plan, so the till's own line has to differ — it is
    // the one view whose purpose changes with the business.
    $('pos-view-sub').textContent = (name === 'till' && posProfile().payFirst)
        ? 'Scan or tap a product to start a sale.'
        : VIEWS[name].sub;
    // The floor plan and the order lists are painted on demand: they read from
    // state.overview, which refresh() already holds, so switching is a repaint.
    if (name === 'tables') renderTables();
    if (name === 'orders') renderOrderLists();
    if (name === 'shift')  { renderShift(); renderShiftHistory(); }
    if (name === 'reservations') { renderReservations(); loadReservationRange().catch(() => {}); }
    // The topbar's till CTAs step aside on the planning surface: Create Order
    // and New reservation competing for one glance is two primary actions in one
    // zone, and the one that belongs to the screen you are on should win.
    document.querySelector('.pos-topbar-actions')?.classList.toggle('hidden', name === 'reservations');
    // Orders goes full width too, now that the cards carry their own detail.
    //
    // The panel was a second copy of what the card already shows, costing the
    // board ~380px — a third of its width — to duplicate it. With the cards
    // expanded there is nothing left for it to add, and the grid uses the space
    // for another column of orders instead.
    document.getElementById('pos-shell')?.classList.toggle('is-wide', name === 'shift' || name === 'orders' || name === 'reservations');
    closeSideNav();

    // A scanner types into whatever has focus, so at a counter the search box
    // has to have it by default — otherwise the first scan of every sale goes
    // nowhere and the cashier has to click the field first, which is the same
    // wasted motion pay-first exists to remove.
    //
    // Only when nothing else is focused: stealing focus out from under someone
    // mid-typing is worse than the problem it solves.
    if (name === 'till' && posProfile().payFirst) {
        const box = $('pos-menu-search');
        const idle = !document.activeElement || document.activeElement === document.body;
        if (box && idle) box.focus();
    }
}

// Replace the finance nav inside the SHARED sidebar with the till's.
//
// The chrome — logo, entity switcher, Lucide icons, the light theme, the profile
// block, the mobile drawer — all comes from sidebar-loader.js and
// shared-dashboard.css untouched. Only #nav-container's contents change, using
// the same `.section-label` / `.nav-item` / `.sidebar-icon` / `.sidebar-text`
// classes, so the two sidebars are the same component with a different menu and
// cannot drift apart when either is restyled.
//
// A first attempt built a parallel sidebar. It duplicated every one of those
// pieces and was visibly a different component within an hour.
const TILL_NAV = [
    { section: 'Point of sale' },
    { view: 'till',   id: 'nav-pos',        label: 'Point of Sale' },
    { view: 'tables', id: 'nav-outlet-pnl', label: 'Tables',  badge: 'pos-nav-tables' },
    { view: 'orders', id: 'nav-ledger',     label: 'Orders',  badge: 'pos-nav-orders' },
    { view: 'reservations', id: 'nav-invoices', label: 'Reservations', badge: 'pos-nav-res' },
    { view: 'shift',  id: 'nav-accounting', label: 'Shift',   badge: 'pos-nav-shift' }
];

function mountTillNav() {
    const host = document.getElementById('nav-container');
    if (!host) return false;

    const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || {};
    // Snapshot the Lucide icons the shared sidebar has ALREADY injected, keyed by
    // the nav ids this menu reuses. Taken before the wipe, obviously — and taken
    // from the DOM rather than redrawn here, so the till cannot end up with a
    // second icon family the first time the dashboard's are restyled.
    // Only the views this business actually uses. A retail till has no floor to
    // draw, and a menu entry onto a room that does not exist is worse than one
    // fewer entry.
    const nav = TILL_NAV.filter((n) => n.section || posProfile().views.includes(n.view));

    const icons = {};
    nav.filter((n) => n.id).forEach((n) => {
        const svg = document.querySelector(`#${n.id} .sidebar-icon`);
        if (svg) icons[n.id] = svg.outerHTML;
    });
    // The loader has not painted yet — try again rather than render iconless.
    if (!Object.keys(icons).length) return false;

    const item = (n) => `
        <button type="button" id="till-${n.view}" data-view="${n.view}"
            class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium w-full justify-center lg:justify-start">
            ${icons[n.id] || ''}
            <span class="sidebar-text text-[13px] sidebar-hide">${esc(n.label)}</span>
            ${n.badge ? `<span class="pos-nav-badge sidebar-hide" id="${n.badge}"></span>` : ''}
        </button>`;

    host.innerHTML = nav.map((n) => n.section
        ? `<p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2 sidebar-hide">${esc(n.section)}</p>`
        : item(n)).join('');

    host.querySelectorAll('[data-view]').forEach((b) => {
        b.addEventListener('click', () => setView(b.dataset.view));
    });

    // Only a role that HAS a dashboard is offered one — a cashier is denied
    // every collection behind that link, so it would be a door onto a wall.
    import('/assets/js/perms-service.js').then(({ isPosOnlyRole }) => {
        if (isPosOnlyRole(ws.role)) return;
        host.insertAdjacentHTML('beforeend',
            `<p class="section-label px-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2 sidebar-hide">Workspace</p>
             <a href="/dashboard" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all hover:bg-gray-800/50 text-gray-400 hover:text-white font-medium w-full justify-center lg:justify-start">
                <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                <span class="sidebar-text text-[13px] sidebar-hide">Back to Dashboard</span>
             </a>`);
    }).catch(() => {});

    // Reveals the nav and retires the shimmer. Set only once the till's items
    // are actually in the DOM, so the finance nav never gets a frame.
    host.setAttribute('data-till-nav', '1');
    mountOutletSwitcher();
    setView(state.view);
    return true;
}

// The sidebar's workspace switcher becomes an OUTLET switcher.
//
// A cashier belongs to exactly one workspace and never switches it, so that
// control spent the most prominent slot in the sidebar on a choice that does not
// exist for this role. The outlet is the one thing they DO switch, and every
// figure and every sale on the page is scoped by it.
function mountOutletSwitcher() {
    const wrap = document.getElementById('entity-switcher-wrap');
    if (!wrap || wrap.dataset.posOutlet) return;
    wrap.dataset.posOutlet = '1';
    wrap.classList.remove('relative');
    wrap.innerHTML = `
        <label class="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5" for="pos-outlet">Outlet</label>
        <select id="pos-outlet" aria-label="Outlet"></select>`;
    // fluxy-select.js auto-enhances selects added later via its MutationObserver,
    // so this gets the shared custom dropdown without a manual call — the same
    // control the rest of the app uses (DESIGN_SYSTEM §6: never the native one).
    document.getElementById('entity-switcher-menu')?.remove();
    bindOutlet();
    if (typeof outletMountedResolve === 'function') { outletMountedResolve(); outletMountedResolve = null; }
}

let outletMountedResolve = null;
const outletMounted = new Promise((res) => { outletMountedResolve = res; });

function closeSideNav() {
    // Switching view on a phone should close the drawer. The SHARED sidebar owns
    // those classes, so this reaches for them rather than inventing a second pair.
    document.getElementById('sidebar')?.classList.remove('sidebar-mobile-open');
    const bd = document.querySelector('.sidebar-mobile-backdrop');
    if (bd) { bd.classList.remove('is-visible'); bd.hidden = true; }
    document.body.style.overflow = '';
}

// ── Formatting ───────────────────────────────────────────────────────────────
// Rupiah, no space after Rp, dot thousands separator. Never a monospace face.
const rp = (n) => window.FluxyMoney.formatBase(Math.round(Math.abs(Number(n) || 0)));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const toast = (m, t = 'success') => (window.showToast ? window.showToast(m, t) : console.log(m));

// A till is used by people who cannot debug a stack trace. Show the reason.
function fail(err, fallback) {
    const msg = (err && err.message) ? err.message : fallback;
    console.error('[pos]', err);
    toast(msg || fallback, 'error');
}

// Guard every mutation: a double-tap on a slow connection must not open two
// orders or take payment twice.
//
// The guard is right; its SILENCE was not. Re-entry was refused by returning
// null, and nothing else happened — the button still looked live, the tap did
// nothing, and there was no spinner, no disabled state and no error. A cashier
// at a counter presses again. It also cost two spec failures on 2026-08-31
// before it was recognised, which is the same symptom seen from the outside.
//
// So the busy state is now IN THE DOM. `pointer-events: none` on the mutating
// controls means a press can no longer be swallowed — it cannot be made at all,
// and the control is visibly unavailable while the write is in flight. The
// dimming is delayed in CSS so a 200ms write does not flash the till grey.
async function once(fn) {
    if (state.busy) return null;
    state.busy = true;
    document.body.dataset.posBusy = '1';
    try { return await fn(); }
    finally {
        state.busy = false;
        delete document.body.dataset.posBusy;
    }
}

// ── Status vocabulary ────────────────────────────────────────────────────────
// Status is carried by TEXT everywhere. The colour is a second channel, never
// the only one.
// `action` is the NEXT STEP, named as the thing that is about to happen — it is
// the board's one instruction to the person reading it. Never "Pay Bill" on an
// order still in the kitchen: a button that names a later step invites the
// cashier to skip the one in front of them, and on a till that means a dish
// leaves the pass unrecorded.
//
const STATUS = {
    open:             { label: 'Open',             cls: 'fluxy-status-neutral', next: 'sent',             action: 'Process to Kitchen' },
    submitted:        { label: 'New QR order',     cls: 'fluxy-status-info',    next: 'sent',             action: 'Confirm Order' },
    sent:             { label: 'In the kitchen',   cls: 'fluxy-status-info',    next: 'ready',            action: 'Mark as Ready' },
    // Cooked and waiting to be carried out. Its own state because it is a
    // different person's problem: a plate under the pass is the runner's, not
    // the cook's, and without it the board shows a 12-minute "in the kitchen"
    // for food that was done in four.
    ready:            { label: 'Ready to serve',   cls: 'fluxy-status-warning', next: 'served',           action: 'Serve' },
    served:           { label: 'Served',           cls: 'fluxy-status-success', next: 'awaiting_payment', action: 'Request Bill' },
    awaiting_payment: { label: 'Awaiting payment', cls: 'fluxy-status-warning', next: null,               action: 'Pay Bill' },
    paid:             { label: 'Paid',             cls: 'fluxy-status-success', next: null,               action: null },
    void:             { label: 'Voided',           cls: 'fluxy-status-danger',  next: null,               action: null }
};

// ── Outlets ──────────────────────────────────────────────────────────────────

async function loadOutlets() {
    const dims = await ds.getDimensions(state.uid).catch(() => []);
    state.outlets = (dims || []).filter((d) => d.type === 'outlet' && d.status !== 'archived');

    const sel = $('pos-outlet');
    if (!sel) return false;
    // The hint lives beside the select in the sidebar, created with it. Written
    // through a helper because the select moved once already and a hard
    // `$('pos-outlet-hint').textContent` threw the moment it did — taking
    // loadOutlets, and therefore the whole catalogue, down with it.
    const setHint = (html) => {
        let el = document.getElementById('pos-outlet-hint');
        if (!el && sel.parentElement) {
            el = document.createElement('p');
            el.id = 'pos-outlet-hint';
            el.className = 'pos-outlet-hint';
            sel.parentElement.appendChild(el);
        }
        if (el) el.innerHTML = html;
    };
    if (!state.outlets.length) {
        sel.innerHTML = '<option value="">No outlets yet</option>';
        sel.disabled = true;
        // Not a dead end: say exactly where an outlet comes from. Outlets are
        // created in the receive-stock drawer today, which nobody would guess.
        setHint('Create one from <a href="/inventory" class="underline font-semibold">Inventory → Receive stock</a> first — a sale with no outlet cannot be attributed.');
        return false;
    }
    setHint('');
    sel.disabled = false;
    const stored = localStorage.getItem(OUTLET_KEY);
    state.outletId = state.outlets.some((o) => o.id === stored) ? stored : state.outlets[0].id;
    // Persist the FIRST resolution too, not just an explicit change. Without
    // this the till re-picked outlets[0] on every load, so adding an outlet that
    // sorted earlier would silently move a running till to a different room —
    // and its sales with it.
    localStorage.setItem(OUTLET_KEY, state.outletId);
    sel.innerHTML = state.outlets.map((o) =>
        `<option value="${esc(o.id)}"${o.id === state.outletId ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
    return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderMetrics() {
    const o = state.overview;
    if (!o) return;
    const c = o.counts;
    $('pos-metrics').innerHTML = [
        { v: `${c.tablesFree}/${c.tablesTotal}`, l: 'Tables free' },
        { v: String(c.activeOrders), l: 'Active orders' },
        { v: String(c.awaitingPayment), l: 'Awaiting payment', warn: c.awaitingPayment > 0 },
        // Labelled "recorded at the till" on purpose — see the header note.
        { v: rp(o.salesToday), l: `${c.paidToday} paid · at the till` }
    ].map((m) => `
        <div class="pos-metric">
            <div class="pos-metric-value${m.warn ? ' is-warn' : ''}">${esc(m.v)}</div>
            <div class="pos-metric-label">${esc(m.l)}</div>
        </div>`).join('');
}

// The two honesty signals. Both count things that are wrong and would otherwise
// be invisible, and both say what to do about it.
function renderBanners() {
    const o = state.overview;
    if (!o) return;
    const out = [];

    if (o.unpostedCount > 0) {
        out.push(`<div class="pos-note is-warn">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
            <span><strong>${o.unpostedCount} paid ${o.unpostedCount === 1 ? 'order has' : 'orders have'} not reached the ledger yet.</strong>
            The sale is recorded; the accounting entry still needs posting.
            <button id="pos-post-now" class="underline font-semibold">Post ${o.unpostedCount === 1 ? 'it' : 'them'} now</button>.</span>
        </div>`);
    }

    if (o.noCostBasisCount > 0) {
        const names = o.noCostBasisNames.map(esc).join(', ');
        const more = o.noCostBasisCount > o.noCostBasisNames.length
            ? ` and ${o.noCostBasisCount - o.noCostBasisNames.length} more` : '';
        // The interpolated names sit in their OWN node, away from the fixed
        // prose around them. Inlined, the whole sentence becomes one text node
        // that no dictionary key can ever match, so the banner would stay
        // English on a Bahasa-first dashboard.
        out.push(`<div class="pos-note is-warn">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
            <span><strong>${o.noCostBasisCount} menu ${o.noCostBasisCount === 1 ? 'item has' : 'items have'} no cost basis</strong>
            <span class="block text-[12px] mt-0.5">${names}${more}</span>
            <span>They sell at 100% margin, which will overstate your gross profit.</span>
            <span>Give each a recipe in</span> <a href="/inventory?tab=items">Inventory</a>.</span>
        </div>`);
    }

    // The §6 line: this page's figure is not the accounting figure, and says so.
    if (o.counts.paidToday > 0) {
        out.push(`<div class="pos-note is-info">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span>Figures here are what the till recorded. The accounting revenue figure lives on <a href="/revenue-overview">Revenue</a>, and matches once everything is posted.</span>
        </div>`);
    }

    const panel = $('pos-banners');
    panel.innerHTML = out.length ? out.join('')
        : '<div class="pos-bell-empty">Nothing needs your attention.</div>';

    // The count is what earns the bell: a badge that is always lit is furniture,
    // so the informational "till vs accounting" note is deliberately NOT counted
    // — it is context, not an action.
    const actionable = (o.unpostedCount > 0 ? 1 : 0) + (o.noCostBasisCount > 0 ? 1 : 0);
    const badge = $('pos-bell-count');
    if (badge) {
        badge.classList.toggle('hidden', actionable === 0);
        badge.textContent = String(actionable);
    }
    const post = $('pos-post-now');
    if (post) post.addEventListener('click', () => once(async () => {
        post.disabled = true;
        post.textContent = 'Posting…';
        try {
            await ds.emitUnpostedPosSales(state.uid);
            await ds.postPendingJournals(state.uid).catch(() => {});
            toast('Posted to the ledger.');
            await refresh();
        } catch (err) { fail(err, 'Could not post those sales.'); }
    }));
}

// The floor plan. It used to be the page's primary surface; the reference makes
// the CATALOGUE primary, so the grid moved behind the header's "Table Order"
// button. Same markup, same handlers, same startOrder/selectOrder calls — only
// where it is painted changed, which is why no order flow moved with it.
// The floor plan, drawn as a plan of a room.
//
// Tables sit where the manager put them. `layout_x` / `layout_y` on the table
// doc are its centre as a percentage of the canvas, so one arrangement reads
// correctly at every width — the floor keeps a fixed aspect ratio precisely so
// those percentages mean something stable.
//
// It was an auto-fill CSS grid until 2026-08-31, and a grid could never be
// right: it asserts that every table is equidistant from every other, which is
// the one thing about a dining room that is never true. Matching the screen to
// the room was left entirely to the person holding the tray.
//
// Two things in the reference are still NOT built, because FluxyOS has no data
// behind them and a floor plan that lies is worse than one that is plain:
//   · "Reserved" — there is no reservation concept. A third legend colour that
//     nothing can ever enter is decoration.
//   · exact seat counts per side — `seats` is display-only and often null, so
//     the chairs are a convention (and never written as a number).

// Where the tables nobody has placed yet go.
//
// Packed into rows against the MEASURED canvas and the MEASURED footprints,
// after paint — not from a proportional formula. The formula was the first cut
// and it could not work: it divided the canvas into equal cells and ignored how
// wide a table actually is, so at the width the floor really gets (~728px, the
// order panel takes the rest) six tables already overlapped and twelve
// overlapped twelve times. That is precisely the collision this view was
// reported for.
//
// Deterministic — same tables, same order, same result — because an unplaced
// floor that reshuffles on every reload gives "did my drag save?" no answer.
//
// The canvas grows when a room genuinely needs more than its 16:9 gives it.
// Overflowing furniture that cannot be reached is worse than a taller page.
function layoutUnplacedTables(floor) {
    // `refresh()` repaints the floor even when the Tables view is hidden, where
    // every rect is zero and nothing can be measured — pack on the next paint
    // that can actually see the canvas instead of dividing by nothing.
    if (!floor) return;
    const rect = floor.getBoundingClientRect();
    if (!rect.width) return;
    const els = [...floor.querySelectorAll('.pos-table[data-auto="1"]')];
    if (!els.length) return;

    const PAD = 18, GAP_X = 20, GAP_Y = 18;
    const avail = Math.max(80, rect.width - PAD * 2);

    const rows = [];
    let row = [], rowW = 0;
    els.forEach((el) => {
        const w = el.offsetWidth;
        if (row.length && rowW + GAP_X + w > avail) { rows.push({ items: row, w: rowW }); row = []; rowW = 0; }
        rowW += (row.length ? GAP_X : 0) + w;
        row.push(el);
    });
    if (row.length) rows.push({ items: row, w: rowW });

    const rowH = rows.map((r) => Math.max(...r.items.map((e) => e.offsetHeight)));
    const blockH = rowH.reduce((a, b) => a + b, 0) + GAP_Y * Math.max(0, rows.length - 1);
    const needed = blockH + PAD * 2;
    if (needed > rect.height) floor.style.minHeight = `${Math.ceil(needed)}px`;
    const H = Math.max(rect.height, needed);

    // Centred, not top-aligned. Four tables pinned to the ceiling of a 16:9
    // room with two thirds of the floor empty below reads as a layout that
    // failed rather than a small restaurant.
    let y = Math.max(PAD, (H - blockH) / 2);
    rows.forEach((r, ri) => {
        let x = PAD + (avail - r.w) / 2;
        r.items.forEach((el) => {
            const w = el.offsetWidth;
            el.style.left = `${((x + w / 2) / rect.width) * 100}%`;
            el.style.top = `${((y + rowH[ri] / 2) / H) * 100}%`;
            x += w + GAP_X;
        });
        y += rowH[ri] + GAP_Y;
    });
}

// Seats decide the FOOTPRINT, not a number on the screen. A two-top and an
// eight-top drawn the same size is the floor plan failing at its only job.
function tableFootprint(seats) {
    if (seats <= 2) return { w: 104, h: 66, perSide: 1 };
    if (seats <= 4) return { w: 128, h: 78, perSide: 2 };
    if (seats <= 6) return { w: 158, h: 82, perSide: 3 };
    return { w: 196, h: 92, perSide: Math.ceil(seats / 2) };
}

function elapsedSince(ts) {
    const t = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
    if (!t) return '';
    const mins = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
    const h = Math.floor(mins / 60);
    return `${String(h).padStart(2, '0')}.${String(mins % 60).padStart(2, '0')}h`;
}

function renderTables() {
    const o = state.overview;
    if (!o) return;
    const host = $('pos-tables');
    const empty = $('pos-tables-empty');
    const bar = document.querySelector('.pos-floor-bar');
    if (!host || !empty) return;

    if (!o.tables.length) {
        host.classList.add('hidden');
        bar?.classList.add('hidden');
        empty.classList.remove('hidden');
        window.renderEmptyState('pos-tables-empty', {
            title: 'No tables at this outlet yet',
            description: 'Add the tables in this room so orders can be attached to them. Takeaway orders work without one.',
            buttonText: 'Add a table',
            onAction: openTableDrawer
        });
        return;
    }
    empty.classList.add('hidden');
    host.classList.remove('hidden');
    bar?.classList.remove('hidden');

    // Arranging is `pos.manage` — the same capability that creates and archives
    // tables. A cashier reads the floor; they do not redraw the room.
    const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || null;
    const mayArrange = !!(ws && typeof ws.can === 'function' && ws.can('pos.manage'));
    $('pos-arrange-btn')?.classList.toggle('hidden', !mayArrange);

    const byTable = {};
    (o.activeOrders || []).forEach((ord) => { if (ord.table_id) byTable[ord.table_id] = ord; });
    // Reservations are read through the SAME function the Create Order dialog
    // and `createPosOrder` use. The floor plan does not get its own opinion
    // about what "free" means — that is precisely how a reserved table ends up
    // sold to a walk-in on one surface and held on another.
    const reservations = o.reservations || [];
    const now = Date.now();

    // Zone tabs, from `pos_tables.zone`. One zone is not a choice, so the strip
    // only appears when there is more than one floor to choose between — and
    // each floor is its own plan, which is why positions are per table rather
    // than per zone.
    const zones = [];
    o.tables.forEach((t) => { const z = t.zone || null; if (z && !zones.includes(z)) zones.push(z); });
    zones.sort((a, b) => a.localeCompare(b));
    if (state.zone && !zones.includes(state.zone)) state.zone = null;

    const tabs = zones.length > 1 ? `
        <div class="pos-floor-tabs" role="tablist" aria-label="Floors">
            ${[null].concat(zones).map((z) => `
                <button type="button" role="tab" aria-selected="${(state.zone || null) === z}"
                    class="pos-floor-tab${(state.zone || null) === z ? ' is-active' : ''}"
                    data-zone="${z === null ? '' : esc(z)}">${z === null ? 'All' : esc(z)}</button>`).join('')}
        </div>` : '';

    const shown = o.tables.filter((t) => !state.zone || (t.zone || null) === state.zone);

    const tables = shown.map((t, i) => {
        const ord = byTable[t.id];
        const avail = tableStateAt(t.id, { orders: o.activeOrders || [], reservations }, now);
        const res = avail.reservation;
        const cls = { free: 'is-free', occupied: 'is-busy', bill: 'is-bill', reserved: 'is-reserved' }[avail.state];
        const seats = Math.min(12, Math.max(2, Number(t.seats) || 4));
        const fp = tableFootprint(seats);
        // The pending position wins while a drag is unsaved, so a re-render
        // (an order lands, the clock ticks) does not snap the table back to
        // where it was before the manager moved it.
        const pending = state.floorMoves && state.floorMoves[t.id];
        const placed = !state.floorReset
            && Number.isFinite(Number(t.layout_x)) && Number.isFinite(Number(t.layout_y));
        const spot = pending || (placed ? { x: Number(t.layout_x), y: Number(t.layout_y) } : null);
        const chairRow = (n) => `<span class="pos-chairs">${'<i></i>'.repeat(Math.max(0, n))}</span>`;

        return `<button type="button" class="pos-table ${cls}"
                    data-table="${esc(t.id)}" data-order="${esc(ord ? ord.id : '')}"
                    ${spot ? '' : 'data-auto="1"'}
                    ${res ? `data-reservation="${esc(res.id)}"` : ''}
                    style="${spot ? `left:${spot.x}%; top:${spot.y}%;` : ''} --pos-table-w:${fp.w}px; --pos-table-h:${fp.h}px;"
                    aria-label="Table ${esc(t.label)}, ${seats} seats — ${
                        avail.state === 'reserved'
                            ? `reserved for ${esc(res.guest_name)} at ${esc(formatClock(toMs(res.starts_at)))}`
                            : (ord ? 'in use' : 'free')}">
            ${chairRow(fp.perSide)}
            <span class="pos-table-body">
                <span class="pos-table-top">
                    <span class="pos-table-label">${esc(t.label)}</span>
                    ${t.zone && !state.zone ? `<span class="pos-table-zone">${esc(t.zone)}</span>` : ''}
                </span>
                ${ord ? `<span class="pos-table-meta">
                    <span class="pos-table-money">${rp(ord.total_amount)}</span>
                    ${elapsedSince(ord.opened_at) ? `<span class="pos-table-since">${esc(elapsedSince(ord.opened_at))}</span>` : ''}
                </span>` : `<span class="pos-table-free">${
                    // Who and when, never a bare "Reserved". A cashier reading
                    // one word assumes the system is being cautious, and a
                    // cashier who assumes that seats the table anyway.
                    res ? `${esc(res.guest_name.split(' ')[0])} · ${esc(formatClock(toMs(res.starts_at)))}`
                        // A table free NOW with a booking later says so, so a
                        // two-hour party is not seated into a wall the cashier
                        // could have seen coming.
                        : (avail.upcoming ? `Free · booked ${esc(formatClock(toMs(avail.upcoming.starts_at)))}`
                            : 'Free')}</span>`}
            </span>
            ${chairRow(seats - fp.perSide)}
        </button>`;
    }).join('');

    const arranging = !!state.arranging;
    const arrangeBar = arranging ? `
        <div class="pos-arrange-bar">
            <p class="pos-arrange-hint">Drag each table to where it stands in the room.</p>
            <div class="pos-arrange-actions">
                <button type="button" class="pos-btn-ghost" data-arrange="reset">Reset to grid</button>
                <button type="button" class="pos-btn-ghost" data-arrange="cancel">Cancel</button>
                <button type="button" class="pos-btn-primary" data-arrange="save">Save layout</button>
            </div>
        </div>` : '';

    host.innerHTML = `${tabs}
        <div class="pos-floor${arranging ? ' is-arranging' : ''}" id="pos-floor">
            ${tables || '<p class="pos-floor-empty">No tables on this floor.</p>'}
        </div>
        ${arrangeBar}`;

    // Pack the unplaced ones now that they have real widths on the page.
    layoutUnplacedTables(host.querySelector('#pos-floor'));

    host.querySelectorAll('[data-zone]').forEach((b) => b.addEventListener('click', () => {
        state.zone = b.dataset.zone || null;
        renderTables();
    }));

    if (arranging) { wireFloorDrag(host); wireArrangeBar(host); return; }

    host.querySelectorAll('[data-table]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const orderId = btn.dataset.order;
            if (orderId) {
                // An occupied table: the order already exists, so open it and go
                // where the work is.
                selectOrder(orderId);
                renderOrderControls();
                setView('till');
                return;
            }
            // A RESERVED table opens its booking, not a walk-in order. This is
            // the requirement made physical: the cashier cannot take this table
            // for someone else without first releasing it, and the release is a
            // deliberate act (seat them, cancel, or mark a no-show) rather than
            // a dialog they can click past.
            const resId = btn.dataset.reservation;
            if (resId) {
                const r = (state.overview.reservations || []).find((x) => x.id === resId);
                if (r) { openReservationDetail(r); return; }
            }
            // A FREE table asks the same questions the Create Order button does,
            // with the table already answered. It used to open an order on the
            // spot knowing nothing about it — and since the details can only be
            // taken at creation, that meant a table order could never have any.
            openCreateOrderDialog({ tableId: btn.dataset.table });
        });
    });
    mountTableArchive(host);
}

// Dragging, on pointer events so a finger on the tablet at the host stand works
// exactly like a mouse. Positions are held in `state.floorMoves` until Save —
// a layout that writes on every drop turns one mis-drag into a trip to the
// database, and gives Cancel nothing to undo.
function wireFloorDrag(host) {
    const floor = host.querySelector('#pos-floor');
    if (!floor) return;
    state.floorMoves = state.floorMoves || {};

    floor.querySelectorAll('[data-table]').forEach((el) => {
        el.addEventListener('click', (e) => e.preventDefault());   // arrange mode does not open orders
        el.addEventListener('pointerdown', (e) => {
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();
            const rect = floor.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            // Grab OFFSET, so the table does not jump its centre to the cursor
            // the moment it is touched.
            const dx = e.clientX - (box.left + box.width / 2);
            const dy = e.clientY - (box.top + box.height / 2);
            // Half the table, as a percentage — the clamp that keeps furniture
            // inside the walls instead of half-way through them.
            const padX = (box.width / 2 / rect.width) * 100;
            const padY = (box.height / 2 / rect.height) * 100;

            el.classList.add('is-dragging');
            el.setPointerCapture(e.pointerId);

            const move = (ev) => {
                const x = ((ev.clientX - dx - rect.left) / rect.width) * 100;
                const y = ((ev.clientY - dy - rect.top) / rect.height) * 100;
                // Snapped to a half-percent so a row of tables lines up by hand.
                const snap = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n * 2) / 2));
                const nx = snap(x, padX, 100 - padX);
                const ny = snap(y, padY, 100 - padY);
                el.style.left = `${nx}%`;
                el.style.top = `${ny}%`;
                state.floorMoves[el.dataset.table] = { x: nx, y: ny };
            };
            const up = () => {
                el.classList.remove('is-dragging');
                el.removeEventListener('pointermove', move);
                el.removeEventListener('pointerup', up);
                el.removeEventListener('pointercancel', up);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        });
    });
}

function wireArrangeBar(host) {
    host.querySelectorAll('[data-arrange]').forEach((btn) => btn.addEventListener('click', async () => {
        const what = btn.dataset.arrange;

        if (what === 'cancel') {
            state.floorMoves = {};
            state.floorReset = false;
            state.arranging = false;
            setArrangeButton();
            renderTables();
            return;
        }

        if (what === 'reset') {
            // Ignore what is saved and re-pack from scratch. Staged like any
            // other change — nothing is written until Save, so Cancel still
            // puts the room back.
            state.floorMoves = {};
            state.floorReset = true;
            renderTables();
            return;
        }

        // Save what is ON THE FLOOR, not only what was dragged. "Save layout"
        // that persisted three nudged tables and silently dropped the tidy
        // arrangement of the other nine would be answering a different question
        // than the button asks.
        const moves = [...host.querySelectorAll('#pos-floor .pos-table')]
            .map((el) => ({ id: el.dataset.table, x: parseFloat(el.style.left), y: parseFloat(el.style.top) }))
            .filter((m) => m.id && Number.isFinite(m.x) && Number.isFinite(m.y));
        if (!moves.length) {
            state.arranging = false;
            state.floorReset = false;
            setArrangeButton();
            renderTables();
            return;
        }
        await once(async () => {
            try {
                await ds.savePosTableLayout(state.uid, moves);
                toast(`Layout saved — ${moves.length} ${moves.length === 1 ? 'table' : 'tables'}.`);
                state.floorMoves = {};
                state.floorReset = false;
                state.arranging = false;
                setArrangeButton();
                await refresh();
                renderTables();
            } catch (err) { fail(err, 'Could not save the layout.'); }
        });
    }));
}

function setArrangeButton() {
    const btn = $('pos-arrange-btn');
    if (!btn) return;
    const label = btn.querySelector('span');
    if (label) label.textContent = state.arranging ? 'Done arranging' : 'Arrange layout';
    btn.classList.toggle('is-on', !!state.arranging);
}

// "Table Order" is now a VIEW, not a drawer. A drawer over the catalogue was
// the right shape when the floor plan was a secondary surface; with its own nav
// entry it is a place you go, and two ways to reach the same grid is one more
// than a cashier should have to learn.
function openTableSheet() { setView('tables'); }

// ── Orders view ─────────────────────────────────────────────────────────────
//
// Built to the supplied reference: status tabs, search, and a card grid where
// each card carries table → status → order meta → items → total → actions.
//
// The statuses are FluxyOS's real ones, not the reference's vocabulary. The
// reference lists "Ready", "In Kitchen", "Waiting for Payment"; this ledger's
// order states are open → sent → served → awaiting_payment → paid, and inventing
// a display state that no order can ever be in is how a board stops meaning
// anything. The two tabs map onto the real states rather than the labels.
// One tab per REAL status, in ladder order: open → sent → served →
// awaiting_payment → paid. The tab labels are the kitchen's words, but each one
// resolves to a status an order can genuinely be in — a board with a tab nothing
// can ever land in stops meaning anything.
const ORDER_TABS = {
    all:     (o) => o.status !== 'void',
    // Being taken at the till, or a QR order not yet confirmed. Nothing has
    // reached the kitchen.
    process: (o) => ['open', 'submitted'].includes(o.status),
    kitchen: (o) => o.status === 'sent',
    ready:   (o) => o.status === 'ready',
    served:  (o) => o.status === 'served',
    bill:    (o) => o.status === 'awaiting_payment',
    done:    (o) => o.status === 'paid'
};

// ── Waiting time, and what counts as late ───────────────────────────────────
//
// The clock starts when the order ENTERED its current status, not when it was
// created: a table that has been served and is waiting to pay is not "40 minutes
// late in the kitchen". `status_changed_at` carries that; orders written before
// the field existed fall back to `opened_at`, which over-states the wait rather
// than under-stating it — the safe direction for a queue.
function statusSince(o) {
    const t = o.status_changed_at && typeof o.status_changed_at.toDate === 'function'
        ? o.status_changed_at.toDate()
        : (o.opened_at && typeof o.opened_at.toDate === 'function' ? o.opened_at.toDate() : null);
    return t;
}

function waitMs(o, now = Date.now()) {
    const t = statusSince(o);
    return t ? Math.max(0, now - t.getTime()) : 0;
}

// Minutes before a status is "slow" and then "late". These are per-status
// because the same number means different things: four minutes holding a bill a
// customer has asked for is worse service than four minutes of cooking.
//
// A terminal status has no clock — a paid order is not waiting for anybody, and
// a permanently amber board teaches staff to ignore the colour.
const SLA = {
    open:             { warn: 3,  late: 6 },
    submitted:        { warn: 2,  late: 5 },
    sent:             { warn: 10, late: 18 },
    // The tightest clock on the board, deliberately. Food that is cooked and
    // not moving is the thing that reaches the customer cold, and the fix costs
    // one person ten seconds — so it should shout early.
    ready:            { warn: 2,  late: 4 },
    served:           { warn: 15, late: 30 },
    awaiting_payment: { warn: 4,  late: 8 },
    paid: null,
    void: null
};

// Past this, an order is not late — it is ABANDONED, and saying "late" about it
// is how a board ends up entirely red. Observed on the real till: open carts from
// the previous day rendered "23h 1m LATE" beside a dish that was genuinely six
// minutes over, and the two were indistinguishable. A screen where everything
// shouts has stopped saying anything.
//
// Two hours is past any service window and comfortably short of a trading day,
// so nothing in a live service can reach it by accident.
const STALE_MINS = 120;

/** 'ok' | 'warn' | 'late' | 'stale' | null (null = waiting on nobody). */
function waitLevel(o, now = Date.now()) {
    const sla = SLA[o.status];
    if (!sla) return null;
    const mins = waitMs(o, now) / 60000;
    if (mins >= STALE_MINS) return 'stale';
    if (mins >= sla.late) return 'late';
    if (mins >= sla.warn) return 'warn';
    return 'ok';
}

function fmtWait(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

// How overdue an order is, as a MULTIPLE of its own late threshold. Comparing
// raw minutes would always float the kitchen above the till, because cooking
// legitimately takes longer than sending — so a 12-minute dish would outrank a
// bill the customer asked for 7 minutes ago and is still sitting with.
function urgency(o, now = Date.now()) {
    const sla = SLA[o.status];
    if (!sla) return -1;
    const mins = waitMs(o, now) / 60000;
    // A stale cart ranks BELOW everything live. Left on the same scale a
    // day-old order scores ~200x and permanently owns the top of the board,
    // burying the dish that is actually six minutes over.
    if (mins >= STALE_MINS) return -0.5;
    return mins / sla.late;
}

const ORDER_SORTS = {
    waiting:    (a, b, now) => urgency(b, now) - urgency(a, now) || waitMs(b, now) - waitMs(a, now),
    newest:     (a, b) => openedMs(b) - openedMs(a),
    oldest:     (a, b) => openedMs(a) - openedMs(b),
    time_early: (a, b) => timeOfDay(a) - timeOfDay(b),
    time_late:  (a, b) => timeOfDay(b) - timeOfDay(a)
};

function openedMs(o) {
    const t = o.opened_at && typeof o.opened_at.toDate === 'function' ? o.opened_at.toDate() : null;
    return t ? t.getTime() : 0;
}

// Minutes since midnight, so "earliest time" means time-of-day rather than
// date. On a board showing one day it agrees with oldest-first; across several
// days it is the different question it sounds like.
function timeOfDay(o) {
    const t = o.opened_at && typeof o.opened_at.toDate === 'function' ? o.opened_at.toDate() : null;
    return t ? t.getHours() * 60 + t.getMinutes() : 0;
}

function inDateWindow(o, mode) {
    if (mode === 'all') return true;
    const t = openedMs(o);
    if (!t) return mode === 'all';
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const startToday = d.getTime();
    if (mode === 'today') return t >= startToday;
    if (mode === 'yesterday') return t >= startToday - 86400000 && t < startToday;
    if (mode === 'week') return t >= startToday - 6 * 86400000;
    return true;
}

function visibleOrders() {
    const ov = state.overview || {};
    const all = (ov.activeOrders || []).concat(ov.paidToday || []);
    const pass = ORDER_TABS[state.orderTab] || ORDER_TABS.all;
    const q = (state.orderQuery || '').trim().toLowerCase();
    // One `now` for the whole pass. Reading Date.now() inside the comparator
    // gives the sort a moving target, which is a genuine way to get an unstable
    // (and briefly wrong) order out of Array.sort.
    const now = Date.now();
    return all.filter((o) => {
        if (!pass(o)) return false;
        if (!inDateWindow(o, state.orderDate)) return false;
        if (state.orderService === 'dine_in' && !o.table_id) return false;
        if (state.orderService === 'takeaway' && o.table_id) return false;
        if (!q) return true;
        // Name, order, table — plus the item names, because "who ordered the
        // waffles" is how a cashier actually finds a bill.
        return String(o.order_number || '').toLowerCase().includes(q)
            || String(o.table_label || '').toLowerCase().includes(q)
            || (o.table_label ? false : 'takeaway'.includes(q))
            || (o.lines || []).some((l) => String(l.item_name || '').toLowerCase().includes(q));
    }).sort((a, b) => {
        // Terminal orders never outrank live ones, whatever the sort. A paid
        // bill is not competing for anybody's attention, and letting it sit at
        // the top of a kitchen screen because it happens to be newest is the
        // exact failure this board exists to avoid.
        const liveA = SLA[a.status] ? 1 : 0;
        const liveB = SLA[b.status] ? 1 : 0;
        if (liveA !== liveB) return liveB - liveA;
        // "Longest waiting" is meaningless once BOTH orders are settled — nobody
        // is waiting on either. Left to the urgency comparator they fell through
        // to its raw-elapsed tiebreak, which put the OLDEST paid order first and
        // turned the Completed tab back to front. Newest-first is what someone
        // reviewing completed sales wants, and it is what the tab did before.
        if (!liveA && !liveB && state.orderSort === 'waiting') return openedMs(b) - openedMs(a);
        const cmp = ORDER_SORTS[state.orderSort] || ORDER_SORTS.waiting;
        return cmp(a, b, now) || openedMs(b) - openedMs(a);
    });
}

// The identifier a cashier scans for. "TA" for takeaway, matching the reference.
function orderTag(o) {
    return o.table_label ? String(o.table_label) : 'TA';
}

// `20260831-018` is the full order number and it is unreadable on a card: it
// wrapped across three lines and collided with the status badge. The date is
// already shown beneath, so the card carries only the per-day sequence, which is
// the half a cashier actually calls out.
function orderShort(o) {
    const n = String(o.order_number || '');
    const seq = n.includes('-') ? n.split('-').pop() : n;
    return seq ? `#${seq}` : 'Order';
}

// The word that goes beside the figure. `ok` gets none: a number with no label
// is the quiet state, which is most of the board most of the time.
const WAIT_TAG = { warn: 'slow', late: 'late', stale: 'stale' };

// The number the kitchen actually scans for.
//
// Text first, colour second — "18m · late" is legible to a colour-blind cook and
// on a screen washed out by service-line lighting, and the DESIGN_SYSTEM rule is
// that status is never colour-alone. `data-wait-*` lets the ticker refresh the
// figure in place every few seconds without re-rendering the grid and stealing
// focus out of the search box.
function waitChip(o, now = Date.now()) {
    const lvl = waitLevel(o, now);
    if (!lvl) return '';                       // paid or void: waiting on nobody
    const since = statusSince(o);
    return `<span class="pos-wait is-${lvl}" data-wait-since="${since ? since.getTime() : ''}"
                  data-wait-status="${esc(o.status || '')}"
                  title="In this status since ${since ? esc(since.toLocaleTimeString(window.FluxyMoney.baseLocale(), { hour: '2-digit', minute: '2-digit' })) : ''}">
        <span class="pos-wait-num">${esc(fmtWait(waitMs(o, now)))}</span>
        ${WAIT_TAG[lvl] ? `<span class="pos-wait-tag">${WAIT_TAG[lvl]}</span>` : ''}
    </span>`;
}

// Keep the clock honest without repainting the board.
//
// Two cadences on purpose. The FIGURES tick every 15s in place, because a chip
// reading "9m" on a screen that has been open for half an hour is a lie the
// kitchen would act on. The SORT is only re-run every 60s, and only when nobody
// is typing — re-ordering cards under a cook's finger mid-tap is how the wrong
// order gets opened.
let waitTicker = null;
let lastResort = 0;

function tickWaits() {
    const view = document.querySelector('.pos-view[data-view="orders"]');
    if (!view || view.classList.contains('hidden')) return;

    const now = Date.now();
    document.querySelectorAll('.pos-wait[data-wait-since]').forEach((el) => {
        const since = Number(el.dataset.waitSince);
        if (!since) return;
        const status = el.dataset.waitStatus;
        const sla = SLA[status];
        if (!sla) return;
        const ms = Math.max(0, now - since);
        const mins = ms / 60000;
        const lvl = mins >= STALE_MINS ? 'stale'
            : (mins >= sla.late ? 'late' : (mins >= sla.warn ? 'warn' : 'ok'));
        const num = el.querySelector('.pos-wait-num');
        if (num) num.textContent = fmtWait(ms);
        el.classList.remove('is-ok', 'is-warn', 'is-late', 'is-stale');
        el.classList.add(`is-${lvl}`);
        const tag = el.querySelector('.pos-wait-tag');
        if (!WAIT_TAG[lvl]) { if (tag) tag.remove(); }
        else if (tag) { tag.textContent = WAIT_TAG[lvl]; }
        else {
            const span = document.createElement('span');
            span.className = 'pos-wait-tag';
            span.textContent = WAIT_TAG[lvl];
            el.appendChild(span);
        }
        el.closest('.pos-ocard')?.classList.toggle('is-late', lvl === 'late');
    });

    const typing = document.activeElement
        && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!typing && state.orderSort === 'waiting' && now - lastResort > 60000) {
        lastResort = now;
        renderOrderLists();
    }
}

function startWaitTicker() {
    if (waitTicker) return;
    waitTicker = setInterval(tickWaits, 15000);
}

// ── Sort & filter panel ─────────────────────────────────────────────────────
//
// The dashboard's filter component, driven by the same shape the Ledger uses: a
// rail of groups on the left, single-select options on the right, a live result
// count, Reset and Apply. Reusing the CSS rather than re-styling means a cashier
// who has filtered the Ledger already knows this control.
//
// Every group is single-select here. The Ledger has multi-select groups because
// "Income AND Expense" is a real question; "sorted by newest AND by longest
// waiting" is not.
const POS_FILTER_GROUPS = [
    {
        key: 'orderSort', label: 'Sort', default: 'waiting',
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7h13M3 12h9M3 17h5M17 8v9m0 0 3-3m-3 3-3-3"/>',
        options: [
            // First because it is the board's whole argument: what needs
            // attention next, not what happened last.
            { value: 'waiting',    label: 'Longest waiting' },
            { value: 'newest',     label: 'Newest to oldest' },
            { value: 'oldest',     label: 'Oldest to newest' },
            { value: 'time_early', label: 'Earliest time' },
            { value: 'time_late',  label: 'Latest time' }
        ]
    },
    {
        key: 'orderDate', label: 'Date', default: 'today',
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0V11.25h18v7.5"/>',
        options: [
            { value: 'today',     label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'week',      label: 'Last 7 days' },
            { value: 'all',       label: 'All dates' }
        ]
    },
    {
        key: 'orderService', label: 'Service', default: 'all',
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M6 10v9m12-9v9"/>',
        options: [
            { value: 'all',      label: 'All orders' },
            { value: 'dine_in',  label: 'Dine in' },
            { value: 'takeaway', label: 'Take away' }
        ]
    }
];

let posPendingFilters = null;
let posActiveGroup = POS_FILTER_GROUPS[0].key;

const posFilterIsDefault = (g, st) => (st[g.key] ?? g.default) === g.default;

function posCountApplied(st) {
    return POS_FILTER_GROUPS.reduce((n, g) => (posFilterIsDefault(g, st) ? n : n + 1), 0);
}

function renderPosFilterRail() {
    const rail = $('pos-filter-rail');
    if (!rail) return;
    rail.innerHTML = POS_FILTER_GROUPS.map((g) => `
        <button type="button" class="fluxy-filter-rail-item" role="tab" data-group="${esc(g.key)}" aria-selected="${g.key === posActiveGroup}">
            <svg class="fluxy-filter-rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${g.icon}</svg>
            <span class="fluxy-filter-rail-label">${esc(g.label)}</span>
            <span class="fluxy-filter-rail-dot${posFilterIsDefault(g, posPendingFilters) ? ' hidden' : ''}" aria-hidden="true"></span>
        </button>`).join('');
}

function renderPosFilterOptions() {
    const host = $('pos-filter-options');
    const title = $('pos-filter-detail-title');
    const g = POS_FILTER_GROUPS.find((x) => x.key === posActiveGroup);
    if (!host || !g) return;
    if (title) title.textContent = g.key === 'orderSort' ? 'Sort by' : `Show only · ${g.label}`;
    const chosen = posPendingFilters[g.key] ?? g.default;
    host.innerHTML = g.options.map((o) => `
        <button type="button" class="fluxy-filter-option${o.value === chosen ? ' is-selected' : ''}" role="radio"
                aria-checked="${o.value === chosen}" data-value="${esc(o.value)}">
            <span class="fluxy-filter-radio" aria-hidden="true"></span>
            <span>${esc(o.label)}</span>
        </button>`).join('');
}

function updatePosFilterPreview() {
    // Counts against the PENDING selection, so Apply is never a surprise.
    const committed = { orderSort: state.orderSort, orderDate: state.orderDate, orderService: state.orderService };
    Object.assign(state, posPendingFilters);
    const n = visibleOrders().length;
    Object.assign(state, committed);

    const res = $('pos-filter-result-count');
    if (res) res.textContent = `Results: ${n.toLocaleString(window.FluxyMoney.baseLocale())}`;
    const applied = posCountApplied(posPendingFilters);
    const badge = $('pos-filter-applied-badge');
    if (badge) {
        badge.textContent = `${applied} applied`;
        badge.classList.toggle('hidden', applied === 0);
    }
}

function syncPosFilterTrigger() {
    const applied = posCountApplied(state);
    const count = $('pos-filter-count');
    if (count) {
        count.textContent = String(applied);
        count.classList.toggle('hidden', applied === 0);
    }
}

function positionPosFilterPanel() {
    const trigger = $('pos-orders-filter');
    const panel = $('pos-filter-panel');
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 12;
    const width = panel.offsetWidth || 520;
    // Right-aligned to the trigger, but clamped to the CONTENT's left edge, not
    // the window's. The till has a fixed sidebar the Ledger does not, and a
    // 520px panel hung off a trigger two-thirds across the board reached back
    // under it — the panel appeared to float over the navigation.
    const canvas = document.querySelector('.fluxy-page-canvas') || document.body;
    const minLeft = Math.max(gap, Math.round(canvas.getBoundingClientRect().left));
    const maxLeft = Math.max(minLeft, window.innerWidth - width - gap);
    const left = Math.min(Math.max(minLeft, rect.right - width), maxLeft);
    panel.style.setProperty('--fluxy-filter-panel-top', `${Math.round(rect.bottom + 6)}px`);
    panel.style.setProperty('--fluxy-filter-panel-left', `${Math.round(left)}px`);
}

function openPosFilterPanel() {
    const panel = $('pos-filter-panel');
    if (!panel) return;
    posPendingFilters = {
        orderSort: state.orderSort, orderDate: state.orderDate, orderService: state.orderService
    };
    posActiveGroup = POS_FILTER_GROUPS[0].key;
    renderPosFilterRail();
    renderPosFilterOptions();
    updatePosFilterPreview();
    panel.hidden = false;
    $('pos-orders-filter')?.setAttribute('aria-expanded', 'true');
    positionPosFilterPanel();
    requestAnimationFrame(positionPosFilterPanel);
}

function closePosFilterPanel() {
    const panel = $('pos-filter-panel');
    if (!panel) return;
    panel.hidden = true;
    $('pos-orders-filter')?.setAttribute('aria-expanded', 'false');
}

// Per-tab counts, and whether anything inside a tab is LATE.
//
// The count answers "how much work is in the kitchen"; the red mark answers
// "and is any of it in trouble" — without which a cook has to open all six tabs
// to find out. Counts respect the date and service filters, so the number on a
// tab always equals what pressing it will show.
// TEST SEAM — paints supplied rows through the real render path.
//
// The board's whole argument is about order AGE, and every threshold here is
// minutes long. Proving the 18-minute kitchen rule by waiting 18 minutes is not
// a test anyone runs twice, and manufacturing genuinely old orders means writing
// junk into a live workspace. This takes rows with known timestamps and repaints
// with them.
//
// Deliberately narrow: it does not expose `state`, it writes nothing, and it
// touches only this tab's DOM. Everything it can do, devtools could already do.
// Returns what it painted, so a caller can seed and read in ONE step. The live
// watcher repaints from real data whenever a QR order or another till writes, so
// seeding and asserting in two round-trips is a race the assertion loses — it
// reads the real board and reports a confusing failure about sort order.
window.__posSeedBoard = (rows) => {
    // FREEZE the board first.
    //
    // The live watcher repaints from real data whenever anything writes, which
    // detaches the seeded cards mid-interaction — Playwright reports "element
    // was detached from the DOM" on a card that was simply replaced. Patching
    // each spec around it treats the symptom; a seeded board is a frozen board
    // by definition, so seeding says so once and every seeded spec is
    // deterministic. Reversed by reloading the page, which every spec does.
    if (state.unwatch) { state.unwatch(); state.unwatch = null; }
    state.frozen = true;

    const all = (rows || []).map((o) => ({ ...o }));
    state.overview = {
        ...(state.overview || {}),
        activeOrders: all.filter((o) => o.status !== 'paid'),
        paidToday: all.filter((o) => o.status === 'paid'),
        tables: (state.overview || {}).tables || []
    };
    renderOrderLists();
    return [...document.querySelectorAll('.pos-ocard')].map((c) => {
        const w = c.querySelector('.pos-wait');
        return {
            status: c.dataset.status,
            level: w ? (String(w.className).match(/is-(ok|warn|late|stale)/) || [])[1] || null : null,
            text: w ? w.textContent.replace(/\s+/g, ' ').trim() : null,
            flagged: c.classList.contains('is-late'),
            // The card's actions, returned with everything else so a caller
            // never has to make a SECOND round-trip to read them — the live
            // watcher repaints from real data in between, and the assertion
            // then describes the real board instead of the seeded one.
            actions: [...c.querySelectorAll('.pos-ocard-btn')].map((b) => b.textContent.trim())
        };
    });
};

// The card's ONE action: whatever happens to this order next.
//
// It used to read "Pay Bills" on anything with a total, including an order still
// being typed at the till — naming a step three moves away and inviting the
// cashier to skip the ones in between. A settled order gets a receipt, because
// that is genuinely the only thing left to do with it, and a voided one gets
// nothing at all.
function cardAction(o) {
    const st = STATUS[o.status] || STATUS.open;
    if (o.status === 'paid') {
        return `<div class="pos-ocard-actions">
            <button type="button" class="pos-ocard-btn" data-print="${esc(o.id)}">Print receipt</button>
        </div>`;
    }
    if (!st.action) return '';
    // `data-advance` for a status move, `data-pay` for the one that opens money.
    const attr = o.status === 'awaiting_payment' ? 'data-pay' : 'data-advance';
    return `<div class="pos-ocard-actions">
        <button type="button" class="pos-ocard-btn is-primary is-only" ${attr}="${esc(o.id)}">${esc(st.action)}</button>
    </div>`;
}

function renderTabCounts() {
    const ov = state.overview || {};
    const all = (ov.activeOrders || []).concat(ov.paidToday || []);
    const now = Date.now();
    const scoped = all.filter((o) => inDateWindow(o, state.orderDate)
        && !(state.orderService === 'dine_in' && !o.table_id)
        && !(state.orderService === 'takeaway' && o.table_id));

    Object.keys(ORDER_TABS).forEach((key) => {
        const el = document.querySelector(`[data-otab-count="${key}"]`);
        if (!el) return;
        const rows = scoped.filter(ORDER_TABS[key]);
        el.textContent = rows.length ? String(rows.length) : '';
        el.classList.toggle('is-late', rows.some((o) => waitLevel(o, now) === 'late'));
    });
}

function renderOrderLists() {
    const grid = $('pos-orders-grid');
    const empty = $('pos-orders-empty');
    if (!grid || !empty) return;

    renderTabCounts();

    const rows = visibleOrders();
    if (!rows.length) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        empty.innerHTML = `<div class="fluxy-table-empty">
            <p class="fluxy-table-empty-title">${state.orderQuery ? 'No order matches that' : 'Nothing here yet'}</p>
            <p class="fluxy-table-empty-description">${state.orderQuery
                ? 'Try a table, an order number, or an item name.'
                : 'Orders appear as they are opened on the floor.'}</p>
        </div>`;
        return;
    }
    empty.classList.add('hidden');
    grid.classList.remove('hidden');

    // The card is the detail view now — the side panel is gone from this board,
    // so truncating to three lines would put the information behind a click that
    // no longer leads anywhere. A very long order still caps, because one
    // 30-line card would set the height of its whole grid row.
    const MAX_LINES = 8;

    const now = Date.now();
    grid.innerHTML = rows.map((o) => {
        const st = STATUS[o.status] || STATUS.open;
        const lvl = waitLevel(o, now);
        const when = o.opened_at?.toDate ? o.opened_at.toDate() : null;
        const lines = o.lines || [];
        const shown = lines.slice(0, MAX_LINES);
        const more = lines.length - shown.length;
        const payable = ['served', 'awaiting_payment'].includes(o.status)
            || (o.status !== 'paid' && o.status !== 'void' && Number(o.total_amount) > 0);

        return `<article class="pos-ocard${state.orderId === o.id ? ' is-open' : ''}${lvl === 'late' ? ' is-late' : ''}" data-order-card="${esc(o.id)}" data-status="${esc(o.status || '')}" tabindex="0" role="button"
                    aria-label="Order ${esc(o.order_number || '')}, ${o.table_label ? `table ${esc(o.table_label)}` : 'takeaway'}">
            <div class="pos-ocard-head">
                <!-- Blue for takeaway, navy for a table. The kitchen sorts by
                     service type before it reads anything else — a bag that
                     leaves the pass is a different job from a plate that goes to
                     a table — and scanning a column of identically-black badges
                     for the two letters "TA" is reading, not scanning.
                     Colour is never the only signal: the badge still says TA or
                     the table number, so the distinction survives a monochrome
                     kitchen printer, sunlight, and dichromacy. -->
                <span class="pos-otag${o.table_label ? '' : ' is-takeaway'}"
                      title="${esc(tr(o.table_label ? 'Dine In' : 'Takeaway'))}">${esc(orderTag(o))}</span>
                <div class="pos-ocard-id">
                    <!-- The service type is its OWN element on purpose. The DOM
                         translator matches whole text nodes, so "#018 · Takeaway"
                         as one node left the English word sitting in a fully
                         Bahasa card. -->
                    <p class="pos-ocard-meta">${esc(orderShort(o))} · <span>${o.table_label ? 'Dine In' : 'Takeaway'}</span></p>
                    <div class="pos-ocard-sub">
                        <p class="pos-ocard-when">${when
                            ? esc(when.toLocaleDateString(window.FluxyMoney.baseLocale(), { day: 'numeric', month: 'short' })
                                + ' · ' + when.toLocaleTimeString(window.FluxyMoney.baseLocale(), { hour: '2-digit', minute: '2-digit' }))
                            : ''}</p>
                        <span class="fluxy-table-status ${st.cls} pos-ocard-status">${esc(st.label)}</span>
                    </div>
                </div>
                ${waitChip(o, now)}
            </div>

            ${o.customer_name || o.guest_count ? `<div class="pos-ocard-who">${
                [o.customer_name ? esc(o.customer_name) : '',
                 o.guest_count ? `${Number(o.guest_count)} guests` : ''].filter(Boolean).join(' · ')
            }</div>` : ''}
            <!-- The order-level note is an instruction to the whole ticket —
                 an allergy, a "serve together". It outranks the line items, so
                 it sits above them and is the one thing on the card allowed to
                 carry a colour. -->
            ${o.note ? `<p class="pos-ocard-ordernote">${esc(o.note)}</p>` : ''}

            <table class="pos-ocard-items">
                <thead><tr><th>Items</th><th>Qty</th><th>Price</th></tr></thead>
                <tbody>
                    ${shown.map((l) => {
                        // Everything the person COOKING needs, on the card.
                        //
                        // A kitchen screen that hides "medium well" or "no ice"
                        // behind a tap is not a kitchen screen: hands are full,
                        // and the one thing a cook must never have to do is
                        // navigate. Modifiers and the line note are the order —
                        // without them the card says "Wagyu ×2" for two
                        // completely different plates.
                        const mods = (l.modifiers || []).map((m) => esc(m.option_name)).join(' · ');
                        const note = l.note ? esc(l.note) : '';
                        return `<tr>
                        <td>
                            <span class="pos-ocard-item">${esc(l.item_name)}</span>
                            ${mods ? `<span class="pos-ocard-mods">${mods}</span>` : ''}
                            ${note ? `<span class="pos-ocard-note">${note}</span>` : ''}
                        </td>
                        <td>${Number(l.quantity) || 0}</td>
                        <td>${rp((Number(l.gross_amount) || 0) - (Number(l.discount_amount) || 0))}</td>
                    </tr>`; }).join('')}
                    ${more > 0 ? `<tr class="pos-ocard-more"><td colspan="3">+${more} more</td></tr>` : ''}
                    ${!lines.length ? '<tr class="pos-ocard-more"><td colspan="3">Nothing added yet</td></tr>' : ''}
                </tbody>
            </table>

            <div class="pos-ocard-total"><span>Total</span><span>${rp(o.total_amount)}</span></div>

            ${cardAction(o)}
        </article>`;
    }).join('');

    // Clicking the card — anywhere but a button — opens it in the SHARED panel.
    // The list stays put behind it: navigating away from a board a cashier is
    // working through is the thing this view exists to avoid.
    // Opening a card takes the order to the TILL, where the full panel is.
    //
    // The board hides that panel — the cards carry their own detail now — but
    // "hidden" is not the same as "gone": Refund and Reprint live there and
    // nowhere else, so selecting a paid card without switching view left them
    // unreachable. That is precisely the dead end the refund spec exists to
    // prevent, and removing the panel re-created it.
    //
    // The card's own CTA is unaffected: it stops the event, so the next step is
    // still one press from the board.
    const open = (id) => { selectOrder(id); setView('till'); };
    grid.querySelectorAll('[data-order-card]').forEach((card) => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            open(card.dataset.orderCard);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            open(card.dataset.orderCard);
        });
    });
    // The next step, taken from the board without opening anything.
    grid.querySelectorAll('[data-advance]').forEach((b) =>
        b.addEventListener('click', (e) => {
            e.stopPropagation();                    // the card itself is clickable
            once(() => advanceOrderById(b.dataset.advance));
        }));
    grid.querySelectorAll('[data-pay]').forEach((b) =>
        b.addEventListener('click', async (e) => {
            e.stopPropagation();
            // AWAITED. `selectOrder` is async, and the old code opened the
            // payment sheet in the same tick — so it could read `state.order`
            // before the order it was about to charge had been loaded.
            selectOrder(b.dataset.pay);
            openPaymentModal();
        }));
    grid.querySelectorAll('[data-print]').forEach((b) =>
        b.addEventListener('click', () => {
            const o = visibleOrders().find((x) => x.id === b.dataset.print);
            if (o) openReceipt(o);
        }));
}

// ── Shift view ──────────────────────────────────────────────────────────────
async function renderShiftHistory() {
    const host = $('pos-shift-history');
    if (!host) return;
    host.innerHTML = '<div style="padding:14px 4px;color:#94A3B8;font-size:13px">Loading…</div>';
    try {
        const rows = await ds.listPosShifts(state.uid, { dimensionId: state.outletId, limitCount: 10 });
        if (!rows.length) {
            host.innerHTML = '<div style="padding:18px 4px;text-align:center;color:#94A3B8;font-size:13px">No shift has been closed at this outlet yet.</div>';
            return;
        }
        host.innerHTML = `<div class="pos-order-results" style="max-height:none;margin-top:0">${rows.map((sh) => {
            const closed = sh.closed_at && typeof sh.closed_at.toDate === 'function'
                ? sh.closed_at.toDate().toLocaleString(window.FluxyMoney.baseLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                : 'Open';
            const v = Number(sh.variance) || 0;
            // Over and short are both control signals — neither is hidden, and a
            // balanced drawer says so rather than showing a bare zero.
            const note = sh.status !== 'closed' ? 'Open'
                : (v === 0 ? 'Balanced' : (v < 0 ? `Short ${rp(Math.abs(v))}` : `Over ${rp(v)}`));
            return `<div class="pos-order-result" style="cursor:default">
                <span>${esc(closed)} · ${esc(String(sh.order_count || 0))} order${Number(sh.order_count) === 1 ? '' : 's'}</span>
                <span>${esc(note)}</span></div>`;
        }).join('')}</div>`;
    } catch (err) {
        host.innerHTML = '<div style="padding:14px 4px;color:#94A3B8;font-size:13px">Could not load shift history.</div>';
    }
}

// The dining type and table pickers are GONE from the panel.
//
// They were a second entry point that asked none of the questions the Create
// Order dialog asks, so an order started here could never carry a customer — and
// two ways in that behave differently is the kind of thing that gets reported as
// "the details are missing" rather than as a duplicate flow. Create Order is the
// only way an order begins now.
//
// Kept as a function because everything that used to change these controls still
// calls it; it simply has nothing left to do.
function renderOrderControls() { /* the panel has no controls of its own now */ }

// Every unpaid sale that is not the one on screen. In a pay-first profile that
// is exactly "parked": there are no tables, so a cart the cashier put down has
// nowhere to be except this list.
//
// Dine-in orders are excluded — a table order is already parked AT ITS TABLE,
// and listing it here would be a second way to do one thing.
function parkedSales() {
    const open = (state.overview && state.overview.activeOrders) || [];
    return open
        .filter((o) => !o.table_id && o.id !== state.orderId && o.status !== 'void'
            // An order with nothing on it is not a parked SALE — it is residue
            // from a cart that was opened and walked away from. Listing it makes
            // the cashier read past noise to find the one they put down, and
            // resuming it looks exactly like losing their items.
            && (o.lines || []).length > 0)
        .sort((a, b) => {
            const ta = a.opened_at?.toDate ? a.opened_at.toDate().getTime() : 0;
            const tb = b.opened_at?.toDate ? b.opened_at.toDate().getTime() : 0;
            return tb - ta;
        });
}

function renderParkedChip() {
    const chip = $('pos-parked-chip');
    if (!chip) return;
    const n = posProfile().payFirst ? parkedSales().length : 0;
    chip.classList.toggle('hidden', n === 0);
    $('pos-parked-count').textContent = String(n);
}

// One row per sale: what it is, what is on it, what it is worth, how long it has
// been sitting. The age matters — a cart from yesterday is almost certainly
// abandoned, and the cashier is the only one who can decide that.
function orderResultRow(ord) {
    const label = ord.note
        || (ord.table_label ? `Table ${ord.table_label}` : 'Takeaway');
    const count = (ord.lines || []).reduce((n, l) => n + (Number(l.quantity) || 0), 0);
    const age = elapsedSince(ord.opened_at);
    return `<button type="button" class="pos-order-result" data-open="${esc(ord.id)}">
        <span>${esc(label)}
            <span class="pos-order-result-meta">· ${count} ${count === 1 ? 'item' : 'items'}${age ? ` · ${esc(age)}` : ''}</span>
        </span>
        <span>${rp(ord.total_amount)}</span>
    </button>`;
}

function renderOrderSearch() {
    const box = $('pos-order-results');
    const input = $('pos-order-search');
    if (!box || !input) return;
    const q = input.value.trim().toLowerCase();
    const open = (state.overview && state.overview.activeOrders) || [];

    // An empty box used to mean "show nothing", which made every parked sale
    // invisible until the cashier guessed at a number they never saw. Empty now
    // means "show me what is parked" — but only when the panel was deliberately
    // opened, never as ambient clutter.
    if (!q) {
        if (!box.dataset.showParked) { box.classList.add('hidden'); box.innerHTML = ''; return; }
        const parked = parkedSales();
        box.classList.remove('hidden');
        box.innerHTML = parked.length
            ? parked.map(orderResultRow).join('')
            : '<div style="padding:10px 12px;font-size:13px;color:#94A3B8">No parked sales.</div>';
    } else {
        const hits = open.filter((ord) =>
            String(ord.order_number || '').toLowerCase().includes(q)
            || String(ord.table_label || '').toLowerCase().includes(q)
            || String(ord.note || '').toLowerCase().includes(q));
        box.classList.remove('hidden');
        box.innerHTML = hits.length ? hits.map(orderResultRow).join('')
            : '<div style="padding:10px 12px;font-size:13px;color:#94A3B8">No open order matches that.</div>';
    }

    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => once(async () => {
        // Resuming with a cart already open must PARK it, never drop it. That is
        // the whole defect this exists to fix, and it would be absurd to
        // reintroduce it here.
        await parkCurrentSale({ silent: true });

        const id = b.dataset.open;
        selectOrder(id);
        if (state.orderId !== id) {
            // The list is a snapshot. Another device — or the cashier's own
            // earlier tab — may have paid or voided this sale since it was drawn,
            // and `selectOrder` simply does nothing when it cannot find the
            // order. Doing nothing is the worst possible answer here: the cashier
            // taps a sale and the screen does not move, so they tap it again.
            toast('That sale is no longer open.', 'error');
            await refresh().catch(() => {});
            renderOrderSearch();
            renderParkedChip();
            return;
        }

        input.value = '';
        delete box.dataset.showParked;
        box.classList.add('hidden'); box.innerHTML = '';
        renderParkedChip();
    })));
}

// Put the open cart down. Returns false when there was nothing to put down.
//
// Nothing is written unless a label is given: an unpaid order is already parked
// by virtue of existing, so "hold" is just letting go of it on screen.
async function parkCurrentSale({ label = null, silent = false } = {}) {
    const o = state.order;
    if (!o || ['paid', 'void'].includes(o.status)) return false;
    if (!(o.lines || []).length) return false;
    // A dine-in order is ALREADY parked — at its table, where the floor plan
    // finds it. Parking it again would label a table order as though it were a
    // loose cart and put it in a list it does not belong in.
    if (o.table_id) return false;
    let parked = o;
    try {
        if (label) parked = await ds.setPosOrderLabel(state.uid, state.orderId, label);
    } catch (err) { fail(err, 'Could not label that sale.'); return false; }

    // Update the overview IN MEMORY rather than re-reading it.
    //
    // A refresh() here races the live watcher, which the label write has just
    // woken: two overlapping refreshes, one of them re-binding `state.order`
    // from a read taken while the order was still selected, and the cart the
    // cashier just put down flickers back onto the screen. We already hold the
    // updated document — there is nothing to go and fetch.
    if (state.overview) {
        const list = state.overview.activeOrders || (state.overview.activeOrders = []);
        const at = list.findIndex((x) => x.id === parked.id);
        if (at >= 0) list[at] = { ...list[at], ...parked };
        else list.push(parked);
    }
    state.orderId = null;
    state.order = null;
    renderOrder(); renderMenu(); renderParkedChip();
    if (!silent) toast(`Sale parked${label ? ` as "${label}"` : ''}.`);
    return true;
}

function menuCategories() {
    const seen = [];
    state.menu.forEach((m) => {
        const c = m.pos_category || null;
        if (c && !seen.includes(c)) seen.push(c);
    });
    return seen.sort((a, b) => a.localeCompare(b));
}

function visibleMenu() {
    const q = state.menuQuery.trim().toLowerCase();
    return state.menu.filter((m) => {
        if (state.menuCategory && (m.pos_category || null) !== state.menuCategory) return false;
        if (!q) return true;
        // Barcode too: a half-scanned or hand-typed code should narrow the grid
        // rather than empty it, so the cashier can still see what they meant.
        return String(m.name || '').toLowerCase().includes(q)
            || String(m.barcode || '').toLowerCase().includes(q);
    });
}

// ── Scanning ─────────────────────────────────────────────────────────────────
//
// A barcode scanner is a KEYBOARD. It types the code into whatever has focus and
// presses Enter — there is no device integration to write, no permission to ask
// for and nothing to pair. So "scanning" is: the search box receives a burst of
// characters and an Enter, and Enter means "this is a complete code, act on it".
//
// Exact match only, and never a partial one: `899100210` is a prefix of a real
// product's code, and adding the wrong item to a cart because a scan was cut
// short is worse than adding nothing.
function scanBarcode(raw) {
    const code = String(raw || '').trim();
    if (!code) return false;

    const hits = (state.menu || []).filter((m) => String(m.barcode || '').trim() === code);
    if (!hits.length) return false;
    if (hits.length > 1) {
        // Two products sharing a code is a data problem the cashier cannot solve
        // at the counter, and guessing between them books the wrong revenue
        // against the wrong item. Name it and refuse.
        toast(`${hits.length} products share the barcode ${code}. Fix the duplicate before scanning it.`, 'error');
        return true;
    }

    const item = hits[0];
    // A scanned item with options still has to ask — the scan says WHICH
    // product, not which size.
    if (posModifierGroups(item).length) { openModifierDrawer(item); return true; }
    addMenuLine(item.id, item.name, Number(item.sales_price));
    return true;
}

function renderChips() {
    const host = $('pos-cat-chips');
    if (!host) return;
    const cats = menuCategories();
    // One category is not a filter — it is a label, and a lone chip beside
    // "Show All" implies a choice that does not exist.
    if (cats.length < 2) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    const chip = (label, value) => {
        const active = (state.menuCategory || null) === value;
        return `<button type="button" role="tab" aria-selected="${active}"
                    class="pos-chip${active ? ' is-active' : ''}" data-cat="${value === null ? '' : esc(value)}">
                    ${esc(label)}</button>`;
    };
    host.innerHTML = [chip('Show All', null)].concat(cats.map((c) => chip(c, c))).join('');
    host.querySelectorAll('[data-cat]').forEach((b) => {
        b.addEventListener('click', () => {
            state.menuCategory = b.dataset.cat || null;
            renderChips(); renderMenu();
        });
    });
}

function renderMenu() {
    const host = $('pos-menu');
    const empty = $('pos-menu-empty');
    const count = $('pos-menu-count');

    if (!state.menu.length) {
        host.classList.add('hidden');
        empty.classList.remove('hidden');
        if (count) count.textContent = '';
        window.renderEmptyState('pos-menu-empty', {
            title: 'Nothing on the menu yet',
            description: 'An item appears here once it has a selling price and is marked visible on the till. Set both in Inventory.',
            buttonText: 'Open Inventory',
            onAction: () => { window.location.href = '/inventory?tab=items'; }
        });
        return;
    }

    const rows = visibleMenu();
    const open = !!state.order && !['paid', 'void'].includes(state.order.status);
    // At a counter nobody "opens an order" — they start scanning. In a pay-first
    // profile the catalogue stays live with no order, and the first tap creates
    // the sale and puts the item on it. Requiring "New sale" first would be the
    // extra tap this whole profile exists to remove.
    const live = open || (posProfile().payFirst && !!state.outletId);

    if (count) {
        count.textContent = rows.length === state.menu.length
            ? `${state.menu.length} item${state.menu.length === 1 ? '' : 's'}`
            : `${rows.length} of ${state.menu.length}`;
    }

    // A filter that matches nothing is not the same as an empty menu, and must
    // not offer "Open Inventory" as though the menu were unbuilt.
    if (!rows.length) {
        host.classList.add('hidden');
        empty.classList.remove('hidden');
        empty.innerHTML = `<div class="fluxy-table-empty">
            <p class="fluxy-table-empty-title">No item matches that</p>
            <p class="fluxy-table-empty-description">Try a different word, or clear the category filter.</p>
        </div>`;
        return;
    }

    empty.classList.add('hidden');
    empty.innerHTML = '';
    host.classList.remove('hidden');

    const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2)
        .map((w) => w[0] || '').join('') || '?';

    // What is already on this order, and how many. A cashier ringing up six
    // things needs to see at a glance which are on the bill — checking by reading
    // the panel is a context switch per item.
    const onOrder = {};
    ((state.order && state.order.lines) || []).forEach((l) => {
        onOrder[l.item_id] = (onOrder[l.item_id] || 0) + (Number(l.quantity) || 0);
    });

    host.innerHTML = rows.map((m) => `
        <button type="button" class="pos-card${onOrder[m.id] ? ' is-in-order' : ''}${m.image_path ? ' has-image' : ''}" data-item="${esc(m.id)}"
                data-price="${m.sales_price}" data-name="${esc(m.name)}" ${live ? '' : 'disabled'}
                title="${live ? '' : 'Open a table or start a takeaway order first'}">
            <span class="pos-card-media">
                <!-- The initial is the FALLBACK, and it stays until an image has
                     actually decoded. Most items have no photo, and one that
                     fails to load must land back on the card the till had before
                     images existed rather than on an empty grey tile.
                     The alt text is empty on purpose: the product name is the
                     next line of the same button, so a screen reader announcing
                     the photo would read it twice.
                     (No backticks in this comment - it sits inside a template
                     literal and one would end the string.) -->
                <span class="pos-card-initial">${esc(initials(m.name))}</span>
                ${m.image_path ? `<img alt="" hidden data-img="${esc(m.image_path)}">` : ''}
            </span>
            <span class="pos-card-name">${esc(m.name)}</span>
            <span class="pos-card-price">${rp(m.sales_price)}</span>
            ${cardStockTag(m)}
            ${onOrder[m.id]
                ? `<span class="pos-card-qty" aria-label="${onOrder[m.id]} on this order">${onOrder[m.id]}</span>`
                : '<span class="pos-card-add" aria-hidden="true">+</span>'}
        </button>`).join('');

    // One tile shape for the whole grid — see `.pos-grid.has-images`. Decided
    // from the ROWS on screen rather than the whole menu, so filtering to a
    // category of photo-less drinks compacts the grid instead of leaving it
    // spaced for pictures that are not there.
    host.classList.toggle('has-images', rows.some((m) => !!m.image_path));

    loadMenuImages(host);

    host.querySelectorAll('[data-item]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const item = (state.menu || []).find((m) => m.id === btn.dataset.item);
            // An item with options asks before it lands. One without still adds
            // in a single tap — the common case must not pay for the rare one.
            if (item && posModifierGroups(item).length) return openModifierDrawer(item);
            addMenuLine(btn.dataset.item, btn.dataset.name, Number(btn.dataset.price));
        });
        // Kept in sync with `live` above: a card that is tappable with no order
        // open must be able to open one.
        if (!state.orderId && posProfile().payFirst) btn.removeAttribute('disabled');
    });
}

// Product photos, fetched only when a card is about to be seen.
//
// Every read is AUTHENTICATED — `getItemImageObjectURL` sends the caller's ID
// token and storage.rules decides, so a menu photo can never become a public
// link. That rules out the obvious implementation (put a URL in `src`) and is
// the reason this needs code at all rather than an attribute.
//
// Two consequences of that, both handled here:
//
//   · one HTTP round trip per image. A 60-item menu eagerly loaded is 60
//     authenticated downloads on a tablet over a shop's wifi, which would make
//     the till slow at exactly the moment it is opened. An IntersectionObserver
//     fetches a photo when its card is near the viewport, so scrolling pays for
//     what it shows.
//   · `renderMenu` runs on every refresh — an order changes, the clock ticks —
//     so without a cache the same images would be re-fetched continuously. The
//     DAL caches the object URL per session, and `data-img-done` stops the
//     observer re-requesting a card that already has its picture.
function loadMenuImages(host) {
    const targets = [...host.querySelectorAll('img[data-img]:not([data-img-done])')];
    if (!targets.length) return;

    // ⚠️ OBSERVE THE TILE, NOT THE IMAGE.
    //
    // The <img> starts `hidden` so a slow or failed load degrades to the card's
    // initial rather than to a broken-image glyph — and `[hidden]` resolves to
    // `display: none`, which gives the element a ZERO-SIZE rect.
    // IntersectionObserver never reports a zero-area element as intersecting, so
    // observing the image itself meant the callback never fired, `paint()` never
    // ran, and no photo ever loaded. Nothing errored; the cards simply kept
    // their initials, which is indistinguishable from having no photo set.
    //
    // The media tile is the element that actually occupies space, so it is what
    // gets watched; the image it contains is what gets painted.
    const tileOf = (img) => img.closest('.pos-card-media') || img.closest('.pos-card') || img;

    const paint = async (img) => {
        if (img.dataset.imgDone) return;
        img.dataset.imgDone = '1';
        try {
            const url = await ds.getItemImageObjectURL(state.uid, img.dataset.img);
            // Swap only once the bytes have DECODED. Setting src and unhiding
            // together shows a broken-image glyph for as long as the fetch takes,
            // and forever if it fails.
            img.addEventListener('load', () => {
                img.hidden = false;
                img.closest('.pos-card-media')?.querySelector('.pos-card-initial')?.remove();
            }, { once: true });
            img.src = url;
        } catch (_) {
            // Silent, and deliberately so. A missing photo is a cosmetic gap on a
            // screen someone is using to serve a customer; the card still names
            // the product and takes the tap. The initial stays.
            img.remove();
            img.closest?.('.pos-card')?.classList.remove('has-image');
        }
    };

    if (typeof IntersectionObserver !== 'function') { targets.forEach(paint); return; }
    const byTile = new Map();
    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (!e.isIntersecting) return;
            io.unobserve(e.target);
            const img = byTile.get(e.target);
            if (img) paint(img);
        });
    }, { root: host.closest('.pos-catalog-body') || null, rootMargin: '200px' });
    targets.forEach((img) => {
        const tile = tileOf(img);
        byTile.set(tile, img);
        io.observe(tile);
    });
}

// Unguarded on purpose — see addMenuLine below.
async function addLineNow(itemId, itemName, unitPrice, modifiers = null, note = null) {
    try {
        // Pay-first: the first tap opens the sale. Sequential rather than
        // parallel on purpose — the line needs the order id.
        if (!state.orderId && posProfile().payFirst) {
            const order = await ds.createPosOrder(state.uid, {
                dimensionId: state.outletId,
                tableId: null, tableLabel: null, channel: 'staff',
                shiftId: state.shift ? state.shift.id : null
            });
            state.orderId = order.id;
            state.order = order;
        }
        state.order = await ds.addPosOrderLine(state.uid, state.orderId, {
            itemId, itemName, quantity: 1, unitPrice, modifiers, note
        });
        renderOrder();
    } catch (err) { fail(err, 'Could not add that item.'); }
}

// `once()` DOES NOT NEST. It returns null the moment `state.busy` is set, so a
// guarded call made from inside another guarded call does nothing at all, in
// silence. The drawer's submit handler already runs its onSubmit inside once(),
// so the modifier flow must call `addLineNow` directly — wrapping it cost an
// afternoon here: the drawer closed, no line appeared, no error anywhere.
function addMenuLine(itemId, itemName, unitPrice, modifiers = null, note = null) {
    return once(() => addLineNow(itemId, itemName, unitPrice, modifiers, note));
}

// ── Modifiers ────────────────────────────────────────────────────────────────
//
// The menu IS `items`, so modifier groups live on the item — no second master to
// drift from the recipe (docs/data-model/pos.md §1). A group is only real when it
// has options; a half-authored one is ignored rather than shown as an empty
// question the cashier cannot answer.
//
// `select` collapses min/max into the three shapes an F&B menu actually uses:
// size (one, required), sugar level (one, optional), add-ons (any).
function posModifierGroups(item) {
    const groups = Array.isArray(item && item.pos_modifier_groups) ? item.pos_modifier_groups : [];
    return groups
        .map((g) => ({
            id: String(g.id || ''),
            name: String(g.name || '').trim(),
            select: ['one_required', 'one_optional', 'many'].includes(g.select) ? g.select : 'one_optional',
            options: (Array.isArray(g.options) ? g.options : [])
                .map((o) => ({
                    id: String(o.id || ''),
                    name: String(o.name || '').trim(),
                    price_delta: Math.round(Number(o.price_delta) || 0)
                }))
                .filter((o) => o.id && o.name)
        }))
        .filter((g) => g.name && g.options.length);
}

const groupRule = (g) => (g.select === 'one_required' ? 'Choose one'
    : (g.select === 'many' ? 'Choose any' : 'Optional'));

function openModifierDrawer(item) {
    const groups = posModifierGroups(item);
    const base = Number(item.sales_price) || 0;
    const chosen = new Map();   // group_id → Set(option_id)

    const priceTag = (d) => (d === 0 ? '' : `<span class="pos-mod-delta">${d > 0 ? '+' : '−'}${rp(d)}</span>`);

    const d = drawer({
        title: item.name,
        subtitle: rp(base),
        submitLabel: 'Add to order',
        body: groups.map((g) => `
            <div class="pos-mod-group" data-group="${esc(g.id)}" data-select="${esc(g.select)}">
                <div class="pos-mod-head">
                    <span class="pos-mod-name">${esc(g.name)}</span>
                    <span class="pos-mod-rule">${groupRule(g)}</span>
                </div>
                <div class="pos-mod-options">
                    ${g.options.map((o) => `
                        <button type="button" class="pos-mod-opt" data-opt="${esc(o.id)}"
                                data-delta="${o.price_delta}" data-name="${esc(o.name)}">
                            <span>${esc(o.name)}</span>${priceTag(o.price_delta)}
                        </button>`).join('')}
                </div>
            </div>`).join(''),
        onSubmit: async () => {
            const picked = [];
            groups.forEach((g) => {
                (chosen.get(g.id) || new Set()).forEach((optId) => {
                    const o = g.options.find((x) => x.id === optId);
                    if (o) picked.push({
                        group_id: g.id, group_name: g.name,
                        option_id: o.id, option_name: o.name, price_delta: o.price_delta
                    });
                });
            });
            // NOT addMenuLine: this already runs inside the drawer's once().
            await addLineNow(item.id, item.name, base, picked);
        }
    });

    // The submit button carries the RESULTING price, so the number a cashier
    // reads before committing is the number the customer will be charged.
    const submit = d.querySelector('button[type="submit"][form="pos-drawer-form"]');
    const sync = () => {
        let delta = 0;
        let missing = false;
        groups.forEach((g) => {
            const set = chosen.get(g.id) || new Set();
            set.forEach((id) => { delta += (g.options.find((o) => o.id === id) || {}).price_delta || 0; });
            if (g.select === 'one_required' && set.size === 0) missing = true;
        });
        if (submit) {
            submit.disabled = missing;
            // Two text nodes, not one interpolated string: the DOM translator
            // matches WHOLE text nodes, so "Add to order · Rp52.000" would leave
            // the English half sitting in a Bahasa drawer.
            submit.innerHTML = missing
                ? '<span>Choose the required options</span>'
                : `<span>Add to order</span> · <span>${esc(rp(base + delta))}</span>`;
        }
    };

    d.querySelectorAll('.pos-mod-group').forEach((groupEl) => {
        const gid = groupEl.dataset.group;
        const single = groupEl.dataset.select !== 'many';
        groupEl.querySelectorAll('[data-opt]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const set = chosen.get(gid) || new Set();
                const id = btn.dataset.opt;
                if (set.has(id)) {
                    // A required group cannot be emptied by tapping the one
                    // choice again — that would arm a submit nobody can press.
                    if (!(single && groupEl.dataset.select === 'one_required')) set.delete(id);
                } else {
                    if (single) set.clear();
                    set.add(id);
                }
                chosen.set(gid, set);
                groupEl.querySelectorAll('[data-opt]').forEach((b) => {
                    b.classList.toggle('is-on', set.has(b.dataset.opt));
                    b.setAttribute('aria-pressed', String(set.has(b.dataset.opt)));
                });
                sync();
            });
        });
    });
    sync();
}

// What the one primary button says.
//
// In a pay-first profile it carries the AMOUNT — the number a cashier reads
// before committing is the number the customer will be charged, and it is due
// (total − already paid), so a part-paid sale asks for the balance rather than
// the whole bill again.
//
// Two text nodes, never one interpolated string: the DOM translator matches
// WHOLE text nodes, so "Charge Rp125.000" would leave the English word sitting
// in a Bahasa till.
function setPrimaryAction(primary, o, st) {
    const p = posProfile();
    if (o.status === 'paid' || o.status === 'void') {
        primary.textContent = p.closeLabel;
        return;
    }
    const nextIsPayment = o.status === 'awaiting_payment' || !p.ladder[o.status];
    if (p.payFirst && nextIsPayment) {
        const due = Math.max(0, (Number(o.total_amount) || 0) - (Number(o.paid_amount) || 0));
        primary.innerHTML = `<span>Charge</span> ${esc(rp(due))}`;
        return;
    }
    primary.textContent = st.action;
}

// What the till knows about stock, said plainly and never used to refuse a sale.
//
// A shop that has physically got the thing sells it, whatever the system
// believes — and a cashier cannot stop mid-service to reconcile inventory.
// Blocking the sale would make FluxyOS wrong about the MONEY as well as about
// the stock, which is the worse of the two errors. So this warns and gets out of
// the way; the negative on-hand it leaves behind is the correct record of what
// happened and shows up in the stock count as a real discrepancy.
//
// Silent on anything that has no on-hand number of its own: a service is never
// held as stock, and a recipe's availability belongs to its ingredients.
function itemStock(itemId) {
    const item = (state.menu || []).find((m) => m.id === itemId);
    if (!item || item.type === 'composite' || item.track_stock === false) return null;
    const map = (state.overview && state.overview.onHand) || null;
    if (!map || !(itemId in map)) return null;
    return Number(map[itemId]) || 0;
}

function stockNote(line, qty) {
    const left = itemStock(line.item_id);
    if (left === null) return '';
    if (left <= 0) {
        return `<div class="pos-line-stock is-out">Out of stock — selling it anyway will leave inventory short</div>`;
    }
    if (qty > left) {
        return `<div class="pos-line-stock is-out">Only ${left} in stock, ${qty} on this order</div>`;
    }
    if (left <= 5) return `<div class="pos-line-stock is-low">${left} left in stock</div>`;
    return '';
}

// Stock on the card, so the answer arrives BEFORE the item is on the bill.
// Never disables the card — see stockNote().
function cardStockTag(m) {
    if (!m || m.type === 'composite' || m.track_stock === false) return '';
    const map = (state.overview && state.overview.onHand) || null;
    if (!map || !(m.id in map)) return '';
    const left = Number(map[m.id]) || 0;
    if (left <= 0) return '<span class="pos-card-stock is-out">Out of stock</span>';
    if (left <= 5) return `<span class="pos-card-stock is-low">${left} left</span>`;
    return '';
}

function renderOrder() {
    const o = state.order;
    const lines = $('pos-order-lines');
    const totals = $('pos-order-totals');
    const primary = $('pos-primary');
    const badge = $('pos-order-status');
    const discountBtn = $('pos-discount-btn');
    const voidBtn = $('pos-void-btn');
    const refundBtn = $('pos-refund-btn');

    document.getElementById('pos-order-panel').classList.toggle('is-empty', !o);

    if (!o) {
        const prof = posProfile();
        $('pos-order-title').textContent = prof.emptyTitle;
        $('pos-order-sub').textContent = prof.payFirst
            ? 'Scan or tap a product to start.'
            // Names the two things that actually start an order. The button
            // directly below is Create Order, so this says what the OTHER way
            // in is rather than repeating the control under it.
            : (state.overview && state.overview.tables.length
                ? 'Start one below, or tap a free table.'
                : 'Start a take away below, or add a table first.');
        badge.classList.add('hidden');
        lines.innerHTML = '';
        totals.innerHTML = '';
        // Enabled, and it does something: a floor with no tables cannot take a
        // dine-in order at all, and this is the one control on screen when
        // nothing is open. On a counter it stays the "New sale" it always was.
        const prof2 = posProfile();
        primary.disabled = false;
        primary.textContent = prof2.emptyAction;
        primary.dataset.emptyAction = prof2.payFirst ? 'new-sale' : 'create-order';
        discountBtn.classList.add('hidden');
        voidBtn.classList.add('hidden');
        refundBtn.classList.add('hidden');
        $('pos-reprint-btn').classList.add('hidden');
        return;
    }

    const st = STATUS[o.status] || STATUS.open;
    $('pos-order-title').textContent = o.table_label ? `Table ${o.table_label}` : 'Takeaway';
    // Who it is for, beside the order number. Capturing a customer and then
    // never showing them back would make the dialog a form that goes nowhere —
    // and the name is what a cashier calls out when the food is ready.
    const who = [
        o.customer_name || null,
        o.guest_count ? `${o.guest_count} ${o.guest_count === 1 ? 'guest' : 'guests'}` : null,
        o.customer_phone || null
    ].filter(Boolean).join(' · ');
    $('pos-order-sub').textContent = `Order ${o.order_number || ''}`
        + (o.channel === 'qr' ? ' · scanned by the customer' : '')
        + (who ? ` · ${who}` : '');
    // `.fluxy-status` carries colour and nothing else — no padding, no
    // background, no radius — so the label rendered as bare tinted text jammed
    // against the table name. `.fluxy-table-status` is the actual pill. Same
    // omission as the Orders board had.
    badge.className = `fluxy-table-status ${st.cls} pos-order-badge`;
    badge.textContent = st.label;
    badge.classList.remove('hidden');

    const rows = o.lines || [];
    // "Not finished with" — said directly. It used to read `st.next || awaiting`,
    // which happened to mean the same thing only because STATUS still carries the
    // F&B chain; once the ladder became profile data that coincidence was one
    // edit away from silently locking a retail cart.
    const editableNow = !['paid', 'void'].includes(o.status);
    // Reference line shape: the name, the arithmetic spelled out
    // (`Rp10.000 × 2 = Rp20.000`), a stepper, notes, and a remove control.
    // Spelling out the multiplication is the reference's one genuinely better
    // idea — a cashier reading back a bill checks the sum, not the unit price.
    lines.innerHTML = rows.length ? rows.map((l) => {
        const qty = Number(l.quantity) || 0;
        const gross = Number(l.gross_amount) || 0;
        const disc = Number(l.discount_amount) || 0;
        const net = gross - disc;
        return `<div class="pos-line">
            <div class="pos-line-main">
                <div class="pos-line-head">
                    <div class="pos-line-name">${esc(l.item_name)}</div>
                    ${editableNow ? `<button type="button" class="pos-line-remove" data-remove="${esc(l.line_id)}"
                        aria-label="Remove ${esc(l.item_name)}" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                    </button>` : ''}
                </div>
                <div class="pos-line-calc">${rp((Number(l.unit_price) || 0) + (Number(l.modifier_amount) || 0))} × ${qty} = ${rp(gross)}</div>
                ${stockNote(l, qty)}
                ${(l.modifiers || []).length ? `<div class="pos-line-mods">${
                    l.modifiers.map((m) => esc(m.option_name)
                        + (m.price_delta ? ` (${m.price_delta > 0 ? '+' : '−'}${rp(m.price_delta)})` : '')).join(' · ')
                }</div>` : ''}
                ${disc > 0 ? `<div class="pos-line-meta" style="color:#C2410C">${esc(l.discount_reason || 'Discount')} −${rp(disc)} · now ${rp(net)}</div>` : ''}
                ${l.note ? `<div class="pos-line-meta">${esc(l.note)}</div>` : ''}
            </div>
            <div class="pos-line-amt">${rp(net)}</div>
            ${editableNow ? `
                <div class="pos-line-controls">
                    <div class="pos-qty">
                        <button type="button" data-dec="${esc(l.line_id)}" aria-label="One fewer ${esc(l.item_name)}">−</button>
                        <input type="text" class="pos-qty-input" data-qty="${esc(l.line_id)}"
                               value="${qty}" inputmode="numeric" autocomplete="off"
                               aria-label="Quantity of ${esc(l.item_name)}">
                        <button type="button" data-inc="${esc(l.line_id)}" aria-label="One more ${esc(l.item_name)}">+</button>
                    </div>
                    <button type="button" class="pos-line-note-btn" data-note="${esc(l.line_id)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>
                        ${l.note ? 'Edit note' : 'Note'}
                    </button>
                    <button type="button" class="pos-line-note-btn" data-disc="${esc(l.line_id)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 5 5 19M6.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>
                        Discount
                    </button>
                </div>` : ''}
        </div>`;
    }).join('') : '<div style="padding:24px 16px;text-align:center;color:#94A3B8;font-size:13px">Nothing added yet.</div>';

    // Remove = quantity 0. The DAL already drops a zero-quantity line, so this
    // reuses the same path the stepper does rather than adding a delete method.
    lines.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => once(async () => {
            try {
                state.order = await ds.setPosOrderLineQuantity(state.uid, state.orderId, btn.dataset.remove, 0);
                renderOrder();
            } catch (err) { fail(err, 'Could not remove that line.'); }
        }));
    });

    lines.querySelectorAll('[data-disc]').forEach((btn) => {
        btn.addEventListener('click', () => openDiscountDrawer(btn.dataset.disc));
    });
    lines.querySelectorAll('[data-note]').forEach((btn) => {
        btn.addEventListener('click', () => openLineNoteDrawer(btn.dataset.note));
    });
    // Typed quantity. Tapping "+" eleven times to sell a dozen is not a till,
    // and a stepper is only tolerable for the two or three it was designed for.
    // The steppers stay — most lines are one or two — but the number itself is
    // now a field.
    lines.querySelectorAll('[data-qty]').forEach((input) => {
        const commit = () => once(async () => {
            const id = input.dataset.qty;
            const line = (state.order.lines || []).find((l) => l.line_id === id);
            if (!line) return;
            const typed = String(input.value).replace(/\D/g, '');
            // Empty is not zero. Clearing the box to retype is the commonest
            // thing a person does in a number field, and reading that as "remove
            // the line" would delete an item mid-edit.
            if (typed === '') { input.value = String(Number(line.quantity) || 0); return; }
            // 999 is not a limit anyone will meet legitimately; it is a guard
            // against a leaning finger turning one coffee into 111111.
            const q = Math.min(999, Number(typed));
            if (q === Number(line.quantity)) return;
            try {
                state.order = await ds.setPosOrderLineQuantity(state.uid, state.orderId, id, q);
                renderOrder();
            } catch (err) {
                fail(err, 'Could not change that quantity.');
                input.value = String(Number(line.quantity) || 0);
            }
        });
        input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            // Escape abandons the edit rather than committing a half-typed number.
            if (e.key === 'Escape') {
                const line = (state.order.lines || []).find((l) => l.line_id === input.dataset.qty);
                input.value = String((line && Number(line.quantity)) || 0);
                input.blur();
            }
        });
    });

    lines.querySelectorAll('[data-inc],[data-dec]').forEach((btn) => {
        btn.addEventListener('click', () => once(async () => {
            const id = btn.dataset.inc || btn.dataset.dec;
            const line = (state.order.lines || []).find((l) => l.line_id === id);
            if (!line) return;
            const q = Number(line.quantity) + (btn.dataset.inc ? 1 : -1);
            try {
                state.order = await ds.setPosOrderLineQuantity(state.uid, state.orderId, id, Math.max(0, q));
                renderOrder();
            } catch (err) { fail(err, 'Could not change that quantity.'); }
        }));
    });

    // Reference totals stack. It separates PRODUCT discount (the sum of the line
    // discounts) from EXTRA discount (the order-level one) — a split FluxyOS
    // already stores but never showed, so this is the reference surfacing real
    // data rather than new arithmetic. `discount_total` is the sum of both.
    // The reference's "Coupon discount" row has no equivalent and is not built.
    const extraDisc = Number(o.discount_amount) || 0;
    const productDisc = Math.max(0, (Number(o.discount_total) || 0) - extraDisc);
    const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>';
    const canEdit = !['paid', 'void'].includes(o.status);

    const bits = [`<div class="pos-total-row"><span>Sub total</span><span>${rp(o.subtotal)}</span></div>`];
    if (productDisc > 0) {
        bits.push(`<div class="pos-total-row is-discount"><span>Product discount</span><span>−${rp(productDisc)}</span></div>`);
    }
    bits.push(`<div class="pos-total-row${extraDisc > 0 ? ' is-discount' : ''}">
        <span>Extra discount${canEdit ? `<button type="button" class="pos-total-edit" id="pos-edit-extra" aria-label="Edit extra discount" title="Edit">${pencil}</button>` : ''}</span>
        <span>${extraDisc > 0 ? `−${rp(extraDisc)}` : rp(0)}</span></div>`);
    bits.push(`<div class="pos-total-row is-grand"><span>Total</span><span>${rp(o.total_amount)}</span></div>`);
    if (Number(o.paid_amount) > 0 && o.status !== 'paid') {
        bits.push(`<div class="pos-total-row"><span>Paid so far</span><span>${rp(o.paid_amount)}</span></div>`);
        bits.push(`<div class="pos-total-row is-grand"><span>Balance</span><span>${rp(Number(o.total_amount) - Number(o.paid_amount))}</span></div>`);
    }
    totals.innerHTML = bits.join('');
    document.getElementById('pos-edit-extra')?.addEventListener('click', () => openDiscountDrawer(null));

    const empty = !rows.length;
    primary.disabled = empty && o.status !== 'paid';
    setPrimaryAction(primary, o, st);

    const editable = !['paid', 'void'].includes(o.status);
    // Hold is pay-first only. In F&B the TABLE is the parking slot, so a second
    // parking concept would be two ways to do one thing.
    $('pos-hold-btn')?.classList.toggle('hidden',
        !posProfile().payFirst || !editable || empty);
    discountBtn.classList.toggle('hidden', !editable || empty);
    voidBtn.classList.toggle('hidden', !editable);

    // A paid order's only correction is a refund, and only once.
    const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || null;
    const mayRefund = !!(ws && typeof ws.can === 'function' && ws.can('pos.refund'));
    refundBtn.classList.toggle('hidden',
        !(o.status === 'paid' && mayRefund && !o.refund_transaction_id));
    $('pos-reprint-btn').classList.toggle('hidden', o.status !== 'paid');
    if (o.refund_transaction_id) {
        badge.className = 'fluxy-status fluxy-status-danger';
        badge.textContent = 'Refunded';
    }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function startOrder(tableId, details = {}) {
    const t = state.overview.tables.find((x) => x.id === tableId);
    try {
        const order = await ds.createPosOrder(state.uid, {
            dimensionId: state.outletId,
            tableId: tableId || null,
            tableLabel: t ? t.label : null,
            channel: 'staff',
            // Who it is for, captured in the Create Order dialog. Absent for
            // every other caller — the floor plan, the table select, a scan into
            // an empty cart — which all open an order with nothing known yet.
            customerName: details.customerName || null,
            customerPhone: details.customerPhone || null,
            guestCount: details.guestCount || null,
            note: details.note || null,
            // Stamps which drawer rang it up. Null when no shift is open — the
            // sale is still real, it just sits outside every cash count.
            shiftId: state.shift ? state.shift.id : null
        });
        state.orderId = order.id;
        state.order = order;
        // Paint the order AND the menu from what we already have. The order
        // exists; everything needed to start ringing it up is in hand.
        renderOrder();
        renderMenu();

        // The refresh is NOT awaited.
        //
        // It re-reads the whole operational picture — 300 orders, the tables,
        // the menu and 1,000 stock movements — and the cashier was made to watch
        // "Creating…" for the entire round trip on a busy outlet, for data that
        // changes nothing about the order they just made. Reported as "creating
        // an order takes a long time", and it did.
        //
        // The await used to be load-bearing: renderMenu() before it enabled the
        // product cards while `once()` still held `state.busy`, and once() drops
        // a call while busy IN SILENCE — so a tap on a dish went nowhere. That is
        // no longer how the guard works: `body[data-pos-busy]` takes the pointer
        // off those cards, so an early tap cannot be swallowed, it simply cannot
        // be made. The reason for the wait is gone; the wait should go with it.
        refresh({ keepOrder: true }).catch(() => {});
    } catch (err) { fail(err, 'Could not open that order.'); }
}

// Searches paidToday as well as activeOrders, and that is the whole point.
//
// A paid order is not an ACTIVE one, so looking only at activeOrders meant
// clicking a card on the Orders board's Completed tab hit `if (!found) return`
// and did nothing whatsoever — no panel, no refund, no reprint, no error. The
// refund button became unreachable for the second time, by a different route
// than the first (the panel used to clear itself the instant payment landed).
// The board is now the only way back to a paid order, so anything the board can
// LIST, this must be able to OPEN.
function selectOrder(orderId) {
    const ov = state.overview || {};
    const found = (ov.activeOrders || []).concat(ov.paidToday || [])
        .find((o) => o.id === orderId);
    if (!found) return;
    state.orderId = orderId;
    state.order = found;
    renderOrder();
    renderMenu();
}

// Move ONE order forward from the board, without pulling it into the panel.
//
// The board is the working surface now: a cook pressing "Mark as Served" wants
// that order to move, not to be navigated into an editor. `advance()` stays for
// the till, where the order on screen IS the subject.
async function advanceOrderById(orderId) {
    const ov = state.overview || {};
    const o = (ov.activeOrders || []).concat(ov.paidToday || []).find((x) => x.id === orderId);
    if (!o) return;
    const next = posProfile().ladder[o.status];
    if (!next) return;
    try {
        const updated = await ds.setPosOrderStatus(state.uid, orderId, next);
        // Patch in memory and repaint straight away. Waiting for the refresh
        // leaves the card sitting on its old status for a round trip, which on a
        // busy board reads as "the press did nothing" and gets pressed again.
        const patch = (list) => (list || []).map((x) => (x.id === orderId ? { ...x, ...updated } : x));
        state.overview = { ...ov, activeOrders: patch(ov.activeOrders), paidToday: patch(ov.paidToday) };
        if (state.orderId === orderId) { state.order = updated; renderOrder(); }
        renderOrderLists();
        refresh({ keepOrder: true }).catch(() => {});
    } catch (err) { fail(err, 'Could not update that order.'); }
}

async function advance() {
    const o = state.order;
    if (!o) return;
    if (o.status === 'paid' || o.status === 'void') {
        state.orderId = null; state.order = null;
        renderOrder(); renderMenu();
        return;
    }
    if (o.status === 'awaiting_payment') return openPaymentModal();
    // The ladder is PROFILE data, not a property of the status. A pay-first
    // profile has no next step, and "no next step" here means charge — never
    // "do nothing", which is what a bare `return` would have made it.
    const next = posProfile().ladder[o.status];
    if (!next) return openPaymentModal();
    try {
        state.order = await ds.setPosOrderStatus(state.uid, state.orderId, next);
        renderOrder();
        await refresh({ keepOrder: true });
    } catch (err) { fail(err, 'Could not update that order.'); }
}

// ── Drawers ──────────────────────────────────────────────────────────────────
// A minimal right-side drawer. Deliberately NOT a new component family: it
// reuses the app's dialog surface conventions (white card, gray-200 border,
// rounded-xl) at the size a phone can hold.

function drawer({ title, subtitle, body, submitLabel, onSubmit, danger = false }) {
    document.getElementById('pos-drawer')?.remove();
    const el = document.createElement('div');
    el.id = 'pos-drawer';
    el.innerHTML = `
        <div class="fixed inset-0 bg-black/40 z-[90]" data-close></div>
        <div class="fixed inset-x-0 bottom-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] bg-white z-[91] shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none max-h-[92vh] sm:max-h-none" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
                <div>
                    <h2 class="text-[16px] font-semibold text-slate-950">${esc(title)}</h2>
                    ${subtitle ? `<p class="text-[12px] text-slate-500 mt-0.5">${esc(subtitle)}</p>` : ''}
                </div>
                <button type="button" data-close class="text-slate-400 hover:text-slate-700 p-1" aria-label="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <form id="pos-drawer-form" class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">${body}</form>
            ${submitLabel ? `<div class="px-5 py-4 border-t border-gray-200">
                <button type="submit" form="pos-drawer-form" class="w-full min-h-[48px] rounded-lg ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'} text-white text-[15px] font-semibold">${esc(submitLabel)}</button>
            </div>` : ''}
        </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    el.querySelector('#pos-drawer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        // A drawer with no submit label is a VIEW (the floor plan), not a form.
        // Its content still lives in the form element for layout, so the submit
        // path has to tolerate having nothing to do.
        if (typeof onSubmit !== 'function') return;
        await once(async () => {
            try { await onSubmit(new FormData(e.target)); close(); }
            catch (err) { fail(err, 'That did not work.'); }
        });
    });
    setTimeout(() => el.querySelector('input,select')?.focus(), 50);
    // The element, with close attached. Callers that only need `.close()` keep
    // working; callers that need to bind inside the drawer can query it.
    el.close = close;
    return el;
}

// ── Take payment ────────────────────────────────────────────────────────────
//
// A centre-screen modal, not the side drawer it used to be. Taking money is the
// one moment the cashier must not be doing anything else, and it is the step
// with a customer standing over it — the same reason Create Order is a modal.
// Uses the dashboard's overlay tokens (blurred navy scrim, 16px card, pinned
// footer) so it is the same component the rest of the app uses.
//
// EVERY figure goes through window.FluxyMoney. Nothing here may assume rupiah:
// the quick-cash amounts come from the currency's own banknotes, the input
// parses in the workspace's locale, and the placeholder is built from the
// currency name rather than written out per country. IDR is both the correct
// answer and the fallback, so a hardcoded assumption is invisible on an
// Indonesian account and wrong everywhere else.
function openPaymentModal() {
    const o = state.order;
    if (!o) return;
    const M = window.FluxyMoney;
    const cur = M.baseCurrency();
    const due = Math.max(0, Number(o.total_amount) - Number(o.paid_amount || 0));
    const methods = DataService.POS_PAYMENT_METHODS;
    let method = 'cash';
    let received = due;                       // exact is the commonest tender

    document.getElementById('pos-pay-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'pos-pay-modal';
    el.className = 'pos-modal-layer';
    el.innerHTML = `
        <div class="pos-modal-backdrop" data-close></div>
        <div class="pos-modal pos-pay" role="dialog" aria-modal="true" aria-labelledby="pos-pay-title">
            <div class="pos-modal-head">
                <div>
                    <h2 class="pos-modal-title" id="pos-pay-title">Take payment</h2>
                    <p class="pos-modal-sub">${esc(o.table_label ? `Table ${o.table_label}` : 'Takeaway')} · ${esc(orderShort(o))}</p>
                </div>
                <button type="button" class="pos-modal-close" data-close aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
            </div>

            <form class="pos-modal-body" id="pos-pay-form">
                <!-- The bill, stated once and large. Everything below is in
                     service of matching this number. -->
                <div class="pos-pay-due">
                    <span class="pos-pay-due-label">Amount due</span>
                    <span class="pos-pay-due-value" id="pos-pay-due">${esc(rp(due))}</span>
                </div>

                <div class="pos-field">
                    <label>Payment method</label>
                    <div class="pos-methods" id="pos-method-row">
                        ${methods.map((m) => `<button type="button" class="pos-method${m.id === 'cash' ? ' is-on' : ''}" data-method="${esc(m.id)}">${esc(m.label)}</button>`).join('')}
                    </div>
                    <p class="pos-hint" id="pos-settle-note"></p>
                </div>

                <div id="pos-cash-block">
                    <div class="pos-field">
                        <label for="pos-pay-amount">Amount received</label>
                        <!-- DISABLED rather than removed on a non-cash method.
                             A field that vanishes makes the dialog jump under a
                             cashier's hand mid-payment and leaves them wondering
                             whether they missed a step; a disabled field with the
                             bill already in it says "this one is not yours to
                             enter" and is done. -->
                        <!-- The symbol is rendered beside the field rather than
                             typed into it: the input carries digits only, so the
                             parser never has to strip a currency mark that
                             differs per market (Rp / ₱ / S$ / RM / $). -->
                        <div class="pos-amount-wrap">
                            <!-- The symbol precedes the digits in source order,
                                 so the pair reads symbol-then-digits; the
                                 CSS pushes the two of them to the right edge
                                 together. (No backticks in this comment: it is
                                 inside a template literal and one would end the
                                 string. Caught by check:module-parse, which is
                                 exactly what that check is for.) -->
                            <span class="pos-amount-cur" aria-hidden="true">${esc(M.baseSymbol())}</span>
                            <input id="pos-pay-amount" name="amount" class="pos-amount-input" autocomplete="off"
                                   inputmode="${esc(M.moneyInputMode())}"
                                   placeholder="Enter amount received"
                                   value="${esc(M.formatMoneyInput(M.fromMinor(due, cur), cur))}">
                        </div>
                    </div>
                    <p class="pos-hint" id="pos-amount-note" hidden>The provider moves the exact amount — nothing to count out.</p>
                    <!-- What the customer plausibly hands over, derived from the
                         bill and this currency's own banknotes. -->
                    <div class="pos-quick" id="pos-quick"></div>
                    <div class="pos-change" id="pos-change" hidden>
                        <span class="pos-change-label">Change</span>
                        <span class="pos-change-value" id="pos-change-value"></span>
                        <span class="pos-change-note" id="pos-change-note" hidden>Exact amount — nothing to give back.</span>
                    </div>
                    <p class="pos-hint is-warn" id="pos-short" hidden></p>
                </div>

                <div class="pos-field">
                    <label for="pos-pay-ref">Reference <span class="opt">(optional)</span></label>
                    <input id="pos-pay-ref" name="reference" placeholder="Transfer note, QRIS ref…" autocomplete="off">
                </div>
            </form>

            <div class="pos-modal-foot">
                <button type="button" class="pos-btn-ghost" data-close>Cancel</button>
                <button type="submit" form="pos-pay-form" class="pos-btn-primary" id="pos-pay-submit">Confirm payment</button>
            </div>
        </div>`;
    document.body.appendChild(el);

    const $$ = (id) => el.querySelector('#' + id);
    const amt = $$('pos-pay-amount');
    const close = () => el.remove();
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', function esc2(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
    });

    // TENDER, not settlement. A bank transfer settles to the same account as
    // cash and puts nothing in the drawer, so the cashier does not count it out
    // and must not be asked what they received — reading `settlement` here made
    // Bank transfer and Other behave as cash, which is also how they came to be
    // counted as drawer cash at close. See POS_PAYMENT_METHODS.
    //
    // ⚠️ THE ID IS THE PRIMARY SIGNAL, `tender` only refines it.
    //
    // `tender` arrives from pos-service.js, a DIFFERENT module from this one —
    // this page is three separate requests (pos.js → db-service.js →
    // pos-service.js) and they can be a version apart in a browser that
    // revalidated one and not the others. Keyed on `tender` alone, that
    // combination made `m.tender` undefined, so EVERY method read as non-cash:
    // the amount field came up disabled on Cash, pinned to the exact bill, and
    // the change could only ever be zero. Reproduced by serving a pre-`tender`
    // pos-service.js; the spec below keeps doing so.
    //
    // A method whose id is `cash` is cash, in every version of this file that
    // has ever existed. Deriving the till's behaviour from the stable fact and
    // letting the newer field refine it makes the mixed-version case a no-op
    // instead of a silently broken drawer.
    const isCash = () => {
        const m = methods.find((x) => x.id === method) || {};
        return m.tender ? m.tender === 'cash' : m.id === 'cash';
    };

    // Redraws change, shortfall and the submit button from `received`.
    const sync = () => {
        const cash = isCash();
        const submit = $$('pos-pay-submit');
        // The quick-cash row is the only part that goes: "what note did they
        // hand you" is a question with no meaning on a card.
        $$('pos-quick').hidden = !cash;
        amt.disabled = !cash;
        amt.readOnly = !cash;

        if (!cash) {
            // The provider moves the exact bill. Nobody overpays a terminal and
            // no change comes out of a drawer, so the field states the amount
            // and is not editable.
            received = due;
            amt.value = M.formatMoneyInput(M.fromMinor(due, cur), cur);
            $$('pos-change').hidden = true;
            $$('pos-short').hidden = true;
            $$('pos-amount-note').hidden = false;
            submit.disabled = false;
            submit.textContent = 'Confirm payment';
            return;
        }
        $$('pos-amount-note').hidden = true;

        // CHANGE IS ALWAYS SHOWN ON A CASH PAYMENT, including zero.
        //
        // It used to appear only when there was change to give, so the cashier
        // could not tell "exact money" from "the screen has not caught up with
        // what I typed" — the two look identical when the row is simply absent.
        // A stated Rp0 is a confirmation; a missing row is an open question, and
        // this is the moment a customer is standing there waiting to be told.
        const change = Math.max(0, received - due);
        $$('pos-change').hidden = false;
        $$('pos-change-value').textContent = rp(change);
        $$('pos-change').classList.toggle('is-zero', change === 0);
        // A zero says so IN WORDS. On its own, a 0 in a result panel is
        // indistinguishable from a panel that has not been filled in — which is
        // exactly how a correctly-calculated exact payment came to be reported
        // as "the change is not calculated".
        $$('pos-change-note').hidden = change !== 0;

        const short = received > 0 && received < due;
        $$('pos-short').hidden = !short;
        if (short) $$('pos-short').textContent = `${rp(due - received)} short — payment cannot be taken.`;
        // A short tender has no change to state; showing Rp0 beside a shortfall
        // reads as "nothing to give back", which is true and useless.
        if (short) $$('pos-change').hidden = true;

        // A tender below the bill cannot be taken at all.
        //
        // The earlier cut allowed it as an explicit "part payment" to preserve
        // split tender — cash + QRIS on one bill. The business does not do that,
        // and confirmed so: on this floor a short tender is a miscount, and the
        // useful thing is to refuse it while the customer is still standing
        // there. The DAL still accepts partial amounts, so this is a till rule
        // rather than a lost capability — `recordPosPayment` is unchanged.
        //
        // The button is disabled, and the reason sits right above it. A dead
        // button with no explanation is the worst of both.
        submit.disabled = received <= 0 || short;
        submit.textContent = 'Confirm payment';
    };

    const setReceived = (minor) => {
        received = Math.max(0, Math.round(minor || 0));
        amt.value = received ? M.formatMoneyInput(M.fromMinor(received, cur), cur) : '';
        renderQuick();
        sync();
    };

    function renderQuick() {
        const host = $$('pos-quick');
        const picks = M.cashSuggestions(due, cur, 3);
        host.innerHTML = [
            `<button type="button" class="pos-quick-btn${received === due ? ' is-on' : ''}" data-cash="${due}">Exact</button>`
        ].concat(picks.map((v) =>
            `<button type="button" class="pos-quick-btn${received === v ? ' is-on' : ''}" data-cash="${v}">${esc(rp(v))}</button>`
        )).join('');
    }

    $$('pos-quick').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cash]');
        if (!b) return;
        setReceived(Number(b.dataset.cash));
        amt.focus();
    });

    $$('pos-method-row').addEventListener('click', (e) => {
        const b = e.target.closest('[data-method]');
        if (!b) return;
        method = b.dataset.method;
        el.querySelectorAll('.pos-method').forEach((x) => x.classList.toggle('is-on', x === b));
        const m = methods.find((x) => x.id === method);
        // Two facts, and the note has to get both right — this line said
        // "Counts as cash in the drawer today" for a BANK TRANSFER, because it
        // read `settlement` alone. A transfer does land in the same account as
        // cash; what it does not do is put notes in the till, which is the only
        // thing this sentence is here to tell the person holding the drawer.
        $$('pos-settle-note').textContent = m.tender === 'cash'
            ? 'Counts as cash in the drawer today.'
            : (m.settlement === 'clearing'
                ? 'Settles when the provider pays out — not cash in the drawer today.'
                : 'Lands in the bank, not in the drawer — it is not counted at close.');
        if (!isCash()) setReceived(due); else sync();
    });

    amt.addEventListener('input', () => {
        // ── The guard that does not depend on anything else having run ──────
        //
        // `sync()` disables this field on every non-cash method, and that holds
        // on every path I can reach. It is still the WRONG place for this to be
        // the only defence: an editable "amount received" on a card payment is
        // a fraud surface — a cashier types a bigger figure, pockets the
        // difference as change, and the drawer still reconciles — so it must not
        // rest on one assignment having executed at the right moment.
        //
        // If input arrives on a non-cash method at all, the value is put back
        // and the keystroke is discarded. Three layers now stand between a
        // typed figure and the books: this, `sync()`, and `recordPosPayment`,
        // which refuses any tender that differs from the applied amount on a
        // non-cash method.
        if (!isCash()) {
            received = due;
            amt.value = M.formatMoneyInput(M.fromMinor(due, cur), cur);
            return;
        }
        const digits = amt.value.replace(/\D/g, '');
        amt.value = digits ? M.liveMoneyInput(amt.value) : '';
        received = M.toMinor(amt.value, cur);
        renderQuick();
        sync();
    });

    $$('pos-pay-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if ($$('pos-pay-submit').disabled) return;
        once(async () => {
            const submit = $$('pos-pay-submit');
            submit.disabled = true;
            try {
                const order = await ds.recordPosPayment(state.uid, state.orderId, {
                    method,
                    // What is APPLIED to the bill is capped at what is owed; the
                    // rest is change, not revenue and not money in the drawer.
                    // Sending the whole tender as `amount` is what used to make
                    // every over-tender read as a short drawer at close.
                    amount: Math.min(received, due),
                    amountReceived: received,
                    reference: $$('pos-pay-ref').value
                });
                state.order = order;
                close();
                if (order.status === 'paid') {
                    const change = Math.max(0, received - due);
                    // The change is the part that still has to HAPPEN after the
                    // screen is done, so it is what the confirmation says.
                    toast(change > 0
                        ? `Paid — give ${rp(change)} change.`
                        : `Paid — ${rp(order.total_amount)} recorded.`);
                    // The bill is paid, so the party has left and the table is
                    // the house's again. Closing the booking here is what stops
                    // a seated reservation holding its table for the rest of its
                    // 90 minutes after the guests have gone — the table would
                    // read free on the order side and held on the reservation
                    // side, which is the exact disagreement this feature exists
                    // to prevent, just pointing the other way.
                    //
                    // Best-effort: the money is already recorded and a failure
                    // to tidy the booking must never surface as a failed
                    // payment. The board still shows it as seated, which a
                    // person can close out.
                    closeReservationForOrder(order.id).catch(() => {});
                    // Asked for at the counter, in the second after payment.
                    openReceipt(order);
                } else {
                    toast(`${rp(received)} recorded. ${rp(Number(order.total_amount) - Number(order.paid_amount))} still due.`);
                }
                renderOrder(); renderMenu();
                await refresh({ keepOrder: true });
            } catch (err) {
                submit.disabled = false;
                fail(err, 'Could not record that payment.');
            }
        });
    });

    // Seed the settle note and the first paint.
    el.querySelector('.pos-method.is-on')?.click();
    setReceived(due);
    setTimeout(() => amt.focus(), 40);
    return el;
}

function openDiscountDrawer(lineId = null) {
    const o = state.order;
    const line = lineId ? (o.lines || []).find((l) => l.line_id === lineId) : null;
    const base = line ? Number(line.gross_amount) : Number(o.subtotal);
    // Percent is entered, then resolved to an AMOUNT before it is stored — the
    // ledger holds Rupiah, and a stored percentage would have to be re-applied
    // against a base that can still move.
    let mode = 'amount';

    drawer({
        title: line ? `Discount ${line.item_name}` : 'Add a discount',
        subtitle: `${rp(base)} before discount`,
        submitLabel: 'Apply discount',
        body: `
            <div>
                <div class="pos-methods" id="pos-disc-mode" style="margin-bottom:12px">
                    <button type="button" class="pos-method is-on" data-mode="amount">Amount</button>
                    <button type="button" class="pos-method" data-mode="percent">Percent</button>
                </div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-disc-amt"><span id="pos-disc-label">Amount off</span></label>
                <input id="pos-disc-amt" name="amount" inputmode="numeric" class="pos-amount-input" value="0" autocomplete="off">
                <p class="text-[11px] text-slate-500 mt-2" id="pos-disc-preview"></p>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-disc-why">Why?</label>
                <input id="pos-disc-why" name="reason" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Promo makan siang, komplain, staff…" required>
                <p class="text-[11px] text-slate-500 mt-2">The menu price stays on the record — the discount is booked separately, so you can see later where margin actually went.</p>
            </div>`,
        onSubmit: async (fd) => {
            const typed = window.FluxyMoney.toMinor(fd.get('amount'), window.FluxyMoney.baseCurrency());
            const amount = mode === 'percent'
                ? Math.round(base * Math.min(100, typed) / 100)
                : typed;
            state.order = await ds.setPosOrderDiscount(state.uid, state.orderId, {
                lineId, amount, reason: fd.get('reason')
            });
            renderOrder();
            toast(amount > 0 ? `${rp(amount)} discount applied.` : 'Discount removed.');
        }
    });

    const el = $('pos-disc-amt');
    const preview = () => {
        const typed = window.FluxyMoney.toMinor(el.value, window.FluxyMoney.baseCurrency());
        $('pos-disc-preview').textContent = mode === 'percent' && typed > 0
            ? `${Math.min(100, typed)}% of ${rp(base)} = ${rp(Math.round(base * Math.min(100, typed) / 100))}`
            : '';
    };
    el.addEventListener('input', () => {
        const d = el.value.replace(/\D/g, '');
        el.value = mode === 'percent' ? d.slice(0, 3) : (d ? window.FluxyMoney.formatMoneyInput(el.value, window.FluxyMoney.baseCurrency()) : '');
        preview();
    });
    $('pos-disc-mode').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        mode = b.dataset.mode;
        document.querySelectorAll('#pos-disc-mode .pos-method').forEach((x) => x.classList.toggle('is-on', x === b));
        $('pos-disc-label').textContent = mode === 'percent' ? 'Percent off' : 'Amount off';
        el.value = '0';
        preview();
    });
}

// ── Receipt ──────────────────────────────────────────────────────────────────
//
// Deliberately NOT a drawer. A receipt is printed, and print styling on a
// drawer inside an app shell fights the sidebar, the topbar and the page
// background. This opens a bare window containing only the receipt, so
// `window.print()` produces the slip and nothing else — and it works on a
// phone's share sheet, which is how most of these will actually reach a
// customer.
//
// 58mm is the thermal roll every Indonesian warung printer uses.
function openReceipt(order) {
    const o = order;
    const line = (l) => {
        const net = (Number(l.gross_amount) || 0) - (Number(l.discount_amount) || 0);
        const each = (Number(l.unit_price) || 0) + (Number(l.modifier_amount) || 0);
        // Options are printed. A customer checking a bill against what they
        // ordered cannot verify an upcharge that appears only in the total.
        const mods = (l.modifiers || []).length
            ? `<br><span class="m">${(l.modifiers || []).map((m) => esc(m.option_name)).join(', ')}</span>`
            : '';
        return `<tr><td>${esc(l.item_name)}${mods}<br><span class="m">${l.quantity} × ${rp(each)}</span></td>`
             + `<td class="r">${rp(net)}</td></tr>`;
    };
    const row = (label, value, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${value}</td></tr>`;
    const paid = (o.payments || []).filter((p) => p.status === 'settled');
    // Printed in Bahasa regardless of the staff UI language — the reader is the
    // customer, not the cashier.
    const ID_METHOD = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu', other: 'Lainnya' };
    const methodLabel = (id) => ID_METHOD[id] || id;
    const when = o.paid_at && typeof o.paid_at.toDate === 'function' ? o.paid_at.toDate() : new Date();
    const outlet = state.outlets.find((x) => x.id === o.dimension_id);

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(o.order_number || 'Receipt')}</title>
<style>
  @page { size: 58mm auto; margin: 4mm; }
  body { width: 58mm; margin: 0 auto; padding: 8px 0;
         font-family: -apple-system, "Segoe UI", Inter, sans-serif;
         font-size: 11px; line-height: 1.4; color: #000;
         font-variant-numeric: tabular-nums; }
  h1 { font-size: 13px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; }
  .m { color: #555; font-size: 10px; }
  .r { text-align: right; white-space: nowrap; }
  hr { border: 0; border-top: 1px dashed #999; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .tot td { font-weight: 700; font-size: 12px; padding-top: 4px; }
  .dsc td { color: #444; }
  .foot { margin-top: 8px; text-align: center; font-size: 10px; color: #555; }
  @media screen {
    body { box-shadow: 0 0 0 1px #e2e8f0; padding: 16px; margin-top: 24px; }
    .noprint { display: block; text-align: center; margin: 16px auto; width: 58mm; }
    .noprint button { font: inherit; padding: 10px 18px; border-radius: 8px;
                      border: 0; background: #0F172A; color: #fff; cursor: pointer; }
  }
  @media print { .noprint { display: none; } }
</style></head><body>
  <h1>${esc((outlet && outlet.name) || 'FluxyOS')}</h1>
  <div class="c m">${esc(o.table_label ? `Meja ${o.table_label}` : 'Bawa pulang')} · ${esc(o.order_number || '')}</div>
  <div class="c m">${when.toLocaleString(window.FluxyMoney.baseLocale())}</div>
  <hr>
  <table>${(o.lines || []).map(line).join('')}</table>
  <hr>
  <table>
    ${row('Subtotal', rp(o.subtotal))}
    ${Number(o.discount_total) > 0 ? row(o.discount_reason || 'Diskon', `−${rp(o.discount_total)}`, 'dsc') : ''}
    ${row('Total', rp(o.total_amount), 'tot')}
    ${paid.map((p) => row(methodLabel(p.method), rp(p.amount))).join('')}
    ${
        // Tendered and change, on the receipt, for the one case where they
        // differ from the total: cash. This is the customer's own record of what
        // they handed over and what came back — the two figures a dispute at the
        // counter is actually about, and the receipt was silent on both.
        // Older payments carry neither field; they fall out rather than
        // rendering "Rp0" against a sale nobody can now check.
        paid.filter((p) => Number(p.change_given) > 0).map((p) =>
            row('Tunai', rp(p.amount_received)) + row('Kembalian', rp(p.change_given))).join('')
    }
  </table>
  ${o.refund_transaction_id ? '<hr><div class="c"><strong>DIREFUND</strong></div>' : ''}
  <div class="foot">Terima kasih 🙏</div>
  <div class="noprint"><button onclick="window.print()">Cetak</button></div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });</` + `script>
</body></html>`;

    // A blocked popup must not fail silently — say what happened and what to do.
    const w = window.open('', '_blank', 'width=380,height=640');
    if (!w) { toast('Allow pop-ups for this site to print the receipt.', 'error'); return; }
    w.document.write(html);
    w.document.close();
}

// Refunding is finance+ only (perms-service CASHIER_CAPS): voiding an unpaid
// order is a floor correction, handing money back out is the till-fraud
// direction. The button is therefore absent for a cashier rather than present
// and failing — an action you can see but cannot use is worse than no action.
function openRefundDrawer() {
    const o = state.order;
    drawer({
        title: 'Refund this order',
        subtitle: `${o.table_label ? `Table ${o.table_label}` : 'Takeaway'} · ${rp(o.total_amount)}`,
        submitLabel: 'Refund order',
        danger: true,
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-refund-why">Reason</label>
                <input id="pos-refund-why" name="reason" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Salah pesan, komplain tamu…" required>
                <p class="text-[11px] text-slate-500 mt-2">This reverses the sale in the books and puts the stock back. The original order stays on the record — a refund is a correction, not an erasure.</p>
            </div>`,
        onSubmit: async (fd) => {
            await ds.refundPosOrder(state.uid, state.orderId, fd.get('reason'));
            toast(`Refunded ${rp(o.total_amount)}.`);
            state.orderId = null; state.order = null;
            renderOrder(); renderMenu();
            await refresh();
        }
    });
}

// Naming a parked sale is optional, and the drawer says so. A cashier with a
// queue should be able to press Hold, press Enter and move on; the label is for
// the times there are three carts down and "Takeaway #019" identifies none of
// them.
// Create Order: a popup that asks who the order is for before it exists.
//
// It replaced a drawer, and the difference is not decoration. The right-hand
// drawer is where the till acts on the order ALREADY on screen; this is the
// thing that brings one into existence, and centre-screen is how a form says
// "answer this first" rather than sliding in beside work that has not started.
//
// The type is the top of the form rather than the whole decision, because the
// fields below it change: a dine-in needs a table and a cover count, a takeaway
// needs neither and would be asked for a table it does not have.
//
// EVERY DETAIL IS OPTIONAL EXCEPT THE TABLE. A queue does not wait while a
// cashier types a phone number, so an order with nothing but a type is as valid
// as one with all of it — but a dine-in with no table has nowhere to sit, and
// nothing downstream could repair that.
function openCreateOrderDialog({ tableId = null } = {}) {
    const tables = ((state.overview && state.overview.tables) || []);
    // A table is unavailable for two different reasons and the cashier needs to
    // be told which: somebody is sitting at it, or somebody has booked it. Both
    // come from `tableStateAt` — the same function the floor plan paints from
    // and `createPosOrder` refuses on — so the three can never disagree about
    // which tables are takeable.
    const ctx = {
        orders: (state.overview && state.overview.activeOrders) || [],
        reservations: (state.overview && state.overview.reservations) || []
    };
    const availability = new Map(tables.map((t) => [t.id, tableStateAt(t.id, ctx)]));
    const stateOf = (id) => availability.get(id) || { available: true, state: 'free' };

    // Arriving from the floor plan, the table IS the question already answered —
    // so it is pre-filled and locked, and the type cannot be takeaway. Tapping a
    // table used to create an order on the spot with nothing known about it,
    // which meant the details could only ever be added by not adding them.
    const fromFloor = !!tableId;
    let type = 'dine_in';

    document.getElementById('pos-create-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'pos-create-modal';
    // The centring layer — see `.pos-modal-layer` in pos.html.
    el.className = 'pos-modal-layer';
    el.innerHTML = `
        <div class="pos-modal-backdrop" data-close></div>
        <div class="pos-modal" role="dialog" aria-modal="true" aria-labelledby="pos-create-title">
            <div class="pos-modal-head">
                <div>
                    <h2 class="pos-modal-title" id="pos-create-title">Create Order</h2>
                    <p class="pos-modal-sub">Who is this order for?</p>
                </div>
                <button type="button" class="pos-modal-close" data-close aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <form class="pos-modal-body" id="pos-create-form">
                ${fromFloor ? '' : `
                <div class="pos-typeseg" role="tablist" aria-label="Order type">
                    <button type="button" role="tab" data-type="dine_in" class="is-on" aria-selected="true">Dine In</button>
                    <button type="button" role="tab" data-type="takeaway" aria-selected="false">Take Away</button>
                </div>`}

                <div class="pos-field" data-only="dine_in">
                    <label for="pos-create-table">Table</label>
                    <select id="pos-create-table" name="table"${fromFloor ? ' disabled' : ''}>
                        <option value="">Choose a table…</option>
                        ${tables.map((t) => {
                            const st = stateOf(t.id);
                            // The table the dialog was OPENED with is never
                            // disabled — arriving from the floor plan, it is the
                            // question already answered, and the floor plan only
                            // routes free tables here in the first place.
                            const blocked = !st.available && t.id !== tableId;
                            const why = st.state === 'reserved' && st.reservation
                                ? ` — reserved ${esc(formatClock(toMs(st.reservation.starts_at)))}`
                                : (blocked ? ' — in use' : '');
                            return `<option value="${esc(t.id)}"`
                                + `${t.id === tableId ? ' selected' : ''}`
                                + `${blocked ? ' disabled' : ''}>`
                                + `${esc(tableOptionLabel(t))}`
                                + `${why}</option>`;
                        }).join('')}
                    </select>
                </div>

                <div class="pos-field-row">
                    <div class="pos-field">
                        <label for="pos-create-name">Customer name</label>
                        <input id="pos-create-name" name="name" maxlength="80" autocomplete="off" placeholder="Pak Budi">
                    </div>
                    <div class="pos-field" data-only="dine_in">
                        <label for="pos-create-covers">Guests <span class="opt">(optional)</span></label>
                        <input id="pos-create-covers" name="covers" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="2">
                    </div>
                </div>

                <div class="pos-field">
                    <label for="pos-create-phone">Phone number <span class="opt">(optional)</span></label>
                    <input id="pos-create-phone" name="phone" maxlength="32" inputmode="tel" autocomplete="off" placeholder="0812-3456-7890">
                </div>

                <div class="pos-field">
                    <label for="pos-create-note">Notes <span class="opt">(optional)</span></label>
                    <textarea id="pos-create-note" name="note" maxlength="200" placeholder="Allergies, seating, anything the kitchen should know"></textarea>
                </div>

                <p class="pos-modal-sub" id="pos-create-error" style="color:#B91C1C" hidden></p>
            </form>
            <div class="pos-modal-foot">
                <button type="button" class="pos-btn-ghost" data-close>Cancel</button>
                <button type="submit" form="pos-create-form" class="pos-btn-primary" id="pos-create-submit">Create Order</button>
            </div>
        </div>`;
    document.body.appendChild(el);

    const close = () => el.remove();
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    // Escape closes, because a modal that traps a cashier mid-service is worse
    // than one they dismissed by accident.
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    const applyType = () => {
        el.querySelectorAll('[data-type]').forEach((b) => {
            const on = b.dataset.type === type;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-selected', String(on));
        });
        // A takeaway is not asked for a table it will never have, nor for a
        // cover count that means nothing without one.
        el.querySelectorAll('[data-only="dine_in"]').forEach((f) => { f.hidden = type !== 'dine_in'; });
        // With Guests hidden, the name was left sitting in one column of a
        // two-column grid — noticeably narrower than the Phone field under it,
        // for no reason a person could see. It takes the whole row instead.
        el.querySelector('.pos-field-row').classList.toggle('is-single', type !== 'dine_in');
        // A takeaway is often not a person at all. "Pak Budi" is the wrong
        // prompt for a GoFood ticket, and a cashier who cannot see how to answer
        // leaves the field blank.
        //
        // Translated HERE rather than left to the i18n observer: that watches
        // `childList` only, and setting `.placeholder` is an attribute
        // mutation. It is caught on first paint (the dialog is a new node) but
        // NOT when the cashier toggles the type afterwards — which on a
        // Bahasa-first till would flip the field into English mid-form.
        el.querySelector('#pos-create-name').placeholder = tr(type === 'dine_in'
            ? 'Pak Budi'
            : 'Name or GoFood / GrabFood order…');
        // Same reason: "seating" is not a note anyone writes on a takeaway.
        el.querySelector('#pos-create-note').placeholder = tr(type === 'dine_in'
            ? 'Allergies, seating, anything the kitchen should know'
            : 'Allergies, or anything the kitchen should know');
    };
    el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.type; applyType();
    }));
    applyType();
    if (fromFloor) {
        el.querySelector('.pos-modal-sub').textContent = 'Who is this table for?';
    }

    el.querySelector('#pos-create-covers').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
    });

    el.querySelector('#pos-create-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const err = el.querySelector('#pos-create-error');
        // A disabled select submits nothing, so the table it was opened WITH is
        // the answer when the cashier never had a choice to make.
        const chosen = el.querySelector('#pos-create-table').value || tableId || '';
        const table = type === 'dine_in' ? chosen : '';
        if (type === 'dine_in' && !table) {
            err.textContent = 'Pick the table this order is for.';
            err.hidden = false;
            el.querySelector('#pos-create-table').focus();
            return;
        }
        // Re-checked at SUBMIT, not only when the list was painted. A dialog
        // left open across a service is a list of tables as they were minutes
        // ago, and the disabled attribute on a stale option is a rule that has
        // already stopped applying. The DAL refuses it too — this is here so the
        // cashier is told why in the dialog rather than by a red toast after it
        // closed.
        if (table && table !== tableId) {
            const blocked = walkInBlockedReason(table, ctx);
            if (blocked) {
                err.textContent = blocked;
                err.hidden = false;
                el.querySelector('#pos-create-table').focus();
                return;
            }
        }
        // Required for BOTH types now. A dine-in without a name is a table you
        // cannot address; a takeaway without one is a bag nobody can be called
        // for. It is the only field on this form that is always answerable.
        const nameEl = el.querySelector('#pos-create-name');
        if (!nameEl.value.trim()) {
            err.textContent = type === 'dine_in'
                ? 'Give this table a name so staff can address it.'
                : 'Give this order a name so it can be called out.';
            err.hidden = false;
            nameEl.focus();
            return;
        }
        err.hidden = true;
        const submit = el.querySelector('#pos-create-submit');
        submit.disabled = true;
        submit.textContent = 'Creating…';
        once(async () => {
            const t = tables.find((x) => x.id === table) || null;
            await startOrder(table || null, {
                customerName: el.querySelector('#pos-create-name').value.trim() || null,
                customerPhone: el.querySelector('#pos-create-phone').value.trim() || null,
                guestCount: type === 'dine_in' ? Number(el.querySelector('#pos-create-covers').value || 0) || null : null,
                note: el.querySelector('#pos-create-note').value.trim() || null
            });
            close();
            document.removeEventListener('keydown', onKey);
            // Straight to the menu. The next thing a cashier does after opening
            // an order is put something on it, and leaving them on the floor
            // plan is a step they would undo every single time.
            setView('till');
            if (t) toast(`Table ${t.label} opened.`);
        });
    });

    // The table is already known when arriving from the floor, so the cursor
    // starts on the first thing still to answer.
    setTimeout(() => el.querySelector(fromFloor ? '#pos-create-name' : '#pos-create-table')?.focus(), 40);
}

// ═════════════════════════════════════════════════════════════════════════════
// RESERVATIONS
//
// A booking board that shares ONE availability rule with the floor plan and the
// Create Order dialog (assets/js/pos-availability.js). That sharing is the whole
// feature: a reservation the till cannot see is worse than no reservations at
// all, because the table gets sold twice and the party with the booking is the
// one turned away.
//
// Three surfaces, one rule:
//   - here, when a host books a table (refuses an overlapping sitting);
//   - `renderTables`, where a reserved table paints as held and cannot be tapped
//     into a walk-in order;
//   - `openCreateOrderDialog`, where it is disabled in the table select — and
//     `createPosOrder` in the DAL, which refuses it even if the dialog is
//     bypassed.
// ═════════════════════════════════════════════════════════════════════════════

// Hours the calendar draws. Derived from the day's own bookings rather than
// fixed, because a fixed 08:00–23:00 grid is 15 rows of empty space on a floor
// that opens at 17:00 — and this page is judged by how much of it is work.
const CAL_HOUR_PX = 56;
// How much of the day is on screen before the grid scrolls. Twelve hours at
// 56px is most of a laptop viewport and all of a 10" tablet's, and the day
// continues above and below rather than being cropped to it.
const CAL_VISIBLE_HOURS = 12;

// THE GRID IS ALWAYS THE WHOLE DAY, 00:00 to 24:00.
//
// It was briefly cropped to the hours that had bookings in them, which is the
// obvious way to spend less screen on empty space — and it was wrong. A
// calendar cropped to its own contents cannot be used to CREATE anything: the
// empty hours are where the next booking goes, and clicking one is how it is
// taken. It also silently changed shape as bookings were added, so the same
// Tuesday sat at a different height depending on what was already in it.
//
// The white-space problem is real, and it is solved by SCROLLING to the part of
// the day that matters instead of by deleting the rest — see `scrollCalendarToNow`.
function calendarHours() {
    return { from: 0, to: 24 };
}

// Side-by-side lanes for bookings that overlap in time.
//
// Without this, two parties booked at 19:00 render one exactly on top of the
// other: the second is unreadable and the first is unclickable. On a floor with
// more than one table that is not an edge case, it is Friday.
//
// Standard interval-graph colouring: walk the day in start order, put each
// booking in the first lane whose previous booking has finished, and give every
// booking in a connected overlap cluster the same lane COUNT so the widths line
// up down the cluster instead of jittering block to block.
function layoutDayLanes(rows) {
    const items = rows.map((r) => ({ r, w: reservationWindow(r) }))
        .filter((x) => x.w)
        .sort((a, b) => a.w.startMs - b.w.startMs || a.w.endMs - b.w.endMs);

    const laneEnds = [];        // lane index → end of the last booking in it
    const placed = [];
    let clusterStart = 0;       // index into `placed` where the current cluster began
    let clusterEnd = -Infinity; // latest end seen in the current cluster

    const closeCluster = (upto) => {
        const lanes = Math.max(1, ...placed.slice(clusterStart, upto).map((p) => p.lane + 1));
        for (let i = clusterStart; i < upto; i += 1) placed[i].lanes = lanes;
    };

    items.forEach((it) => {
        // A booking starting after everything before it has finished begins a
        // NEW cluster: nothing it overlaps can still be open, so the previous
        // cluster's widths are settled.
        if (it.w.startMs >= clusterEnd) {
            closeCluster(placed.length);
            clusterStart = placed.length;
            clusterEnd = -Infinity;
            laneEnds.length = 0;
        }
        let lane = laneEnds.findIndex((end) => end <= it.w.startMs);
        if (lane === -1) { lane = laneEnds.length; }
        laneEnds[lane] = it.w.endMs;
        clusterEnd = Math.max(clusterEnd, it.w.endMs);
        placed.push({ ...it, lane, lanes: 1 });
    });
    closeCluster(placed.length);
    return placed;
}

// The days the current range covers. One list, so the header, the columns and
// the "which day did I click" lookup can never disagree about what is on screen.
function resRangeDays() {
    const anchor = new Date(state.resAnchor);
    if (state.resPeriod === 'day') return [startOfDay(anchor)];
    if (state.resPeriod === 'week') {
        const s = startOfWeek(anchor);
        return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    // Month: a Monday-anchored 6×7 grid, so every month renders the same height
    // and the cells never reflow under the cursor between months.
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function resRangeLabel() {
    const days = resRangeDays();
    const d = new Date(state.resAnchor);
    if (state.resPeriod === 'day') {
        return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    }
    if (state.resPeriod === 'month') {
        return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const a = days[0];
    const b = days[6];
    const fmt = (x, withMonth) => x.toLocaleDateString(undefined,
        withMonth ? { day: 'numeric', month: 'short' } : { day: 'numeric' });
    const sameMonth = a.getMonth() === b.getMonth();
    return `${fmt(a, !sameMonth)} – ${fmt(b, true)} ${b.getFullYear()}`;
}

function moveResRange(step) {
    if (step === 0) { state.resAnchor = Date.now(); return; }
    const d = new Date(state.resAnchor);
    if (state.resPeriod === 'day') d.setDate(d.getDate() + step);
    else if (state.resPeriod === 'week') d.setDate(d.getDate() + step * 7);
    else d.setMonth(d.getMonth() + step);
    state.resAnchor = d.getTime();
}

// Every booking the board knows about, filtered by the search box.
//
// Searches the phone number as well as the name, because the way a host finds a
// booking is by the number the guest just called from.
function visibleReservations() {
    const rows = (state.reservations || []).slice();
    const q = (state.resQuery || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.guest_name, r.table_label, r.guest_phone, r.note, r.guest_email]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
}

function reservationsOn(day, rows = visibleReservations()) {
    const key = dayKey(day);
    return rows.filter((r) => dayKey(r.starts_at) === key)
        .sort((a, b) => (toMs(a.starts_at) || 0) - (toMs(b.starts_at) || 0));
}

const RES_STATE = {
    pending:   { label: 'Pending',   pill: 'fluxy-status-warning' },
    confirmed: { label: 'Confirmed', pill: 'fluxy-status-success' },
    arrived:   { label: 'Seated',    pill: 'fluxy-status-info' },
    completed: { label: 'Completed', pill: 'fluxy-status-neutral' },
    cancelled: { label: 'Cancelled', pill: 'fluxy-status-danger' },
    no_show:   { label: 'No-show',   pill: 'fluxy-status-danger' }
};

// How a table reads in a picker.
//
// It was `1 · Floor 2 · 1 seats`, which is wrong three times over:
//   - a bare leading number reads as a ROW INDEX, not a table. "Assign later"
//     sat above it, so the list looked numbered rather than named.
//   - the zone is the CATEGORY — it is how a host narrows a floor before
//     choosing within it, so it belongs in front, the way every other grouped
//     list in the product reads.
//   - "1 seats".
//
// Now: `Floor 2 · Table 1 · 1 seat`. Each part drops out when it is absent
// rather than leaving a dangling separator — plenty of tables have no zone, and
// `seats` is nullable by design (pos.md §2: display only).
function tableOptionLabel(t) {
    const seats = Number(t.seats);
    return [
        t.zone || null,
        `${tr('Table')} ${t.label}`,
        seats > 0 ? `${seats} ${tr(seats === 1 ? 'seat' : 'seats')}` : null
    ].filter(Boolean).join(' · ');
}

const RES_SOURCES = [
    { id: 'direct', label: 'Walk-up / direct' },
    { id: 'phone', label: 'Phone' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'website', label: 'Website' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'other', label: 'Other' }
];
const sourceLabel = (id) => (RES_SOURCES.find((s) => s.id === id) || { label: 'Direct' }).label;

// Bookings that overlap another sitting on the same table. The DAL refuses these
// on write, but that check is read-then-write and cannot be a transaction (see
// savePosReservation), so the board detects them instead of trusting they cannot
// exist. A clash nobody can see is the failure this feature exists to prevent.
function clashingIds(rows) {
    const out = new Set();
    rows.forEach((r) => {
        if (!r.table_id || !HOLDING_STATUSES.includes(r.status)) return;
        reservationConflicts(rows, {
            tableId: r.table_id,
            startsAt: r.starts_at,
            durationMinutes: r.duration_minutes,
            excludeId: r.id
        }).forEach((c) => { out.add(r.id); out.add(c.id); });
    });
    return out;
}

// Tables a booking is holding at this moment, through the same function the
// floor plan paints with.
function heldNow() {
    const o = state.overview || {};
    const ctx = { orders: o.activeOrders || [], reservations: state.reservations || [] };
    return (o.tables || []).filter((t) => tableStateAt(t.id, ctx).state === 'reserved').length;
}

function renderReservationMetrics() {
    const host = $('pos-res-metrics');
    if (!host) return;
    const days = resRangeDays();
    const inRange = new Set(days.map((d) => dayKey(d)));
    const rows = visibleReservations().filter((r) => inRange.has(dayKey(r.starts_at)));
    const live = rows.filter((r) => HOLDING_STATUSES.includes(r.status));
    const covers = live.reduce((s, r) => s + (Number(r.party_size) || 0), 0);
    const lost = rows.filter((r) => r.status === 'no_show').length;
    const unassigned = live.filter((r) => !r.table_id).length;

    host.innerHTML = [
        { v: String(live.length), l: 'Reservations' },
        { v: String(covers), l: 'Guests expected' },
        // Not a table-utilisation percentage. The reference design shows one,
        // and it would be a fabricated number here: utilisation needs a service
        // window and a turn count this product does not model yet, and a
        // plausible wrong number is the failure mode this codebase guards
        // hardest against. Tables held right now is the true version of the
        // same question.
        //
        // Computed from `tableStateAt` over the tables on screen, NOT from a
        // count the server returned: this figure and the floor plan's colours
        // are then the same calculation, so the strip can never claim two tables
        // are held while the room shows three.
        { v: String(heldNow()), l: 'Tables held now' },
        { v: String(unassigned || lost), l: unassigned ? 'Need a table' : 'No-shows', warn: unassigned > 0 || lost > 0 }
    ].map((m) => `
        <div class="pos-metric">
            <div class="pos-metric-value${m.warn ? ' is-warn' : ''}">${esc(m.v)}</div>
            <div class="pos-metric-label">${esc(m.l)}</div>
        </div>`).join('');
}

// One booking, drawn in its time slot.
// Where a block sits, vertically and across its lanes. Percent of the column
// minus the 10px of gutter the CSS reserves, so lanes divide evenly at whatever
// width the grid is actually rendered at.
function laneStyle(lane, lanes) {
    if (lanes <= 1) return '';
    const span = `(100% - 10px) / ${lanes}`;
    return `left:calc(5px + ${lane} * ${span}); width:calc(${span} - 3px); right:auto;`;
}

const topFor = (ms, fromHour) => Math.max(0,
    (((new Date(ms).getHours() - fromHour) * 60 + new Date(ms).getMinutes()) / 60) * CAL_HOUR_PX);

function reservationBlock(r, { fromHour, clashes, now, lane = 0, lanes = 1 }) {
    const w = reservationWindow(r);
    if (!w) return '';
    const top = topFor(w.startMs, fromHour);
    const height = Math.max(38, (w.durationMin / 60) * CAL_HOUR_PX - 3);
    const late = isLate(r, now);
    const cls = [`is-${r.status}`, late ? 'is-late' : '', clashes.has(r.id) ? 'is-clash' : '']
        .filter(Boolean).join(' ');
    const meta = `${formatWindow(r)} · ${r.table_label ? `Table ${r.table_label}` : 'No table yet'}`;

    // A shared lane is roughly 70px wide in the week view. "Maya Kusuma · 4"
    // does not fit and rendered as "Maya Kusu" with the party count clipped off
    // — a label that has lost the thing it was there to say. So a narrow block
    // drops to what stays true when shortened: the first name, the covers, and
    // the start time. The full text is on `title` and in the detail sheet, and
    // the Day view and the List show everything at full width.
    const narrow = lanes > 1;
    const firstName = String(r.guest_name || '').trim().split(/\s+/)[0] || r.guest_name;
    return `<button type="button" class="pos-res ${cls}${narrow ? ' is-narrow' : ''}" data-res="${esc(r.id)}"
                style="top:${top}px; height:${height}px; ${laneStyle(lane, lanes)}"
                title="${esc(`${r.guest_name} · ${r.party_size} · ${meta}`)}"
                aria-label="${esc(r.guest_name)}, ${esc(meta)}">
        <span class="pos-res-name">${esc(narrow ? firstName : r.guest_name)} · ${Number(r.party_size) || 0}</span>
        <span class="pos-res-meta">${esc(narrow ? formatClock(w.startMs) : meta)}</span>
        ${!narrow && height >= 52 ? `<span class="pos-res-state">${esc(late ? 'Late — not seated' : RES_STATE[r.status].label)}</span>` : ''}
    </button>`;
}

// Below this the lanes stop being readable and start being decoration.
//
// A week column is ~156px on a 1540px canvas: two lanes is 70px, which holds a
// first name and a time. Three is 45px, which holds neither — so a busier
// cluster collapses its tail into one "+N more" block that opens the day. The
// Day view is one wide column, so it affords more.
const laneCap = () => (state.resPeriod === 'day' ? 4 : 2);

// Render a day's bookings, folding anything past the lane cap into an overflow
// block covering the cluster's own time span.
function renderDayColumn(rows, opts) {
    const placed = layoutDayLanes(rows);
    const cap = laneCap();
    const out = [];
    const hidden = [];
    placed.forEach((p) => {
        const lanes = Math.min(p.lanes, cap);
        if (p.lanes <= cap || p.lane < cap - 1) {
            out.push(reservationBlock(p.r, { ...opts, lane: p.lane, lanes }));
        } else {
            hidden.push(p);
        }
    });
    if (hidden.length) {
        // One overflow block per contiguous run, spanning what it stands for —
        // a "+3" floating at a single minute would not say WHEN the three are.
        const startMs = Math.min(...hidden.map((h) => h.w.startMs));
        const endMs = Math.max(...hidden.map((h) => h.w.endMs));
        const top = topFor(startMs, opts.fromHour);
        const height = Math.max(30, ((endMs - startMs) / 3600000) * CAL_HOUR_PX - 3);
        out.push(`<button type="button" class="pos-res is-more" data-more="${esc(opts.dayKey)}"
                    style="top:${top}px; height:${height}px; ${laneStyle(cap - 1, cap)}"
                    title="Open this day">
            <span class="pos-res-name">+${hidden.length}</span>
            <span class="pos-res-meta">more</span>
        </button>`);
    }
    return out.join('');
}

function renderReservationCalendar() {
    const host = $('pos-res-calendar');
    if (!host) return;
    const now = Date.now();
    const rows = visibleReservations();
    const clashes = clashingIds(rows);

    if (state.resPeriod === 'month') { renderReservationMonth(host, rows, now); return; }

    const days = resRangeDays();
    const dayRows = days.map((d) => reservationsOn(d, rows));
    const { from, to } = calendarHours();
    const hours = Array.from({ length: Math.max(1, to - from) }, (_, i) => from + i);
    const todayKey = dayKey(new Date());

    const head = days.map((d) => {
        const isToday = dayKey(d) === todayKey;
        const count = dayRows[days.indexOf(d)].filter((r) => HOLDING_STATUSES.includes(r.status)).length;
        return `<div class="pos-cal-day${isToday ? ' is-today' : ''}">
            <span class="pos-cal-dow">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span>
            <strong class="pos-cal-dom">${d.getDate()}</strong>
            <span class="pos-cal-count">${count ? `${count} booked` : '—'}</span>
        </div>`;
    }).join('');

    const cols = days.map((d, i) => {
        const isToday = dayKey(d) === todayKey;
        return `<div class="pos-cal-col${isToday ? ' is-today' : ''}" data-calday="${esc(dayKey(d))}">
            ${hours.map(() => '<div class="pos-cal-slot"></div>').join('')}
            ${renderDayColumn(dayRows[i], { fromHour: from, clashes, now, dayKey: dayKey(d) })}
        </div>`;
    }).join('');

    // The "now" line only exists on a range that contains today — drawing it on
    // next week's grid would be a marker pointing at nothing.
    const nowDate = new Date(now);
    const showsToday = days.some((d) => dayKey(d) === todayKey);
    const nowOffset = ((nowDate.getHours() - from) * 60 + nowDate.getMinutes()) / 60 * CAL_HOUR_PX;
    const nowLine = (showsToday && nowDate.getHours() >= from && nowDate.getHours() < to)
        ? `<div class="pos-cal-now" style="top:${nowOffset}px"><span>${formatClock(now)}</span></div>` : '';

    host.classList.remove('hidden');
    host.innerHTML = `
        <div class="pos-cal-scroll" style="--cal-hour:${CAL_HOUR_PX}px; max-height:calc(${CAL_HOUR_PX}px * ${CAL_VISIBLE_HOURS})">
            <div class="pos-cal-head" style="--cal-cols:${days.length}"><div></div>${head}</div>
            <div class="pos-cal-grid" style="--cal-cols:${days.length}; --cal-hour:${CAL_HOUR_PX}px">
                <div class="pos-cal-times">
                    ${hours.map((h) => `<div class="pos-cal-time">${String(h).padStart(2, '0')}:00</div>`).join('')}
                </div>
                ${cols}
                ${nowLine}
            </div>
        </div>`;

    scrollCalendarToHour(host, dayRows.flat(), from);

    wireReservationBlocks(host);
    host.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        state.resAnchor = new Date(`${b.dataset.more}T12:00:00`).getTime();
        state.resPeriod = 'day';
        renderReservations();
    }));
    // Clicking empty time books it: the host's actual gesture is "this slot,
    // this day", and making them re-enter both in a dialog they opened from a
    // button is the same information typed twice.
    host.querySelectorAll('[data-calday]').forEach((col) => {
        col.addEventListener('click', (e) => {
            if (e.target.closest('[data-res]')) return;
            const rect = col.getBoundingClientRect();
            const minutes = Math.round(((e.clientY - rect.top) / CAL_HOUR_PX) * 60 / 15) * 15;
            const d = new Date(`${col.dataset.calday}T00:00:00`);
            d.setHours(from, 0, 0, 0);
            d.setMinutes(d.getMinutes() + Math.max(0, minutes));
            openReservationDialog({ startsAt: d });
        });
    });
}

// Open the day where the work is, without cropping the day.
//
// The whole 24 hours are rendered and scrollable — 03:00 is reachable, because
// somebody eventually books it — but nobody opens this board to look at 03:00.
// It lands one hour above the earliest booking, or above the current hour on a
// day with none, which is where a host would have scrolled to anyway.
//
// Preserves an existing scroll position: this runs on every repaint (a booking
// lands, the clock ticks), and yanking the grid back under someone mid-scroll
// is worse than the problem it solves.
function scrollCalendarToHour(host, rows, fromHour) {
    const box = host.querySelector('.pos-cal-scroll');
    if (!box || box.dataset.posScrolled) return;
    const hours = rows.map((r) => reservationWindow(r))
        .filter(Boolean)
        .map((w) => new Date(w.startMs).getHours());
    const target = hours.length ? Math.min(...hours) : new Date().getHours();
    box.scrollTop = Math.max(0, (target - 1 - fromHour) * CAL_HOUR_PX);
    box.dataset.posScrolled = '1';
}

function renderReservationMonth(host, rows, now) {
    const days = resRangeDays();
    const month = new Date(state.resAnchor).getMonth();
    const todayKey = dayKey(new Date());
    const dows = days.slice(0, 7).map((d) => `<div class="pos-cal-day">
        <span class="pos-cal-dow">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span></div>`).join('');

    host.classList.remove('hidden');
    // `is-month` gives the header its own SEVEN-column grid. The week header's
    // template starts with a 56px time gutter, and reusing it here pushed every
    // weekday one column right of the cells it labelled — Sunday wrapped onto a
    // second row and the whole grid read one day out.
    host.innerHTML = `
        <div class="pos-cal-head is-month">${dows}</div>
        <div class="pos-cal-month">
            ${days.map((d) => {
                const list = reservationsOn(d, rows).filter((r) => HOLDING_STATUSES.includes(r.status));
                const covers = list.reduce((s, r) => s + (Number(r.party_size) || 0), 0);
                return `<button type="button" class="pos-cal-mcell${d.getMonth() !== month ? ' is-outside' : ''}${dayKey(d) === todayKey ? ' is-today' : ''}" data-monthday="${esc(dayKey(d))}">
                    <span class="pos-cal-mdate">${d.getDate()}</span>
                    ${covers ? `<span class="pos-cal-mcovers">${list.length} · ${covers} guests</span>` : ''}
                    ${list.slice(0, 2).map((r) => `<span class="pos-cal-mchip">${esc(formatClock(toMs(r.starts_at)))} ${esc(r.guest_name)}</span>`).join('')}
                    ${list.length > 2 ? `<span class="pos-cal-mchip">+${list.length - 2} more</span>` : ''}
                </button>`;
            }).join('')}
        </div>`;

    // A month cell drills into its day rather than opening a booking: at month
    // scale the question is which night, and the answer to "which night" is that
    // night's timeline.
    host.querySelectorAll('[data-monthday]').forEach((cell) => cell.addEventListener('click', () => {
        state.resAnchor = new Date(`${cell.dataset.monthday}T12:00:00`).getTime();
        state.resPeriod = 'day';
        renderReservations();
    }));
}

function renderReservationList() {
    const host = $('pos-res-list');
    if (!host) return;
    const now = Date.now();
    const days = new Set(resRangeDays().map((d) => dayKey(d)));
    const rows = visibleReservations()
        .filter((r) => days.has(dayKey(r.starts_at)))
        .sort((a, b) => (toMs(a.starts_at) || 0) - (toMs(b.starts_at) || 0));
    const clashes = clashingIds(visibleReservations());

    host.classList.remove('hidden');
    if (!rows.length) {
        host.innerHTML = `<section class="fluxy-table-card"><div class="fluxy-table-empty">
            <p class="fluxy-table-empty-title">No reservations in this range</p>
            <p class="fluxy-table-empty-description">Take one with New reservation, or move to another week.</p>
        </div></section>`;
        return;
    }

    host.innerHTML = `
        <section class="fluxy-table-card">
            <div class="fluxy-table-card-header">
                <div>
                    <h2 class="fluxy-table-title">Reservations</h2>
                    <p class="fluxy-table-subtitle">${rows.length} booking${rows.length === 1 ? '' : 's'} in this range${
                        // The strip above counts only bookings that still hold a
                        // table; this list shows cancelled and no-show history
                        // too. Two different numbers side by side read as a bug
                        // unless the smaller one says what it is.
                        (() => { const live = rows.filter((r) => HOLDING_STATUSES.includes(r.status)).length;
                            return live === rows.length ? '' : ` · ${live} still holding a table`; })()
                    }. Tap one to seat it or release its table.</p>
                </div>
            </div>
            <div class="fluxy-table-scroll">
                <table class="fluxy-table">
                    <thead><tr class="fluxy-table-header">
                        <th>Guest</th><th>Date &amp; time</th><th>Table</th>
                        <th class="fluxy-table-money">Guests</th><th>Duration</th><th>Status</th><th>Source</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map((r) => {
                            const w = reservationWindow(r);
                            const late = isLate(r, now);
                            const st = RES_STATE[r.status] || RES_STATE.pending;
                            return `<tr class="fluxy-table-row fluxy-table-row-clickable" data-res="${esc(r.id)}">
                                <td class="fluxy-table-cell">
                                    <span class="fluxy-table-cell-primary">${esc(r.guest_name)}</span>
                                    <span class="fluxy-table-cell-meta">${esc(r.guest_phone || r.guest_email || '—')}</span>
                                </td>
                                <td class="fluxy-table-cell">${esc(new Date(w.startMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))} · ${esc(formatClock(w.startMs))}</td>
                                <td class="fluxy-table-cell">${r.table_label ? esc(r.table_label) : '<span class="fluxy-table-cell-meta">Not assigned</span>'}</td>
                                <td class="fluxy-table-cell fluxy-table-money">${Number(r.party_size) || 0}</td>
                                <td class="fluxy-table-cell">${w.durationMin} min</td>
                                <td class="fluxy-table-cell">
                                    <span class="fluxy-table-status ${st.pill}">${esc(late ? 'Late' : st.label)}</span>
                                    ${clashes.has(r.id) ? '<span class="fluxy-table-status fluxy-status-danger">Clash</span>' : ''}
                                </td>
                                <td class="fluxy-table-cell">${esc(sourceLabel(r.source))}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </section>`;
    wireReservationBlocks(host);
}

function wireReservationBlocks(host) {
    host.querySelectorAll('[data-res]').forEach((el) => el.addEventListener('click', () => {
        const r = (state.reservations || []).find((x) => x.id === el.dataset.res);
        if (r) openReservationDetail(r);
    }));
}

// The two sources of bookings, folded into one list.
//
//   - `state.overview.reservations` — everything that could hold a table near
//     now. The floor plan needs exactly this and nothing more.
//   - `state.resRange` — whatever range the board is showing, which may be a
//     week in October and may include cancelled and no-show history the floor
//     plan has no use for.
//
// Merged by id, range last, so a booking present in both takes its freshest
// copy. One list means the board and the floor plan cannot hold two different
// opinions about the same table.
function mergeReservations() {
    const byId = new Map();
    ((state.overview && state.overview.reservations) || []).forEach((r) => byId.set(r.id, r));
    (state.resRange || []).forEach((r) => byId.set(r.id, r));
    state.reservations = [...byId.values()];
}

// Fetch the range the board is looking at. Called when the range moves, not on
// every repaint: scrubbing through a week is a paint against data already in
// hand, and a query per arrow press would make the board feel like a website.
async function loadReservationRange() {
    if (!state.uid || !state.outletId) return;
    const days = resRangeDays();
    const from = startOfDay(days[0]).getTime();
    const to = addDays(startOfDay(days[days.length - 1]), 1).getTime();
    // Every status, unlike the floor plan's read: a cancelled booking and a
    // no-show are what an evening's history is made of, and a board that hides
    // them makes a full night out of one that half emptied.
    state.resRange = await ds.getPosReservations(state.uid, {
        dimensionId: state.outletId, fromMs: from, toMs: to, limitCount: 400
    });
    mergeReservations();
    renderReservations();
}

function renderReservations() {
    if (!$('pos-res-date')) return;
    $('pos-res-date').textContent = resRangeLabel();
    document.querySelectorAll('[data-rperiod]').forEach((b) => {
        const on = b.dataset.rperiod === state.resPeriod;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('[data-rlayout]').forEach((b) => {
        const on = b.dataset.rlayout === state.resLayout;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
    });

    renderReservationMetrics();
    const calendar = state.resLayout === 'calendar';
    // A month grid IS the calendar layout; the list stays available in both.
    $('pos-res-calendar').classList.toggle('hidden', !calendar);
    $('pos-res-list').classList.toggle('hidden', calendar);
    if (calendar) renderReservationCalendar(); else renderReservationList();
}

// The booking whose party has just paid and left.
//
// One-directional by design: the reservation carries `order_id`, the order
// carries nothing. `pos_orders` has a `hasOnly` in firestore.rules and is frozen
// once paid, so a back-reference would have meant widening the key set on the
// document the money path runs through — real risk, for a link that is one
// client-side lookup away.
async function closeReservationForOrder(orderId) {
    const r = (state.reservations || []).find((x) => x.order_id === orderId && x.status === 'arrived');
    if (!r) return;
    await ds.setPosReservationStatus(state.uid, r.id, 'completed');
}

// Read-only view of the order on screen, for specs.
//
// A payment's recorded shape — what was applied to the bill, what was handed
// over, what went back as change — is not rendered anywhere except the receipt,
// which prints in a popup a test has to close. Those three figures are exactly
// where the drawer-reconciliation bug lived, so they need an assertion that
// reads the RECORD rather than a screen.
window.__posOrder = () => (state.order ? JSON.parse(JSON.stringify({
    id: state.order.id,
    status: state.order.status,
    total_amount: state.order.total_amount,
    paid_amount: state.order.paid_amount,
    payments: (state.order.payments || []).map((p) => ({
        method: p.method, tender: p.tender, amount: p.amount,
        amount_received: p.amount_received, change_given: p.change_given
    }))
})) : null);

// Replace the floor's tables and bookings with a known fixture, then repaint.
//
// Nothing is written to Firestore. The claim under test is a RENDERING and
// SELECTION rule — "a reserved table cannot be given to a walk-in" — and proving
// it against real data would mean writing bookings into a live workspace that
// rules will never let a test delete (a cancelled booking is a fact about the
// evening; see firestore.rules). Freezing is the same mechanism and the same
// reason as `__posSeedBoard`: the live watcher repaints from the server
// mid-interaction and detaches the element the spec is holding.
window.__posSeedFloor = (tables, reservations) => {
    if (state.unwatch) { state.unwatch(); state.unwatch = null; }
    state.frozen = true;
    const rows = (reservations || []).map((r) => ({ ...r }));
    state.overview = {
        ...(state.overview || {}),
        tables: (tables || []).map((t) => ({ ...t })),
        activeOrders: (state.overview || {}).activeOrders || [],
        paidToday: (state.overview || {}).paidToday || [],
        counts: { ...((state.overview || {}).counts || {}), tablesReserved: 0 },
        reservations: rows
    };
    state.resRange = rows;
    mergeReservations();
    renderTables();
    renderReservations();
    return [...document.querySelectorAll('.pos-table')].map((el) => ({
        label: el.querySelector('.pos-table-label')?.textContent.trim() || '',
        state: (String(el.className).match(/is-(free|busy|bill|reserved)/) || [])[1] || null,
        caption: el.querySelector('.pos-table-free')?.textContent.replace(/\s+/g, ' ').trim() || null,
        reservation: el.dataset.reservation || null
    }));
};

// ── Taking a booking ────────────────────────────────────────────────────────
//
// A modal, not the side drawer, for the same reason Create Order and the payment
// screen are: it is taken while somebody is waiting — on the phone or at the
// door — and it must be the only thing on screen.
function openReservationDialog({ reservation = null, startsAt = null, tableId = null } = {}) {
    const editing = !!reservation;
    const tables = ((state.overview && state.overview.tables) || []);
    const when = reservation ? new Date(toMs(reservation.starts_at))
        : (startsAt || new Date(Date.now() + 60 * 60 * 1000));
    // Both halves are built by hand in LOCAL time. `toISOString()` converts to
    // UTC and would offer a Jakarta host a booking seven hours in the past — the
    // silent kind of wrong, since the dialog would still look perfectly normal.
    const pad = (n) => String(n).padStart(2, '0');
    const dayValue = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    const timeValue = `${pad(when.getHours())}:${pad(when.getMinutes())}`;

    document.getElementById('pos-res-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'pos-res-modal';
    el.className = 'pos-modal-layer';
    el.innerHTML = `
        <div class="pos-modal-backdrop" data-close></div>
        <div class="pos-modal" role="dialog" aria-modal="true" aria-labelledby="pos-res-title">
            <div class="pos-modal-head">
                <div>
                    <h2 class="pos-modal-title" id="pos-res-title">${editing ? 'Edit reservation' : 'New reservation'}</h2>
                    <p class="pos-modal-sub">Hold a table for a guest. It stops being sellable 30 minutes before they are due.</p>
                </div>
                <button type="button" class="pos-modal-close" data-close aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <!-- novalidate: this form does its OWN validation and reports it in
                 #pos-res-error, in words a host can act on. Native constraint
                 validation runs first and blocks the submit - and it blocks it
                 SILENTLY here, because the submit button lives outside the form
                 (linked by the form attribute), so the browser's bubble has
                 nothing on screen to anchor to. That is exactly how a step of
                 900 on the time field turned Create reservation into a dead
                 button with no error anywhere: found 2026-09-01, and only
                 because a spec caught it.
                 (No backticks in this comment - it lives inside a template
                 literal, and one would end the string.) -->
            <form class="pos-modal-body" id="pos-res-form" novalidate>
                <div class="pos-field">
                    <label for="pos-res-name">Guest name</label>
                    <input id="pos-res-name" name="name" maxlength="80" autocomplete="off" placeholder="Pak Budi"
                           value="${esc(reservation ? reservation.guest_name : '')}">
                </div>
                <div class="pos-field-row is-when">
                    <div class="pos-field">
                        <label for="pos-res-datefield">Date</label>
                        <!-- The SHARED FluxyDateRangePicker in single-date mode.
                             Never a native date input: PROJECT_BACKGROUND §5 is
                             explicit, and the browser's own calendar was the one
                             control on this page that did not look like the
                             product. Mounted below, once the dialog is in the DOM. -->
                        <div id="pos-res-datefield" class="pos-res-datehost"></div>
                    </div>
                    <div class="pos-field">
                        <label for="pos-res-time">Time</label>
                        <!-- Time stays a native control. The ban is on calendars
                             and date fields, there is no shared time component,
                             and a native time input is the one the tablet's own
                             keyboard is built for.
                             NO step attribute. It looks like a free 15-minute
                             grid and is not: for type=time the step BASE is the
                             control's own initial value, so a dialog opened at
                             18:54 rejected 19:00 with "the two nearest valid
                             values are 18.54 and 19.09". A floor books at 19:05
                             anyway. -->
                        <input id="pos-res-time" name="time" type="time" value="${esc(timeValue)}">
                    </div>
                    <div class="pos-field">
                        <label for="pos-res-party">Guests</label>
                        <input id="pos-res-party" name="party" inputmode="numeric" maxlength="3" autocomplete="off"
                               value="${esc(String(reservation ? reservation.party_size : 2))}">
                    </div>
                </div>
                <div class="pos-field-row">
                    <div class="pos-field">
                        <label for="pos-res-table">Table</label>
                        <select id="pos-res-table" name="table">
                            <option value="">Assign later</option>
                        </select>
                    </div>
                    <div class="pos-field">
                        <label for="pos-res-duration">Minutes</label>
                        <input id="pos-res-duration" name="duration" inputmode="numeric" maxlength="3" autocomplete="off"
                               value="${esc(String(reservation ? reservation.duration_minutes : DEFAULT_DURATION_MIN))}">
                    </div>
                </div>
                <div class="pos-field-row">
                    <div class="pos-field">
                        <label for="pos-res-phone">Phone <span class="opt">(optional)</span></label>
                        <input id="pos-res-phone" name="phone" maxlength="32" inputmode="tel" autocomplete="off"
                               placeholder="0812-3456-7890" value="${esc(reservation ? (reservation.guest_phone || '') : '')}">
                    </div>
                    <div class="pos-field">
                        <label for="pos-res-source">Source</label>
                        <select id="pos-res-source" name="source">
                            ${RES_SOURCES.map((s) => `<option value="${esc(s.id)}"${reservation && reservation.source === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="pos-field">
                    <label for="pos-res-note">Notes <span class="opt">(optional)</span></label>
                    <textarea id="pos-res-note" name="note" maxlength="200"
                              placeholder="Birthday, allergies, seating preference">${esc(reservation ? (reservation.note || '') : '')}</textarea>
                </div>
                <p class="pos-modal-sub" id="pos-res-error" style="color:#B91C1C" hidden></p>
            </form>
            <div class="pos-modal-foot">
                <button type="button" class="pos-btn-ghost" data-close>Cancel</button>
                <button type="submit" form="pos-res-form" class="pos-btn-primary" id="pos-res-submit">${editing ? 'Save changes' : 'Create reservation'}</button>
            </div>
        </div>`;
    document.body.appendChild(el);

    // The picker renders its panel into a FIXED-position element outside the
    // dialog, so removing the dialog does not remove the calendar — it would be
    // left floating over the board with nothing to close it.
    const close = () => { picker?.destroy?.(); el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', onKey);

    const select = el.querySelector('#pos-res-table');
    const timeInput = el.querySelector('#pos-res-time');
    const durationInput = el.querySelector('#pos-res-duration');

    // The chosen day, held here rather than read back out of the control: the
    // shared picker owns its own label and reports through onChange.
    let chosenDay = dayValue;
    const DRP = window.FluxyDateRangePicker;
    const picker = DRP ? DRP.mount(el.querySelector('#pos-res-datefield'), {
        mode: 'single',
        start: dayValue,
        defaultStart: dayValue,
        // A booking is in the future. `minDate` defaults to today, so a host
        // cannot hold a table for a night that has already happened; an EXISTING
        // booking opens with its own date as the floor, or editing one taken
        // yesterday would refuse to show the day it is for.
        minDate: reservation ? (dayValue < DRP.getDayKey() ? dayValue : DRP.getDayKey()) : DRP.getDayKey(),
        // A year out. The component's default max is TODAY — correct for a
        // finance range, useless for a reservation, and the reason this is
        // passed explicitly rather than left alone.
        // `addDays` takes a day KEY, not a Date — it splits the string. Passing a
        // Date threw inside the picker, which mount() does not catch, so the
        // whole dialog rendered with no date control at all.
        maxDate: DRP.addDays(DRP.getDayKey(), 365),
        onChange: ({ start }) => { chosenDay = start; paintTables(); }
    }) : null;
    // No picker means the script did not load. Say so rather than presenting a
    // dialog whose date cannot be changed.
    if (!picker) el.querySelector('#pos-res-datefield').innerHTML =
        '<p class="pos-modal-sub">Date picker unavailable — reload the page.</p>';

    // The moment the two controls add up to. One place, so the table list, the
    // validation and the write can never disagree about which minute is meant.
    const chosenMs = () => Date.parse(`${chosenDay}T${timeInput.value || '00:00'}`);

    // The table list is REBUILT whenever the time changes, because which tables
    // are takeable is a question about a moment — a table free at 18:00 is not
    // free at 20:00, and a list computed once would be answering about whichever
    // time the dialog happened to open with.
    function paintTables() {
        const startMs = chosenMs();
        const duration = Number(durationInput.value) || DEFAULT_DURATION_MIN;
        const chosen = select.value || (reservation ? reservation.table_id : tableId) || '';
        select.innerHTML = `<option value="">Assign later</option>` + tables.map((t) => {
            const clash = Number.isNaN(startMs) ? [] : reservationConflicts(state.reservations || [], {
                tableId: t.id, startsAt: startMs, durationMinutes: duration,
                excludeId: reservation ? reservation.id : null
            });
            const busy = clash[0];
            return `<option value="${esc(t.id)}"${t.id === chosen ? ' selected' : ''}${busy ? ' disabled' : ''}>`
                + `${esc(tableOptionLabel(t))}`
                + `${busy ? ` — booked ${formatClock(toMs(busy.starts_at))}` : ''}</option>`;
        }).join('');
    }
    paintTables();
    timeInput.addEventListener('change', paintTables);
    durationInput.addEventListener('change', paintTables);
    [el.querySelector('#pos-res-party'), durationInput].forEach((i) => i.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
    }));

    el.querySelector('#pos-res-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const err = el.querySelector('#pos-res-error');
        const show = (msg, focus) => { err.textContent = msg; err.hidden = false; focus?.focus(); };
        const name = el.querySelector('#pos-res-name').value.trim();
        if (!name) return show('Give this reservation a guest name.', el.querySelector('#pos-res-name'));
        const startMs = chosenMs();
        if (Number.isNaN(startMs)) return show('Pick the date and time this reservation is for.', timeInput);
        const party = Number(el.querySelector('#pos-res-party').value);
        if (!Number.isInteger(party) || party < 1) return show('How many guests are coming?', el.querySelector('#pos-res-party'));
        err.hidden = true;

        const submit = el.querySelector('#pos-res-submit');
        submit.disabled = true;
        submit.textContent = 'Saving…';
        const table = tables.find((t) => t.id === select.value) || null;
        once(async () => {
            try {
                await ds.savePosReservation(state.uid, {
                    dimension_id: state.outletId,
                    table_id: table ? table.id : null,
                    table_label: table ? table.label : null,
                    guest_name: name,
                    guest_phone: el.querySelector('#pos-res-phone').value.trim() || null,
                    party_size: party,
                    starts_at: startMs,
                    duration_minutes: Number(durationInput.value) || DEFAULT_DURATION_MIN,
                    source: el.querySelector('#pos-res-source').value,
                    note: el.querySelector('#pos-res-note').value.trim() || null
                }, { create: !editing, reservationId: editing ? reservation.id : null });
                close();
                toast(editing ? 'Reservation updated.' : `Table held for ${name}.`);
                await refresh();
                renderReservations();
            } catch (error) {
                submit.disabled = false;
                submit.textContent = editing ? 'Save changes' : 'Create reservation';
                show(error && error.message ? error.message : 'Could not save that reservation.');
            }
        });
    });

    setTimeout(() => el.querySelector('#pos-res-name')?.focus(), 40);
}

// ── One booking, and what to do with it ─────────────────────────────────────
//
// Every action here either SEATS the party or RELEASES the table, because those
// are the only two things that happen to a booking. Nothing expires on a timer:
// a table comes back into supply when a person says it has.
function openReservationDetail(r) {
    const w = reservationWindow(r);
    const late = isLate(r);
    const st = RES_STATE[r.status] || RES_STATE.pending;
    const held = HOLDING_STATUSES.includes(r.status);

    document.getElementById('pos-res-detail')?.remove();
    const el = document.createElement('div');
    el.id = 'pos-res-detail';
    el.className = 'pos-modal-layer';
    el.innerHTML = `
        <div class="pos-modal-backdrop" data-close></div>
        <div class="pos-modal" role="dialog" aria-modal="true" aria-labelledby="pos-resd-title">
            <div class="pos-modal-head">
                <div>
                    <h2 class="pos-modal-title" id="pos-resd-title">${esc(r.guest_name)}</h2>
                    <p class="pos-modal-sub">${esc(formatWindow(r))} · ${Number(r.party_size) || 0} guests · ${esc(sourceLabel(r.source))}</p>
                </div>
                <button type="button" class="pos-modal-close" data-close aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18 18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="pos-modal-body">
                ${late ? `<p class="pos-res-warn">Due at ${esc(formatClock(w.startMs))} and nobody is seated. The table stays held until you seat them or mark a no-show — it will not free itself while the guest may still be on their way.</p>` : ''}
                ${!r.table_id && held ? '<p class="pos-res-warn">No table assigned, so this booking is holding nothing. Edit it to pick one.</p>' : ''}
                <div class="pos-res-detail">
                    <dl>
                        <dt>Status</dt><dd><span class="fluxy-table-status ${st.pill}">${esc(st.label)}</span></dd>
                        <dt>Table</dt><dd>${r.table_label ? esc(r.table_label) : 'Not assigned'}</dd>
                        <dt>Held from</dt><dd>${esc(formatClock(w.holdFrom))} until ${esc(formatClock(w.endMs))}</dd>
                        <dt>Phone</dt><dd>${esc(r.guest_phone || '—')}</dd>
                        ${r.note ? `<dt>Notes</dt><dd>${esc(r.note)}</dd>` : ''}
                    </dl>
                </div>
                <div class="pos-res-actions">
                    ${held && r.table_id && !r.order_id ? '<button type="button" class="pos-btn-primary" data-act="seat">Seat guest</button>' : ''}
                    ${r.order_id ? '<button type="button" class="pos-btn-primary" data-act="open">Open their order</button>' : ''}
                    ${held ? '<button type="button" class="pos-btn-ghost" data-act="edit">Edit</button>' : ''}
                    ${held ? '<button type="button" class="pos-btn-ghost" data-act="no_show">Mark no-show</button>' : ''}
                    ${held ? '<button type="button" class="pos-btn-ghost" data-act="cancelled">Cancel booking</button>' : ''}
                    ${r.status === 'arrived' ? '<button type="button" class="pos-btn-ghost" data-act="completed">Close out</button>' : ''}
                </div>
            </div>
        </div>`;
    document.body.appendChild(el);

    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', onKey);

    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'edit') { close(); openReservationDialog({ reservation: r }); return; }
        if (act === 'open') {
            close();
            selectOrder(r.order_id);
            setView('till');
            return;
        }
        once(async () => {
            try {
                if (act === 'seat') {
                    const order = await ds.seatPosReservation(state.uid, r.id,
                        { shiftId: state.shift ? state.shift.id : null });
                    close();
                    await refresh();
                    // Straight to the till with their order open: seating a party
                    // and taking their first order are one motion, and landing
                    // the host back on the calendar is a step they would undo.
                    selectOrder(order.id);
                    setView('till');
                    toast(`${r.guest_name} seated at ${r.table_label}.`);
                    return;
                }
                await ds.setPosReservationStatus(state.uid, r.id, act);
                close();
                await refresh();
                renderReservations();
                toast(act === 'completed' ? 'Reservation closed out.'
                    : act === 'no_show' ? `${r.guest_name} marked a no-show. ${r.table_label || 'The table'} is free again.`
                    : `Reservation cancelled. ${r.table_label || 'The table'} is free again.`);
            } catch (error) { fail(error, 'Could not update that reservation.'); }
        });
    }));
}

function openHoldDrawer() {
    const o = state.order;
    if (!o) return;
    drawer({
        title: 'Hold this sale',
        subtitle: `${rp(o.total_amount)} · ${(o.lines || []).length} line${(o.lines || []).length === 1 ? '' : 's'}`,
        submitLabel: 'Hold sale',
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-hold-label">
                    Name it <span class="font-normal text-slate-400">(optional)</span>
                </label>
                <input id="pos-hold-label" name="label" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]"
                       maxlength="60" placeholder="Blue jacket, Pak Budi…" autocomplete="off">
                <p class="text-[11px] text-slate-500 mt-2">The sale stays exactly as it is. It does not hold stock — whoever pays first gets the last one.</p>
            </div>`,
        onSubmit: async (fd) => {
            // NOT once() — the drawer's submit already runs inside one, and
            // once() does not nest.
            await parkCurrentSale({ label: (fd.get('label') || '').trim() || null });
        }
    });
    setTimeout(() => $('pos-hold-label')?.focus(), 40);
}

function openLineNoteDrawer(lineId) {
    const line = (state.order.lines || []).find((l) => l.line_id === lineId);
    if (!line) return;
    drawer({
        title: `Note for ${line.item_name}`,
        subtitle: 'Goes to the kitchen with this line.',
        submitLabel: 'Save note',
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-line-note">Note</label>
                <input id="pos-line-note" name="note" maxlength="120" value="${esc(line.note || '')}" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Tanpa sambal, pedas, es sedikit…">
            </div>`,
        onSubmit: async (fd) => {
            const note = String(fd.get('note') || '').trim() || null;
            state.order = await ds.updatePosOrder(state.uid, state.orderId, (o) => ({
                lines: (o.lines || []).map((l) => (l.line_id === lineId ? { ...l, note } : l))
            }));
            renderOrder();
            toast(note ? 'Note saved.' : 'Note removed.');
        }
    });
}

function openVoidDrawer() {
    drawer({
        title: 'Void this order',
        subtitle: 'Nothing is charged and nothing is posted to the books.',
        submitLabel: 'Void order',
        danger: true,
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-void-why">Reason</label>
                <input id="pos-void-why" name="reason" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Tamu batal, salah input…" required>
                <p class="text-[11px] text-slate-500 mt-2">A voided order leaves no revenue and no stock movement — the reason is the only trace it leaves.</p>
            </div>`,
        onSubmit: async (fd) => {
            await ds.voidPosOrder(state.uid, state.orderId, fd.get('reason'));
            toast('Order voided.');
            state.orderId = null; state.order = null;
            renderOrder(); renderMenu();
            await refresh();
        }
    });
}

// Long-press / right-click a table to archive it. Deliberately not a visible
// per-tile button: the grid is tapped hundreds of times a service and a delete
// affordance on every tile is an accident waiting to happen. Archiving is rare.
function mountTableArchive(host) {
    host.querySelectorAll('[data-table]').forEach((btn) => {
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (btn.dataset.order) {
                toast('That table has an open order. Close or void it first.', 'error');
                return;
            }
            const t = state.overview.tables.find((x) => x.id === btn.dataset.table);
            if (!t) return;
            window.showFluxyDialog
                ? window.showFluxyDialog({
                    title: `Archive table ${t.label}?`,
                    message: 'It disappears from the grid. Past orders keep pointing at it, so nothing in the books changes.',
                    confirmText: 'Archive',
                    variant: 'danger',
                    onConfirm: async () => {
                        await ds.archivePosTable(state.uid, t.id);
                        toast(`Table ${t.label} archived.`);
                        await refresh();
                    }
                })
                : once(async () => {
                    await ds.archivePosTable(state.uid, t.id);
                    toast(`Table ${t.label} archived.`);
                    await refresh();
                });
        });
    });
}

function openTableDrawer() {
    const outlet = state.outlets.find((o) => o.id === state.outletId);
    drawer({
        title: 'Add a table',
        subtitle: outlet ? outlet.name : '',
        submitLabel: 'Add table',
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-tbl-label">Table name or number</label>
                <input id="pos-tbl-label" name="label" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="12, A3, Bar 2" required>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-tbl-zone">Area <span class="font-normal text-slate-400">(optional)</span></label>
                <input id="pos-tbl-zone" name="zone" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Lantai 2, Teras">
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-tbl-seats">Seats <span class="font-normal text-slate-400">(optional)</span></label>
                <input id="pos-tbl-seats" name="seats" inputmode="numeric" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="4">
            </div>`,
        onSubmit: async (fd) => {
            await ds.savePosTable(state.uid, {
                label: fd.get('label'),
                zone: fd.get('zone'),
                seats: Number(fd.get('seats')) || null,
                dimension_id: state.outletId
            }, { create: true });
            toast('Table added.');
            await refresh();
        }
    });
}

// ── The cash drawer ──────────────────────────────────────────────────────────
//
// The bit that makes a till reconcilable. Without it an owner ends the day with
// a sales figure and a drawer full of cash and no way to ask whether they agree.

function renderShift() {
    // Two hosts: the compact bar on the till, and the full one on the Shift
    // view. Same markup — a second rendering of the drawer state is a second
    // thing to keep in step with the first.
    const bars = ['pos-shiftbar', 'pos-shiftbar-full'].map((id) => $(id)).filter(Boolean);
    const bar = bars[0];
    if (!bar) return;
    const s = state.shift;
    const mayManage = !!state.outletId;

    if (!s) {
        bar.className = 'pos-shiftbar is-closed';
        bar.innerHTML = `
            <span class="pos-shift-state"><span class="pos-shift-dot"></span>No shift open</span>
            <span class="pos-shift-meta">Sales still record, but they sit outside every cash count.</span>
            <span class="pos-shift-actions">
                <button type="button" id="pos-open-shift" class="pos-shift-btn is-primary" ${mayManage ? '' : 'disabled'}>Open shift</button>
            </span>`;
        $('pos-open-shift')?.addEventListener('click', openShiftDrawer);
        mirrorShiftBar(bars);
        return;
    }

    const since = s.opened_at && typeof s.opened_at.toDate === 'function'
        ? s.opened_at.toDate().toLocaleTimeString(window.FluxyMoney.baseLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
    const moves = (s.movements || []).length;
    bar.className = 'pos-shiftbar is-open';
    // Deliberately NOT showing expected cash here. The whole point of a blind
    // close is that the person counting has not been told the answer.
    bar.innerHTML = `
        <span class="pos-shift-state"><span class="pos-shift-dot"></span>Shift open</span>
        <span class="pos-shift-meta">Since ${esc(since)} · float ${rp(s.opening_float)}${moves ? ` · ${moves} drawer ${moves === 1 ? 'movement' : 'movements'}` : ''}</span>
        <span class="pos-shift-actions">
            <button type="button" id="pos-drawer-move" class="pos-shift-btn">Paid in / out</button>
            <button type="button" id="pos-close-shift" class="pos-shift-btn is-primary">Close shift</button>
        </span>`;
    mirrorShiftBar(bars);
}

// The Shift view shows the same bar. Cloning the HTML and re-binding by class
// keeps ONE source of truth for what a shift bar says; rendering it twice from
// two code paths is how the two come to disagree.
function mirrorShiftBar(bars) {
    if (bars.length < 2) return;
    const src = bars[0];
    bars.slice(1).forEach((dst) => {
        dst.className = src.className;
        dst.innerHTML = src.innerHTML.replace(/id="pos-(open-shift|drawer-move|close-shift)"/g, 'data-act="$1"');
        dst.querySelectorAll('[data-act]').forEach((b) => {
            const act = b.dataset.act;
            b.addEventListener('click', () => {
                if (act === 'open-shift') return openShiftDrawer();
                if (act === 'drawer-move') return openMovementDrawer();
                return once(openCloseShiftDrawer);
            });
        });
    });
}

function openShiftDrawer() {
    const outlet = state.outlets.find((o) => o.id === state.outletId);
    drawer({
        title: 'Open shift',
        subtitle: outlet ? outlet.name : '',
        submitLabel: 'Open shift',
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-float">Opening float</label>
                <input id="pos-float" name="float" inputmode="numeric" class="pos-amount-input" value="0" autocomplete="off">
                <p class="text-[11px] text-slate-500 mt-2">The cash already in the drawer for change. It is not income and posts nothing — it just changes what the drawer should hold at close.</p>
            </div>`,
        onSubmit: async (fd) => {
            const float = window.FluxyMoney.toMinor(fd.get('float'), window.FluxyMoney.baseCurrency());
            state.shift = await ds.openPosShift(state.uid, { dimensionId: state.outletId, openingFloat: float });
            toast('Shift open.');
            renderShift();
            await refresh();
        }
    });
    const el = $('pos-float');
    el.addEventListener('input', () => {
        const d = el.value.replace(/\D/g, '');
        el.value = d ? window.FluxyMoney.formatMoneyInput(el.value, window.FluxyMoney.baseCurrency()) : '';
    });
}

function openMovementDrawer() {
    let kind = 'paid_out';
    drawer({
        title: 'Paid in / out',
        subtitle: 'Cash that moved without a sale.',
        submitLabel: 'Record',
        body: `
            <div>
                <div class="pos-methods" id="pos-move-kind">
                    <button type="button" class="pos-method is-on" data-kind="paid_out">Paid out</button>
                    <button type="button" class="pos-method" data-kind="paid_in">Paid in</button>
                </div>
                <p class="text-[11px] text-slate-500 mt-2" id="pos-move-note"></p>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-move-amt">Amount</label>
                <input id="pos-move-amt" name="amount" inputmode="numeric" class="pos-amount-input" value="0" autocomplete="off">
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-move-why">What for?</label>
                <input id="pos-move-why" name="reason" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Beli es, bayar kurir, tambah kembalian…" required>
            </div>`,
        onSubmit: async (fd) => {
            const amount = window.FluxyMoney.toMinor(fd.get('amount'), window.FluxyMoney.baseCurrency());
            state.shift = await ds.recordPosShiftMovement(state.uid, state.shift.id, {
                kind, amount, reason: fd.get('reason')
            });
            toast(kind === 'paid_out' ? 'Paid out recorded.' : 'Paid in recorded.');
            renderShift();
        }
    });
    const note = () => {
        // Say what each one does to the books, because they differ and it is not
        // obvious: one is an expense, the other is moving your own cash around.
        $('pos-move-note').textContent = kind === 'paid_out'
            ? 'Records an expense — this money left the business.'
            : 'Change topped up from the safe. Moves cash around; posts nothing.';
    };
    $('pos-move-kind').addEventListener('click', (e) => {
        const b = e.target.closest('[data-kind]');
        if (!b) return;
        kind = b.dataset.kind;
        document.querySelectorAll('#pos-move-kind .pos-method').forEach((x) => x.classList.toggle('is-on', x === b));
        note();
    });
    const el = $('pos-move-amt');
    el.addEventListener('input', () => {
        const d = el.value.replace(/\D/g, '');
        el.value = d ? window.FluxyMoney.formatMoneyInput(el.value, window.FluxyMoney.baseCurrency()) : '';
    });
    note();
}

// BLIND CLOSE.
//
// The expected figure is not on screen — not in the shift bar, not in this
// drawer — until the count has been entered and submitted. Showing it first
// turns a count into a transcription, and the variance stops measuring
// anything. That is the whole reason a blind close exists, so the reveal is
// staged deliberately rather than by accident of layout.
async function openCloseShiftDrawer() {
    const tally = await ds.getPosShiftTally(state.uid, state.shift.id).catch(() => null);
    // Parked sales do NOT distort the count — only paid ones reach the drawer —
    // but they are unfinished business walking out of the door with the person
    // closing up, and nothing else on this screen would mention them.
    const parked = parkedSales().length;
    drawer({
        title: 'Close shift',
        subtitle: tally ? `${tally.order_count} ${tally.order_count === 1 ? 'order' : 'orders'} this shift` : '',
        submitLabel: 'Count and close',
        body: `
            ${parked ? `<div class="pos-note is-warn">
                <strong>${parked} ${parked === 1 ? 'sale is' : 'sales are'} still on hold.</strong>
                <span class="block text-[12px] mt-0.5">They are not in this count — nothing is owed on them yet — but they will still be here tomorrow.</span>
            </div>` : ''}
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-counted">Cash counted in the drawer</label>
                <input id="pos-counted" name="counted" inputmode="numeric" class="pos-amount-input" value="" placeholder="0" autocomplete="off" required>
                <p class="text-[11px] text-slate-500 mt-2">Count it before you look. FluxyOS shows what it expected only after you submit — a count taken against a number you were already shown cannot tell you anything.</p>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-close-note">Note <span class="font-normal text-slate-400">(optional)</span></label>
                <input id="pos-close-note" name="note" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Anything worth remembering about this shift">
            </div>`,
        onSubmit: async (fd) => {
            const counted = Number(String(fd.get('counted')).replace(/\D/g, ''));
            const closed = await ds.closePosShift(state.uid, state.shift.id, {
                countedCash: counted, note: fd.get('note')
            });
            state.shift = null;
            renderShift();
            await refresh();
            showShiftResult(closed);
        }
    });
    const el = $('pos-counted');
    el.addEventListener('input', () => {
        const d = el.value.replace(/\D/g, '');
        el.value = d ? window.FluxyMoney.formatMoneyInput(el.value, window.FluxyMoney.baseCurrency()) : '';
    });
}

// The reveal. Now — and only now — the expected figure and the variance.
function showShiftResult(s) {
    const v = Number(s.variance) || 0;
    const tone = v === 0 ? 'is-ok' : (v < 0 ? 'is-short' : 'is-over');
    const word = v === 0 ? 'Drawer balanced' : (v < 0 ? 'Short' : 'Over');
    const methods = Object.entries(s.by_method || {});
    drawer({
        title: 'Shift closed',
        subtitle: `${s.order_count} ${s.order_count === 1 ? 'order' : 'orders'} this shift`,
        submitLabel: 'Done',
        body: `
            <div>
                <div class="pos-total-row"><span>Opening float</span><span>${rp(s.opening_float)}</span></div>
                <div class="pos-total-row"><span>Cash sales</span><span>${rp(s.cash_sales)}</span></div>
                ${(s.movements || []).filter((m) => m.kind === 'paid_in').length
                    ? `<div class="pos-total-row"><span>Paid in</span><span>${rp((s.movements || []).filter((m) => m.kind === 'paid_in').reduce((a, m) => a + m.amount, 0))}</span></div>` : ''}
                ${(s.movements || []).filter((m) => m.kind === 'paid_out').length
                    ? `<div class="pos-total-row"><span>Paid out</span><span>−${rp((s.movements || []).filter((m) => m.kind === 'paid_out').reduce((a, m) => a + m.amount, 0))}</span></div>` : ''}
                <div class="pos-total-row is-grand"><span>Expected in drawer</span><span>${rp(s.expected_cash)}</span></div>
                <div class="pos-total-row"><span>You counted</span><span>${rp(s.counted_cash)}</span></div>
                <div class="pos-variance ${tone}"><span>${word}</span><span>${v === 0 ? rp(0) : (v < 0 ? '−' : '+') + rp(v)}</span></div>
                ${v !== 0 ? `<p class="text-[11px] text-slate-500 mt-2">Posted to 6700 Cash Over &amp; Short. It is kept out of sales on purpose — folding it in would hide the very thing this count exists to find.</p>` : ''}
            </div>
            ${s.non_cash_sales ? `<div class="pos-count-reveal">
                <p class="text-[12px] font-semibold text-slate-700 mb-2">Not in the drawer</p>
                <div class="pos-total-row"><span>Card, QRIS and transfer</span><span>${rp(s.non_cash_sales)}</span></div>
                <p class="text-[11px] text-slate-500 mt-2">Settles when the provider pays out, so it was never cash you could count.</p>
            </div>` : ''}
            ${methods.length ? `<div class="pos-count-reveal">
                <p class="text-[12px] font-semibold text-slate-700 mb-2">By payment method</p>
                ${methods.map(([m, amt]) => {
                    const label = (DataService.POS_PAYMENT_METHODS.find((x) => x.id === m) || {}).label || m;
                    return `<div class="pos-total-row"><span>${esc(label)}</span><span>${rp(amt)}</span></div>`;
                }).join('')}
            </div>` : ''}`,
        onSubmit: async () => {}
    });
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function refresh({ keepOrder = false } = {}) {
    // A seeded board must not be repainted from the server — see __posSeedBoard.
    if (state.frozen) return;
    const [overview, menu, shift] = await Promise.all([
        ds.getPosOverview(state.uid, { dimensionId: state.outletId }),
        ds.getPosMenu(state.uid),
        ds.getOpenPosShift(state.uid, { dimensionId: state.outletId })
    ]);
    // Checked AGAIN, after the await. Freezing stops the next refresh from
    // starting; it cannot stop one that was already in flight, and that one
    // resolves a second later and overwrites the fixture with real data — the
    // spec's seeded tables silently become the workspace's own. Intermittent by
    // construction, and worse the busier the workspace, which is exactly the
    // shape of bug a seeded fixture exists to avoid.
    if (state.frozen) return;
    state.overview = overview;
    state.menu = menu;
    state.shift = shift;
    // The board and the floor plan read ONE list. `getPosOverview` returns the
    // bookings that could hold a table near now, which is what the floor plan
    // needs; the board additionally loads the range it is showing (see
    // loadReservationRange), because a week in October is not "near now".
    mergeReservations();

    // Re-bind the open order to the freshly-read copy, so the panel can never
    // show a stale version and lose the concurrency race on the next write.
    if (state.orderId && !keepOrder) {
        const live = (overview.activeOrders || []).concat(overview.paidToday || [])
            .find((o) => o.id === state.orderId);
        if (live) state.order = live;
        else if (state.order && !['paid', 'void'].includes(state.order.status)) {
            // ABSENT FROM THE OVERVIEW IS NOT GONE.
            //
            // The overview is a bounded, outlet-filtered list read. The live
            // watcher calls refresh() on every snapshot, so a snapshot landing
            // moments after an order is created triggers a read that has not
            // caught up with it yet — and this branch then threw away the order
            // the cashier had just opened: panel back to "No order open", every
            // product card disabled again, no error anywhere. Intermittent, and
            // more likely the busier the outlet.
            //
            // So ask the document before discarding it. One read, only on the
            // miss, and it still clears for the case this branch is FOR: an
            // order voided on another device really is gone.
            const fresh = await ds.getPosOrder(state.uid, state.orderId).catch(() => null);
            if (fresh && fresh.status !== 'void') state.order = fresh;
            else { state.orderId = null; state.order = null; }
        }
    }

    renderShift();
    renderMetrics();
    renderBanners();
    renderTables();        // no-op unless the floor-plan sheet is open
    renderChips();
    renderMenu();
    renderOrderControls();
    renderOrder();
    $('pos-new-order').disabled = !state.outletId;

    applyPosProfileChrome();
    renderParkedChip();

    // Free-table count on the "Table Order" button — the floor plan is behind a
    // click now, so its one at-a-glance number comes forward to the button.
    const badge = $('pos-tables-count');
    if (badge) {
        const c = overview.counts || {};
        const has = Number(c.tablesTotal) > 0;
        badge.classList.toggle('hidden', !has);
        if (has) badge.textContent = `${c.tablesFree}/${c.tablesTotal}`;
    }

    // Sidebar counters. The till's nav carries the two numbers a cashier glances
    // at between orders, so switching view is a choice rather than a check.
    const c = overview.counts || {};
    const navTables = $('pos-nav-tables');
    if (navTables) navTables.textContent = Number(c.tablesTotal) ? `${c.tablesFree}/${c.tablesTotal}` : '';
    const navOrders = $('pos-nav-orders');
    if (navOrders) navOrders.textContent = Number(c.activeOrders) ? String(c.activeOrders) : '';
    const navShift = $('pos-nav-shift');
    if (navShift) navShift.hidden = !state.shift;

    const navRes = $('pos-nav-res');
    if (navRes) navRes.textContent = Number(c.reservationsUpcoming) ? String(c.reservationsUpcoming) : '';

    if (state.view === 'orders') renderOrderLists();
    if (state.view === 'reservations') renderReservations();

    autoSweepUnposted();
}

// The retry the design always described and never wired.
//
// firestore.rules says it in as many words — "a finance session sweeps them
// later" — and _emitPosSale's catch says the same. But nothing ever called
// emitUnpostedPosSales except a button in the notification panel, so "later"
// meant "when somebody notices the badge". Between 2026-08-30 and 2026-08-31
// every till sale failed to post and the backlog simply accumulated.
//
// Runs ONCE per page load, only when there is a backlog and only for a session
// that may write journals — a cashier cannot post, and hammering a sweep that
// is guaranteed to fail is worse than not trying. `transaction_id` is stamped
// in the same batch as the transaction, so re-running is idempotent.
function autoSweepUnposted() {
    if (state.sweptOnce) return;
    if (!state.overview || !(state.overview.unpostedCount > 0)) return;
    const ws = (typeof window !== 'undefined' && window.FluxyWorkspace) || null;
    if (!(ws && typeof ws.can === 'function' && ws.can('accounting.post'))) return;

    state.sweptOnce = true;
    (async () => {
        try {
            const r = await ds.emitUnpostedPosSales(state.uid);
            if (!r.emitted) {
                // Nothing moved. Loud on purpose: a sweep that finds a backlog
                // and posts none of it is the exact shape of the bug above.
                if (r.found) console.error('[pos] sweep could not post any of the',
                    r.found, 'unposted sale(s):', r.failed.slice(0, 3));
                return;
            }
            toast(`${r.emitted} till ${r.emitted === 1 ? 'sale' : 'sales'} posted to the ledger.`);
            await ds.postPendingJournals(state.uid).catch(() => {});
            await refresh();
        } catch (err) {
            console.error('[pos] automatic ledger sweep failed:', err && err.message);
        }
    })();
}

// The parts of the shell that are F&B-shaped. Applied on every refresh rather
// than once at boot, because the workspace resolves asynchronously and the first
// render can happen before the category is known.
function applyPosProfileChrome() {
    const p = posProfile();

    // "Table Order" opens the floor plan. Without tables there is no floor.
    $('pos-tables-btn')?.classList.toggle('hidden', !p.views.includes('tables'));

    // "Create Order" on a floor with tables, "New sale" at a counter.
    const start = $('pos-new-order');
    const startText = start && start.querySelector('span');
    if (startText) startText.textContent = p.startLabel;
    // Matches what the button now does: a counter creates, an F&B till asks.
    if (start) start.setAttribute('aria-label', p.payFirst ? 'Start a new sale' : 'Create an order');
}

function watch() {
    if (state.unwatch) { state.unwatch(); state.unwatch = null; }
    state.unwatch = ds.watchPosOrders(state.uid, { dimensionId: state.outletId }, (rows) => {
        // A QR order is a write this tab does not know about — the one case the
        // app's emit-on-write refresh model cannot cover. See watchPosOrders.
        const before = (state.overview && state.overview.counts.newQrOrders) || 0;
        const now = rows.filter((o) => o.channel === 'qr' && o.status === 'submitted').length;
        if (now > before) toast(`${now - before} new order from a table.`, 'info');
        refresh().catch(() => {});
    });
}

// Bound where the control is CREATED, not in wire(). The outlet select moved
// into the sidebar, which the loader paints asynchronously — so wire() ran
// first, `$('pos-outlet')` was null, and the throw aborted the rest of wire()
// including the nav swap. The symptom was the finance nav never being replaced,
// which reads as a layout bug and is really an unhandled null three calls away.
function bindOutlet() {
    const sel = document.getElementById('pos-outlet');
    if (!sel || sel.dataset.posBound) return;
    sel.dataset.posBound = '1';
    sel.addEventListener('change', async (e) => {
        state.outletId = e.target.value;
        localStorage.setItem(OUTLET_KEY, state.outletId);
        state.orderId = null; state.order = null;
        await refresh();
        watch();
    });
}

function wire() {
    // One interval for the life of the page. It no-ops unless the Orders view is
    // the one on screen.
    startWaitTicker();
    $('pos-primary').addEventListener('click', () => {
        // With no order open this button is not "advance" — there is nothing to
        // advance. It is whatever the empty panel needs: a table to exist, or a
        // sale to start.
        if (!state.order) {
            const what = $('pos-primary').dataset.emptyAction;
            if (what === 'create-order') return openCreateOrderDialog();
            return once(() => startOrder(null));
        }
        return once(advance);
    });
    $('pos-discount-btn').addEventListener('click', openDiscountDrawer);
    $('pos-void-btn').addEventListener('click', openVoidDrawer);
    $('pos-refund-btn').addEventListener('click', openRefundDrawer);
    $('pos-reprint-btn').addEventListener('click', () => openReceipt(state.order));
    $('pos-new-order').addEventListener('click', () => once(async () => {
        // PARK, never drop. Pressing this with items in the cart used to abandon
        // them silently — no warning, no toast, and the only route back was the
        // Orders board, which nobody had a reason to open.
        const parked = await parkCurrentSale();
        const p = posProfile();
        // A counter has one kind of order, so asking which would be a question
        // with one answer. Pay-first also opens its sale on the first tap of a
        // product, so there is nothing left to do once the cart is clear.
        if (p.payFirst) { if (!parked) await startOrder(null); return; }
        openCreateOrderDialog();
    }));

    $('pos-hold-btn')?.addEventListener('click', () => openHoldDrawer());

    const parkedChip = $('pos-parked-chip');
    parkedChip?.addEventListener('click', () => {
        const box = $('pos-order-results');
        if (box.dataset.showParked) { delete box.dataset.showParked; }
        else { box.dataset.showParked = '1'; }
        renderOrderSearch();
    });
    $('pos-tables-btn').addEventListener('click', openTableSheet);
    $('pos-manage-tables')?.addEventListener('click', openTableDrawer);
    $('pos-arrange-btn')?.addEventListener('click', () => {
        state.arranging = !state.arranging;
        // Leaving by the toggle discards, exactly like Cancel — there is no
        // third outcome where half an arrangement survives.
        if (!state.arranging) { state.floorMoves = {}; state.floorReset = false; }
        setArrangeButton();
        renderTables();
    });

    // sidebar-loader.js renders asynchronously (it awaits auth), so the nav may
    // not exist yet. Observe rather than poll on a timer: a fixed delay is a
    // race that passes on a fast machine and ships a nav-less till on a slow one.
    if (!mountTillNav()) {
        const mo = new MutationObserver(() => { if (mountTillNav()) mo.disconnect(); });
        mo.observe(document.getElementById('sidebar'), { childList: true, subtree: true });
        setTimeout(() => mo.disconnect(), 15000);
    }

    // The burger, the backdrop and Sign Out all belong to the SHARED sidebar:
    // sidebar-loader.js binds `header button.md:hidden` and owns #logout-btn.
    // Rolling my own left two off-canvas mechanisms racing over one element.

    // Catalogue filters. Client-side against an already-loaded menu, so this is
    // a repaint per keystroke and never a query.
    // Orders board: tabs + search. Both filter an already-loaded list, so this
    // is a repaint, never a query — a cashier scanning a board must not wait.
    document.querySelectorAll('[data-otab]').forEach((b) => {
        b.addEventListener('click', () => {
            state.orderTab = b.dataset.otab;
            document.querySelectorAll('[data-otab]').forEach((x) => {
                const on = x === b;
                x.classList.toggle('is-active', on);
                x.setAttribute('aria-selected', String(on));
            });
            renderOrderLists();
        });
    });
    $('pos-orders-search').addEventListener('input', (e) => {
        state.orderQuery = e.target.value || '';
        renderOrderLists();
    });

    // ── Reservations board ──────────────────────────────────────────────
    // Range, layout and search are all client-side repaints against a range
    // already loaded — a host scrubbing through a week must not wait on a query
    // per click. Only moving the RANGE fetches, and only when it leaves what is
    // already in hand.
    document.querySelectorAll('[data-rperiod]').forEach((b) => b.addEventListener('click', () => {
        state.resPeriod = b.dataset.rperiod;
        loadReservationRange().catch(() => {});
        renderReservations();
    }));
    document.querySelectorAll('[data-rlayout]').forEach((b) => b.addEventListener('click', () => {
        state.resLayout = b.dataset.rlayout;
        renderReservations();
    }));
    document.querySelectorAll('[data-rmove]').forEach((b) => b.addEventListener('click', () => {
        moveResRange(Number(b.dataset.rmove));
        loadReservationRange().catch(() => {});
        renderReservations();
    }));
    $('pos-res-search')?.addEventListener('input', (e) => {
        state.resQuery = e.target.value || '';
        renderReservations();
    });
    $('pos-res-new')?.addEventListener('click', () => openReservationDialog());
    // ── Sort & filter panel ─────────────────────────────────────────────
    // The button used to be a second, hidden way to set the "In Process" tab —
    // a control that silently moved another control. It now opens the panel.
    $('pos-orders-filter').addEventListener('click', (e) => {
        e.stopPropagation();
        if ($('pos-filter-panel')?.hidden === false) closePosFilterPanel();
        else openPosFilterPanel();
    });
    $('pos-filter-close')?.addEventListener('click', closePosFilterPanel);

    $('pos-filter-rail')?.addEventListener('click', (e) => {
        const item = e.target.closest('.fluxy-filter-rail-item');
        if (!item) return;
        // Re-rendering the rail detaches this node, so the outside-click handler
        // below would otherwise read a target that is no longer inside the panel
        // and close it. Same reason the Ledger stops the event here.
        e.stopPropagation();
        posActiveGroup = item.dataset.group;
        renderPosFilterRail();
        renderPosFilterOptions();
    });

    $('pos-filter-options')?.addEventListener('click', (e) => {
        const opt = e.target.closest('.fluxy-filter-option');
        if (!opt) return;
        e.stopPropagation();
        posPendingFilters[posActiveGroup] = opt.dataset.value;
        renderPosFilterOptions();
        renderPosFilterRail();
        updatePosFilterPreview();
    });

    $('pos-filter-reset')?.addEventListener('click', (e) => {
        e.stopPropagation();
        POS_FILTER_GROUPS.forEach((g) => { posPendingFilters[g.key] = g.default; });
        renderPosFilterRail();
        renderPosFilterOptions();
        updatePosFilterPreview();
    });

    $('pos-filter-apply')?.addEventListener('click', (e) => {
        e.stopPropagation();
        Object.assign(state, posPendingFilters);
        syncPosFilterTrigger();
        closePosFilterPanel();
        renderOrderLists();
    });

    document.addEventListener('click', (e) => {
        const panel = $('pos-filter-panel');
        if (!panel || panel.hidden) return;
        if (e.target.closest('#pos-filter-popover')) return;
        closePosFilterPanel();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $('pos-filter-panel')?.hidden === false) closePosFilterPanel();
    });
    window.addEventListener('resize', () => {
        if ($('pos-filter-panel')?.hidden === false) positionPosFilterPanel();
    });

    // Notifications. Everything that used to stack above the catalogue lives
    // here, the way the dashboard gathers what needs attention instead of
    // pushing the actual work further down the page.
    const bell = $('pos-bell');
    const panel = $('pos-bell-panel');
    bell.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        bell.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
        if (panel.classList.contains('hidden')) return;
        if (panel.contains(e.target) || bell.contains(e.target)) return;
        panel.classList.add('hidden');
        bell.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || panel.classList.contains('hidden')) return;
        panel.classList.add('hidden');
        bell.setAttribute('aria-expanded', 'false');
        bell.focus();
    });

    const menuSearch = $('pos-menu-search');
    menuSearch.addEventListener('input', (e) => {
        state.menuQuery = e.target.value || '';
        renderMenu();
    });
    menuSearch.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const typed = menuSearch.value;
        if (scanBarcode(typed)) {
            // Clear and stay focused: a cashier scans a queue of items without
            // touching the screen between them.
            menuSearch.value = '';
            state.menuQuery = '';
            renderMenu();
            menuSearch.focus();
            return;
        }
        // Enter on something that is not a code is not an error — the grid is
        // already filtered by it. Only say so when it matched nothing at all.
        if (typed.trim() && !visibleMenu().length) {
            toast(`Nothing matches "${typed.trim()}".`, 'error');
        }
    });

    // Open-order search. The dining/table selects that used to sit beside it are
    // gone — Create Order is the only entry point now.
    $('pos-order-search').addEventListener('input', renderOrderSearch);

    // Offline is v1's honest limitation: the till is online-only, so it says so
    // loudly rather than silently failing a save mid-service.
    const setOnline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);
    setOnline();
}

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = '/login'; return; }
    // No `feature` gate: eligibility resolves from the OWNER's email, and a
    // cashier is not the owner. The sidebar reveals the entry for a POS-only
    // role; firestore.rules is the real boundary either way.
    const gated = await applyToPage(user, { pageKey: 'pos' });
    if (gated) return;

    state.uid = user.uid;
    ds.actorUid = user.uid;

    // No identity painted here at all: the shared sidebar's profile block already
    // carries the avatar, name and role, and a second avatar on a 60px topbar
    // said the same thing twice.

    wire();

    // The outlet <select> lives in the sidebar now, which sidebar-loader.js
    // paints asynchronously. Waiting on the mount beats a timer: a fixed delay
    // is a race that loads outlets into an element that does not exist yet.
    await Promise.race([outletMounted, new Promise((r) => setTimeout(r, 12000))]);
    const hasOutlet = await loadOutlets();
    if (!hasOutlet) {
        $('pos-metrics').innerHTML = '';
        renderOrder();
        return;
    }
    await refresh();
    watch();
});
