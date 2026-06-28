// FluxyOS — Journal Detail page
//
// The central accounting drill-down hub. Opens a single journal by id and traces
// it end to end: header metadata, the balanced debit/credit lines, the related
// source document, per-account ledger links, the audit timeline, and a reverse
// action. AI Explanation is a designed placeholder (no AI calls yet).
//
// Reads only — the only mutation is reverseJournal (finance/accountant), which is
// gated in the UI and enforced by firestore.rules.

const SOURCE_LINKS = {
    transactions: '/ledger',
    bills: '/bill',
    subscriptions: '/subscription',
    invoices: '/invoices',
    bank_statement_imports: '/integration'
};

const MANUAL_SUBTYPE_LABELS = {
    opening: 'Opening balance', accrual: 'Accrual', adjustment: 'Adjustment',
    reclass: 'Reclassification', closing: 'Year-end closing', audit: 'Audit adjustment',
    correction: 'Correction', depreciation: 'Depreciation', fx: 'Foreign exchange'
};

function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatRupiah(n) {
    const value = Number(n);
    if (!Number.isFinite(value)) return 'Rp0';
    return `Rp${Math.abs(Math.round(value)).toLocaleString('id-ID')}`;
}

function tsMillis(t) {
    if (!t) return null;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    return null;
}

function fmtDateTime(t) {
    const ms = tsMillis(t);
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
    });
}

