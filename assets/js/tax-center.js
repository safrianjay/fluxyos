// =============================================================================
// FluxyOS — Tax Center page controller (Indonesia Tax Center, Phase 1)
//
// Thin UI layer over DataService. Loads the workspace tax profile, renders the
// PPN summary for the current period from tax_transactions, and saves the profile.
// All tax math lives in the pure engine (assets/js/tax-engine.js) and the data
// layer (db-service.js) — this file only orchestrates DOM. Mirrors accounting.js.
//
// Phase 1 ships the profile + an empty-by-default PPN summary; tax_transactions are
// posted in a later phase. See docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md.
// =============================================================================

// Rupiah, raw integer → 'Rp1.234.567' (no space after Rp — design-system rule).
function formatRp(n) {
    const v = Math.round(Number(n) || 0);
    return 'Rp' + v.toLocaleString('id-ID');
}

// 'YYYY-MM' and a human label in Asia/Jakarta, matching the accounting period key.
function currentPeriod() {
    const now = new Date();
    const key = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
    const label = now.toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta', month: 'long', year: 'numeric' });
    return { key, label };
}

function toast(message, type) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(message, type);
}

const TAX_CODE_LABEL = { PPN_OUT_11: 'PPN Keluaran 11%', PPN_IN_11: 'PPN Masukan 11%' };

function canEditTax() {
    const role = (typeof window !== 'undefined' && window.FluxyWorkspace && window.FluxyWorkspace.role) || null;
    // Owner default (no resolved role) keeps full access; viewer is read-only.
    return !role || ['owner', 'admin', 'finance', 'accountant'].includes(role);
}

function wireTabs() {
    const tabs = Array.from(document.querySelectorAll('[data-tax-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-tax-panel]'));
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const key = tab.getAttribute('data-tax-tab');
            tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
            panels.forEach((p) => {
                const match = p.getAttribute('data-tax-panel') === key;
                p.classList.toggle('hidden', !match);
                p.classList.toggle('flex', match);
            });
        });
    });
}

function renderProfile(profile) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val == null ? '' : val; };
    set('tax-npwp', profile?.npwp);
    set('tax-nik', profile?.nik);
    set('tax-kpp', profile?.tax_office_kpp);
    set('tax-klu', profile?.business_classification);
    set('tax-ppn-rate', profile?.default_ppn_rate == null ? 11 : profile.default_ppn_rate);
    const pkp = document.getElementById('tax-pkp-status');
    if (pkp) pkp.value = profile?.pkp_status === 'pkp' ? 'pkp' : 'non_pkp';
    const umkm = document.getElementById('tax-umkm');
    if (umkm) umkm.checked = profile?.umkm_final === true;

    const status = document.getElementById('kpi-profile-status');
    const sub = document.getElementById('kpi-profile-sub');
    if (status) status.textContent = profile ? (profile.pkp_status === 'pkp' ? 'PKP' : 'Non-PKP') : 'Not set';
    if (sub) sub.textContent = profile?.umkm_final ? 'UMKM final scheme' : 'PKP status';
}

