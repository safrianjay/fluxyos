// FluxyOS — Manual Journal editor (Draft -> Posted)
//
// The dedicated accountant workflow for entries the posting engine does not cover
// (opening balances, accruals, adjustments, reclasses, depreciation, FX). A draft
// is saved without a number and without ledger impact; posting reserves the
// journal number, asserts balance, and locks the entry. Journal Number, internal
// id, created-at/by are system-owned and never editable here.
//
// The hard boundary is firestore.rules; this page mirrors the journals.manual gate.

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

function toInt(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
}

function canManualJournal() {
    const ws = (typeof window !== 'undefined') ? window.FluxyWorkspace : null;
    if (ws && typeof ws.can === 'function' && ws.role) return ws.can('journals.manual');
    return true;
}

const state = { ds: null, user: null, draftId: null, coa: [], accountOptions: '', dirty: false };

export async function initManualJournalPage({ ds, user }) {
    state.ds = ds;
    state.user = user;
    if (!canManualJournal()) {
        el('mj-denied')?.classList.remove('hidden');
        return;
    }
    el('mj-form')?.classList.remove('hidden');

    const params = new URLSearchParams(window.location.search);
    state.draftId = params.get('draft');

    el('mj-date').value = todayKey();
    syncPeriod();

    try {
        state.coa = await ds.getChartOfAccounts(user.uid).catch(() => []);
    } catch (_) { state.coa = []; }
    state.accountOptions = `<option value="">Select account…</option>` +
        (state.coa || []).map(a => `<option value="${escapeHtml(a.code)}">${escapeHtml(a.code)} · ${escapeHtml(a.name)}</option>`).join('');

    bindControls();

    if (state.draftId) {
        await loadDraft();
    } else {
        addLine();
        addLine();
        recalc();
    }
}

function bindControls() {
    el('mj-date')?.addEventListener('change', syncPeriod);
    el('mj-add-line')?.addEventListener('click', () => { addLine(); recalc(); });
    el('mj-save-draft')?.addEventListener('click', onSaveDraft);
    el('mj-post')?.addEventListener('click', onPost);
    el('mj-discard')?.addEventListener('click', onDiscard);

    const tbody = el('mj-lines');
    tbody?.addEventListener('input', (e) => {
        const t = e.target;
        // A line is one-sided: typing a debit clears the credit and vice versa.
        if (t.classList.contains('mj-debit') && toInt(t.value) > 0) {
            const row = t.closest('tr');
            const cr = row?.querySelector('.mj-credit'); if (cr) cr.value = '';
        } else if (t.classList.contains('mj-credit') && toInt(t.value) > 0) {
            const row = t.closest('tr');
            const dr = row?.querySelector('.mj-debit'); if (dr) dr.value = '';
        }
        state.dirty = true;
        recalc();
    });
    tbody?.addEventListener('change', () => { state.dirty = true; });
    tbody?.addEventListener('click', (e) => {
        if (e.target.closest('.mj-remove')) {
            e.target.closest('tr')?.remove();
            if (!el('mj-lines').children.length) addLine();
            state.dirty = true;
            recalc();
        }
    });
    ['mj-description', 'mj-reference', 'mj-subtype'].forEach(id => el(id)?.addEventListener('input', () => { state.dirty = true; }));
}

function syncPeriod() {
    const d = el('mj-date').value || todayKey();
    el('mj-period').value = String(d).slice(0, 7);
}

function addLine(line) {
    const tbody = el('mj-lines');
    const tr = document.createElement('tr');
    tr.className = 'fluxy-table-row';
    tr.innerHTML = `
        <td class="fluxy-table-cell"><select class="acct-records-select mj-acct">${state.accountOptions}</select></td>
        <td class="fluxy-table-cell"><input type="text" class="acct-records-input mj-memo" placeholder="Line memo" maxlength="120"></td>
        <td class="fluxy-table-cell fluxy-table-money"><input type="number" min="0" step="1" inputmode="numeric" class="acct-records-input mj-debit" placeholder="0" style="text-align:right;"></td>
        <td class="fluxy-table-cell fluxy-table-money"><input type="number" min="0" step="1" inputmode="numeric" class="acct-records-input mj-credit" placeholder="0" style="text-align:right;"></td>
        <td class="fluxy-table-cell" style="text-align:right;"><button type="button" class="mj-remove acct-link" aria-label="Remove line">Remove</button></td>`;
    tbody.appendChild(tr);
    if (line) {
        tr.querySelector('.mj-acct').value = line.account_code || '';
        tr.querySelector('.mj-memo').value = line.memo || '';
        if (toInt(line.debit) > 0) tr.querySelector('.mj-debit').value = toInt(line.debit);
        if (toInt(line.credit) > 0) tr.querySelector('.mj-credit').value = toInt(line.credit);
    }
}

function gatherLines() {
    return [...el('mj-lines').querySelectorAll('tr')].map(tr => ({
        account_code: tr.querySelector('.mj-acct').value,
        memo: tr.querySelector('.mj-memo').value.trim(),
        debit: toInt(tr.querySelector('.mj-debit').value),
        credit: toInt(tr.querySelector('.mj-credit').value)
    })).filter(l => l.account_code && (l.debit > 0 || l.credit > 0));
}

