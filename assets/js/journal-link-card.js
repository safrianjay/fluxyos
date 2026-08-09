// =============================================================================
// FluxyOS — Journal Information card (shared)
//
// Single responsibility: a business record's detail view explains the BUSINESS
// event and points at its journal; the Journal Detail page explains the
// ACCOUNTING event. So this card renders only high-level journal metadata —
// number, posting status, posting method, posting date, period, description —
// and deep-links to accounting-journal.html. It must never render journal lines,
// debits/credits, totals, balances, or audit history: those live on Journal
// Detail and duplicating them is exactly what this component exists to avoid.
//
// Used by the Transactions drawer (ledger.html), the Bill drawer (bill.html),
// and the Invoice detail view (invoices.html). Subscriptions have no detail
// surface yet; when one is added, pass context: 'subscription'.
//
//   window.FluxyJournalCard.render({ hostEl, ds, userId, record, context })
// =============================================================================

(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    const STATUS_LABEL = {
        posted: 'Posted', draft: 'Draft', reversal: 'Reversal', reversed: 'Reversed'
    };

    // Mirrors selectRule() in assets/js/accounting-engine.js. Used ONLY to explain
    // why no journal exists — never to decide whether something posts.
    const POSTING_TX_TYPES = new Set([
        'income', 'revenue', 'refund', 'expense', 'fee', 'tax',
        'pending_receivable', 'pending_payable'
    ]);

    function formatDate(value) {
        if (!value) return '—';
        let d = value;
        if (typeof value?.toDate === 'function') d = value.toDate();
        else if (typeof value === 'string' || typeof value === 'number') d = new Date(value);
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
        const loc = (typeof window !== 'undefined' && window.FluxyI18n?.locale?.()) || 'en-US';
        return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function accountDisplay(accountCode, accountName) {
        const code = String(accountCode || '').trim();
        const name = String(accountName || '').trim();
        const label = code ? `${escapeHtml(code)}${name ? ` · ${escapeHtml(name)}` : ''}` : escapeHtml(name || '—');
        if (!code) return label;
        return `<a href="/accounting-account?code=${encodeURIComponent(code)}" class="text-[#1F2937] font-semibold hover:text-[#EA580C] transition-colors">${label}</a>`;
    }

    function accountLines(journal, side) {
        if (!journal || !Array.isArray(journal.lines)) return '—';
        const seen = new Set();
        const lines = [];
        for (const line of journal.lines) {
            if (side === 'debit' ? Number(line.debit) > 0 : Number(line.credit) > 0) {
                const key = `${String(line.account_code || '').trim()}|${String(line.account_name || '').trim()}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    lines.push(line);
                }
            }
        }
        if (!lines.length) return '—';
        return lines.map((line) => accountDisplay(line.account_code, line.account_name)).join('<br>');
    }

    // Copy reads better naming the thing in front of the user than "this record".
    const NOUN = { transaction: 'transaction', bill: 'bill', invoice: 'invoice', subscription: 'subscription' };

    // Why is there no journal? A bare "none" teaches the user nothing; each branch
    // names the reason and, where relevant, what will produce one.
    function emptyStateCopy(record, context) {
        const noun = NOUN[context] || 'record';
        const status = String(record?.accounting_status || '').toLowerCase();
        const voided = String(record?.void_status || '').toLowerCase() === 'voided'
            || record?.is_voided === true
            || String(record?.status || '').toLowerCase() === 'void';

        if (status === 'pending') {
            return `This ${noun} is queued for posting. Its journal appears once pending entries are posted from the Accounting Center.`;
        }
        if (status === 'excluded') {
            return `This ${noun} is deliberately outside the IDR ledger, so no journal is generated for it.`;
        }
        if (context === 'invoice') {
            if (String(record?.status || '').toLowerCase() === 'draft') {
                return 'A journal is created when this invoice is finalized.';
            }
            if (voided) return 'This invoice was voided. Any journal it produced was reversed in the ledger.';
        }
        if (context === 'transaction') {
            const type = String(record?.type || '').toLowerCase();
            if (type && !POSTING_TX_TYPES.has(type)) {
                return `Transactions of type "${type}" do not post to the ledger, so no journal is generated.`;
            }
            if (voided) return 'This transaction was voided. Any journal it produced was reversed in the ledger.';
        }
        if (voided) return `This ${noun} was voided. Any journal it produced was reversed in the ledger.`;
        return `No journal has been generated for this ${noun} yet.`;
    }

    function emptyHtml(record, context) {
        // 'pending' is the one empty state with an action behind it, and the copy
        // named the Accounting Center without saying where in it. Everything else
        // here explains a settled fact, so it stays text-only.
        const actionable = String(record?.accounting_status || '').toLowerCase() === 'pending';
        return `
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400 mb-2">Journal information</p>
                <p class="text-[13px] text-gray-500 leading-relaxed">${escapeHtml(emptyStateCopy(record, context))}</p>
                ${actionable ? `
                <a href="/accounting?tab=journals"
                   class="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#EA580C] hover:underline">
                    Post pending entries
                    <span aria-hidden="true">→</span>
                </a>` : ''}
            </div>`;
    }

    function cardHtml(journal) {
        const statusLabel = STATUS_LABEL[String(journal.status || '').toLowerCase()] || journal.status || '—';
        const method = journal.journal_type === 'manual' ? 'Manual' : 'Automatically generated';
        const href = `accounting-journal.html?id=${encodeURIComponent(journal.id)}`;
        const debitAccounts = accountLines(journal, 'debit');
        const creditAccounts = accountLines(journal, 'credit');
        return `
            <div class="group block rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors hover:border-[#EA580C] hover:bg-orange-50/40">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400 mb-2">Journal information</p>
                        <p class="truncate text-[14px] font-bold text-gray-900 group-hover:text-[#EA580C] transition-colors">${escapeHtml(journal.journal_number || 'Not numbered')}</p>
                        <p class="mt-0.5 text-[12px] text-gray-500">${escapeHtml(statusLabel)} · ${escapeHtml(method)}</p>
                    </div>
                    <a id="tx-detail-journal-card-link" class="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:border-[#EA580C] hover:text-[#EA580C] transition-colors" href="${href}">
                        <span>View journal</span>
                        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </a>
                </div>
                <div class="mt-3 grid grid-cols-2 gap-3 border-t border-gray-200 pt-3">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Posting date</p>
                        <p class="mt-0.5 text-[13px] font-semibold text-gray-800">${escapeHtml(formatDate(journal.posted_at || journal.created_at))}</p>
                    </div>
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Period</p>
                        <p class="mt-0.5 text-[13px] font-semibold text-gray-800">${escapeHtml(journal.period_key || '—')}</p>
                    </div>
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Debit account</p>
                        <p id="tx-detail-journal-debit-account" class="mt-0.5 text-[13px] font-semibold text-gray-800">${debitAccounts}</p>
                    </div>
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Credit account</p>
                        <p id="tx-detail-journal-credit-account" class="mt-0.5 text-[13px] font-semibold text-gray-800">${creditAccounts}</p>
                    </div>
                </div>
                <p class="mt-3 text-[11px] text-gray-400">Open the journal for accounts, debits and credits, and audit history.</p>
            </div>`;
    }

    // `isStale` lets a caller cancel a paint when the user has already moved to
    // another record — the fetch is async and drawers are reused.
    async function render({ hostEl, ds, userId, record, context = 'transaction', isStale = null }) {
        if (!hostEl) return;
        let journal = null;
        if (record?.journal_ref && ds && userId) {
            try {
                journal = await ds.getJournalById(userId, record.journal_ref);
            } catch (_) { /* best-effort — fall through to the empty state */ }
        }
        if (typeof isStale === 'function' && isStale()) return;
        // dashboard-i18n.js runs a MutationObserver over document.body, so
        // async-injected markup is re-translated without an explicit call.
        hostEl.innerHTML = journal ? cardHtml(journal) : emptyHtml(record, context);
    }

    window.FluxyJournalCard = { render, emptyStateCopy };
})();