// renderPpn drives the headline KPIs from the ledger (source of truth: 2100 output /
// 1130 input, via ds.getPpnLedger) so they stay correct even when tax_transactions
// detail rows lag (e.g. after an edit); tax_transactions feed the detail table only.
function renderPpn(profile, taxTx, ledgerPpn, period) {
    const periodLabel = document.getElementById('ppn-period-label');
    if (periodLabel) periodLabel.textContent = period.label;

    const output = ledgerPpn ? ledgerPpn.output : 0;
    const input = ledgerPpn ? ledgerPpn.input : 0;
    const payable = ledgerPpn ? ledgerPpn.payable : 0;

    const kpiOut = document.getElementById('kpi-ppn-output');
    const kpiIn = document.getElementById('kpi-ppn-input');
    const kpiPay = document.getElementById('kpi-ppn-payable');
    if (kpiOut) kpiOut.textContent = formatRp(output);
    if (kpiIn) kpiIn.textContent = formatRp(input);
    if (kpiPay) kpiPay.textContent = formatRp(payable);

    const body = document.getElementById('ppn-summary-body');
    if (!body) return;
    if (!taxTx.length) {
        const isPkp = profile?.pkp_status === 'pkp';
        if (typeof window !== 'undefined' && typeof window.renderEmptyState === 'function') {
            window.renderEmptyState('ppn-summary-body', {
                icon: '🧾',
                title: 'No PPN lines yet for this period',
                description: isPkp
                    ? 'As your invoices and bills post, their PPN Keluaran and Masukan will summarize here.'
                    : 'This workspace is set to Non-PKP, so no PPN is charged. Switch to PKP in the Company Tax Profile if you are VAT-registered.'
            });
        } else {
            body.innerHTML = '<p class="fluxy-meta" style="padding:16px">No PPN lines yet for this period.</p>';
        }
        return;
    }
    const rows = taxTx.map((t) => `
        <tr class="fluxy-table-row">
            <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${t.tax_name || t.tax_code || ''}</span><span class="fluxy-table-cell-meta">${t.direction || ''}</span></td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(t.taxable_base)}</td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(t.tax_amount)}</td>
        </tr>`).join('');
    body.innerHTML = `
        <div class="fluxy-table-scroll"><table class="fluxy-table">
            <thead><tr class="fluxy-table-header"><th>Tax</th><th class="fluxy-table-money">Base (DPP)</th><th class="fluxy-table-money">PPN</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
}

function renderOverviewNote(profile) {
    const el = document.getElementById('tax-overview-note');
    if (!el) return;
    if (!profile) {
        el.innerHTML = '<p class="fluxy-meta">Start by setting your <strong>Company Tax Profile</strong> (NPWP and PKP status).</p>';
    } else {
        el.innerHTML = `<p class="fluxy-meta">Profile set: <strong>${profile.pkp_status === 'pkp' ? 'PKP' : 'Non-PKP'}</strong>${profile.umkm_final ? ' · UMKM final scheme' : ''} · default PPN ${Number(profile.default_ppn_rate) || 0}%.</p>`;
    }
}

function wireSave(ds, user) {
    const btn = document.getElementById('tax-profile-save');
    if (!btn) return;
    if (!canEditTax()) {
        btn.setAttribute('disabled', 'disabled');
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        const hint = document.getElementById('tax-profile-hint');
        if (hint) hint.textContent = 'Read-only for your role.';
        document.querySelectorAll('[data-tax-panel="profile"] input, [data-tax-panel="profile"] select')
            .forEach((el) => el.setAttribute('disabled', 'disabled'));
        return;
    }
    btn.addEventListener('click', async () => {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
        btn.setAttribute('disabled', 'disabled');
        try {
            const profile = await ds.saveTaxProfile(user.uid, {
                npwp: val('tax-npwp'),
                nik: val('tax-nik'),
                pkp_status: val('tax-pkp-status'),
                default_ppn_rate: val('tax-ppn-rate'),
                tax_office_kpp: val('tax-kpp'),
                business_classification: val('tax-klu'),
                umkm_final: (document.getElementById('tax-umkm') || {}).checked === true
            });
            renderProfile(profile);
            renderOverviewNote(profile);
            toast('Tax profile saved', 'success');
        } catch (err) {
            toast('Could not save tax profile', 'error');
            console.error('saveTaxProfile failed', err);
        } finally {
            btn.removeAttribute('disabled');
        }
    });
}

function renderMappings(mappings) {
    const el = document.getElementById('tax-mappings-list');
    if (!el) return;
    if (!mappings.length) {
        el.innerHTML = '<p class="fluxy-meta" style="padding:8px 0">No tax mappings yet. Add one above to start posting PPN on a category or type.</p>';
        return;
    }
    const rows = mappings.map((m) => `
        <tr class="fluxy-table-row">
            <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${m.source_value || ''}</span><span class="fluxy-table-cell-meta">${m.source_type === 'transaction_type' ? 'Type' : 'Category'}</span></td>
            <td class="fluxy-table-cell">${TAX_CODE_LABEL[m.tax_code] || m.tax_code || ''}</td>
            <td class="fluxy-table-cell" style="text-align:right">${canEditTax() ? `<button type="button" class="acct-btn acct-btn-secondary" data-archive-mapping="${m.id}">Archive</button>` : ''}</td>
        </tr>`).join('');
    el.innerHTML = `<div class="fluxy-table-scroll"><table class="fluxy-table">
        <thead><tr class="fluxy-table-header"><th>Source</th><th>Treatment</th><th style="text-align:right">Action</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}