function fmtDate(t) {
    const ms = tsMillis(t);
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

function journalType(j) { return j.journal_type || (j.posting_rule_id === 'MANUAL' ? 'manual' : 'system'); }

function typeLabel(j) {
    if (journalType(j) === 'manual') {
        const sub = MANUAL_SUBTYPE_LABELS[j.manual_subtype] || 'Manual';
        return `Manual · ${sub}`;
    }
    return 'System · posting engine';
}

function statusBadge(j) {
    if (j.status === 'draft') return ['fluxy-status-neutral', 'Draft'];
    if (j.reversed_by_journal_id) return ['fluxy-status-warning', 'Reversed'];
    if (j.status === 'reversal' || String(j.posting_rule_id || '').startsWith('REVERSAL')) return ['fluxy-status-info', 'Reversal'];
    if (!j.is_balanced) return ['fluxy-status-danger', 'Out of balance'];
    return ['fluxy-status-success', 'Posted'];
}

function sourceDeepLink(source) {
    if (!source || !source.collection || !source.id) return '';
    const base = SOURCE_LINKS[source.collection];
    if (!base) return '';
    const param = source.collection === 'invoices' ? 'invoice' : 'record';
    return `${base}?${param}=${encodeURIComponent(source.id)}`;
}

function canReverse() {
    const ws = (typeof window !== 'undefined') ? window.FluxyWorkspace : null;
    if (ws && typeof ws.can === 'function' && ws.role) return ws.can('journals.manual');
    return true;
}

let pageState = { ds: null, user: null, journalId: null };

export function initAccountingJournalPage({ ds, user }) {
    pageState.ds = ds;
    pageState.user = user;
    const params = new URLSearchParams(window.location.search);
    pageState.journalId = params.get('id');
    el('journal-ask-ai')?.addEventListener('click', () => {
        if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
        else window.showToast?.('Fluxy AI is still loading. Try again in a moment.', 'info');
    });
    loadJournal();
}

async function loadJournal() {
    const { ds, user, journalId } = pageState;
    if (!journalId) return showError('No journal was specified in the link.');
    try {
        const journal = await ds.getJournalById(user.uid, journalId);
        if (!journal) return showError('This journal could not be found.');
        const [coa, auditAll] = await Promise.all([
            ds.getChartOfAccounts(user.uid).catch(() => []),
            ds.getAuditLogs(user.uid, 200).catch(() => [])
        ]);
        const audit = (auditAll || []).filter(a => a.target_collection === 'journals' && a.target_id === journalId);
        render(journal, coa, audit);
    } catch (err) {
        console.error('Journal load failed:', err);
        showError('Check your connection and try again.');
    }
}

function showError(msg) {
    el('journal-loading')?.classList.add('hidden');
    el('journal-content')?.classList.add('hidden');
    const e = el('journal-error');
    if (e) { e.classList.remove('hidden'); const b = el('journal-error-body'); if (b) b.textContent = msg; }
}

function metaRow(label, value) {
    return `<div class="acct-jr-meta-item"><div class="acct-jr-meta-label">${escapeHtml(label)}</div><div class="acct-jr-meta-value">${value}</div></div>`;
}

function render(j, coa, audit) {
    const [badgeClass, badgeLabel] = statusBadge(j);
    const number = j.journal_number || (j.status === 'draft' ? 'Draft — not numbered' : '—');
    const src = j.source || {};
    const srcLink = sourceDeepLink(src);
    const srcText = j.source_number || (src.collection ? `${String(src.collection).replace(/s$/, '')} · ${String(src.id || '').slice(0, 10)}` : 'Manual entry — no source document');

    const lines = (j.lines || []).map(l => `<tr class="fluxy-table-row">
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${escapeHtml(l.account_code)}</span></td>
        <td class="fluxy-table-cell"><span class="fluxy-table-cell-meta">${escapeHtml(l.account_name || '')}${l.memo ? ' · ' + escapeHtml(l.memo) : ''}</span></td>
        <td class="fluxy-table-cell fluxy-table-money">${Number(l.debit) > 0 ? formatRupiah(l.debit) : '—'}</td>
        <td class="fluxy-table-cell fluxy-table-money">${Number(l.credit) > 0 ? formatRupiah(l.credit) : '—'}</td>
    </tr>`).join('');
    const totals = `<tr class="fluxy-table-row fluxy-table-row-total">
        <td class="fluxy-table-cell" colspan="2">Total</td>
        <td class="fluxy-table-cell fluxy-table-money">${formatRupiah(j.total_debit)}</td>
        <td class="fluxy-table-cell fluxy-table-money">${formatRupiah(j.total_credit)}</td>
    </tr>`;

    // Per-account ledger links (drill into the General Ledger tab for each account).
    const accounts = [...new Set((j.lines || []).map(l => l.account_code))];
    const ledgerLinks = accounts.map(code => {
        const meta = (coa || []).find(a => a.code === code);
        return `<a class="acct-link" href="/accounting" title="Open the General Ledger and choose this account">${escapeHtml(code)} · ${escapeHtml(meta ? meta.name : code)} →</a>`;
    }).join('<span style="color:#D1D5DB;"> | </span>');

    const auditRows = audit.length ? audit
        .slice()
        .sort((a, b) => (tsMillis(a.created_at) || 0) - (tsMillis(b.created_at) || 0))
        .map(a => `<li class="acct-jr-timeline-item"><span class="acct-jr-timeline-dot"></span><div><div class="acct-jr-meta-value">${escapeHtml(prettyAction(a.action))}</div><div class="acct-jr-meta-label">${escapeHtml(fmtDateTime(a.created_at))}${a.actor_uid ? ' · ' + escapeHtml(String(a.actor_uid).slice(0, 8)) : ''}</div></div></li>`)
        .join('')
        : '<li class="acct-jr-meta-label">No audit events recorded for this journal yet.</li>';

    const reverseBtn = (j.status !== 'draft' && !j.reversed_by_journal_id && canReverse())
        ? `<button type="button" id="journal-reverse-btn" class="acct-btn acct-btn-secondary">Reverse this journal</button>`
        : '';

    const reversalNote = j.reversed_by_journal_id
        ? `<div class="acct-jr-note">This journal has been reversed by a later correcting entry.</div>`
        : (j.reverses_journal_id ? `<div class="acct-jr-note">This is a reversal entry that offsets an earlier journal.</div>` : '');

    el('journal-content').innerHTML = `
        <nav class="acct-breadcrumb" aria-label="Breadcrumb">
            <a href="/accounting">Accounting Center</a><span>/</span>
            <a href="/accounting">Journals</a><span>/</span>
            <span style="color:#374151;font-weight:500;">${escapeHtml(number)}</span>
        </nav>

        <section class="acct-card" style="padding:24px;margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
                <div style="min-width:0;">
                    <h1 class="fluxy-section-title" style="font-size:24px;color:#0B0F19;">${escapeHtml(number)}</h1>
                    <p class="fluxy-body" style="color:#6B7280;margin-top:4px;">${escapeHtml(j.description || '')}</p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <span class="fluxy-table-status ${badgeClass}">${badgeLabel}</span>
                    ${reverseBtn}
                </div>
            </div>
            ${reversalNote}
            <div class="acct-jr-meta-grid">
                ${metaRow('Posting date', escapeHtml(fmtDate(j.posted_at || j.created_at)))}
                ${metaRow('Accounting period', escapeHtml(j.period_key || '—'))}
                ${metaRow('Type', escapeHtml(typeLabel(j)))}
                ${metaRow('Source', srcLink ? `<a class="acct-link" href="${srcLink}">${escapeHtml(srcText)} →</a>` : escapeHtml(srcText))}
                ${metaRow('Reference', escapeHtml(j.reference || '—'))}
                ${metaRow('Created by', escapeHtml(j.created_by ? String(j.created_by).slice(0, 12) : '—'))}
                ${metaRow('Generated by', escapeHtml(j.generated_by === 'posting_engine' ? 'Posting engine' : (j.generated_by ? String(j.generated_by).slice(0, 12) : '—')))}
                ${metaRow('Internal ID', `<span style="font-size:12px;color:#9CA3AF;">${escapeHtml(j.id)}</span>`)}
            </div>
        </section>

        <section class="acct-card fluxy-table-card" style="margin-bottom:20px;">
            <div class="fluxy-table-card-header"><div><h2 class="fluxy-table-title">Journal lines</h2><p class="fluxy-table-subtitle">Balanced double-entry postings for this journal.</p></div></div>
            <div class="fluxy-table-scroll">
                <table class="fluxy-table">
                    <thead><tr class="fluxy-table-header"><th>Account</th><th>Name</th><th class="fluxy-table-money">Debit</th><th class="fluxy-table-money">Credit</th></tr></thead>
                    <tbody>${lines}${totals}</tbody>
                </table>
            </div>
        </section>

        <div class="acct-jr-columns">
            <section class="acct-card" style="padding:20px;">
                <h2 class="fluxy-table-title" style="margin-bottom:12px;">Related ledger entries</h2>
                <p class="fluxy-table-subtitle" style="margin-bottom:12px;">Open the running balance for each account this journal touches.</p>
                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">${ledgerLinks || '<span class="acct-jr-meta-label">No accounts.</span>'}</div>
            </section>

            <section class="acct-card" style="padding:20px;">
                <h2 class="fluxy-table-title" style="margin-bottom:12px;">Audit timeline</h2>
                <ul class="acct-jr-timeline">${auditRows}</ul>
            </section>
        </div>

        <div class="acct-jr-columns">
            <section class="acct-card" style="padding:20px;">
                <h2 class="fluxy-table-title" style="margin-bottom:8px;">Tax information</h2>
                <p class="fluxy-table-subtitle">No tax lines on this journal. Tax-aware postings arrive with the Tax Engine.</p>
            </section>
            <section class="acct-card" style="padding:20px;border-style:dashed;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <svg class="w-4 h-4" style="color:#EA580C;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    <h2 class="fluxy-table-title">AI explanation</h2>
                </div>
                <p class="fluxy-table-subtitle">Soon: ask Fluxy AI why this journal was generated, find the related document, or draft a correcting entry. Use “Ask Fluxy AI” above in the meantime.</p>
            </section>
        </div>
    `;

    el('journal-loading')?.classList.add('hidden');
    el('journal-error')?.classList.add('hidden');
    el('journal-content')?.classList.remove('hidden');

    el('journal-reverse-btn')?.addEventListener('click', onReverse);
}

function prettyAction(action) {
    const map = {
        'journal.draft_created': 'Draft created',
        'journal.draft_deleted': 'Draft discarded',
        'journal.posted': 'Posted',
        'journal.reversed': 'Reversed',
        'period.close': 'Posted at period close'
    };
    return map[action] || action || 'Event';
}

async function onReverse() {
    const { ds, user, journalId } = pageState;
    const ok = await window.showConfirmDialog?.({
        title: 'Reverse this journal?',
        body: 'A new reversing entry will be posted into the current open period to offset this journal. The original stays on the books for audit.',
        confirmLabel: 'Reverse journal',
        cancelLabel: 'Cancel',
        tone: 'danger'
    });
    if (ok === false) return;
    const btn = el('journal-reverse-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Reversing…'; }
    try {
        const res = await ds.reverseJournal(user.uid, journalId);
        window.showToast?.(`Reversed — ${res.journal_number} posted.`, 'success');
        loadJournal();
    } catch (err) {
        console.error('Reverse failed:', err);
        window.showAlertDialog?.({ title: 'Could not reverse', body: err?.message || 'Please try again.', tone: 'danger' });
        if (btn) { btn.disabled = false; btn.textContent = 'Reverse this journal'; }
    }
}
