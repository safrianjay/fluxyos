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

function renderPpn(profile, taxTx, period) {
    const periodLabel = document.getElementById('ppn-period-label');
    if (periodLabel) periodLabel.textContent = period.label;

    const output = taxTx.filter((t) => t.direction === 'output').reduce((s, t) => s + (Number(t.tax_amount) || 0), 0);
    const input = taxTx.filter((t) => t.direction === 'input').reduce((s, t) => s + (Number(t.tax_amount) || 0), 0);
    const payable = output - input;

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

export async function initTaxCenterPage({ ds, user }) {
    if (!ds || !user) return;
    wireTabs();
    const period = currentPeriod();
    const label = document.getElementById('tax-period-label');
    if (label) label.textContent = period.label;

    wireSave(ds, user);

    let profile = null;
    let taxTx = [];
    try {
        [profile, taxTx] = await Promise.all([
            ds.getTaxProfile(user.uid),
            ds.getTaxTransactions(user.uid, { periodKey: period.key })
        ]);
    } catch (err) {
        console.error('Tax Center load failed', err);
    }
    renderProfile(profile);
    renderOverviewNote(profile);
    renderPpn(profile, taxTx || [], period);
}