async function reloadMappings(ds, user) {
    const mappings = await ds.getTaxMappings(user.uid).catch(() => []);
    renderMappings(mappings);
}

function wireMappings(ds, user) {
    const addBtn = document.getElementById('map-add-btn');
    const list = document.getElementById('tax-mappings-list');
    const editable = canEditTax();
    if (!editable) {
        if (addBtn) { addBtn.setAttribute('disabled', 'disabled'); addBtn.classList.add('opacity-50', 'cursor-not-allowed'); }
        document.querySelectorAll('[data-tax-panel="mappings"] input, [data-tax-panel="mappings"] select')
            .forEach((el) => el.setAttribute('disabled', 'disabled'));
        const hint = document.getElementById('map-hint');
        if (hint) hint.textContent = 'Read-only for your role.';
        return;
    }
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const sourceType = (document.getElementById('map-source-type') || {}).value;
            const sourceValueEl = document.getElementById('map-source-value');
            const sourceValue = sourceValueEl ? sourceValueEl.value.trim() : '';
            const taxCode = (document.getElementById('map-tax-code') || {}).value;
            if (!sourceValue) { toast('Enter a category or type value', 'error'); return; }
            addBtn.setAttribute('disabled', 'disabled');
            try {
                await ds.saveTaxMapping(user.uid, { source_type: sourceType, source_value: sourceValue, tax_code: taxCode });
                if (sourceValueEl) sourceValueEl.value = '';
                await reloadMappings(ds, user);
                toast('Tax mapping saved', 'success');
            } catch (err) {
                toast('Could not save mapping', 'error');
                console.error('saveTaxMapping failed', err);
            } finally {
                addBtn.removeAttribute('disabled');
            }
        });
    }
    // Archive via delegation on the (persistent) list container.
    if (list) {
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-archive-mapping]');
            if (!btn) return;
            const id = btn.getAttribute('data-archive-mapping');
            const ok = typeof window.showConfirmDialog === 'function'
                ? await window.showConfirmDialog({ title: 'Archive mapping?', body: 'This source will no longer post PPN.', confirmLabel: 'Archive', cancelLabel: 'Cancel', tone: 'danger' })
                : true;
            if (!ok) return;
            try {
                await ds.archiveTaxMapping(user.uid, id);
                await reloadMappings(ds, user);
                toast('Mapping archived', 'success');
            } catch (err) {
                toast('Could not archive mapping', 'error');
                console.error('archiveTaxMapping failed', err);
            }
        });
    }
}

export async function initTaxCenterPage({ ds, user }) {
    if (!ds || !user) return;
    wireTabs();
    const period = currentPeriod();
    const label = document.getElementById('tax-period-label');
    if (label) label.textContent = period.label;

    wireSave(ds, user);
    wireMappings(ds, user);

    let profile = null;
    let taxTx = [];
    let mappings = [];
    let trial = [];
    try {
        [profile, taxTx, mappings, trial] = await Promise.all([
            ds.getTaxProfile(user.uid),
            ds.getTaxTransactions(user.uid, { periodKey: period.key }),
            ds.getTaxMappings(user.uid),
            ds.getPpnLedger(user.uid, period.key)
        ]);
    } catch (err) {
        console.error('Tax Center load failed', err);
    }
    renderProfile(profile);
    renderOverviewNote(profile);
    renderPpn(profile, taxTx || [], trial || { output: 0, input: 0, payable: 0 }, period);
    renderMappings(mappings || []);
}
