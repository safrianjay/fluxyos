// Report Preview — full-page viewer for a monthlyReportPack.
//
// Reads the pack + raw source records from sessionStorage (staged by the
// Reports & Exports drawer's "Open Full Report" CTA). Auth-guarded; never
// queries global collections; CSV download and Confirm Export reuse the
// same logic as the drawer flow.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    buildCsvBundle,
    downloadFile,
    formatRupiahCompact,
    formatPercent,
    periodLabel
} from './report-builder.js';

function scopePeriodHuman(period) {
    if (!period) return '';
    return `${period.label || ''} (${periodLabel({ start: period.start_date, end: period.end_date })})`;
}

const REPORT_PREVIEW_STORAGE_KEY = 'fluxyos_report_preview';

// The drawer's Open Full Report opens this page in a new tab. New tabs get
// their own sessionStorage, so the payload is staged in localStorage instead
// and cleared once read. This keeps the handoff one-shot.
function readPreviewStorage() {
    try {
        return localStorage.getItem(REPORT_PREVIEW_STORAGE_KEY)
            || sessionStorage.getItem(REPORT_PREVIEW_STORAGE_KEY);
    } catch {
        return null;
    }
}
function clearPreviewStorage() {
    try { localStorage.removeItem(REPORT_PREVIEW_STORAGE_KEY); } catch {}
    try { sessionStorage.removeItem(REPORT_PREVIEW_STORAGE_KEY); } catch {}
}

// Mirrors the navbar/login logo. Orange tile, navy F path — matches the
// sidebar logo defined in sidebar-loader.js. Render via JS so styling stays
// consistent with the rest of the app.
const COVER_LOGO_SVG = `
<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="40" height="40" rx="9" fill="#EA580C" />
    <g transform="translate(1.5, 0)">
        <path d="M 7 6 L 33 6 L 27 12 L 13 12 L 13 34 L 7 34 Z" fill="#FFFFFF" />
        <path d="M 17 18 L 27 18 L 21 24 L 17 24 Z" fill="#FFFFFF" />
    </g>
</svg>`;

const firebaseConfig = {
    apiKey: "AIzaSyDNynZIawmUQkTAVv71r4r9Sg661XvHVsA",
    authDomain: "fluxyos.firebaseapp.com",
    projectId: "fluxyos",
    storageBucket: "fluxyos.firebasestorage.app",
    messagingSenderId: "1084252368929",
    appId: "1:1084252368929:web:da73dc0db83fe592c7f360"
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

const state = {
    user: null,
    pack: null,
    sourceData: null
};

// Loading state should be visible long enough to feel like a transition,
// not a flash. The skeleton stays at least this long even if data is ready.
const MIN_LOADING_MS = 650;
const loadingStartedAt = Date.now();
function afterMinLoading(callback) {
    const elapsed = Date.now() - loadingStartedAt;
    const wait = Math.max(0, MIN_LOADING_MS - elapsed);
    setTimeout(callback, wait);
}

function el(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function readPreviewPayload() {
    try {
        const raw = readPreviewStorage();
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.pack || !parsed.pack.report_identity) return null;
        return parsed;
    } catch {
        return null;
    }
}

function showEmptyState() {
    afterMinLoading(() => {
        el('loading').style.display = 'none';
        el('report-root').hidden = true;
        el('empty-state').style.display = 'block';
    });
}

// ---------- Chart helpers ----------

// Round `max` up to a "nice" axis ceiling at 1/2/5 * 10^n.
function niceMax(max) {
    const v = Math.max(1, Number(max) || 0);
    const power = Math.pow(10, Math.floor(Math.log10(v)));
    const normalized = v / power;
    let nice;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 5) nice = 5;
    else nice = 10;
    return nice * power;
}

function axisTicks(maxValue) {
    const top = niceMax(maxValue);
    return [top, top * 0.75, top * 0.5, top * 0.25, 0];
}

function renderBarChart(items, { yAxisLabel = '' } = {}) {
    const values = items.map(i => Math.abs(Number(i.value) || 0));
    const top = niceMax(Math.max(...values, 0)) || 1;
    const ticks = axisTicks(top);

    const yAxisHtml = ticks.map(t => `<span>${formatRupiahCompact(t)}</span>`).join('');
    const colsHtml = items.map(item => {
        const v = Math.abs(Number(item.value) || 0);
        const heightPct = top > 0 ? (v / top) * 100 : 0;
        const tone = item.color ? ` ${item.color}` : '';
        const label = item.label || '';
        const sublabel = item.sublabel ? `<small>${escapeHtml(item.sublabel)}</small>` : '';
        return `
            <div class="chart-col">
                <div class="chart-col-value">${formatRupiahCompact(item.value)}</div>
                <div class="chart-col-bar${tone}" style="height:${heightPct.toFixed(1)}%;"></div>
                <div class="chart-col-label">${escapeHtml(label)}${sublabel}</div>
            </div>`;
    }).join('');

    return `
        <div class="chart-wrap" ${yAxisLabel ? `aria-label="${escapeHtml(yAxisLabel)}"` : ''}>
            <div class="chart-yaxis">${yAxisHtml}</div>
            <div class="chart-plot">${colsHtml}</div>
        </div>`;
}

