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
    unwatch: null,
    busy: false
};

// ── Formatting ───────────────────────────────────────────────────────────────
// Rupiah, no space after Rp, dot thousands separator. Never a monospace face.
const rp = (n) => `Rp${Math.round(Math.abs(Number(n) || 0)).toLocaleString('id-ID')}`;
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
async function once(fn) {
    if (state.busy) return null;
    state.busy = true;
    try { return await fn(); } finally { state.busy = false; }
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
    const hint = $('pos-outlet-hint');
    if (!state.outlets.length) {
        sel.innerHTML = '<option value="">No outlets yet</option>';
        sel.disabled = true;
        // Not a dead end: say exactly where an outlet comes from. Outlets are
        // created in the receive-stock drawer today, which nobody would guess.
        hint.innerHTML = 'Create one from <a href="/inventory" class="underline font-semibold">Inventory → Receive stock</a> first — a sale with no outlet cannot be attributed.';
        return false;
    }
    hint.textContent = '';
    sel.disabled = false;
    const stored = localStorage.getItem(OUTLET_KEY);
    state.outletId = state.outlets.some((o) => o.id === stored) ? stored : state.outlets[0].id;
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

    $('pos-banners').innerHTML = out.join('');
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

function renderTables() {
    const o = state.overview;
    if (!o) return;
    const host = $('pos-tables');
    const empty = $('pos-tables-empty');

    if (!o.tables.length) {
        host.classList.add('hidden');
        empty.classList.remove('hidden');
        // The empty state offers the action that actually applies here, not a
        // generic "Add Record".
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

    const byTable = {};
    (o.activeOrders || []).forEach((ord) => { if (ord.table_id) byTable[ord.table_id] = ord; });

    host.innerHTML = o.tables.map((t) => {
        const ord = byTable[t.id];
        const cls = !ord ? 'is-free' : (ord.status === 'awaiting_payment' ? 'is-bill' : 'is-busy');
        const foot = !ord ? 'Free'
            : (ord.status === 'awaiting_payment' ? rp(ord.total_amount) : STATUS[ord.status]?.label || 'Open');
        return `<button type="button" class="pos-table ${cls}" data-table="${esc(t.id)}"
                    data-order="${esc(ord ? ord.id : '')}" aria-label="Table ${esc(t.label)} — ${esc(foot)}">
            <span>
                <span class="pos-table-label">${esc(t.label)}</span>
                ${t.zone ? `<span class="pos-table-zone">${esc(t.zone)}</span>` : ''}
            </span>
            <span class="pos-table-foot">${esc(foot)}</span>
        </button>`;
    }).join('');

    host.querySelectorAll('[data-table]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const orderId = btn.dataset.order;
            if (orderId) return selectOrder(orderId);
            return once(() => startOrder(btn.dataset.table));
        });
    });
    mountTableArchive(host);
}

