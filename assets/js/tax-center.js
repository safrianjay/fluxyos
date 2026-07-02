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

import { runComplianceChecks, upcomingTaxDeadlines } from './tax-engine.js';

// Rupiah, raw integer → 'Rp1.234.567' (no space after Rp — design-system rule).
function formatRp(n) {
    const v = Math.round(Number(n) || 0);
    return 'Rp' + v.toLocaleString('id-ID');
}

function formatRpInput(value, allowNegative = false) {
    const raw = String(value || '');
    const negative = allowNegative && raw.trim().startsWith('-');
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return '';
    const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return negative ? `-${formatted}` : formatted;
}

function parseRpInput(value) {
    const raw = String(value || '').replace(/[^\d-]/g, '');
    return Math.round(Number(raw) || 0);
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

// The tax period all tabs scope to. Driven by the topbar date-range picker (same
// convention as the Accounting Center: the period is the MONTH of the selected
// range's start day). Defaults to the current Jakarta month.
let activePeriod = null;
function getActivePeriod() {
    if (!activePeriod) activePeriod = currentPeriod();
    return activePeriod;
}
function periodFromStartKey(startKey) {
    const m = /^(\d{4})-(\d{2})/.exec(String(startKey || ''));
    if (!m) return currentPeriod();
    const key = `${m[1]}-${m[2]}`;
    const label = new Date(Number(m[1]), Number(m[2]) - 1, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { key, label };
}

const TAX_CODE_LABEL = { PPN_OUT_11: 'PPN Keluaran 11%', PPN_IN_11: 'PPN Masukan 11%' };

// CSV helpers (mirror invoices.js: client-side Blob download + export.create audit).
function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
function buildPpnCsv(taxTx, period) {
    const header = ['period', 'direction', 'tax_code', 'counterparty_npwp', 'faktur_number', 'base_dpp', 'ppn'];
    const rows = (taxTx || [])
        .filter((t) => t.direction === 'output' || t.direction === 'input')
        .map((t) => [period.key, t.direction, t.tax_code || '', t.npwp_counterparty || '', t.faktur_number || '', Math.round(Number(t.taxable_base) || 0), Math.round(Number(t.tax_amount) || 0)].map(csvCell).join(','));
    return [header.join(','), ...rows].join('\n');
}
function buildBupotCsv(taxTx, period) {
    const header = ['period', 'direction', 'withholding_code', 'counterparty_npwp', 'bukti_potong_no', 'base_dpp', 'pph'];
    const rows = (taxTx || [])
        .filter((t) => t.direction === 'withheld_by_us' || t.direction === 'withheld_by_other' || t.direction === 'final')
        .map((t) => [period.key, t.direction, t.tax_code || '', t.npwp_counterparty || '', t.bukti_potong_no || '', Math.round(Number(t.taxable_base) || 0), Math.round(Number(t.tax_amount) || 0)].map(csvCell).join(','));
    return [header.join(','), ...rows].join('\n');
}
async function logExport(ds, user, report, period, count) {
    try {
        await ds.addAuditLog(user.uid, {
            action: 'export.create', target_collection: 'report_exports', target_id: '',
            after: { report, period: period.key, rows: count, format: 'csv' }, source: 'dashboard'
        });
    } catch (_) { /* audit best-effort; never block the download */ }
}
// Bind export handlers EARLY (before init's data fetch) and read the tax lines fresh
// at click time — so the buttons work the moment the page is interactive (no race with
// the async load) and always reflect the latest posted data.
function wireExports(ds, user) {
    const ppnBtn = document.getElementById('ppn-export-btn');
    if (ppnBtn) ppnBtn.addEventListener('click', async () => {
        const period = getActivePeriod();
        const taxTx = await ds.getTaxTransactions(user.uid, { periodKey: period.key }).catch(() => []);
        const rows = taxTx.filter((t) => t.direction === 'output' || t.direction === 'input');
        downloadCsv(`spt_ppn_${period.key}.csv`, buildPpnCsv(taxTx, period));
        await logExport(ds, user, 'spt_ppn', period, rows.length);
        toast('SPT PPN CSV exported', 'success');
    });
    const whtBtn = document.getElementById('wht-export-btn');
    if (whtBtn) whtBtn.addEventListener('click', async () => {
        const period = getActivePeriod();
        const taxTx = await ds.getTaxTransactions(user.uid, { periodKey: period.key }).catch(() => []);
        const rows = taxTx.filter((t) => t.direction === 'withheld_by_us' || t.direction === 'withheld_by_other' || t.direction === 'final');
        downloadCsv(`bukti_potong_${period.key}.csv`, buildBupotCsv(taxTx, period));
        await logExport(ds, user, 'bukti_potong', period, rows.length);
        toast('Bukti Potong CSV exported', 'success');
    });
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
            <td class="fluxy-table-cell"><div class="flex flex-col"><span class="fluxy-table-cell-primary">${t.tax_name || t.tax_code || ''}</span><span class="fluxy-table-cell-meta">${t.direction || ''}</span></div></td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(t.taxable_base)}</td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(t.tax_amount)}</td>
        </tr>`).join('');
    body.innerHTML = `
        <div class="fluxy-table-scroll"><table class="fluxy-table">
            <thead><tr class="fluxy-table-header"><th>Tax</th><th class="fluxy-table-money">Base (DPP)</th><th class="fluxy-table-money">PPN</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
}