// Side-by-side grouped horizontal bars showing previous vs current for each
// non-percent metric. Bars share the same axis (max of both periods across
// all metrics) so absolute magnitude differences are visible at a glance —
// useful when a previous period is dramatically smaller and a % delta would
// be misleadingly enormous.
function renderPeriodComparisonChart(rows) {
    const metricRows = (rows || []).filter(r => !r.is_percent);
    if (!metricRows.length) {
        return '<p style="color:var(--muted);margin:0;font-size:14px;">No comparable metrics available.</p>';
    }
    const maxValue = Math.max(
        ...metricRows.flatMap(r => [Math.abs(Number(r.previous) || 0), Math.abs(Number(r.current) || 0)]),
        1
    );
    return `
        <div class="pcompare">
            ${metricRows.map(r => {
                const prev = Math.abs(Number(r.previous) || 0);
                const curr = Math.abs(Number(r.current) || 0);
                const prevPct = maxValue > 0 ? (prev / maxValue) * 100 : 0;
                const currPct = maxValue > 0 ? (curr / maxValue) * 100 : 0;
                return `
                    <div class="pcompare-row">
                        <strong>${escapeHtml(r.metric)}</strong>
                        <div class="pcompare-bars">
                            <div class="pcompare-bar-row">
                                <span class="pcompare-bar-label">Previous</span>
                                <div class="pcompare-bar-track"><div class="pcompare-bar-fill prev" style="width:${prevPct.toFixed(1)}%;"></div></div>
                                <span class="pcompare-bar-value">${formatRupiahCompact(prev)}</span>
                            </div>
                            <div class="pcompare-bar-row">
                                <span class="pcompare-bar-label">Current</span>
                                <div class="pcompare-bar-track"><div class="pcompare-bar-fill curr" style="width:${currPct.toFixed(1)}%;"></div></div>
                                <span class="pcompare-bar-value">${formatRupiahCompact(curr)}</span>
                            </div>
                        </div>
                    </div>`;
            }).join('')}
            <div class="pcompare-legend">
                <span><i class="pcompare-swatch prev"></i>Previous period</span>
                <span><i class="pcompare-swatch curr"></i>Current period</span>
            </div>
        </div>`;
}

function showReport() {
    // Pre-render so the swap from skeleton to report is instant once the
    // minimum loading window elapses.
    const root = el('report-root');
    root.innerHTML = renderReportHtml(state.pack);
    afterMinLoading(() => {
        el('loading').style.display = 'none';
        el('empty-state').style.display = 'none';
        root.hidden = false;
    });
}

// ---------- Rendering ----------

function renderReportHtml(pack) {
    const scope = pack.report_scope || { mode: 'monthly', comparison_mode: 'none' };
    const isYtdMode = scope.mode === 'year_to_date' || scope.mode === 'quarter_to_date';
    const isYoY = scope.comparison_mode === 'previous_year_to_date' || scope.comparison_mode === 'same_period_last_year';

    const sections = [renderCover(pack), renderExecutiveSummary(pack), renderKeyTakeaways(pack)];

    if (isYoY) {
        sections.push(renderYoYProfitLoss(pack));
        sections.push(renderMonthlyTrendComparison(pack));
    } else if (isYtdMode) {
        sections.push(renderYtdProfitLoss(pack));
        sections.push(renderMonthlyTrend(pack));
    } else {
        sections.push(renderProfitLoss(pack));
        if (scope.comparison_mode === 'previous_period') {
            sections.push(renderPeriodComparison(pack));
        }
    }

    sections.push(
        renderPredictability(pack),
        renderExpenseBreakdown(pack),
        renderBillsSubscriptions(pack),
        renderReportConfidence(pack),
        renderDataQuality(pack),
        renderExportManifest(pack)
    );
    return sections.join('');
}

function renderCover(pack) {
    const id = pack.report_identity;
    const generated = new Date(id.generated_at);
    const generatedHuman = generated.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
    <section class="cover">
        <div>
            <div class="brand-row">
                <div class="logo">${COVER_LOGO_SVG}</div>
                <div>
                    <strong>FluxyOS</strong>
                    <span>Financial operations report</span>
                </div>
            </div>
            <span class="pill">Monthly Report Pack</span>
            <h1>${escapeHtml(id.report_title)}</h1>
            <p class="cover-subtitle">A shareable management report generated from FluxyOS operational records. It summarizes performance, cost drivers, payable pressure, data quality, source coverage, and export traceability.</p>
            <div class="cover-note">
                <strong>Management report generated from FluxyOS operational records.</strong><br>
                ${escapeHtml(id.disclaimer)} Full row-level review should use the CSV source files.
            </div>
        </div>
        <aside class="cover-meta">
            <div class="meta-card">
                <small>Prepared for</small>
                <strong>${escapeHtml(id.business_name || 'Your workspace')}</strong>
                <span>Current period: ${escapeHtml(scopePeriodHuman(pack.report_scope?.current_period) || id.period_label)}</span>
                ${pack.report_scope?.comparison_period ? `<span style="margin-top:4px;">Comparison: ${escapeHtml(scopePeriodHuman(pack.report_scope.comparison_period))}</span>` : ''}
            </div>
            <div class="meta-card">
                <small>Generated by</small>
                <strong>${escapeHtml(id.generated_by_name || 'Account owner')}</strong>
                <span>${escapeHtml(generatedHuman)}</span>
            </div>
            <div class="meta-card">
                <small>Export package</small>
                <strong>PDF + CSV</strong>
                <span>PDF summary (browser print) + CSV source files</span>
            </div>
            <div class="meta-card">
                <small>Status &amp; audit</small>
                <strong>Draft management report</strong>
                <span>Audit log written on Confirm Export</span>
            </div>
        </aside>
    </section>`;
}

function renderExecutiveSummary(pack) {
    const es = pack.executive_summary;
    const marginText = pack.profit_loss.revenue === 0 ? 'Not available' : formatPercent(es.gross_margin);
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <div class="kicker">FluxyOS Report Output</div>
                <h2>Executive Summary</h2>
                <p class="subtitle">The minimum information a founder, accountant, or stakeholder needs before reading the detailed report.</p>
            </div>
        </div>
        <div class="summary-callout">${escapeHtml(es.summary_text)}</div>
        <div class="grid-5">
            <div class="metric-card"><div class="metric-label">Revenue</div><div class="metric-value">${formatRupiahCompact(es.revenue)}</div><div class="metric-note">${escapeHtml(es.record_counts_revenue_side)} included.</div></div>
            <div class="metric-card"><div class="metric-label">OpEx</div><div class="metric-value">${formatRupiahCompact(es.opex)}</div><div class="metric-note">${escapeHtml(es.record_counts_opex_side)} included.</div></div>
            <div class="metric-card"><div class="metric-label">Net Result</div><div class="metric-value">${formatRupiahCompact(es.net_result)}</div><div class="metric-note">Revenue minus OpEx.</div></div>
            <div class="metric-card"><div class="metric-label">Gross Margin</div><div class="metric-value">${marginText}</div><div class="metric-note">Safe fallback when revenue is zero.</div></div>
            <div class="metric-card"><div class="metric-label">Report Confidence</div><div class="metric-value">${es.report_confidence}%</div><div class="metric-note">Based on receipt, due-date, renewal, and source coverage.</div></div>
        </div>
    </section>`;
}