function renderPaidToday() {
    const host = $('pos-paid-today');
    const rows = (state.overview && state.overview.paidToday) || [];
    if (!rows.length) { host.closest('section').classList.add('hidden'); return; }
    host.closest('section').classList.remove('hidden');
    host.innerHTML = rows.map((o) => `
        <button type="button" class="pos-paid-row" data-paid="${esc(o.id)}">
            <span>
                <span class="pos-paid-label">${esc(o.table_label ? `Table ${o.table_label}` : 'Takeaway')}</span>
                <span class="pos-paid-meta">${esc(o.order_number || '')}${o.refund_transaction_id ? ' · Refunded' : ''}</span>
            </span>
            <span class="pos-paid-amt${o.refund_transaction_id ? ' is-void' : ''}">${rp(o.total_amount)}</span>
        </button>`).join('');
    host.querySelectorAll('[data-paid]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const o = rows.find((x) => x.id === btn.dataset.paid);
            if (!o) return;
            state.orderId = o.id; state.order = o;
            renderOrder(); renderMenu();
            $('pos-order-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    });
}

function renderMenu() {
    const host = $('pos-menu');
    const empty = $('pos-menu-empty');
    if (!state.menu.length) {
        host.classList.add('hidden');
        empty.classList.remove('hidden');
        window.renderEmptyState('pos-menu-empty', {
            title: 'Nothing on the menu yet',
            description: 'An item appears here once it has a selling price and is marked visible on the till. Set both in Inventory.',
            buttonText: 'Open Inventory',
            onAction: () => { window.location.href = '/inventory?tab=items'; }
        });
        return;
    }
    empty.classList.add('hidden');
    host.classList.remove('hidden');

    const groups = {};
    state.menu.forEach((m) => {
        const k = m.pos_category || 'Menu';
        (groups[k] || (groups[k] = [])).push(m);
    });

    const live = !!state.order && !['paid', 'void'].includes(state.order.status);
    $('pos-menu-sub').textContent = live
        ? 'Tap an item to add it to the open order.'
        : 'Open a table first, then tap items to add them.';

    host.innerHTML = Object.keys(groups).sort().map((cat) => `
        <p class="pos-cat">${esc(cat)}</p>
        <div class="pos-menu-grid">
            ${groups[cat].map((m) => `
                <button type="button" class="pos-menu-item" data-item="${esc(m.id)}"
                        data-price="${m.sales_price}" data-name="${esc(m.name)}" ${live ? '' : 'disabled'}>
                    <span class="pos-menu-name">${esc(m.name)}</span>
                    <span class="pos-menu-price">${rp(m.sales_price)}</span>
                </button>`).join('')}
        </div>`).join('');

    host.querySelectorAll('[data-item]').forEach((btn) => {
        btn.addEventListener('click', () => once(async () => {
            try {
                state.order = await ds.addPosOrderLine(state.uid, state.orderId, {
                    itemId: btn.dataset.item,
                    itemName: btn.dataset.name,
                    quantity: 1,
                    unitPrice: Number(btn.dataset.price)
                });
                renderOrder();
            } catch (err) { fail(err, 'Could not add that item.'); }
        }));
    });
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
        $('pos-order-title').textContent = 'No order open';
        $('pos-order-sub').textContent = state.overview && state.overview.tables.length
            ? 'Pick a table to start.' : 'Add a table, or start a takeaway order.';
        badge.classList.add('hidden');
        lines.innerHTML = '';
        totals.innerHTML = '';
        primary.disabled = true;
        primary.textContent = 'Pick a table';
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
    lines.innerHTML = rows.length ? rows.map((l) => {
        const net = (Number(l.gross_amount) || 0) - (Number(l.discount_amount) || 0);
        const discounted = Number(l.discount_amount) > 0;
        return `<div class="pos-line">
            <div>
                <div class="pos-line-name">${esc(l.item_name)}</div>
                <div class="pos-line-meta"><span>${rp(l.unit_price)} each</span>${l.note ? ` · <span>${esc(l.note)}</span>` : ''}</div>
                ${discounted ? `<div class="pos-line-meta" style="color:#C2410C">${esc(l.discount_reason || 'Discount')} −${rp(l.discount_amount)}</div>` : ''}
                ${st.next || o.status === 'awaiting_payment' ? `
                <div class="pos-qty">
                    <button type="button" data-dec="${esc(l.line_id)}" aria-label="One fewer ${esc(l.item_name)}">−</button>
                    <span>${Number(l.quantity)}</span>
                    <button type="button" data-inc="${esc(l.line_id)}" aria-label="One more ${esc(l.item_name)}">+</button>
                    <button type="button" data-note="${esc(l.line_id)}" class="pos-qty-alt" aria-label="Note for ${esc(l.item_name)}" title="Note">✎</button>
                    <button type="button" data-disc="${esc(l.line_id)}" class="pos-qty-alt" aria-label="Discount ${esc(l.item_name)}" title="Discount">%</button>
                </div>` : ''}
            </div>
            <div class="pos-line-amt">
                ${discounted ? `<span class="pos-line-strike">${rp(l.gross_amount)}</span>` : ''}
                ${rp(net)}
            </div>
        </div>`;
    }).join('') : '<div style="padding:24px 16px;text-align:center;color:#94A3B8;font-size:13px">Nothing added yet.</div>';

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

    const bits = [`<div class="pos-total-row"><span>Subtotal</span><span>${rp(o.subtotal)}</span></div>`];
    if (Number(o.discount_total) > 0) {
        bits.push(`<div class="pos-total-row is-discount"><span>Discount</span><span>−${rp(o.discount_total)}</span></div>`);
    }
    bits.push(`<div class="pos-total-row is-grand"><span>Total</span><span>${rp(o.total_amount)}</span></div>`);
    if (Number(o.paid_amount) > 0 && o.status !== 'paid') {
        bits.push(`<div class="pos-total-row"><span>Paid so far</span><span>${rp(o.paid_amount)}</span></div>`);
        bits.push(`<div class="pos-total-row is-grand"><span>Balance</span><span>${rp(Number(o.total_amount) - Number(o.paid_amount))}</span></div>`);
    }
    totals.innerHTML = bits.join('');

    const empty = !rows.length;
    primary.disabled = empty && o.status !== 'paid';
    primary.textContent = st.action;

    const editable = !['paid', 'void'].includes(o.status);
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
            channel: 'staff'
        });
        state.orderId = order.id;
        state.order = order;
        renderOrder();
        renderMenu();
        await refresh({ keepOrder: true });
    } catch (err) { fail(err, 'Could not open that order.'); }
}