function recalc() {
    const lines = gatherLines();
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    el('mj-total-debit').textContent = formatRupiah(totalDebit);
    el('mj-total-credit').textContent = formatRupiah(totalCredit);
    const flag = el('mj-balance-flag');
    const balanced = totalDebit > 0 && totalDebit === totalCredit;
    if (!lines.length) {
        flag.className = 'fluxy-table-status fluxy-status-neutral';
        flag.textContent = 'Add lines to begin';
    } else if (balanced) {
        flag.className = 'fluxy-table-status fluxy-status-success';
        flag.textContent = 'In balance — ready to post';
    } else {
        flag.className = 'fluxy-table-status fluxy-status-warning';
        const diff = Math.abs(totalDebit - totalCredit);
        flag.textContent = `Out of balance by ${formatRupiah(diff)}`;
    }
    el('mj-post').disabled = !balanced;
    return { balanced, lines };
}

function collectPayload() {
    return {
        date: el('mj-date').value || todayKey(),
        period_key: el('mj-period').value || null,
        description: el('mj-description').value.trim(),
        reference: el('mj-reference').value.trim(),
        subtype: el('mj-subtype').value,
        lines: gatherLines()
    };
}

async function persistDraft() {
    const { ds, user } = state;
    const payload = collectPayload();
    if (state.draftId) {
        await ds.updateManualJournalDraft(user.uid, state.draftId, payload);
    } else {
        state.draftId = await ds.createManualJournalDraft(user.uid, payload);
        const url = new URL(window.location.href);
        url.searchParams.set('draft', state.draftId);
        window.history.replaceState({}, '', url);
        el('mj-discard')?.classList.remove('hidden');
        el('mj-crumb').textContent = 'Draft';
        el('mj-title').textContent = 'Edit Manual Journal';
    }
    state.dirty = false;
}

async function onSaveDraft() {
    const btn = el('mj-save-draft');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        await persistDraft();
        window.showToast?.('Draft saved.', 'success');
    } catch (err) {
        console.error('Save draft failed:', err);
        window.showAlertDialog?.({ title: 'Could not save draft', body: err?.message || 'Please try again.', tone: 'danger' });
    } finally {
        btn.disabled = false; btn.textContent = 'Save draft';
    }
}

async function onPost() {
    const { balanced } = recalc();
    if (!balanced) return;
    const btn = el('mj-post');
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
        await persistDraft(); // save the latest edits first
        const res = await state.ds.postManualJournal(state.user.uid, state.draftId);
        window.showToast?.(`Posted — ${res.journal_number}.`, 'success');
        window.location.href = `accounting-journal.html?id=${encodeURIComponent(state.draftId)}`;
    } catch (err) {
        console.error('Post failed:', err);
        window.showAlertDialog?.({ title: 'Could not post journal', body: err?.message || 'Please try again.', tone: 'danger' });
        btn.disabled = false; btn.textContent = 'Post journal';
    }
}

async function onDiscard() {
    if (!state.draftId) { window.location.href = '/accounting'; return; }
    const ok = await window.showConfirmDialog?.({
        title: 'Discard this draft?',
        body: 'This draft journal will be permanently removed. This cannot be undone.',
        confirmLabel: 'Discard draft',
        cancelLabel: 'Keep editing',
        tone: 'danger'
    });
    if (ok === false) return;
    try {
        await state.ds.deleteManualJournalDraft(state.user.uid, state.draftId);
        window.showToast?.('Draft discarded.', 'info');
        window.location.href = '/accounting';
    } catch (err) {
        console.error('Discard failed:', err);
        window.showAlertDialog?.({ title: 'Could not discard', body: err?.message || 'Please try again.', tone: 'danger' });
    }
}

async function loadDraft() {
    try {
        const j = await state.ds.getJournalById(state.user.uid, state.draftId);
        if (!j) { addLine(); addLine(); recalc(); return; }
        if (j.status !== 'draft') {
            // Already posted — send to the read-only detail page.
            window.location.replace(`accounting-journal.html?id=${encodeURIComponent(state.draftId)}`);
            return;
        }
        el('mj-title').textContent = 'Edit Manual Journal';
        el('mj-crumb').textContent = 'Draft';
        el('mj-discard')?.classList.remove('hidden');
        if (j.period_key) { el('mj-date').value = `${j.period_key}-01`; syncPeriod(); }
        el('mj-description').value = j.description && j.description !== 'Manual journal' ? j.description : '';
        el('mj-reference').value = j.reference || '';
        if (j.manual_subtype) el('mj-subtype').value = j.manual_subtype;
        el('mj-lines').innerHTML = '';
        (j.lines || []).forEach(line => addLine(line));
        if (!el('mj-lines').children.length) { addLine(); addLine(); }
        recalc();
    } catch (err) {
        console.error('Load draft failed:', err);
        addLine(); addLine(); recalc();
    }
}
