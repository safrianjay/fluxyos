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
    orderTab: 'all',
    orderQuery: '',
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
const POS_PROFILES = {
    fnb: {
        ladder: { open: 'sent', submitted: 'sent', sent: 'served', served: 'awaiting_payment' },
        views: ['till', 'tables', 'orders', 'shift'],
        payFirst: false,
        startLabel: 'Takeaway',
        closeLabel: 'Close',
        emptyTitle: 'No order open',
        emptyAction: 'Pick a table'
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

const VIEWS = {
    till:   { title: 'Point of Sale (POS)', crumb: 'Pos' },
    tables: { title: 'Tables',              crumb: 'Tables' },
    orders: { title: 'Orders',              crumb: 'Orders' },
    shift:  { title: 'Shift',               crumb: 'Shift' }
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
    $('pos-view-crumb').textContent = VIEWS[name].crumb;
    // The floor plan and the order lists are painted on demand: they read from
    // state.overview, which refresh() already holds, so switching is a repaint.
    if (name === 'tables') renderTables();
    if (name === 'orders') renderOrderLists();
    if (name === 'shift')  { renderShift(); renderShiftHistory(); }
    // Orders KEEPS the panel: clicking a card opens the order there and the
    // board stays visible behind it, which is the whole interaction. Only Shift
    // goes full width — it has no order to work on.
    document.getElementById('pos-shell')?.classList.toggle('is-wide', name === 'shift');
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
const STATUS = {
    open:             { label: 'Open',            cls: 'fluxy-status-neutral', next: 'sent',              action: 'Send to kitchen' },
    submitted:        { label: 'New QR order',    cls: 'fluxy-status-info',    next: 'sent',              action: 'Confirm order' },
    sent:             { label: 'In the kitchen',  cls: 'fluxy-status-info',    next: 'served',            action: 'Mark served' },
    served:           { label: 'Served',          cls: 'fluxy-status-success', next: 'awaiting_payment',  action: 'Request bill' },
    awaiting_payment: { label: 'Awaiting payment', cls: 'fluxy-status-warning', next: null,               action: 'Take payment' },
    paid:             { label: 'Paid',            cls: 'fluxy-status-success', next: null,                action: 'Close' },
    void:             { label: 'Voided',          cls: 'fluxy-status-danger',  next: null,                action: 'Close' }
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
        const cls = !ord ? 'is-free' : (ord.status === 'awaiting_payment' ? 'is-bill' : 'is-busy');
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
                    style="${spot ? `left:${spot.x}%; top:${spot.y}%;` : ''} --pos-table-w:${fp.w}px; --pos-table-h:${fp.h}px;"
                    aria-label="Table ${esc(t.label)}, ${seats} seats — ${ord ? 'in use' : 'free'}">
            ${chairRow(fp.perSide)}
            <span class="pos-table-body">
                <span class="pos-table-top">
                    <span class="pos-table-label">${esc(t.label)}</span>
                    ${t.zone && !state.zone ? `<span class="pos-table-zone">${esc(t.zone)}</span>` : ''}
                </span>
                ${ord ? `<span class="pos-table-meta">
                    <span class="pos-table-money">${rp(ord.total_amount)}</span>
                    ${elapsedSince(ord.opened_at) ? `<span class="pos-table-since">${esc(elapsedSince(ord.opened_at))}</span>` : ''}
                </span>` : '<span class="pos-table-free">Free</span>'}
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
            // The order opens in the SHARED right-hand panel, beside the floor
            // plan — the same interaction as picking a table from the order
            // flow. It used to jump to the till view, which is a context switch
            // for something already on screen, and it lost the cashier's place
            // on the floor.
            if (orderId) selectOrder(orderId);
            else await once(() => startOrder(btn.dataset.table));
            renderOrderControls();
            document.getElementById('pos-order-panel')
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
const ORDER_TABS = {
    all:     () => true,
    process: (o) => ['open', 'submitted', 'sent', 'served', 'awaiting_payment'].includes(o.status),
    done:    (o) => o.status === 'paid'
};

function visibleOrders() {
    const ov = state.overview || {};
    const all = (ov.activeOrders || []).concat(ov.paidToday || []);
    const pass = ORDER_TABS[state.orderTab] || ORDER_TABS.all;
    const q = (state.orderQuery || '').trim().toLowerCase();
    return all.filter((o) => {
        if (!pass(o)) return false;
        if (!q) return true;
        // Name, order, table — plus the item names, because "who ordered the
        // waffles" is how a cashier actually finds a bill.
        return String(o.order_number || '').toLowerCase().includes(q)
            || String(o.table_label || '').toLowerCase().includes(q)
            || (o.table_label ? false : 'takeaway'.includes(q))
            || (o.lines || []).some((l) => String(l.item_name || '').toLowerCase().includes(q));
    }).sort((a, b) => {
        const ta = a.opened_at?.toDate ? a.opened_at.toDate().getTime() : 0;
        const tb = b.opened_at?.toDate ? b.opened_at.toDate().getTime() : 0;
        return tb - ta;
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

function renderOrderLists() {
    const grid = $('pos-orders-grid');
    const empty = $('pos-orders-empty');
    const dateEl = $('pos-orders-date');
    if (!grid || !empty) return;

    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString(window.FluxyMoney.baseLocale(),
            { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    }

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

    // Three or four lines, then a count. A card whose height is set by its
    // longest order breaks the grid rhythm and buries the total and the actions
    // below the fold of the card.
    const MAX_LINES = 3;

    grid.innerHTML = rows.map((o) => {
        const st = STATUS[o.status] || STATUS.open;
        const when = o.opened_at?.toDate ? o.opened_at.toDate() : null;
        const lines = o.lines || [];
        const shown = lines.slice(0, MAX_LINES);
        const more = lines.length - shown.length;
        const payable = ['served', 'awaiting_payment'].includes(o.status)
            || (o.status !== 'paid' && o.status !== 'void' && Number(o.total_amount) > 0);

        return `<article class="pos-ocard${state.orderId === o.id ? ' is-open' : ''}" data-order-card="${esc(o.id)}" data-status="${esc(o.status || '')}" tabindex="0" role="button"
                    aria-label="Order ${esc(o.order_number || '')}, ${esc(orderTag(o))}">
            <div class="pos-ocard-head">
                <span class="pos-otag">${esc(orderTag(o))}</span>
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
            </div>

            <table class="pos-ocard-items">
                <thead><tr><th>Items</th><th>Qty</th><th>Price</th></tr></thead>
                <tbody>
                    ${shown.map((l) => `<tr>
                        <td>${esc(l.item_name)}</td>
                        <td>${Number(l.quantity) || 0}</td>
                        <td>${rp((Number(l.gross_amount) || 0) - (Number(l.discount_amount) || 0))}</td>
                    </tr>`).join('')}
                    ${more > 0 ? `<tr class="pos-ocard-more"><td colspan="3">+${more} more</td></tr>` : ''}
                    ${!lines.length ? '<tr class="pos-ocard-more"><td colspan="3">Nothing added yet</td></tr>' : ''}
                </tbody>
            </table>

            <div class="pos-ocard-total"><span>Total</span><span>${rp(o.total_amount)}</span></div>

            <div class="pos-ocard-actions">
                <button type="button" class="pos-ocard-btn" data-see="${esc(o.id)}">See Details</button>
                ${payable
                    ? `<button type="button" class="pos-ocard-btn is-primary" data-pay="${esc(o.id)}">Pay Bills</button>`
                    : (o.status === 'paid'
                        ? `<button type="button" class="pos-ocard-btn is-primary" data-print="${esc(o.id)}">Receipt</button>`
                        : '')}
            </div>
        </article>`;
    }).join('');

    // Clicking the card — anywhere but a button — opens it in the SHARED panel.
    // The list stays put behind it: navigating away from a board a cashier is
    // working through is the thing this view exists to avoid.
    const open = (id) => { selectOrder(id); renderOrderLists(); };
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
    grid.querySelectorAll('[data-see]').forEach((b) =>
        b.addEventListener('click', () => open(b.dataset.see)));
    grid.querySelectorAll('[data-pay]').forEach((b) =>
        b.addEventListener('click', () => { selectOrder(b.dataset.pay); openPaymentDrawer(); }));
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

// Reference parity: dining type + table, and a search over open orders. All
// three drive the EXISTING flows (startOrder / selectOrder) rather than new
// ones — the panel is a different way in, not a different behaviour.
function renderOrderControls() {
    const o = state.overview;
    const sel = $('pos-table-select');
    const dining = $('pos-dining');
    if (!sel || !o) return;

    const byTable = {};
    (o.activeOrders || []).forEach((ord) => { if (ord.table_id) byTable[ord.table_id] = ord; });
    const current = state.order && state.order.table_id;

    sel.innerHTML = ['<option value="">Select table</option>'].concat(
        (o.tables || []).map((t) => {
            const busy = byTable[t.id] && (!state.order || byTable[t.id].id !== state.orderId);
            return `<option value="${esc(t.id)}"${current === t.id ? ' selected' : ''}>`
                + `${esc(t.label)}${busy ? ' · in use' : ''}</option>`;
        })
    ).join('');

    if (dining) {
        const takeaway = !!state.order && !state.order.table_id;
        dining.value = takeaway ? 'takeaway' : 'dine_in';
        // A table cannot be chosen for a takeaway order, and an order already
        // open cannot change its table — moving a live order between tables is
        // Phase 3 of the POS plan and has no DAL support yet, so the control is
        // disabled rather than present and failing.
        sel.disabled = dining.value === 'takeaway' || !!state.order;
    }
}

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

    host.innerHTML = rows.map((m) => `
        <button type="button" class="pos-card" data-item="${esc(m.id)}"
                data-price="${m.sales_price}" data-name="${esc(m.name)}" ${live ? '' : 'disabled'}
                title="${live ? '' : 'Open a table or start a takeaway order first'}">
            <span class="pos-card-media">
                <span class="pos-card-initial">${esc(initials(m.name))}</span>
            </span>
            <span class="pos-card-name">${esc(m.name)}</span>
            <span class="pos-card-price">${rp(m.sales_price)}</span>
            <span class="pos-card-add" aria-hidden="true">+</span>
        </button>`).join('');

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
            : (state.overview && state.overview.tables.length
                ? 'Pick a table to start.' : 'Add a table, or start a takeaway order.');
        badge.classList.add('hidden');
        lines.innerHTML = '';
        totals.innerHTML = '';
        primary.disabled = true;
        primary.textContent = posProfile().emptyAction;
        discountBtn.classList.add('hidden');
        voidBtn.classList.add('hidden');
        refundBtn.classList.add('hidden');
        $('pos-reprint-btn').classList.add('hidden');
        return;
    }

    const st = STATUS[o.status] || STATUS.open;
    $('pos-order-title').textContent = o.table_label ? `Table ${o.table_label}` : 'Takeaway';
    $('pos-order-sub').textContent = `Order ${o.order_number || ''}${o.channel === 'qr' ? ' · scanned by the customer' : ''}`;
    badge.className = `fluxy-status ${st.cls}`;
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
            <div>
                <div class="pos-line-head">
                    <div class="pos-line-name">${esc(l.item_name)}</div>
                    ${editableNow ? `<button type="button" class="pos-line-remove" data-remove="${esc(l.line_id)}"
                        aria-label="Remove ${esc(l.item_name)}" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                    </button>` : ''}
                </div>
                <div class="pos-line-calc">${rp((Number(l.unit_price) || 0) + (Number(l.modifier_amount) || 0))} × ${qty} = ${rp(gross)}</div>
                ${(l.modifiers || []).length ? `<div class="pos-line-mods">${
                    l.modifiers.map((m) => esc(m.option_name)
                        + (m.price_delta ? ` (${m.price_delta > 0 ? '+' : '−'}${rp(m.price_delta)})` : '')).join(' · ')
                }</div>` : ''}
                ${disc > 0 ? `<div class="pos-line-meta" style="color:#C2410C">${esc(l.discount_reason || 'Discount')} −${rp(disc)} · now ${rp(net)}</div>` : ''}
                ${l.note ? `<div class="pos-line-meta">${esc(l.note)}</div>` : ''}
                ${editableNow ? `
                <div class="pos-line-controls">
                    <div class="pos-qty">
                        <button type="button" data-dec="${esc(l.line_id)}" aria-label="One fewer ${esc(l.item_name)}">−</button>
                        <span>${qty}</span>
                        <button type="button" data-inc="${esc(l.line_id)}" aria-label="One more ${esc(l.item_name)}">+</button>
                    </div>
                    <button type="button" class="pos-line-note-btn" data-note="${esc(l.line_id)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>
                        ${l.note ? 'Edit note' : 'Add notes'}
                    </button>
                    <button type="button" class="pos-line-note-btn" data-disc="${esc(l.line_id)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 5 5 19M6.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>
                        Discount
                    </button>
                </div>` : ''}
            </div>
            <div class="pos-line-amt">${rp(net)}</div>
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

async function startOrder(tableId) {
    const t = state.overview.tables.find((x) => x.id === tableId);
    try {
        const order = await ds.createPosOrder(state.uid, {
            dimensionId: state.outletId,
            tableId: tableId || null,
            tableLabel: t ? t.label : null,
            channel: 'staff',
            // Stamps which drawer rang it up. Null when no shift is open — the
            // sale is still real, it just sits outside every cash count.
            shiftId: state.shift ? state.shift.id : null
        });
        state.orderId = order.id;
        state.order = order;
        renderOrder();
        // renderMenu() used to run HERE, before the refresh below. That enabled
        // every product card while `once()` was still holding state.busy — and
        // once() DROPS a call while busy, silently. So a cashier could tap a
        // table, tap a dish immediately, and lose the tap with no feedback at
        // all. The cards must not claim to be ready before the till is.
        //
        // refresh() paints the menu itself, and everything it does after the
        // reads is synchronous, so the cards now become tappable within the same
        // task that clears the guard.
        await refresh({ keepOrder: true });
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

async function advance() {
    const o = state.order;
    if (!o) return;
    if (o.status === 'paid' || o.status === 'void') {
        state.orderId = null; state.order = null;
        renderOrder(); renderMenu();
        return;
    }
    if (o.status === 'awaiting_payment') return openPaymentDrawer();
    // The ladder is PROFILE data, not a property of the status. A pay-first
    // profile has no next step, and "no next step" here means charge — never
    // "do nothing", which is what a bare `return` would have made it.
    const next = posProfile().ladder[o.status];
    if (!next) return openPaymentDrawer();
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

function openPaymentDrawer() {
    const o = state.order;
    const due = Math.max(0, Number(o.total_amount) - Number(o.paid_amount || 0));
    const methods = DataService.POS_PAYMENT_METHODS;
    let method = 'cash';

    const d = drawer({
        title: 'Take payment',
        subtitle: `${o.table_label ? `Table ${o.table_label}` : 'Takeaway'} · ${rp(due)} due`,
        submitLabel: 'Record payment',
        body: `
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2">How did they pay?</label>
                <div class="pos-methods" id="pos-method-row">
                    ${methods.map((m) => `<button type="button" class="pos-method${m.id === 'cash' ? ' is-on' : ''}" data-method="${m.id}">${esc(m.label)}</button>`).join('')}
                </div>
                <p class="text-[11px] text-slate-500 mt-2" id="pos-settle-note"></p>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-pay-amount">Amount received</label>
                <input id="pos-pay-amount" name="amount" inputmode="numeric" class="pos-amount-input" value="${window.FluxyMoney.formatMoneyInput(window.FluxyMoney.fromMinor(due, window.FluxyMoney.baseCurrency()), window.FluxyMoney.baseCurrency())}" autocomplete="off">
                <p class="text-[11px] text-slate-500 mt-2" id="pos-change-note"></p>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-pay-ref">Reference <span class="font-normal text-slate-400">(optional)</span></label>
                <input id="pos-pay-ref" name="reference" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Transfer note, QRIS ref…">
            </div>`,
        onSubmit: async (fd) => {
            const amount = window.FluxyMoney.toMinor(fd.get('amount'), window.FluxyMoney.baseCurrency());
            const order = await ds.recordPosPayment(state.uid, state.orderId, {
                method, amount, reference: fd.get('reference')
            });
            state.order = order;
            if (order.status === 'paid') {
                toast(`Paid — ${rp(order.total_amount)} recorded.`);
                // The receipt is asked for at the counter, in the second after
                // payment — not from a history screen later.
                openReceipt(order);
                // The order STAYS on screen. Clearing it immediately was how the
                // Refund button became unreachable: a paid order leaves the table
                // grid, so the panel was the only way back to it and the panel
                // had just emptied itself. The cashier dismisses it with Close.
            } else {
                toast(`${rp(amount)} recorded. ${rp(Number(order.total_amount) - Number(order.paid_amount))} still due.`);
            }
            renderOrder(); renderMenu();
            await refresh();
        }
    });

    const settleNote = () => {
        const m = methods.find((x) => x.id === method);
        // Say where the money actually goes. A cashier does not need the account
        // number, but "not in the drawer until the payout" is operationally real.
        $('pos-settle-note').textContent = m.settlement === 'clearing'
            ? 'Settles when the provider pays out — not cash in the drawer today.'
            : 'Counts as cash in the drawer today.';
    };
    const changeNote = () => {
        const v = window.FluxyMoney.toMinor($('pos-pay-amount').value, window.FluxyMoney.baseCurrency());
        const el = $('pos-change-note');
        if (v > due) el.innerHTML = `<strong>Change: ${rp(v - due)}</strong>`;
        else if (v > 0 && v < due) el.textContent = `Part payment — ${rp(due - v)} would still be due.`;
        else el.textContent = '';
    };
    document.getElementById('pos-method-row').addEventListener('click', (e) => {
        const b = e.target.closest('[data-method]');
        if (!b) return;
        method = b.dataset.method;
        document.querySelectorAll('.pos-method').forEach((x) => x.classList.toggle('is-on', x === b));
        settleNote();
    });
    const amt = $('pos-pay-amount');
    amt.addEventListener('input', () => {
        const digits = amt.value.replace(/\D/g, '');
        amt.value = digits ? window.FluxyMoney.liveMoneyInput(amt.value) : '';
        changeNote();
    });
    settleNote(); changeNote();
    return d;
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
    const [overview, menu, shift] = await Promise.all([
        ds.getPosOverview(state.uid, { dimensionId: state.outletId }),
        ds.getPosMenu(state.uid),
        ds.getOpenPosShift(state.uid, { dimensionId: state.outletId })
    ]);
    state.overview = overview;
    state.menu = menu;
    state.shift = shift;

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

    if (state.view === 'orders') renderOrderLists();

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

    // "Takeaway" is a distinction only a business with a dining room makes.
    const start = $('pos-new-order');
    const startText = start && start.querySelector('span');
    if (startText) startText.textContent = p.startLabel;
    if (start) start.setAttribute('aria-label', p.payFirst ? 'Start a new sale' : 'Start a takeaway order');

    // Dine-in / table pickers: meaningless at a counter.
    document.querySelector('.pos-order-selects')?.classList.toggle('hidden', !p.views.includes('tables'));
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
    $('pos-primary').addEventListener('click', () => once(advance));
    $('pos-discount-btn').addEventListener('click', openDiscountDrawer);
    $('pos-void-btn').addEventListener('click', openVoidDrawer);
    $('pos-refund-btn').addEventListener('click', openRefundDrawer);
    $('pos-reprint-btn').addEventListener('click', () => openReceipt(state.order));
    $('pos-new-order').addEventListener('click', () => once(async () => {
        // PARK, never drop. Pressing this with items in the cart used to abandon
        // them silently — no warning, no toast, and the only route back was the
        // Orders board, which nobody had a reason to open.
        const parked = await parkCurrentSale();
        // Pay-first opens its sale on the first tap of a product, so there is
        // nothing more to do once the cart is clear.
        if (!posProfile().payFirst) await startOrder(null);
        else if (!parked) await startOrder(null);
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
    // The reference's filter button. It scopes to THIS outlet's open orders —
    // the one filter the board does not already offer as a tab — rather than
    // opening a panel of controls that duplicate the tabs beside it.
    $('pos-orders-filter').addEventListener('click', (e) => {
        const on = state.orderTab !== 'process';
        state.orderTab = on ? 'process' : 'all';
        e.currentTarget.setAttribute('aria-expanded', String(on));
        e.currentTarget.classList.toggle('is-on', on);
        document.querySelectorAll('[data-otab]').forEach((x) => {
            const active = x.dataset.otab === state.orderTab;
            x.classList.toggle('is-active', active);
            x.setAttribute('aria-selected', String(active));
        });
        renderOrderLists();
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

    // Open-order search + the dining/table selectors.
    $('pos-order-search').addEventListener('input', renderOrderSearch);
    $('pos-dining').addEventListener('change', (e) => {
        // Only meaningful before an order exists: it chooses HOW the next order
        // starts. Once one is open its table is fixed (moving a live order
        // between tables is Phase 3 of the POS plan and has no DAL support).
        if (state.order) { renderOrderControls(); return; }
        if (e.target.value === 'takeaway') once(() => startOrder(null));
        else renderOrderControls();
    });
    $('pos-table-select').addEventListener('change', (e) => {
        const id = e.target.value;
        if (!id || state.order) return;
        const ord = ((state.overview && state.overview.activeOrders) || [])
            .find((o) => o.table_id === id);
        if (ord) return selectOrder(ord.id);
        return once(() => startOrder(id));
    });

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
