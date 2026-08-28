// FluxyOS — Inventory bulk import panel
//
// Mounts INTO the New item drawer as its second tab, the way CSV bulk upload
// mounts into the Add Transaction drawer. One drawer, a segmented control, one
// shared footer button — the pattern documented in PROJECT_BACKGROUND.md §5 and
// implemented in shared-dashboard.js. Inventory used to answer the same question
// with a second toolbar button and a second drawer; two answers in one product
// means whoever learned the Ledger never finds this.
//
// The visual language is deliberately the Ledger's, not its own: the dashed
// dropzone, the preview card with its eyebrow / filename / summary / status
// badge, the column-mapping chips, the 10px uppercase table head, and the amber
// note. Where this panel needs something the Ledger has no equivalent for
// (column remapping, the opening-balance statement) it is built out of the same
// parts rather than inventing a third vocabulary.
//
// This file is the SURFACE only. Everything it decides is decided in two places
// it does not own:
//   • `inventory-import.js` — parse, map, validate. Pure, separately tested.
//   • `db-service.importInventoryItems` — the single atomic write.
//
// Three rules it exists to keep:
//
//   1. NOTHING IS WRITTEN BEFORE CONFIRM. The file is read in the browser and
//      never uploaded. Leaving costs nothing.
//   2. WHAT WE WILL NOT IMPORT IS SHOWN BEFORE, NOT AFTER — unmapped columns,
//      unresolvable account codes, tracking types we do not enforce, rows that
//      already exist. Finding out afterwards means re-doing a migration.
//   3. EVERY AMOUNT RENDERS THROUGH THE MONEY SEAM. `10.000` is ten thousand or
//      ten depending on a convention the file does not state — 1000x, stored
//      clean, nothing raised. The preview shows `formatBase` output, so the
//      figure approved is the figure stored.

import {
    analyzeImport,
    buildTemplateCsv,
    unmappedColumnReport,
    templateColumn,
    TEMPLATE_COLUMNS,
    MAX_IMPORT_ROWS
} from './inventory-import.js';

const XLSX_URL = '/assets/vendor/xlsx.mini.min.js';
const SPREADSHEET_EXT = /\.(xlsx|xlsm|xlsb|xls)$/i;
const CSV_EXT = /\.(csv|txt)$/i;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS = 5;

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
}

function money(minor) {
    try { return window.FluxyMoney.formatBase(Number(minor) || 0); }
    catch (_) { return String(minor); }
}

function count(n) {
    try { return window.FluxyMoney.baseNumber(Number(n) || 0); }
    catch (_) { return String(n); }
}

function currencyName() {
    try { return window.FluxyMoney.baseCurrencyName(); }
    catch (_) { return 'your workspace currency'; }
}

function todayKey(d = new Date()) {
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0')].join('-');
}

// SheetJS is 248 KB and only an Excel upload needs it, so it is fetched on
// demand and cached. A CSV import — the common path — never pays for it.
let xlsxPromise = null;
function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
        xlsxPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = XLSX_URL;
            script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX failed to initialise')));
            script.onerror = () => { xlsxPromise = null; reject(new Error('Could not load the spreadsheet reader.')); };
            document.head.appendChild(script);
        });
    }
    return xlsxPromise;
}

function pickSheet(wb) {
    const named = wb.SheetNames.find((n) => /invent|import|produk|product|item|barang/i.test(n));
    return named || wb.SheetNames[0];
}

/*
 * A picked file → rows of cells.
 *
 * CSV goes through `window.FluxyCsv.parse` — the SAME parser the bulk
 * transaction importer uses. Two CSV parsers in one app disagree eventually, and
 * they disagree on a comma inside a quoted product name.
 *
 * Excel goes through SheetJS with `raw: true`, so a cell arrives as the text the
 * author typed rather than a value the reader already interpreted. That matters
 * for one reason: Excel would otherwise hand us a Date for `12/12/2024` using
 * ITS locale's day/month order, and an opening balance booked into the wrong
 * month is not something anybody notices.
 */