function selectOrder(orderId) {
    const found = (state.overview.activeOrders || []).find((o) => o.id === orderId);
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
    const st = STATUS[o.status];
    if (!st || !st.next) return;
    try {
        state.order = await ds.setPosOrderStatus(state.uid, state.orderId, st.next);
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
            <div class="px-5 py-4 border-t border-gray-200">
                <button type="submit" form="pos-drawer-form" class="w-full min-h-[48px] rounded-lg ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'} text-white text-[15px] font-semibold">${esc(submitLabel)}</button>
            </div>
        </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    el.querySelector('#pos-drawer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await once(async () => {
            try { await onSubmit(new FormData(e.target)); close(); }
            catch (err) { fail(err, 'That did not work.'); }
        });
    });
    setTimeout(() => el.querySelector('input,select')?.focus(), 50);
    return { close };
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
                <input id="pos-pay-amount" name="amount" inputmode="numeric" class="pos-amount-input" value="${due.toLocaleString('id-ID')}" autocomplete="off">
                <p class="text-[11px] text-slate-500 mt-2" id="pos-change-note"></p>
            </div>
            <div>
                <label class="block text-[12px] font-semibold text-slate-700 mb-2" for="pos-pay-ref">Reference <span class="font-normal text-slate-400">(optional)</span></label>
                <input id="pos-pay-ref" name="reference" class="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-[14px]" placeholder="Transfer note, QRIS ref…">
            </div>`,
        onSubmit: async (fd) => {
            const amount = Number(String(fd.get('amount')).replace(/\D/g, ''));
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
        const v = Number(String($('pos-pay-amount').value).replace(/\D/g, ''));
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
        amt.value = digits ? Number(digits).toLocaleString('id-ID') : '';
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
            const typed = Number(String(fd.get('amount')).replace(/\D/g, ''));
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
        const typed = Number(el.value.replace(/\D/g, ''));
        $('pos-disc-preview').textContent = mode === 'percent' && typed > 0
            ? `${Math.min(100, typed)}% of ${rp(base)} = ${rp(Math.round(base * Math.min(100, typed) / 100))}`
            : '';
    };
    el.addEventListener('input', () => {
        const d = el.value.replace(/\D/g, '');
        el.value = mode === 'percent' ? d.slice(0, 3) : (d ? Number(d).toLocaleString('id-ID') : '');
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
        return `<tr><td>${esc(l.item_name)}<br><span class="m">${l.quantity} × ${rp(l.unit_price)}</span></td>`
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
  <div class="c m">${when.toLocaleString('id-ID')}</div>
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

// ── Load ─────────────────────────────────────────────────────────────────────

async function refresh({ keepOrder = false } = {}) {
    const [overview, menu] = await Promise.all([
        ds.getPosOverview(state.uid, { dimensionId: state.outletId }),
        ds.getPosMenu(state.uid)
    ]);
    state.overview = overview;
    state.menu = menu;

    // Re-bind the open order to the freshly-read copy, so the panel can never
    // show a stale version and lose the concurrency race on the next write.
    if (state.orderId && !keepOrder) {
        const live = (overview.activeOrders || []).concat(overview.paidToday || [])
            .find((o) => o.id === state.orderId);
        if (live) state.order = live;
        else if (state.order && !['paid', 'void'].includes(state.order.status)) {
            state.orderId = null; state.order = null;
        }
    }

    renderMetrics();
    renderBanners();
    renderTables();
    renderPaidToday();
    renderMenu();
    renderOrder();
    $('pos-new-order').disabled = !state.outletId;
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

function wire() {
    $('pos-outlet').addEventListener('change', async (e) => {
        state.outletId = e.target.value;
        localStorage.setItem(OUTLET_KEY, state.outletId);
        state.orderId = null; state.order = null;
        await refresh();
        watch();
    });
    $('pos-primary').addEventListener('click', () => once(advance));
    $('pos-discount-btn').addEventListener('click', openDiscountDrawer);
    $('pos-void-btn').addEventListener('click', openVoidDrawer);
    $('pos-refund-btn').addEventListener('click', openRefundDrawer);
    $('pos-reprint-btn').addEventListener('click', () => openReceipt(state.order));
    $('pos-manage-tables').addEventListener('click', openTableDrawer);
    $('pos-new-order').addEventListener('click', () => once(() => startOrder(null)));

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
    wire();

    const hasOutlet = await loadOutlets();
    if (!hasOutlet) {
        $('pos-metrics').innerHTML = '';
        renderOrder();
        return;
    }
    await refresh();
    watch();
});