function renderKeyTakeaways(pack) {
    if (!pack.key_takeaways.length) return '';
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Key Takeaways</h2>
                <p class="subtitle">Concrete report insights based on the selected period.</p>
            </div>
        </div>
        <div class="grid-4">
            ${pack.key_takeaways.map((t, i) => `
                <div class="takeaway">
                    <div class="takeaway-no">${i + 1}</div>
                    <h3>${escapeHtml(t.title)}</h3>
                    <p>${escapeHtml(t.body)}</p>
                </div>`).join('')}
        </div>
    </section>`;
}

function renderProfitLoss(pack) {
    const pl = pack.profit_loss;
    const chart = renderBarChart([
        { value: pl.revenue, label: 'Revenue' },
        { value: pl.opex, label: 'OpEx', color: 'orange' },
        { value: pl.netResult, label: 'Net Result', color: pl.netResult >= 0 ? 'green' : 'amber' }
    ], { yAxisLabel: 'Revenue, OpEx, Net Result in IDR' });
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <div class="kicker">FluxyOS Report Output</div>
                <h2>Profit &amp; Loss Summary</h2>
                <p class="subtitle">Period performance view generated from ledger records and selected report scope.</p>
            </div>
        </div>
        <div class="grid-2">
            <div class="card">
                <div class="card-title">IDR · ${escapeHtml(pack.report_identity.period_label)}</div>
                ${chart}
                <div class="formula-note" style="margin-top:42px;">${escapeHtml(pl.calculation_note)}</div>
            </div>
            <div class="card">
                <div class="card-title">P&amp;L Table</div>
                <table>
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th class="amount">Amount</th>
                            <th>Basis / Rule</th>
                            <th>Source records</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pl.rows.map(r => `
                            <tr>
                                <td>${escapeHtml(r.metric)}</td>
                                <td class="amount">${r.is_percent ? formatPercent(r.amount) : Number(r.amount).toLocaleString('id-ID')}</td>
                                <td>${escapeHtml(r.basis)}</td>
                                <td>${escapeHtml(r.source_records)}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                <div class="interpretation">
                    <div class="label">Interpretation</div>
                    <p>${escapeHtml(pl.interpretation)}</p>
                </div>
            </div>
        </div>
    </section>`;
}

function renderYtdProfitLoss(pack) {
    const summary = pack.ytd_summary || pack.profit_loss;
    const marginText = summary.revenue === 0 ? 'Not available' : formatPercent(summary.grossMargin);
    const partialNote = pack.ytd_summary?.isPartialCurrentMonth
        ? '<div class="formula-note" style="margin-top:16px;">Includes partial current month — full-month figure will increase as more data is recorded.</div>'
        : '';
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <div class="kicker">FluxyOS Report Output</div>
                <h2>Year-to-Date Profit &amp; Loss</h2>
                <p class="subtitle">${escapeHtml(pack.report_identity.period_label)} performance summarized from ledger records.</p>
            </div>
            <span class="pill blue">YTD</span>
        </div>
        <div class="grid-4">
            <div class="metric-card"><div class="metric-label">YTD Revenue</div><div class="metric-value">${formatRupiahCompact(summary.revenue)}</div><div class="metric-note">${pack.ytd_summary?.elapsedMonths ?? 1} month${pack.ytd_summary?.elapsedMonths === 1 ? '' : 's'} included.</div></div>
            <div class="metric-card"><div class="metric-label">YTD OpEx</div><div class="metric-value">${formatRupiahCompact(summary.opex)}</div><div class="metric-note">Includes expense, fee, tax, and pending payable.</div></div>
            <div class="metric-card"><div class="metric-label">YTD Net Result</div><div class="metric-value">${formatRupiahCompact(summary.netResult)}</div><div class="metric-note">Revenue minus OpEx.</div></div>
            <div class="metric-card"><div class="metric-label">YTD Gross Margin</div><div class="metric-value">${marginText}</div><div class="metric-note">Safe fallback when revenue is zero.</div></div>
        </div>
        ${pack.ytd_summary ? `
        <div class="grid-4" style="margin-top:18px;">
            <div class="metric-card"><div class="metric-label">Avg Monthly Revenue</div><div class="metric-value">${formatRupiahCompact(pack.ytd_summary.avgMonthlyRevenue)}</div><div class="metric-note">YTD revenue ÷ months elapsed.</div></div>
            <div class="metric-card"><div class="metric-label">Avg Monthly OpEx</div><div class="metric-value">${formatRupiahCompact(pack.ytd_summary.avgMonthlyOpex)}</div><div class="metric-note">YTD OpEx ÷ months elapsed.</div></div>
            <div class="metric-card"><div class="metric-label">Best Revenue Month</div><div class="metric-value" style="font-size:20px;">${escapeHtml(pack.ytd_summary.bestRevenueMonth?.monthLabel || '—')}</div><div class="metric-note">${pack.ytd_summary.bestRevenueMonth ? formatRupiahCompact(pack.ytd_summary.bestRevenueMonth.revenue) : 'No revenue recorded.'}</div></div>
            <div class="metric-card"><div class="metric-label">Worst Net Result Month</div><div class="metric-value" style="font-size:20px;">${escapeHtml(pack.ytd_summary.worstNetMonth?.monthLabel || '—')}</div><div class="metric-note">${pack.ytd_summary.worstNetMonth ? formatRupiahCompact(pack.ytd_summary.worstNetMonth.netResult) : 'Insufficient months.'}</div></div>
        </div>` : ''}
        ${partialNote}
    </section>`;
}