async function readFile(file) {
    const name = String(file.name || '');
    if (file.size > MAX_FILE_BYTES) {
        throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB and the limit is 5 MB. One import is capped at ${MAX_IMPORT_ROWS} rows anyway — split it.`);
    }
    if (CSV_EXT.test(name)) {
        const text = await file.text();
        return { rows: window.FluxyCsv.parse(text), sheetName: null, sheetCount: 1 };
    }
    if (SPREADSHEET_EXT.test(name)) {
        const XLSX = await loadXlsx();
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array', raw: true, cellDates: false });
        const sheetName = pickSheet(wb);
        const sheet = wb.Sheets[sheetName];
        if (!sheet) throw new Error('That workbook has no readable sheet.');
        return {
            rows: XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' }),
            sheetName,
            sheetCount: wb.SheetNames.length
        };
    }
    throw new Error('Upload a .csv or .xlsx file. Other formats are not read.');
}

/*
 * Warnings are grouped by message, never listed one per row.
 *
 * A 300-row file with an unrecognised cost account produces 300 identical
 * sentences. Nobody reads the 300th, which means nobody reads the first either,
 * and the one that mattered is buried in the middle. Grouped, the same file says
 * "297 rows: cost account not in your chart" once, with the rows named.
 */
function groupIssues(rows, field) {
    const groups = new Map();
    rows.forEach((r) => {
        (r[field] || []).forEach((issue) => {
            // The account code and the row's own values vary per row; the shape
            // of the complaint does not. Group on the shape.
            const key = issue.message.replace(/"[^"]*"/g, '"…"');
            if (!groups.has(key)) groups.set(key, { message: issue.message, lines: [], column: issue.column });
            groups.get(key).lines.push(r.line);
        });
    });
    return Array.from(groups.values()).sort((a, b) => b.lines.length - a.lines.length);
}

// The Ledger's amber note, reused verbatim so the two importers raise concerns
// in one voice.
function noteHTML(groups, tone) {
    if (!groups.length) return '';
    const palette = tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-amber-200 bg-amber-50 text-amber-800';
    return `<div class="mt-3 rounded-lg border ${palette} px-3 py-2 space-y-1.5">` + groups.map((g) => {
        const shown = g.lines.slice(0, 6).join(', ');
        const more = g.lines.length > 6 ? ` +${g.lines.length - 6}` : '';
        const col = g.column && templateColumn(g.column)
            ? `<span class="font-bold">${esc(templateColumn(g.column).header.replace(/^#/, ''))}</span> · ` : '';
        return `<p class="text-[11px] leading-relaxed">${col}<span>${esc(g.message)}</span> <span class="whitespace-nowrap opacity-70">(row ${esc(shown)}${esc(more)})</span></p>`;
    }).join('') + '</div>';
}

/*
 * A mapping chip.
 *
 * The Ledger renders these as `Label: HeaderInFile` because its labels and its
 * CSV headers genuinely differ ("Description" ← `vendor_name`). Here they are
 * usually the same word, and `Product Name: Product Name` is noise that pushed
 * the real information — the one column we could NOT place — into the sixth row
 * of a wrapping list. So the header is named only when it differs from what we
 * call the field, which is exactly when knowing it is worth anything.
 */
function chip(label, value, ok) {
    const tone = ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500';
    const same = ok && String(value).trim().toLowerCase() === String(label).trim().toLowerCase();
    const text = ok
        ? (same ? esc(label) : `${esc(label)}: ${esc(value)}`)
        : `${esc(label)}: ${esc(value)}`;
    return `<span class="rounded-full border ${tone} px-2.5 py-1 text-[11px] font-bold">${text}</span>`;
}

export function mountInventoryImport(contentEl, { ds, user, onStateChange, onImported } = {}) {
    if (!contentEl || !ds || !user) throw new Error('mountInventoryImport needs (contentEl, { ds, user })');

    const state = {
        fileName: '',
        rawRows: null,
        sheetName: null,
        sheetCount: 1,
        amountMode: 'auto',
        columnOverrides: {},
        result: null,
        existingItems: [],
        chartCodes: new Set(),
        closedPeriods: new Set(),
        dimensions: [],
        openingDimensionId: '',
        busy: false,
        error: ''
    };

    contentEl.innerHTML = shellHTML();

    const el = (id) => contentEl.querySelector(`#${id}`);

    function emit() {
        if (typeof onStateChange !== 'function') return;
        const ready = !!(state.result && state.result.ok && state.result.summary.ready > 0);
        onStateChange({
            ready,
            busy: state.busy,
            count: ready ? state.result.summary.ready : 0
        });
    }

    // ── Shell ───────────────────────────────────────────────────────────────
    // The dropzone is the Ledger's, down to the dashed 2xl wrapper and the 11px
    // icon tile. The template download lives inside it because it answers the
    // question the dropzone asks ("what am I supposed to drop?") and a separate
    // card for one link is the sort of thing that makes a form feel long.
    function shellHTML() {
        return `
        <div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5" id="inv-import-dropzone">
            <label for="inv-import-file" class="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-7 text-center transition-all duration-200 hover:border-[#EA580C] hover:bg-gray-50">
                <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-[#EA580C]">
                    <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
                </span>
                <span id="inv-import-file-label" class="max-w-full truncate text-[13px] font-bold text-gray-900">Choose or drop a CSV or Excel file</span>
                <span class="mt-1 text-[12px] text-gray-500">Read in your browser. Nothing is saved until you confirm.</span>
            </label>
            <input type="file" id="inv-import-file" accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="sr-only">
            <div class="mt-3 flex items-center justify-between gap-3">
                <span class="text-[11px] text-gray-500">${esc(TEMPLATE_COLUMNS.length)} columns · up to ${esc(count(MAX_IMPORT_ROWS))} rows</span>
                <button type="button" id="inv-import-template" class="text-[12px] font-bold text-[#EA580C] hover:underline">Download the template</button>
            </div>
            <div id="inv-import-feedback" class="hidden mt-3 text-[12px] font-medium"></div>
        </div>

        <div id="inv-import-preview" class="hidden"></div>`;
    }

    // ── Preview ─────────────────────────────────────────────────────────────
    function renderPreview() {
        const host = el('inv-import-preview');
        if (!state.result) { host.classList.add('hidden'); host.innerHTML = ''; return; }
        host.classList.remove('hidden');

        const r = state.result;
        const needsMapping = !!r.needsMapping;
        const s = r.summary || {};
        const errorGroups = needsMapping ? [] : groupIssues(r.rows.filter((x) => x.status === 'error'), 'errors');
        const warnGroups = needsMapping ? [] : groupIssues(r.rows, 'warnings');
        const unmapped = unmappedColumnReport(r.columns);

        // Badge mirrors the Ledger's: emerald when the file is clean, amber when
        // something was set aside, and it names the count rather than a mood.
        let badge = { text: 'Ready', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
        if (needsMapping) badge = { text: 'Needs mapping', tone: 'border-amber-200 bg-amber-50 text-amber-700' };
        else if (s.errors) badge = { text: `${s.errors} cannot import`, tone: 'border-amber-200 bg-amber-50 text-amber-700' };
        else if (s.skipped) badge = { text: `${s.skipped} skipped`, tone: 'border-amber-200 bg-amber-50 text-amber-700' };

        const summaryLine = needsMapping
            ? r.fatal.message
            : `${count(s.ready)} of ${count(s.total)} row${s.total === 1 ? '' : 's'} will be imported.`
              + (s.total > PREVIEW_ROWS ? ` Showing first ${PREVIEW_ROWS}.` : '');

        host.innerHTML = `
        <div class="rounded-xl border border-gray-200 bg-white p-4">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-[12px] font-bold uppercase tracking-wider text-gray-400">Inventory import preview</p>
                    <p class="mt-1 truncate text-[13px] font-bold text-gray-900">${esc(state.fileName)}</p>
                    <p class="mt-1 text-[12px] text-gray-500">${esc(summaryLine)}</p>
                </div>
                <span class="shrink-0 rounded-full border ${badge.tone} px-2.5 py-1 text-[11px] font-bold">${esc(badge.text)}</span>
            </div>

            ${mappingChipsHTML(r)}
            ${state.sheetCount > 1 ? `<p class="mt-2 text-[11px] text-gray-500">Read the <strong>${esc(state.sheetName)}</strong> sheet of ${state.sheetCount}.</p>` : ''}
            ${r.skippedMetaRows ? `<p class="mt-2 text-[11px] text-gray-500">Skipped ${r.skippedMetaRows} guidance row${r.skippedMetaRows === 1 ? '' : 's'} from the template.</p>` : ''}

            ${noteHTML(errorGroups, 'error')}
            ${noteHTML(warnGroups, 'warn')}
            ${unmapped.length ? `<div class="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p class="text-[11px] font-bold text-gray-600">Columns we will not import (${unmapped.length})</p>
                ${unmapped.map((u) => `<p class="text-[11px] text-gray-500">${esc(u.header)} — ${esc(u.reason)}</p>`).join('')}
            </div>` : ''}

            ${needsMapping || s.total ? tableHTML(r, needsMapping) : ''}
        </div>

        ${mappingCardHTML(r)}
        ${optionsCardHTML(r)}`;
    }

    // Every column FluxyOS reads, and which header in the file it matched — the
    // Ledger's mapping chips, which happen to be exactly the report this
    // importer needs. Only the columns that carry meaning are chipped; chipping
    // all 22 would bury the two that are required.
    function mappingChipsHTML(r) {
        const KEYS = [
            ['name', 'Name'], ['sku', 'SKU'], ['unit', 'Unit'],
            ['track_stock', 'Track'], ['sell_price', 'Sell price'], ['opening_qty', 'Opening stock']
        ];
        const headers = r.headerCells || [];
        return '<div class="mt-3 flex flex-wrap gap-2">' + KEYS.map(([k, short]) => {
            const idx = r.columns.byKey[k];
            const found = idx !== undefined;
            // The reference template prefixes its opening-balance headers with
            // `#`. Left on, the chip compares "#Opening Balance Stock" against
            // "Opening Balance Stock", decides they differ, and prints both.
            const header = found ? (String(headers[idx] || '').trim().replace(/^#/, '') || `Column ${idx + 1}`) : 'Not in file';
            // A template header matches its own short name closely enough that
            // printing both twice is the redundancy the chip helper strips.
            const templateHeader = templateColumn(k).header.replace(/^#/, '');
            const value = (found && header.toLowerCase() === templateHeader.toLowerCase()) ? short : header;
            return chip(short, value, found);
        }).join('') + '</div>';
    }

    function tableHTML(r, needsMapping) {
        if (needsMapping) return '';
        // Rows that cannot import come first: they are the ones needing a
        // decision, exactly as the Ledger floats its flagged duplicates.
        const ordered = [...r.rows.filter((x) => x.status === 'error'), ...r.rows.filter((x) => x.status !== 'error')];
        const rows = ordered.slice(0, PREVIEW_ROWS);
        if (!rows.length) return '';
        return `<div class="mt-3 overflow-x-auto rounded-lg border border-gray-200">
            <table class="w-full min-w-[640px] text-left">
                <thead class="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <tr><th class="px-3 py-2">Row</th><th class="px-3 py-2">Item</th><th class="px-3 py-2">Unit</th>
                        <th class="px-3 py-2">Sell price</th>
                        <th class="px-3 py-2">Opening stock</th><th class="px-3 py-2">Status</th></tr>
                </thead>
                <tbody class="divide-y divide-gray-100 text-[12px]">
                ${rows.map((row) => {
                    // Sell price belongs on screen for the same reason opening
                    // stock does: it is money about to be stored, and the point
                    // of a preview is that the figure approved is the figure
                    // written. Dropping it to save a column made the money seam
                    // unverifiable for every item that is sold.
                    const bad = row.status === 'error';
                    const opening = row.opening
                        ? `${esc(count(row.opening.quantity))} ${esc(row.draft.base_unit)} · ${esc(money(row.opening.amount_minor))}`
                        // Blank is not zero: an item with no opening balance says so.
                        : '<span class="text-gray-400">No opening stock</span>';
                    const sell = row.draft.sales_price == null
                        ? '<span class="text-gray-400">Not sold</span>'
                        : esc(money(row.draft.sales_price));
                    return `<tr${bad ? ' class="bg-amber-50/40"' : ''}>
                        <td class="px-3 py-2 tabular-nums text-gray-400">${row.line}</td>
                        <td class="px-3 py-2 font-semibold text-gray-900">${esc(row.draft.name || '—')}
                            ${row.draft.sku ? `<span class="block text-[11px] font-normal text-gray-500">${esc(row.draft.sku)}</span>` : ''}</td>
                        <td class="px-3 py-2 text-gray-600">${esc(row.draft.base_unit || '—')}</td>
                        <td class="px-3 py-2 tabular-nums text-gray-600">${sell}</td>
                        <td class="px-3 py-2 text-gray-600">${opening}</td>
                        <td class="px-3 py-2">${bad
                            ? '<span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Cannot import</span>'
                            : row.status === 'skipped'
                                ? '<span class="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-bold text-gray-500">Already exists</span>'
                                : '<span class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Will import</span>'}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>`;
    }

    // Shown only when auto-detection could not place the required columns. A
    // file kept under its owner's own headers — "Bahan", "Takaran" — is a good
    // file; refusing it turns a thirty-second answer into a dead end.
    function mappingCardHTML(r) {
        if (!r.needsMapping) return '';
        const headers = r.headerCells || [];
        const options = (selected) => headers.map((h, i) => {
            const label = String(h || '').trim() || `Column ${i + 1}`;
            return `<option value="${i}"${String(selected) === String(i) ? ' selected' : ''}>${esc(label)}</option>`;
        }).join('');
        const fields = TEMPLATE_COLUMNS.filter((c) => c.key !== 'custom_field').map((c) => {
            const required = c.key === 'name' || c.key === 'unit';
            const current = r.columns.byKey[c.key];
            return `<div class="flex items-center justify-between gap-3 py-1.5">
                <span class="min-w-0 text-[12px] text-gray-700">${esc(c.header.replace(/^#/, ''))}${required ? '<span class="ml-1 text-[10px] font-bold uppercase tracking-wider text-red-600">required</span>' : ''}</span>
                <select data-map-key="${esc(c.key)}" aria-label="Column for ${esc(c.header)}"
                    class="w-[150px] shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[12px] outline-none">
                    <option value="-1"${current === undefined ? ' selected' : ''}>Not in this file</option>
                    ${options(current)}
                </select>
            </div>`;
        }).join('');
        return `<div class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <p class="text-[13px] font-bold text-gray-900">Map columns</p>
            <p class="mt-0.5 text-[11px] text-gray-500">We matched what we recognised. Point us at the rest.</p>
            <div class="mt-2 max-h-[260px] divide-y divide-gray-100 overflow-y-auto">${fields}</div>
        </div>`;
    }

    // The Ledger's "Override row status" card, in shape: a white card holding the
    // choices that change how the file is read. Each block appears only when the
    // file actually raises the question.
    function optionsCardHTML(r) {
        if (r.needsMapping) return '';
        const s = r.summary;
        const blocks = [];

        if (s.ambiguousAmounts) {
            blocks.push(`
            <div>
                <p class="text-[13px] font-bold text-gray-900">Number format</p>
                <p class="mt-0.5 text-[11px] text-gray-500">${esc(count(s.ambiguousAmounts))} row${s.ambiguousAmounts === 1 ? '' : 's'} could be read two ways — "1.500" is either one thousand five hundred, or one and a half.</p>
                <div class="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
                    ${['auto', 'id', 'en'].map((m) => `<button type="button" data-amount-mode="${m}"
                        class="rounded-lg px-2 py-1.5 text-[12px] font-bold ${state.amountMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}">${m === 'auto' ? 'Detect' : m === 'id' ? '1.234,56' : '1,234.56'}</button>`).join('')}
                </div>
            </div>`);
        }

        if (s.withOpening) {
            blocks.push(`
            <div>
                <p class="text-[13px] font-bold text-gray-900">Opening stock posts to your ledger</p>
                <p class="mt-0.5 text-[11px] text-gray-500">${esc(count(s.withOpening))} item${s.withOpening === 1 ? '' : 's'} worth ${esc(money(s.openingValueMinor))}. Recorded as Inventory (1200) against Opening Balance Equity (3900) — stating what you already own, without inventing revenue for it.</p>
                ${state.dimensions.length ? `
                <select id="inv-import-outlet" class="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] outline-none">
                    <option value="">Not assigned to an outlet</option>
                    ${state.dimensions.map((d) => `<option value="${esc(d.id)}"${d.id === state.openingDimensionId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
                </select>` : ''}
            </div>`);
        }

        blocks.push(`<p class="text-[11px] text-gray-500">Every amount is read as ${esc(currencyName())} — the currency this workspace keeps its books in. The template has no currency column, so a price list in another currency has to be converted before it is uploaded.</p>`);

        return `<div class="mt-4 rounded-xl border border-gray-200 bg-white p-4 space-y-3">${blocks.join('')}</div>`;
    }

    function setFeedback(message, tone) {
        const fb = el('inv-import-feedback');
        if (!fb) return;
        fb.textContent = message || '';
        fb.className = message
            ? `mt-3 text-[12px] font-medium ${tone === 'error' ? 'text-red-600' : 'text-gray-500'}`
            : 'hidden mt-3 text-[12px] font-medium';
    }

    // ── Data ────────────────────────────────────────────────────────────────
    function analyze() {
        state.result = analyzeImport(state.rawRows, {
            minorPerUnit: window.FluxyMoney.baseConfig().minorPerUnit || 1,
            amountMode: state.amountMode,
            columnOverrides: state.columnOverrides,
            existingItems: state.existingItems,
            chartCodes: state.chartCodes,
            todayKey: todayKey(),
            isPeriodOpen: (dayKey) => !state.closedPeriods.has(String(dayKey).slice(0, 7))
        });
        return state.result;
    }

    async function loadWorkspaceContext() {
        // Everything the analyzer needs to judge a row against THIS workspace:
        // what already exists, which account codes are real, which periods are
        // shut. Fetched when a file is picked, not on mount — most opens of this
        // tab are somebody looking at the template.
        const [items, chart, periods, dims] = await Promise.all([
            ds.getItems(user.uid, { includeArchived: true }).catch(() => []),
            // The PICKER chart, not getChartOfAccounts: it falls back to the
            // canonical seed for a workspace that has never opened the
            // Accounting Center. Without that fallback the chart reads empty and
            // every account code in the file is reported as unresolvable.
            ds.getChartForPicker(user.uid).catch(() => []),
            ds.listPeriods(user.uid).catch(() => []),
            ds.getDimensions(user.uid).catch(() => [])
        ]);
        state.existingItems = items;
        state.chartCodes = new Set((chart || []).map((a) => String(a.code)));
        state.closedPeriods = new Set((periods || [])
            .filter((p) => p.status === 'closed' || p.status === 'locked')
            .map((p) => String(p.period_key)));
        state.dimensions = (dims || []).filter((d) => d.status !== 'archived');
    }

    async function handleFile(file) {
        setFeedback('Reading…');
        state.busy = true;
        emit();
        try {
            const [read] = await Promise.all([readFile(file), loadWorkspaceContext()]);
            state.fileName = file.name;
            state.rawRows = read.rows;
            state.sheetName = read.sheetName;
            state.sheetCount = read.sheetCount;
            state.columnOverrides = {};
            const result = analyze();
            el('inv-import-file-label').textContent = file.name;
            // A file we cannot read AT ALL reports on the dropzone. A file whose
            // columns we merely cannot place is a different thing and renders its
            // preview, with the mapping card under it.
            if (!result.ok && !result.needsMapping) {
                setFeedback(result.fatal.message, 'error');
                state.rawRows = null;
                state.result = null;
            } else {
                setFeedback('');
            }
        } catch (err) {
            setFeedback((err && err.message) || 'Could not read that file.', 'error');
            state.rawRows = null;
            state.result = null;
        } finally {
            state.busy = false;
            renderPreview();
            emit();
        }
    }

    async function confirm() {
        if (!state.result || !state.result.ok) return;
        const rows = state.result.rows.filter((r) => r.status === 'ready');
        if (!rows.length) return;
        const s = state.result.summary;

        // Opening stock writes to the general ledger. A journal is reversible but
        // never silent, so it is named and confirmed separately from "create some
        // items" — the two are different promises.
        if (s.withOpening) {
            const ok = await window.showConfirmDialog({
                title: `Import ${count(s.ready)} items and post ${money(s.openingValueMinor)} of opening stock?`,
                body: esc(`This creates the items and posts ${money(s.openingValueMinor)} to 1200 Inventory against 3900 Opening Balance Equity, as a numbered journal you can review or reverse in the Accounting Center.`),
                confirmLabel: 'Import and post',
                cancelLabel: 'Not yet',
                icon: 'check'
            });
            if (!ok) return;
        }

        state.busy = true;
        emit();
        setFeedback('');
        try {
            const outcome = await ds.importInventoryItems(user.uid, {
                rows: rows.map((r) => ({ draft: r.draft, opening: r.opening })),
                dimension_id: state.openingDimensionId || null
            });
            state.busy = false;
            window.showToast(`${outcome.totals.items} ${outcome.totals.items === 1 ? 'item' : 'items'} imported.`, 'success');
            if (typeof onImported === 'function') await onImported(outcome);
        } catch (err) {
            state.busy = false;
            // The DAL's period and duplicate errors already read as sentences; a
            // generic "import failed" would throw that away.
            setFeedback((err && err.message) || 'The import could not be completed. Nothing was saved.', 'error');
            emit();
        }
    }

    // ── Events ──────────────────────────────────────────────────────────────
    function onChange(e) {
        const fileInput = e.target.closest('#inv-import-file');
        if (fileInput) {
            const file = fileInput.files && fileInput.files[0];
            if (file) handleFile(file);
            return;
        }
        const outlet = e.target.closest('#inv-import-outlet');
        if (outlet) { state.openingDimensionId = outlet.value || ''; return; }
        const map = e.target.closest('[data-map-key]');
        if (map) {
            state.columnOverrides[map.getAttribute('data-map-key')] = Number(map.value);
            analyze();
            renderPreview();
            emit();
        }
    }

    function onClick(e) {
        if (e.target.closest('#inv-import-template')) {
            const csv = buildTemplateCsv({ todayKey: todayKey() });
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'fluxyos-inventory-import-template.csv';
            a.click();
            URL.revokeObjectURL(url);
            window.showToast('Template downloaded.', 'success');
            return;
        }
        const mode = e.target.closest('[data-amount-mode]');
        if (mode) {
            state.amountMode = mode.getAttribute('data-amount-mode');
            analyze();
            renderPreview();
            emit();
        }
    }

    // Drag-and-drop, matching the Ledger's dropzone affordance.
    function onDragOver(e) { e.preventDefault(); el('inv-import-dropzone').classList.add('border-[#EA580C]'); }
    function onDragLeave() { el('inv-import-dropzone').classList.remove('border-[#EA580C]'); }
    function onDrop(e) {
        e.preventDefault();
        el('inv-import-dropzone').classList.remove('border-[#EA580C]');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFile(file);
    }

    contentEl.addEventListener('change', onChange);
    contentEl.addEventListener('click', onClick);
    contentEl.addEventListener('dragover', onDragOver);
    contentEl.addEventListener('dragleave', onDragLeave);
    contentEl.addEventListener('drop', onDrop);
    emit();

    return {
        confirm,
        getSummary: () => (state.result ? state.result.summary : null),
        reset() {
            state.fileName = '';
            state.rawRows = null;
            state.result = null;
            state.columnOverrides = {};
            state.amountMode = 'auto';
            state.openingDimensionId = '';
            contentEl.innerHTML = shellHTML();
            emit();
        },
        destroy() {
            contentEl.removeEventListener('change', onChange);
            contentEl.removeEventListener('click', onClick);
            contentEl.removeEventListener('dragover', onDragOver);
            contentEl.removeEventListener('dragleave', onDragLeave);
            contentEl.removeEventListener('drop', onDrop);
            contentEl.innerHTML = '';
        }
    };
}

export default { mount: mountInventoryImport };