// Deterministic compliance findings (the detect half of the AI Tax Assistant).
const INSIGHT_STATUS = { critical: 'fluxy-status-danger', warning: 'fluxy-status-warning', info: 'fluxy-status-neutral' };
function renderInsights(findings) {
    const el = document.getElementById('tax-insights');
    if (!el) return;
    el.innerHTML = (findings || []).map((f) => `
        <div class="flex items-start gap-3 border border-gray-200 rounded-lg px-3 py-2.5" data-insight="${f.code}">
            <span class="fluxy-table-status ${INSIGHT_STATUS[f.severity] || 'fluxy-status-neutral'}" style="flex-shrink:0">${f.severity}</span>
            <div>
                <p class="text-[14px] font-semibold text-gray-900">${f.title}</p>
                <p class="text-[12px] text-gray-500">${f.detail}</p>
            </div>
        </div>`).join('');
}

// Tax Calendar: deterministic upcoming deadlines (pure engine math).
const DEADLINE_LABELS = {
    PPH_DEPOSIT: 'PPh deposit',
    EFAKTUR_REPORT: 'e-Faktur upload & PPh report',
    SPT_PPN: 'SPT Masa PPN',
    SPT_TAHUNAN: 'SPT Tahunan Badan'
};
function renderDeadlines() {
    const el = document.getElementById('tax-deadlines');
    if (!el) return;
    const rows = upcomingTaxDeadlines(new Date(), { max: 4 }).map((dl) => {
        const chip = dl.days_left === 0 ? 'Due today' : `${dl.days_left} day${dl.days_left === 1 ? '' : 's'} left`;
        const tone = dl.days_left <= 7 ? 'fluxy-status-warning' : 'fluxy-status-neutral';
        return `<tr class="fluxy-table-row" data-deadline="${dl.code}">
            <td class="fluxy-table-cell"><div class="flex flex-col"><span class="fluxy-table-cell-primary">${DEADLINE_LABELS[dl.code] || dl.code}</span><span class="fluxy-table-cell-meta">${dl.period} — ${dl.due}</span></div></td>
            <td class="fluxy-table-cell" style="text-align:right"><span class="fluxy-table-status ${tone}">${chip}</span></td>
        </tr>`;
    }).join('');
    el.innerHTML = `<div class="fluxy-table-scroll"><table class="fluxy-table"><tbody>${rows}</tbody></table></div>`;
}