function renderMonthlyTrend(pack) {
    const trend = pack.monthly_trend || [];
    if (!trend.length) {
        return `
        <section class="section">
            <div class="report-top"><div><h2>Monthly Trend Breakdown</h2><p class="subtitle">Month-by-month revenue, OpEx, net result, and warnings.</p></div><span class="pill amber">Unavailable</span></div>
            <div class="card"><p style="margin:0;color:var(--muted);font-size:15px;">Not enough months in the selected range to render a trend.</p></div>
        </section>`;
    }
    const maxRevenue = Math.max(...trend.map(m => m.revenue), 1);
    const maxOpex = Math.max(...trend.map(m => m.opex), 1);
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Monthly Trend Breakdown</h2>
                <p class="subtitle">Month-by-month performance for ${escapeHtml(pack.report_identity.period_label)}.</p>
            </div>
        </div>
        <div class="card">
            <div class="card-title">Trend table</div>
            <table>
                <thead>
                    <tr>
                        <th>Month</th>
                        <th class="amount">Revenue</th>
                        <th class="amount">OpEx</th>
                        <th class="amount">Net Result</th>
                        <th class="amount">Gross Margin</th>
                        <th class="amount">Records</th>
                        <th class="amount">Warnings</th>
                    </tr>
                </thead>
                <tbody>
                    ${trend.map(m => `
                        <tr>
                            <td>${escapeHtml(m.monthLabel)}</td>
                            <td class="amount">${Number(m.revenue).toLocaleString('id-ID')}</td>
                            <td class="amount">${Number(m.opex).toLocaleString('id-ID')}</td>
                            <td class="amount">${Number(m.netResult).toLocaleString('id-ID')}</td>
                            <td class="amount">${m.revenue > 0 ? formatPercent(m.grossMargin) : '—'}</td>
                            <td class="amount">${m.recordCount}</td>
                            <td class="amount">${m.warnings}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div class="card" style="margin-top:18px;">
            <div class="card-title">Revenue vs OpEx by month</div>
            <div class="trend-bars">
                ${trend.map(m => `
                    <div class="trend-bar-row">
                        <div class="trend-bar-label">${escapeHtml(m.monthLabel)}</div>
                        <div class="trend-bar-tracks">
                            <div class="trend-bar-track"><div class="trend-bar-fill" style="width:${Math.round((m.revenue / maxRevenue) * 100)}%;"></div></div>
                            <div class="trend-bar-track"><div class="trend-bar-fill orange" style="width:${Math.round((m.opex / maxOpex) * 100)}%;"></div></div>
                        </div>
                        <div class="trend-bar-values"><span class="trend-rev">${formatRupiahCompact(m.revenue)}</span> <span class="trend-opex">${formatRupiahCompact(m.opex)}</span></div>
                    </div>`).join('')}
            </div>
            <div class="trend-bars-legend"><span><i class="legend-swatch"></i>Revenue</span> <span><i class="legend-swatch legend-swatch-orange"></i>OpEx</span></div>
        </div>
    </section>`;
}

function renderYoYProfitLoss(pack) {
    const yoy = pack.yoy_comparison;
    if (!yoy || yoy.status === 'unavailable') {
        return `
        <section class="section">
            <div class="report-top">
                <div>
                    <h2>YTD Profit &amp; Loss Comparison</h2>
                    <p class="subtitle">Compares the selected YTD range to the same range last year.</p>
                </div>
                <span class="pill amber">Unavailable</span>
            </div>
            <div class="card">
                <p style="margin:0;color:var(--muted);font-size:15px;">${escapeHtml(yoy?.limitations?.[0] || 'Previous-year records not found. FluxyOS cannot generate a year-on-year comparison until last-year data is added.')}</p>
            </div>
        </section>`;
    }
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>YTD Profit &amp; Loss Comparison</h2>
                <p class="subtitle">${escapeHtml(pack.report_scope?.current_period?.label)} vs ${escapeHtml(pack.report_scope?.comparison_period?.label)}.</p>
            </div>
            <span class="pill ${yoy.status === 'available' ? 'green' : 'amber'}">${yoy.status === 'available' ? 'Available' : 'Partial'}</span>
        </div>
        <div class="card">
            <div class="card-title">Year-on-year metrics</div>
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th class="amount">Current YTD</th>
                        <th class="amount">Previous YTD</th>
                        <th class="amount">Change</th>
                        <th class="amount">Change %</th>
                        <th>Interpretation</th>
                    </tr>
                </thead>
                <tbody>
                    ${yoy.rows.map(r => {
                        if (r.is_percent) {
                            const sign = r.change_points > 0 ? '+' : '';
                            return `<tr><td>${escapeHtml(r.metric)}</td><td class="amount">${formatPercent(r.current)}</td><td class="amount">${formatPercent(r.previous)}</td><td class="amount">—</td><td class="amount"><span class="pill ${r.change_points > 0 ? 'green' : (r.change_points < 0 ? 'amber' : 'gray')}">${sign}${(r.change_points || 0).toFixed(1)} pts</span></td><td>${escapeHtml(r.interpretation || '')}</td></tr>`;
                        }
                        const sign = r.change > 0 ? '+' : '';
                        const pctText = r.change_pct === null ? 'N/A' : `${r.change_pct >= 0 ? '+' : ''}${r.change_pct.toFixed(1)}%`;
                        const tone = r.change_pct === null ? 'gray' : (r.change_pct >= 0 ? 'green' : 'amber');
                        return `<tr>
                            <td>${escapeHtml(r.metric)}</td>
                            <td class="amount">${Number(r.current).toLocaleString('id-ID')}</td>
                            <td class="amount">${Number(r.previous).toLocaleString('id-ID')}</td>
                            <td class="amount">${sign}${Number(r.change).toLocaleString('id-ID')}</td>
                            <td class="amount"><span class="pill ${tone}">${pctText}</span></td>
                            <td>${escapeHtml(r.interpretation || '')}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            ${yoy.limitations?.length ? `<div class="interpretation"><div class="label">Limitations</div><p>${escapeHtml(yoy.limitations.join(' · '))}</p></div>` : ''}
        </div>
    </section>`;
}

function renderMonthlyTrendComparison(pack) {
    const comp = pack.monthly_trend_comparison;
    if (!comp || comp.status === 'unavailable' || !comp.months?.length) {
        return `
        <section class="section">
            <div class="report-top">
                <div>
                    <h2>Monthly Trend Comparison</h2>
                    <p class="subtitle">Month-by-month revenue and net result vs the same month last year.</p>
                </div>
                <span class="pill amber">Unavailable</span>
            </div>
            <div class="card">
                <p style="margin:0;color:var(--muted);font-size:15px;">${escapeHtml(comp?.limitations?.[0] || 'No previous-year monthly trend data found.')}</p>
            </div>
        </section>`;
    }
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Monthly Trend Comparison</h2>
                <p class="subtitle">Each month of ${escapeHtml(pack.report_scope?.current_period?.label)} aligned with the same month last year.</p>
            </div>
            <span class="pill ${comp.status === 'available' ? 'green' : 'amber'}">${comp.status === 'available' ? 'Available' : 'Partial'}</span>
        </div>
        <div class="card">
            <div class="card-title">Side-by-side by month</div>
            <table>
                <thead>
                    <tr>
                        <th>Month</th>
                        <th class="amount">Current Revenue</th>
                        <th class="amount">Previous Revenue</th>
                        <th class="amount">Δ Revenue</th>
                        <th class="amount">Current Net</th>
                        <th class="amount">Previous Net</th>
                    </tr>
                </thead>
                <tbody>
                    ${comp.months.map(m => {
                        const c = m.current || {};
                        const p = m.previous || {};
                        const delta = m.revenue_change_pct;
                        const deltaText = delta === null || delta === undefined ? 'N/A' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
                        const tone = delta === null || delta === undefined ? 'gray' : (delta >= 0 ? 'green' : 'amber');
                        return `<tr>
                            <td>${escapeHtml(m.currentLabel || m.previousLabel || '—')}</td>
                            <td class="amount">${c.revenue != null ? Number(c.revenue).toLocaleString('id-ID') : '—'}</td>
                            <td class="amount">${p.revenue != null ? Number(p.revenue).toLocaleString('id-ID') : '—'}</td>
                            <td class="amount"><span class="pill ${tone}">${deltaText}</span></td>
                            <td class="amount">${c.netResult != null ? Number(c.netResult).toLocaleString('id-ID') : '—'}</td>
                            <td class="amount">${p.netResult != null ? Number(p.netResult).toLocaleString('id-ID') : '—'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            ${comp.limitations?.length ? `<div class="interpretation"><div class="label">Limitations</div><p>${escapeHtml(comp.limitations.join(' · '))}</p></div>` : ''}
        </div>
    </section>`;
}

function renderPeriodComparison(pack) {
    const pc = pack.period_comparison;
    if (pc.status === 'unavailable') {
        return `
        <section class="section">
            <div class="report-top">
                <div>
                    <h2>Period Comparison</h2>
                    <p class="subtitle">Compares the selected period to the previous equivalent period.</p>
                </div>
                <span class="pill amber">Unavailable</span>
            </div>
            <div class="card">
                <div class="card-title">Status</div>
                <p style="margin:0;color:var(--muted);font-size:15px;line-height:1.5;">${escapeHtml(pc.limitations[0] || 'No previous period records available.')} Period Comparison will populate automatically once the previous period contains data.</p>
            </div>
        </section>`;
    }
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Period Comparison</h2>
                <p class="subtitle">Compares the selected period to the previous equivalent period using real FluxyOS records.</p>
            </div>
            <span class="pill green">Available</span>
        </div>
        <div class="grid-2">
            <div class="card">
                <div class="card-title">Side-by-side</div>
                <table>
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th class="amount">Previous</th>
                            <th class="amount">Current</th>
                            <th>Change</th>
                            <th>Read</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pc.rows.map(r => {
                            let changeCell;
                            if (r.is_percent) {
                                const sign = r.change_points > 0 ? '+' : '';
                                changeCell = `<span class="pill ${r.change_points > 0 ? 'green' : (r.change_points < 0 ? 'amber' : 'gray')}">${sign}${(r.change_points || 0).toFixed(1)} pts</span>`;
                            } else if (r.change === null) {
                                changeCell = `<span class="pill gray">n/a</span>`;
                            } else {
                                const sign = r.change > 0 ? '+' : '';
                                const tone = r.inverse ? (r.change > 0 ? 'amber' : 'green') : (r.change > 0 ? 'green' : (r.change < 0 ? 'amber' : 'gray'));
                                changeCell = `<span class="pill ${tone}">${sign}${(r.change || 0).toFixed(1)}%</span>`;
                            }
                            const prev = r.is_percent ? formatPercent(r.previous) : Number(r.previous || 0).toLocaleString('id-ID');
                            const curr = r.is_percent ? formatPercent(r.current) : Number(r.current || 0).toLocaleString('id-ID');
                            return `<tr><td>${escapeHtml(r.metric)}</td><td class="amount">${prev}</td><td class="amount">${curr}</td><td>${changeCell}</td><td>${escapeHtml(r.interpretation || '')}</td></tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <div class="card">
                <div class="card-title">Previous vs current</div>
                ${renderPeriodComparisonChart(pc.rows)}
                <div class="interpretation" style="margin-top:18px;">
                    <div class="label">How to read</div>
                    <p>Bars scale to the larger of the two periods, so you can see the actual magnitude difference — not just the percentage change.</p>
                </div>
            </div>
        </div>
    </section>`;
}

function renderPredictability(pack) {
    const fp = pack.finance_predictability;
    if (fp.status === 'unavailable') {
        return `
        <section class="section">
            <div class="report-top">
                <div>
                    <h2>Finance Predictability Snapshot</h2>
                    <p class="subtitle">Forward-looking view based on the current run rate. Not a committed forecast.</p>
                </div>
                <span class="pill amber">Unavailable</span>
            </div>
            <div class="card">
                <p style="margin:0;color:var(--muted);font-size:15px;line-height:1.5;">${escapeHtml(fp.limitations.join(' · ') || 'Current period has no revenue — run-rate projections are not meaningful.')}</p>
            </div>
        </section>`;
    }
    const arrLabel = fp.arr.status === 'unavailable' ? 'Unavailable' : (fp.arr.status === 'partial' ? formatRupiahCompact(fp.arr.value) + ' (partial)' : formatRupiahCompact(fp.arr.value));
    const max = Math.max(fp.year_end_revenue_outlook.conservative, fp.year_end_revenue_outlook.current_run_rate, fp.year_end_revenue_outlook.growth_case, 1);
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Finance Predictability Snapshot</h2>
                <p class="subtitle">Forward-looking view based on current run rate, recurring revenue, and selected assumptions. Not an audited forecast.</p>
            </div>
            <span class="pill blue">Run-rate view</span>
        </div>
        <div class="grid-4">
            <div class="card">
                <div class="card-title">Monthly revenue run rate</div>
                <div style="font-family:var(--mono);font-size:26px;font-weight:800;letter-spacing:-.04em;">${formatRupiahCompact(fp.monthly_revenue_run_rate)}</div>
                <p style="margin-top:10px;color:var(--muted);font-size:12px;line-height:1.45;">Selected-period revenue used as the current monthly basis.</p>
            </div>
            <div class="card">
                <div class="card-title">Annualized run rate</div>
                <div style="font-family:var(--mono);font-size:26px;font-weight:800;letter-spacing:-.04em;">${formatRupiahCompact(fp.annualized_revenue_run_rate)}</div>
                <p style="margin-top:10px;color:var(--muted);font-size:12px;line-height:1.45;">Current monthly revenue × 12. Simple run-rate projection, not a committed forecast.</p>
            </div>
            <div class="card">
                <div class="card-title">Estimated ARR</div>
                <div style="font-family:var(--mono);font-size:22px;font-weight:800;letter-spacing:-.04em;">${arrLabel}</div>
                <p style="margin-top:10px;color:var(--muted);font-size:12px;line-height:1.45;">${escapeHtml(fp.arr.limitation || 'Recurring revenue only. Excludes one-time income.')}</p>
            </div>
            <div class="card">
                <div class="card-title">Year-end net result outlook</div>
                <div style="font-family:var(--mono);font-size:22px;font-weight:800;letter-spacing:-.04em;">${formatRupiahCompact(fp.year_end_net_result_outlook.low)} – ${formatRupiahCompact(fp.year_end_net_result_outlook.high)}</div>
                <p style="margin-top:10px;color:var(--muted);font-size:12px;line-height:1.45;">Scenario range using current revenue and OpEx pattern.</p>
            </div>
        </div>
        <div class="grid-2" style="margin-top:22px;">
            <div class="card">
                <div class="card-title">Year-end scenario range</div>
                <div class="scenario-stack">
                    <div class="scenario-row">
                        <strong>Conservative</strong>
                        <div class="scenario-track"><div class="scenario-fill amber" style="width:${Math.round(fp.year_end_revenue_outlook.conservative / max * 100)}%"></div></div>
                        <div class="scenario-amount">${formatRupiahCompact(fp.year_end_revenue_outlook.conservative)} revenue</div>
                    </div>
                    <div class="scenario-row">
                        <strong>Current run rate</strong>
                        <div class="scenario-track"><div class="scenario-fill orange" style="width:${Math.round(fp.year_end_revenue_outlook.current_run_rate / max * 100)}%"></div></div>
                        <div class="scenario-amount">${formatRupiahCompact(fp.year_end_revenue_outlook.current_run_rate)} revenue</div>
                    </div>
                    <div class="scenario-row">
                        <strong>Growth case</strong>
                        <div class="scenario-track"><div class="scenario-fill green" style="width:${Math.round(fp.year_end_revenue_outlook.growth_case / max * 100)}%"></div></div>
                        <div class="scenario-amount">${formatRupiahCompact(fp.year_end_revenue_outlook.growth_case)} revenue</div>
                    </div>
                </div>
                <div class="predictability-note">Planning view, not guaranteed revenue. Not an audited forecast.</div>
            </div>
            <div class="card">
                <div class="card-title">Projection Assumptions</div>
                <table>
                    <thead><tr><th>Metric</th><th>Basis</th><th>Limitation</th></tr></thead>
                    <tbody>
                        ${fp.assumptions.map(a => `<tr><td>${escapeHtml(a.metric)}</td><td>${escapeHtml(a.basis)}</td><td>${escapeHtml(a.limitation)}</td></tr>`).join('')}
                    </tbody>
                </table>
                ${fp.limitations.length ? `<div class="interpretation"><div class="label">Limitations</div><p>${escapeHtml(fp.limitations.join(' · '))}</p></div>` : ''}
            </div>
        </div>
    </section>`;
}

function renderExpenseBreakdown(pack) {
    const eb = pack.expense_breakdown;
    if (eb.categories.length === 0) {
        return `
        <section class="section">
            <div class="report-top"><div><h2>Expense Breakdown</h2><p class="subtitle">Spend grouped by category and vendor.</p></div></div>
            <div class="card"><p style="margin:0;color:var(--muted);font-size:15px;">No expense records in the selected period.</p></div>
        </section>`;
    }
    const chart = renderBarChart(eb.categories.slice(0, 4).map(c => ({
        value: c.amount,
        label: c.category,
        sublabel: `${c.pct}%`,
        color: 'orange'
    })), { yAxisLabel: 'Spend by category in IDR' });
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Expense Breakdown</h2>
                <p class="subtitle">Spend grouped by category and vendor so the user can see where money went and what should be reviewed first.</p>
            </div>
        </div>
        <div class="grid-2">
            <div class="card">
                <div class="card-title">Expense by category</div>
                ${chart}
            </div>
            <div class="card">
                <div class="card-title">Top vendors</div>
                <table>
                    <thead>
                        <tr>
                            <th>Vendor</th>
                            <th class="amount">Amount</th>
                            <th>Category</th>
                            <th>Records</th>
                            <th>Missing receipts</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${eb.top_vendors.map(v => `
                            <tr>
                                <td>${escapeHtml(v.vendor)}</td>
                                <td class="amount">${Number(v.amount).toLocaleString('id-ID')}</td>
                                <td>${escapeHtml(v.category)}</td>
                                <td>${v.count}</td>
                                <td>${v.missing_receipts || 0}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
                <div class="interpretation">
                    <div class="label">Interpretation</div>
                    <p>${escapeHtml(eb.interpretation)}</p>
                </div>
                <div class="csv-columns">
                    <div class="label">CSV output columns</div>
                    <p>${escapeHtml(eb.csv_columns.join(', '))}, Missing Receipt Count</p>
                </div>
            </div>
        </div>
    </section>`;
}

function renderBillsSubscriptions(pack) {
    const bs = pack.bills_subscriptions;
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Bills &amp; Subscription Commitments</h2>
                <p class="subtitle">Upcoming obligations from bills and active subscriptions, shown as a cash pressure proxy — never a cash runway.</p>
            </div>
        </div>
        <div class="grid-4">
            <div class="metric-card"><div class="metric-label">Upcoming bills</div><div class="metric-value">${bs.upcoming_bills_count}</div><div class="metric-note">Bills with future due dates.</div></div>
            <div class="metric-card"><div class="metric-label">Overdue bills</div><div class="metric-value">${bs.overdue_bills_count}</div><div class="metric-note">Past due, still open. Review before handoff.</div></div>
            <div class="metric-card"><div class="metric-label">Active subscriptions</div><div class="metric-value">${bs.active_subscriptions_count}</div><div class="metric-note">Recurring commitments in scope.</div></div>
            <div class="metric-card"><div class="metric-label">Pending payable</div><div class="metric-value">${formatRupiahCompact(bs.pending_payable_total)}</div><div class="metric-note">Proxy only, not bank balance.</div></div>
        </div>
        <div class="grid-2" style="margin-top:22px;">
            <div class="card">
                <div class="card-title">Obligation window</div>
                <table>
                    <thead><tr><th>Window</th><th class="amount">Amount</th><th>Meaning</th></tr></thead>
                    <tbody>
                        ${bs.obligation_windows.map(w => `<tr><td>${escapeHtml(w.window)}</td><td class="amount">${Number(w.amount).toLocaleString('id-ID')}</td><td>${escapeHtml(w.meaning)}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>
            <div class="card">
                <div class="card-title">Interpretation</div>
                <p style="margin:0;color:var(--muted);font-size:16px;line-height:1.4;">${escapeHtml(bs.interpretation)}</p>
                <div class="csv-columns">
                    <div class="label">CSV output columns</div>
                    <p>${escapeHtml(bs.csv_columns.join(', '))}</p>
                </div>
            </div>
        </div>
    </section>`;
}

function renderReportConfidence(pack) {
    const rc = pack.report_confidence_method;
    return `
    <section class="section">
        <div class="report-top">
            <div>
                <h2>Report Confidence Method</h2>
                <p class="subtitle">Defines what the score means, so the report does not imply accounting assurance.</p>
            </div>
            <span class="pill ${rc.score >= 90 ? 'green' : (rc.score >= 70 ? 'orange' : 'amber')}">${escapeHtml(rc.label)}</span>
        </div>
        <div class="grid-2">
            <div class="confidence-score">
                <div>
                    <div class="small-label" style="color:#9a3412;">Confidence score</div>
                    <div class="big">${rc.score}%</div>
                    <p>${escapeHtml(rc.explanation)}</p>
                </div>
                <div class="formula-note" style="margin-top:18px;">${escapeHtml(rc.formula_note)}</div>
            </div>
            <div class="card">
                <div class="card-title">Confidence breakdown</div>
                <table>
                    <thead><tr><th>Area</th><th>Status</th><th>Finding</th><th>Read</th></tr></thead>
                    <tbody>
                        ${rc.breakdown.map(b => {
                            const tone = b.read === 'Good' ? 'green' : (b.read === 'Caution' ? 'amber' : (b.read === 'Limitation' ? 'blue' : (b.read === 'No data' ? 'gray' : 'amber')));
                            const value = typeof b.value === 'number' ? `${b.value}%` : 'Partial';
                            return `<tr><td>${escapeHtml(b.area)}</td><td>${escapeHtml(value)}</td><td>${escapeHtml(b.finding)}</td><td><span class="pill ${tone}">${escapeHtml(b.read)}</span></td></tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </section>`;
}

function renderDataQuality(pack) {
    const dq = pack.data_quality;
    if (!dq.warnings.length) {
        return `
        <section class="section">
            <div class="report-top">
                <div><h2>Data Quality &amp; Cleanup</h2><p class="subtitle">The trust layer: what data is incomplete and what should be fixed before external handoff.</p></div>
                <span class="pill green">Clean</span>
            </div>
            <div class="card">
                <div class="card-title">Data quality warnings</div>
                <p style="margin:0;color:var(--muted);font-size:15px;">${escapeHtml(dq.recommended_cleanup)}</p>
            </div>
        </section>`;
    }
    return `
    <section class="section">
        <div class="report-top">
            <div><h2>Data Quality &amp; Cleanup</h2><p class="subtitle">The trust layer: what data is incomplete and what should be fixed before external handoff.</p></div>
        </div>
        <div class="card">
            <div class="card-title">Data quality warnings</div>
            <table>
                <thead><tr><th>Issue</th><th>Count</th><th>Severity</th><th>Impact</th><th>Recommended action</th></tr></thead>
                <tbody>
                    ${dq.warnings.map(w => {
                        const tone = w.severity === 'High' ? 'amber' : 'blue';
                        return `<tr><td>${escapeHtml(w.issue)}</td><td>${w.count}</td><td><span class="pill ${tone}">${escapeHtml(w.severity)}</span></td><td>${escapeHtml(w.impact)}</td><td>${escapeHtml(w.recommended_action)}</td></tr>`;
                    }).join('')}
                </tbody>
            </table>
            <div class="interpretation">
                <div class="label">Recommended cleanup</div>
                <p>${escapeHtml(dq.recommended_cleanup)}</p>
            </div>
        </div>
    </section>`;
}

function renderExportManifest(pack) {
    const em = pack.export_manifest;
    return `
    <section class="section manifest-final">
        <div class="report-top">
            <div>
                <div class="kicker">Export Manifest</div>
                <h2>PDF summary on print. CSV source files available.</h2>
                <p class="subtitle">What data supports the report, what was excluded, and what source files exist for row-level review.</p>
            </div>
            <span class="pill">Confirm export back on Reports</span>
        </div>
        <div class="grid-4">
            <div class="card">
                <div class="card-title">Included sources</div>
                <ul class="manifest-list">${em.included_sources.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
            </div>
            <div class="card">
                <div class="card-title">Excluded / limited</div>
                <ul class="manifest-list">${em.excluded_or_limited.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
            </div>
            <div class="card">
                <div class="card-title">Source files</div>
                <ul class="manifest-list">${em.source_files.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
            </div>
            <div class="card">
                <div class="card-title">Audit</div>
                <ul class="manifest-list">
                    <li>action: export.create</li>
                    <li>target: report_exports</li>
                    <li>generated by: ${escapeHtml(em.audit.generated_by || '—')}</li>
                    <li>logged on: Confirm Export in the Reports drawer</li>
                </ul>
            </div>
        </div>
        <div class="footer-manifest">
            <span>Generated from FluxyOS user-scoped records. Confirm Export writes report_exports metadata plus an export.create audit log. Full row-level review should use the CSV source files.</span>
            <code>Management report · not audited financial statements</code>
        </div>
    </section>`;
}

// ---------- Toolbar actions ----------

function handlePrint() {
    window.print();
    // afterprint may fire on dialog close — do NOT treat as proof of save.
    // We intentionally do not toast a "PDF downloaded" message here.
}

function handleDownloadCsv() {
    if (!state.pack || !state.sourceData) return;
    const files = buildCsvBundle(state.pack, state.sourceData);
    files.forEach((f, i) => {
        setTimeout(() => downloadFile(f.filename, f.content), i * 250);
    });
}

function bindEvents() {
    el('empty-back-btn')?.addEventListener('click', () => { window.location.href = '/reports'; });
    el('print-btn')?.addEventListener('click', handlePrint);
    el('download-csv-btn')?.addEventListener('click', handleDownloadCsv);
}

// ---------- Boot ----------

bindEvents();

let authCheckTimeout = setTimeout(() => {
    window.location.replace('/login');
}, 2000);

onAuthStateChanged(auth, (user) => {
    if (user) {
        clearTimeout(authCheckTimeout);
        state.user = user;
        const payload = readPreviewPayload();
        if (!payload) {
            showEmptyState();
            return;
        }
        state.pack = payload.pack;
        state.sourceData = payload.sourceData || { transactions: [], bills: [], subscriptions: [] };
        // Handoff payload is one-shot — clear it so a hard refresh shows
        // the empty state instead of stale data from a previous period.
        clearPreviewStorage();
        const period = state.pack.report_identity;
        el('toolbar-period').textContent = `${period.period_label} · Generated ${new Date(period.generated_at).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        showReport();
    } else {
        window.location.replace('/login');
    }
});