// Live page context for the Fluxy AI drawer (window.FluxyAIContext — the explain
// half; read-only, never writes). Registered once init has real figures.
function registerAiContext({ profile, ppn, wht, corporate, findings, period }) {
    if (!window.FluxyAIContext || typeof window.FluxyAIContext.register !== 'function') return;
    const issueCount = (findings || []).filter((f) => f.code !== 'ALL_CLEAR').length;
    window.FluxyAIContext.register(() => ({
        pageTitle: 'Tax Center',
        summary: [
            { label: 'Period', value: period.label },
            { label: 'PKP status', value: profile ? (profile.pkp_status === 'pkp' ? 'PKP' : 'Non-PKP') : 'Not set', status: profile ? 'good' : 'critical' },
            { label: 'PPN payable', value: formatRp(ppn ? ppn.payable : 0) },
            { label: 'PPh withheld (owed)', value: formatRp(wht ? wht.payable : 0) },
            { label: 'Prepaid PPh 25', value: formatRp(corporate ? corporate.prepaid_pph25 : 0) },
            { label: 'Compliance issues', value: String(issueCount), status: issueCount ? 'warning' : 'good' }
        ],
        filters: { period: period.key },
        selectedRecord: null
    }));
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

function renderWithholding(taxTx, whtLedger, period) {
    const periodLabel = document.getElementById('wht-period-label');
    if (periodLabel) periodLabel.textContent = period.label;
    const payable = whtLedger ? whtLedger.payable : 0;
    const credit = whtLedger ? whtLedger.credit : 0;
    const kpiPay = document.getElementById('kpi-wht-payable');
    const kpiCr = document.getElementById('kpi-wht-credit');
    if (kpiPay) kpiPay.textContent = formatRp(payable);
    if (kpiCr) kpiCr.textContent = formatRp(credit);

    const body = document.getElementById('wht-summary-body');
    if (!body) return;
    const rows = (taxTx || []).filter((t) => t.direction === 'withheld_by_us' || t.direction === 'withheld_by_other' || t.direction === 'final');
    if (!rows.length) {
        if (typeof window !== 'undefined' && typeof window.renderEmptyState === 'function') {
            window.renderEmptyState('wht-summary-body', {
                icon: '✂️',
                title: 'No withholding yet for this period',
                description: 'Add a PPh withholding rate on a bill (Bills → Add Bill) and it will summarize here with its bukti potong.'
            });
        } else {
            body.innerHTML = '<p class="fluxy-meta" style="padding:16px">No withholding yet for this period.</p>';
        }
        return;
    }
    const html = rows.map((t) => `
        <tr class="fluxy-table-row">
            <td class="fluxy-table-cell"><div class="flex flex-col"><span class="fluxy-table-cell-primary">${t.tax_name || t.tax_code || ''}</span><span class="fluxy-table-cell-meta">${t.bukti_potong_no || 'No bukti potong'}</span></div></td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(t.taxable_base)}</td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(t.tax_amount)}</td>
        </tr>`).join('');
    body.innerHTML = `<div class="fluxy-table-scroll"><table class="fluxy-table">
        <thead><tr class="fluxy-table-header"><th>Withholding</th><th class="fluxy-table-money">Base (DPP)</th><th class="fluxy-table-money">PPh</th></tr></thead>
        <tbody>${html}</tbody></table></div>`;
}

function periodBadge(status) {
    const map = { computed: ['fluxy-status-info', 'Computed'], filed: ['fluxy-status-success', 'Filed'], settled: ['fluxy-status-success', 'Settled'] };
    return map[status] || ['fluxy-status-neutral', 'Open'];
}

function renderPeriods(periods, period) {
    const label = document.getElementById('period-card-label');
    if (label) label.textContent = period.label;
    const cur = (periods || []).find((p) => p.period_key === period.key);
    const badge = document.getElementById('period-status-badge');
    if (badge) { const [cls, text] = periodBadge(cur && cur.status); badge.className = 'fluxy-table-status ' + cls; badge.textContent = text; }
    const fileBtn = document.getElementById('period-file-btn');
    if (fileBtn) fileBtn.disabled = !cur || cur.status === 'filed' || cur.status === 'settled' || !canEditTax();
    const list = document.getElementById('tax-periods-list');
    if (!list) return;
    // Display only plausible calendar periods (monthly YYYY-MM or annual YYYY up to
    // next year) and cap the list — QA/synthetic far-future years would otherwise
    // sort to the top and bury the real months.
    const maxYear = new Date().getFullYear() + 1;
    const visible = (periods || []).filter((p) => {
        const key = String(p.period_key || '');
        const m = /^(\d{4})(?:-\d{2})?$/.exec(key);
        return m && Number(m[1]) <= maxYear;
    }).slice(0, 12);
    if (!visible.length) {
        list.innerHTML = '<p class="fluxy-meta" style="padding:8px 0">No periods computed yet. Click “Compute period” to summarize this month from your books.</p>';
        return;
    }
    const rows = visible.map((p) => {
        const [cls, text] = periodBadge(p.status);
        return `<tr class="fluxy-table-row">
            <td class="fluxy-table-cell"><span class="fluxy-table-cell-primary">${p.period_key || ''}</span></td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(p.ppn_payable)}</td>
            <td class="fluxy-table-cell fluxy-table-money">${formatRp(p.pph_withheld)}</td>
            <td class="fluxy-table-cell"><span class="fluxy-table-status ${cls}">${text}</span></td>
        </tr>`;
    }).join('');
    list.innerHTML = `<div class="fluxy-table-scroll"><table class="fluxy-table">
        <thead><tr class="fluxy-table-header"><th>Period</th><th class="fluxy-table-money">PPN payable</th><th class="fluxy-table-money">PPh payable</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}

async function reloadPeriods(ds, user) {
    const periods = await ds.listTaxPeriods(user.uid).catch(() => []);
    renderPeriods(periods, getActivePeriod());
}

const FILING_LABEL = { SPT_PPN: 'SPT PPN', SPT_PPh_Unifikasi: 'SPT PPh Unifikasi', SPT_PPh21: 'SPT PPh 21', SPT_Tahunan: 'SPT Tahunan', Tax_Certificate: 'Tax Certificate' };
function renderFilings(filings) {
    const el = document.getElementById('tax-filings-list');
    if (!el) return;
    if (!filings || !filings.length) { el.innerHTML = ''; return; }
    const maxYear = new Date().getFullYear() + 1;
    const sorted = filings.slice()
        .filter((f) => {
            const m = /^(?:monthly|annual)-(\d{4})/.exec(String(f.period_id || ''));
            return m && Number(m[1]) <= maxYear;
        })
        .sort((a, b) => String(b.period_id || '').localeCompare(String(a.period_id || '')))
        .slice(0, 12);
    if (!sorted.length) { el.innerHTML = ''; return; }
    const rows = sorted.map((f) => `
        <tr class="fluxy-table-row">
            <td class="fluxy-table-cell"><div class="flex flex-col"><span class="fluxy-table-cell-primary">${FILING_LABEL[f.filing_type] || f.filing_type || ''}</span><span class="fluxy-table-cell-meta">${String(f.period_id || '').replace('monthly-', '')}</span></div></td>
            <td class="fluxy-table-cell">${f.reference_number || '—'}</td>
            <td class="fluxy-table-cell"><span class="fluxy-table-status fluxy-status-success">${f.status || 'filed'}</span></td>
        </tr>`).join('');
    el.innerHTML = `<h3 class="fluxy-kpi-label" style="margin:4px 0 8px">Filings</h3><div class="fluxy-table-scroll"><table class="fluxy-table">
        <thead><tr class="fluxy-table-header"><th>Filing</th><th>DJP reference</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function reloadFilings(ds, user) {
    const filings = await ds.listTaxFilings(user.uid).catch(() => []);
    renderFilings(filings);
}

function wirePeriods(ds, user) {
    const computeBtn = document.getElementById('period-compute-btn');
    const fileBtn = document.getElementById('period-file-btn');
    if (!canEditTax()) {
        [computeBtn, fileBtn].forEach((b) => { if (b) { b.setAttribute('disabled', 'disabled'); b.classList.add('opacity-50', 'cursor-not-allowed'); } });
        return;
    }
    if (computeBtn) {
        computeBtn.addEventListener('click', async () => {
            const period = getActivePeriod();
            computeBtn.setAttribute('disabled', 'disabled');
            try {
                await ds.computeTaxPeriod(user.uid, period.key);
                await reloadPeriods(ds, user);
                toast('Period computed', 'success');
            } catch (e) {
                toast(e && e.message ? e.message : 'Could not compute period', 'error');
                console.error('computeTaxPeriod failed', e);
            } finally {
                computeBtn.removeAttribute('disabled');
            }
        });
    }
    if (fileBtn) {
        fileBtn.addEventListener('click', async () => {
            const period = getActivePeriod();
            const ok = typeof window.showConfirmDialog === 'function'
                ? await window.showConfirmDialog({ title: 'Mark period as filed?', body: `This locks ${period.label} from recompute. Do this once you have reported it to DJP.`, confirmLabel: 'Mark filed', cancelLabel: 'Cancel', tone: 'default' })
                : true;
            if (!ok) return;
            try {
                await ds.fileTaxPeriod(user.uid, period.key);
                const filingType = document.getElementById('period-filing-type')?.value || 'SPT_PPN';
                const ref = document.getElementById('period-filing-ref')?.value || null;
                await ds.addTaxFiling(user.uid, { periodKey: period.key, filing_type: filingType, reference_number: ref });
                const refInput = document.getElementById('period-filing-ref');
                if (refInput) refInput.value = '';
                await reloadPeriods(ds, user);
                await reloadFilings(ds, user);
                toast('Period filed & filing recorded', 'success');
            } catch (e) {
                toast(e && e.message ? e.message : 'Could not file period', 'error');
                console.error('fileTaxPeriod failed', e);
            }
        });
    }
}

function renderCorporate(summary) {
    const s = summary || { prepaid_pph25: 0, pph_credit: 0, pph29_payable: 0 };
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = formatRp(v); };
    set('kpi-corp-prepaid', s.prepaid_pph25);
    set('kpi-corp-credit', s.pph_credit);
    set('kpi-corp-payable', s.pph29_payable);
}

async function reloadCorporate(ds, user) {
    const summary = await ds.getCorporateTaxSummary(user.uid).catch(() => null);
    renderCorporate(summary);
}

function renderAnnualResult(r) {
    const el = document.getElementById('corp-annual-result');
    if (!el) return;
    const rows = [
        ['Scheme', r.scheme === 'umkm_final' ? 'UMKM final 0.5%' : 'Ordinary CIT 22%'],
        [r.scheme === 'umkm_final' ? 'Turnover' : 'Taxable income', formatRp(r.scheme === 'umkm_final' ? r.turnover : r.taxable_income)],
        ['Corporate tax (CIT)', formatRp(r.cit)],
        ['Less: Prepaid PPh 25', formatRp(r.prepaid)],
        ['Less: PPh withheld', formatRp(r.withheld)],
        [r.pph29 >= 0 ? 'PPh 29 payable' : 'Overpayment', formatRp(Math.abs(r.pph29))]
    ];
    el.innerHTML = '<div class="fluxy-table-scroll"><table class="fluxy-table"><tbody>'
        + rows.map(([k, v], i) => `<tr class="fluxy-table-row ${i === rows.length - 1 ? 'fluxy-table-row-total' : ''}"><td class="fluxy-table-cell">${k}</td><td class="fluxy-table-cell fluxy-table-money">${v}</td></tr>`).join('')
        + '</tbody></table></div>';
}

function wireCorporate(ds, user) {
    const btn = document.getElementById('corp-pph25-btn');
    if (!btn) return;
    if (!canEditTax()) {
        btn.setAttribute('disabled', 'disabled');
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        document.querySelectorAll('[data-tax-panel="corporate"] input, [data-tax-panel="corporate"] select, [data-tax-panel="corporate"] button')
            .forEach((el) => { el.setAttribute('disabled', 'disabled'); el.classList.add('opacity-50', 'cursor-not-allowed'); });
        const hint = document.getElementById('corp-hint');
        if (hint) hint.textContent = 'Read-only for your role.';
        return;
    }
    const amountEl = document.getElementById('corp-pph25-amount');
    if (amountEl) {
        amountEl.addEventListener('input', (event) => {
            const target = event.target;
            target.value = formatRpInput(target.value);
        });
    }

    btn.addEventListener('click', async () => {
        const refEl = document.getElementById('corp-pph25-ref');
        const amount = parseRpInput(amountEl ? amountEl.value : '');
        if (!Number.isFinite(amount) || amount <= 0) { toast('Enter an amount', 'error'); return; }
        btn.setAttribute('disabled', 'disabled');
        try {
            await ds.recordCorporateTaxPayment(user.uid, { amount, reference: refEl ? refEl.value : null });
            if (amountEl) amountEl.value = '';
            if (refEl) refEl.value = '';
            await reloadCorporate(ds, user);
            toast('PPh 25 payment recorded', 'success');
        } catch (e) {
            toast(e && e.message ? e.message : 'Could not record payment', 'error');
            console.error('recordCorporateTaxPayment failed', e);
        } finally {
            btn.removeAttribute('disabled');
        }
    });

    // Annual reconciliation (PPh 29) + fiscal-adjustment line list. Lines persist on
    // the annual tax_periods doc (saveFiscalAdjustments) and their sum feeds the
    // taxable-income computation under the ordinary scheme.
    const yearEl = document.getElementById('corp-annual-year');
    if (yearEl && !yearEl.value) yearEl.value = String(new Date().getFullYear());
    const computeAnnualBtn = document.getElementById('corp-annual-compute');
    const postAnnualBtn = document.getElementById('corp-annual-post');
    let lastAnnual = null;
    let adjLines = [];

    const adjListEl = document.getElementById('fiscal-adj-list');
    const currentYear = () => String((yearEl || {}).value || '').trim();
    const adjTotal = () => adjLines.reduce((s, l) => s + (Math.round(Number(l.amount)) || 0), 0);
    const renderAdjEditor = () => {
        if (!adjListEl) return;
        adjListEl.innerHTML = adjLines.map((l, i) => `
            <div class="flex flex-wrap items-center gap-2" data-adj-row="${i}">
                <input data-adj-label type="text" maxlength="120" placeholder="e.g. Non-deductible entertainment" value="${String(l.label || '').replace(/"/g, '&quot;')}" class="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-orange-400" />
                <select data-adj-kind class="border border-gray-200 rounded-lg px-2 py-2 text-[13px]">
                    <option value="permanent"${l.kind !== 'temporary' ? ' selected' : ''}>Permanent</option>
                    <option value="temporary"${l.kind === 'temporary' ? ' selected' : ''}>Temporary</option>
                </select>
                <input data-adj-amount type="text" inputmode="numeric" placeholder="±0" value="${l.amount ? formatRpInput(String(l.amount), true) : ''}" class="w-36 border border-gray-200 rounded-lg px-3 py-2 text-[13px] tabular-nums text-right focus:outline-none focus:border-orange-400" />
                <button data-adj-remove type="button" class="acct-btn acct-btn-secondary">Remove</button>
            </div>`).join('');
        const totalEl = document.getElementById('fiscal-adj-total');
        if (totalEl) totalEl.textContent = formatRp(adjTotal());
    };
    let adjLoadSeq = 0;
    let adjLoadedYear = null;
    const loadAdjustments = async () => {
        const year = currentYear();
        // The year input fires 'change' again on blur (e.g. when the user clicks
        // Add right after typing). Reloading for the SAME year would clobber the
        // lines being edited with the saved list — only reload on a real change.
        if (year === adjLoadedYear) return;
        const seq = ++adjLoadSeq;
        if (!/^\d{4}$/.test(year)) { adjLines = []; adjLoadedYear = null; renderAdjEditor(); return; }
        const rows = await ds.getFiscalAdjustments(user.uid, year).catch(() => []);
        if (seq !== adjLoadSeq) return; // a newer year change superseded this load
        adjLines = rows;
        adjLoadedYear = year;
        renderAdjEditor();
        // Marker for tests/UI: the editor now reflects this year's saved lines.
        if (adjListEl) adjListEl.dataset.loadedYear = year;
    };
    if (adjListEl) {
        adjListEl.addEventListener('input', (e) => {
            const row = e.target.closest('[data-adj-row]');
            if (!row) return;
            const i = Number(row.getAttribute('data-adj-row'));
            if (!adjLines[i]) return;
            if (e.target.hasAttribute('data-adj-amount')) {
                e.target.value = formatRpInput(e.target.value, true);
                adjLines[i].amount = parseRpInput(e.target.value);
            } else if (e.target.hasAttribute('data-adj-label')) {
                adjLines[i].label = e.target.value;
            } else if (e.target.hasAttribute('data-adj-kind')) {
                adjLines[i].kind = e.target.value;
            }
            const totalEl = document.getElementById('fiscal-adj-total');
            if (totalEl) totalEl.textContent = formatRp(adjTotal());
        });
        adjListEl.addEventListener('change', (e) => {
            const row = e.target.closest('[data-adj-row]');
            if (row && e.target.hasAttribute('data-adj-kind')) adjLines[Number(row.getAttribute('data-adj-row'))].kind = e.target.value;
        });
        adjListEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-adj-remove]');
            if (!btn) return;
            const row = btn.closest('[data-adj-row]');
            adjLines.splice(Number(row.getAttribute('data-adj-row')), 1);
            renderAdjEditor();
        });
    }
    document.getElementById('fiscal-adj-add')?.addEventListener('click', () => {
        adjLines.push({ label: '', amount: 0, kind: 'permanent' });
        renderAdjEditor();
    });
    document.getElementById('fiscal-adj-save')?.addEventListener('click', async () => {
        const year = currentYear();
        if (!/^\d{4}$/.test(year)) { toast('Enter a 4-digit fiscal year', 'error'); return; }
        try {
            adjLines = await ds.saveFiscalAdjustments(user.uid, year, adjLines);
            renderAdjEditor();
            toast('Adjustments saved', 'success');
        } catch (e) {
            toast(e && e.message ? e.message : 'Could not save adjustments', 'error');
            console.error('saveFiscalAdjustments failed', e);
        }
    });
    yearEl?.addEventListener('change', loadAdjustments);
    loadAdjustments();

    if (computeAnnualBtn) {
        computeAnnualBtn.addEventListener('click', async () => {
            const year = currentYear();
            if (!/^\d{4}$/.test(year)) { toast('Enter a 4-digit fiscal year', 'error'); return; }
            computeAnnualBtn.setAttribute('disabled', 'disabled');
            try {
                lastAnnual = await ds.computeAnnualCorporateTax(user.uid, year, { fiscalAdjustment: adjTotal() });
                renderAnnualResult(lastAnnual);
                if (postAnnualBtn) postAnnualBtn.classList.remove('hidden');
            } catch (e) {
                toast(e && e.message ? e.message : 'Could not compute', 'error');
                console.error('computeAnnualCorporateTax failed', e);
            } finally {
                computeAnnualBtn.removeAttribute('disabled');
            }
        });
    }
    if (postAnnualBtn) {
        postAnnualBtn.addEventListener('click', async () => {
            if (!lastAnnual) return;
            const ok = typeof window.showConfirmDialog === 'function'
                ? await window.showConfirmDialog({ title: `Post annual reconciliation ${lastAnnual.fiscal_year}?`, body: `Books CIT to tax expense, consumes prepayments, and posts ${formatRp(Math.abs(lastAnnual.pph29))} ${lastAnnual.pph29 >= 0 ? 'PPh 29 payable' : 'overpayment'}.`, confirmLabel: 'Post', cancelLabel: 'Cancel', tone: 'default' })
                : true;
            if (!ok) return;
            postAnnualBtn.setAttribute('disabled', 'disabled');
            try {
                await ds.postAnnualCorporateTax(user.uid, lastAnnual.fiscal_year, { fiscalAdjustment: lastAnnual.fiscal_adjustment });
                await reloadCorporate(ds, user);
                postAnnualBtn.classList.add('hidden');
                toast('Annual reconciliation posted', 'success');
            } catch (e) {
                toast(e && e.message ? e.message : 'Could not post', 'error');
                console.error('postAnnualCorporateTax failed', e);
            } finally {
                postAnnualBtn.removeAttribute('disabled');
            }
        });
    }
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
            <td class="fluxy-table-cell"><div class="flex flex-col"><span class="fluxy-table-cell-primary">${m.source_value || ''}</span><span class="fluxy-table-cell-meta">${m.source_type === 'transaction_type' ? 'Type' : 'Category'}</span></div></td>
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
    // onAuthStateChanged can re-emit; a second init would double-wire every
    // button (double posting) and reset editor state closures. Init once.
    if (typeof window !== 'undefined') {
        if (window.__fluxyTaxCenterInit) return;
        window.__fluxyTaxCenterInit = true;
    }
    const loading = document.getElementById('tax-loading');
    const content = document.getElementById('tax-page-content');
    loading?.classList.remove('hidden');
    content?.classList.add('hidden');

    wireTabs();
    activePeriod = currentPeriod();

    wireSave(ds, user);
    wireMappings(ds, user);
    wirePeriods(ds, user);
    wireCorporate(ds, user);
    wireExports(ds, user);

    // Fetch + render everything for the active period. Reused by the date picker.
    let refreshSeq = 0;
    const refreshPeriodData = async ({ firstLoad = false } = {}) => {
        const seq = ++refreshSeq;
        const period = getActivePeriod();
        const label = document.getElementById('tax-period-label');
        if (label) label.textContent = period.label;
        if (firstLoad) { loading?.classList.remove('hidden'); content?.classList.add('hidden'); }

        let profile = null, taxTx = [], mappings = [], ppn = null, wht = null, periods = [], filings = [], corporate = null;
        try {
            [profile, taxTx, mappings, ppn, wht, periods, filings, corporate] = await Promise.all([
                ds.getTaxProfile(user.uid),
                ds.getTaxTransactions(user.uid, { periodKey: period.key }),
                ds.getTaxMappings(user.uid),
                ds.getPpnLedger(user.uid, period.key),
                ds.getWhtLedger(user.uid, period.key),
                ds.listTaxPeriods(user.uid),
                ds.listTaxFilings(user.uid),
                ds.getCorporateTaxSummary(user.uid)
            ]);
        } catch (err) {
            console.error('Tax Center load failed', err);
        } finally {
            if (firstLoad) { loading?.classList.add('hidden'); content?.classList.remove('hidden'); }
        }
        if (seq !== refreshSeq) return; // a newer period selection superseded this load

        renderProfile(profile);
        renderOverviewNote(profile);
        renderPpn(profile, taxTx || [], ppn || { output: 0, input: 0, payable: 0 }, period);
        renderWithholding(taxTx || [], wht || { payable: 0, credit: 0 }, period);
        renderMappings(mappings || []);
        renderPeriods(periods || [], period);
        renderFilings(filings || []);
        renderCorporate(corporate);

        // AI Tax Assistant: deterministic compliance findings + live drawer context.
        const findings = runComplianceChecks({ profile, taxTx: taxTx || [], ppn, wht, periods: periods || [], periodKey: period.key });
        renderInsights(findings);
        renderDeadlines();
        registerAiContext({ profile, ppn, wht, corporate, findings, period });
    };

    // Topbar date filter (shared picker, same convention as the Accounting Center:
    // the tax period is the month of the selected range's start day).
    if (window.FluxyDateRangePicker && document.getElementById('tax-date-range-picker')) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const startKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const endKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        window.FluxyDateRangePicker.mount('#tax-date-range-picker', {
            start: startKey,
            end: endKey,
            onChange: ({ start }) => {
                const next = periodFromStartKey(start);
                if (next.key === getActivePeriod().key) return;
                activePeriod = next;
                refreshPeriodData();
            }
        });
    }

    document.getElementById('tax-ask-ai')?.addEventListener('click', () => {
        if (typeof window.toggleFluxyAI === 'function') window.toggleFluxyAI(true);
    });

    await refreshPeriodData({ firstLoad: true });
}
