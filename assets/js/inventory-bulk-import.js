// FluxyOS — Inventory bulk import drawer
//
// Inventory → Bulk import → download template → upload → preview → map &
// validate → review errors → confirm → items created.
//
// This file is the SURFACE only. Everything it decides is decided in two places
// it does not own:
//   • `inventory-import.js` — parse, map, validate. Pure, and separately tested.
//   • `db-service.importInventoryItems` — the single atomic write.
// Keeping the judgement out of the DOM is what lets the preview promise exactly
// what the writer does.
//
// Three rules this drawer exists to keep:
//
//   1. NOTHING IS WRITTEN BEFORE CONFIRM. The file is read in the browser, never
//      uploaded. Leaving at any point before the last button costs nothing.
//   2. WHAT WE WILL NOT IMPORT IS SHOWN BEFORE, NOT AFTER. Unmapped columns,
//      unresolvable account codes, tracking types we do not enforce, rows that
//      already exist — all of it is on screen while the user can still change
//      their mind. Finding out afterwards means re-doing a migration.
//   3. EVERY AMOUNT IS RENDERED THROUGH THE MONEY SEAM BEFORE IT IS CONFIRMED.
//      `10.000` is ten thousand or ten depending on a convention the file does
//      not state — 1000x, stored clean, with nothing raised. So the preview
//      shows `formatBase` output: the number the user approves is literally the
//      number that lands in the ledger.
//      (IDR is not exempt. It is merely unambiguous — rupiah has no minor unit,
//      so a decimal reading of a money cell is never valid there.)

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

const ID = {
    root: 'inv-import-root',
    overlay: 'inv-import-overlay',
    panel: 'inv-import-panel',
    title: 'inv-import-title',
    body: 'inv-import-body',
    footer: 'inv-import-footer'
};

let mounted = null;

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
}

function money(minor) {
    try { return window.FluxyMoney.formatBase(Number(minor) || 0); }
    catch (_) { return String(minor); }
}

function currencyName() {
    try { return window.FluxyMoney.baseCurrencyName(); }
    catch (_) { return 'your workspace currency'; }
}

function count(n) {
    try { return window.FluxyMoney.baseNumber(Number(n) || 0); }
    catch (_) { return String(n); }
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

/*
 * A picked file → rows of cells.
 *
 * CSV goes through `window.FluxyCsv.parse` — the SAME parser the bulk
 * transaction importer uses. Two CSV parsers in one app disagree eventually, and
 * they disagree on a comma inside a quoted product name.
 *
 * Excel goes through SheetJS with `raw: true`, so a cell arrives as the text the
 * author typed rather than a value the reader has already interpreted. That
 * matters for exactly one reason: Excel would otherwise hand us a Date for
 * `12/12/2024` using ITS locale's day/month order, and an opening balance booked
 * into the wrong month is not something anybody notices.
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

// A workbook may carry several tabs. Prefer the one whose name looks like the
// reference template's; otherwise the first. Which sheet was used is always
// reported, because silently reading tab 1 of a 5-tab workbook is how somebody
// imports last year's list.
function pickSheet(wb) {
    const named = wb.SheetNames.find((n) => /invent|import|produk|product|item|barang/i.test(n));
    return named || wb.SheetNames[0];
}

// ── Step 1: upload ───────────────────────────────────────────────────────────

function uploadStepHTML() {
    return `
    <div class="fluxy-drawer-section">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">Start from the template</h3>
        </div>
        <p class="fluxy-drawer-section-desc">The template carries the ${TEMPLATE_COLUMNS.length} columns
           this importer reads, each with what it is for and whether it is required. Fill it in,
           or paste your existing list under its header row.</p>
        <button type="button" id="inv-import-template" class="fluxy-drawer-btn fluxy-drawer-btn--secondary fluxy-drawer-btn--block" style="margin-top:12px;">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"></path></svg>
            Download the template (CSV)
        </button>
        <p class="fluxy-drawer-hint" style="margin-top:8px;">Opens in Excel, Google Sheets, or Numbers. Save it back as CSV or .xlsx — both upload.</p>
    </div>

    <div class="fluxy-drawer-field">
        <label class="fluxy-drawer-label" for="inv-import-file">Your file</label>
        <input id="inv-import-file" type="file" accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
               class="fluxy-drawer-input" style="padding:10px 12px;">
        <p class="fluxy-drawer-hint">CSV or Excel, up to 5 MB and ${count(MAX_IMPORT_ROWS)} rows. The file is read here in your browser — it is never uploaded anywhere.</p>
    </div>

    <div id="inv-import-upload-error" class="fluxy-drawer-callout fluxy-drawer-callout--warning hidden"></div>

    <div class="fluxy-drawer-section fluxy-drawer-section--muted">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">What happens next</h3>
        </div>
        <p class="fluxy-drawer-section-desc">You will see every row, what each one will create, and
           anything we cannot read — before anything is saved. Nothing is written to your inventory
           or your ledger until you press Import on the last step.</p>
    </div>`;
}

// ── Step 2: review ───────────────────────────────────────────────────────────

function tile(label, value, tone) {
    const toneClass = tone ? ` inv-import-tile--${tone}` : '';
    return `<div class="inv-import-tile${toneClass}">
        <span class="inv-import-tile-value">${esc(value)}</span>
        <span class="inv-import-tile-label">${esc(label)}</span>
    </div>`;
}

function statusBadge(status) {
    if (status === 'ready') return '<span class="fluxy-table-status fluxy-status-success">Will import</span>';
    if (status === 'skipped') return '<span class="fluxy-table-status fluxy-status-neutral">Already exists</span>';
    return '<span class="fluxy-table-status fluxy-status-danger">Cannot import</span>';
}

/*
 * Warnings are grouped by message, never listed one per row.
 *
 * A 300-row file with an unrecognised cost account produces 300 identical
 * sentences. Nobody reads the 300th, which means nobody reads the first either —
 * and the one warning that mattered is buried in the middle of them. Grouped,
 * the same file says "297 rows: cost account not in your chart" once, with the
 * rows named.
 */
function groupIssues(rows, field) {
    const groups = new Map();
    rows.forEach((r) => {
        (r[field] || []).forEach((issue) => {
            // The account code and the row's own values vary per row; the shape
            // of the complaint does not. Group on the shape.
            const key = issue.message.replace(/"[^"]*"/g, '"…"');
            if (!groups.has(key)) groups.set(key, { message: issue.message, key, lines: [], column: issue.column });
            groups.get(key).lines.push(r.line);
        });
    });
    return Array.from(groups.values()).sort((a, b) => b.lines.length - a.lines.length);
}

function issueListHTML(groups, tone) {
    if (!groups.length) return '';
    return `<ul class="inv-import-issues inv-import-issues--${tone}">` + groups.map((g) => {
        const shown = g.lines.slice(0, 6).join(', ');
        const more = g.lines.length > 6 ? ` +${g.lines.length - 6} more` : '';
        const col = g.column && templateColumn(g.column)
            ? `<span class="inv-import-issue-col">${esc(templateColumn(g.column).header)}</span>` : '';
        return `<li>
            <span class="inv-import-issue-count">${g.lines.length === 1 ? 'Row' : `${g.lines.length} rows`}</span>
            ${col}
            <span class="inv-import-issue-text">${esc(g.message)}</span>
            <span class="inv-import-issue-rows">Row ${esc(shown)}${esc(more)}</span>
        </li>`;
    }).join('') + '</ul>';
}

/*
 * Map columns.
 *
 * Auto-detection handles the template's headers and the spellings a real export
 * produces, in English and Bahasa. What it cannot handle is a column somebody
 * named themselves — and a file is not wrong for saying "Nama Bahan". This is
 * where the user says what detection could not infer.
 *
 * It renders for every column FluxyOS reads: the ones already matched (so a
 * wrong match can be corrected, not just an absent one) and the ones still
 * empty. Required fields come first and are marked, because a file missing one
 * of those cannot be previewed at all until it is answered.
 */
function mappingHTML(state) {
    const { result } = state;
    const headers = result.headerCells || [];
    const used = result.columns.byKey;
    const options = (selected) => headers.map((h, i) => {
        const label = String(h || '').trim() || `Column ${i + 1}`;
        return `<option value="${i}"${String(selected) === String(i) ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');

    const rows = TEMPLATE_COLUMNS.filter((c) => c.key !== 'custom_field').map((c) => {
        const required = c.key === 'name' || c.key === 'unit';
        const current = used[c.key];
        const missing = required && current === undefined;
        return `<div class="inv-import-map-row${missing ? ' inv-import-map-row--missing' : ''}">
            <div class="inv-import-map-field">
                <span class="inv-import-map-name">${esc(c.header)}${required ? ' <span class="inv-import-map-req">required</span>' : ''}</span>
                <span class="inv-import-map-note">${esc(c.note)}</span>
            </div>
            <select class="fluxy-drawer-select inv-import-map-select" data-map-key="${esc(c.key)}" aria-label="Column for ${esc(c.header)}">
                <option value="-1"${current === undefined ? ' selected' : ''}>Not in this file</option>
                ${options(current)}
            </select>
        </div>`;
    }).join('');

    return `<div class="fluxy-drawer-section">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">Map columns</h3>
        </div>
        <p class="fluxy-drawer-section-desc">We matched what we recognised. Change anything we got wrong, and point us at the columns we could not place.</p>
        <div class="inv-import-map">${rows}</div>
    </div>`;
}

// The file is readable but we cannot tell which column is which. Everything the
// review step would show depends on that answer, so this is the only thing on
// screen until it is given.
function mappingStepHTML(state) {
    return `
    <div class="inv-import-filename">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"></path></svg>
        <span>${esc(state.fileName)}</span>
        <button type="button" id="inv-import-change-file" class="inv-import-change">Choose a different file</button>
    </div>
    <div class="fluxy-drawer-callout fluxy-drawer-callout--warning">${esc(state.result.fatal.message)}</div>
    ${mappingHTML(state)}`;
}

function reviewStepHTML(state) {
    const { result, fileName, sheetName, sheetCount, amountMode, dimensions, openingDimensionId } = state;
    const s = result.summary;
    const unmapped = unmappedColumnReport(result.columns);
    const errorGroups = groupIssues(result.rows.filter((r) => r.status === 'error'), 'errors');
    const warningGroups = groupIssues(result.rows, 'warnings');

    const notices = [];
    if (sheetCount > 1) {
        notices.push(`Read the <strong>${esc(sheetName)}</strong> sheet of ${sheetCount}. Rename the sheet you want first if that is the wrong one.`);
    }
    if (result.skippedMetaRows) {
        notices.push(`Skipped ${result.skippedMetaRows} guidance ${result.skippedMetaRows === 1 ? 'row' : 'rows'} from the template (the requirement and instruction lines).`);
    }

    const openingBlock = s.withOpening ? `
        <div class="fluxy-drawer-section">
            <div class="fluxy-drawer-section-head">
                <h3 class="fluxy-drawer-section-title">Opening stock posts to your ledger</h3>
            </div>
            <p class="fluxy-drawer-section-desc">${esc(
                `${count(s.withOpening)} ${s.withOpening === 1 ? 'item carries' : 'items carry'} an opening balance worth ${money(s.openingValueMinor)}.`
            )}</p>
            <p class="fluxy-drawer-section-desc">FluxyOS records it as Inventory (1200) against Opening Balance Equity (3900) — stating what you already own, without inventing revenue for it. One journal per opening date.</p>
            ${dimensions && dimensions.length ? `
            <div class="fluxy-drawer-field" style="margin-top:12px;">
                <label class="fluxy-drawer-label" for="inv-import-outlet">Where is this stock?</label>
                <select id="inv-import-outlet" class="fluxy-drawer-select">
                    <option value="">Not assigned to an outlet</option>
                    ${dimensions.map((d) => `<option value="${esc(d.id)}"${d.id === openingDimensionId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
                </select>
                <p class="fluxy-drawer-hint">The template has no outlet column, so the whole file lands in one place. Unassigned stock still counts toward the company total — it just shows as "Unassigned" on Outlet P&amp;L.</p>
            </div>` : ''}
        </div>` : '';

    // The format control appears only when a real ambiguity was found. Offering
    // it on every import would train people to click past it.
    const formatBlock = s.ambiguousAmounts ? `
        <div class="fluxy-drawer-callout fluxy-drawer-callout--warning">
            <strong>${esc(`${count(s.ambiguousAmounts)} ${s.ambiguousAmounts === 1 ? 'row has an amount' : 'rows have amounts'} that could be read two ways.`)}</strong>
            <span style="display:block;margin-top:4px;">In this workspace's currency, "1.500" is either one thousand five hundred, or one and a half. Tell us which convention the file uses and the figures below will update.</span>
            <div class="fluxy-drawer-segment" style="margin-top:10px;" role="group" aria-label="Number format">
                <button type="button" class="fluxy-drawer-segment-btn${amountMode === 'auto' ? ' is-active' : ''}" data-amount-mode="auto">Detect</button>
                <button type="button" class="fluxy-drawer-segment-btn${amountMode === 'id' ? ' is-active' : ''}" data-amount-mode="id">1.234,56</button>
                <button type="button" class="fluxy-drawer-segment-btn${amountMode === 'en' ? ' is-active' : ''}" data-amount-mode="en">1,234.56</button>
            </div>
        </div>` : '';

    const unmappedBlock = unmapped.length ? `
        <div class="fluxy-drawer-section fluxy-drawer-section--muted">
            <div class="fluxy-drawer-section-head">
                <h3 class="fluxy-drawer-section-title">Columns we will not import (${unmapped.length})</h3>
            </div>
            <ul class="inv-import-issues inv-import-issues--muted">
                ${unmapped.map((u) => `<li><span class="inv-import-issue-col">${esc(u.header)}</span><span class="inv-import-issue-text">${esc(u.reason)}</span></li>`).join('')}
            </ul>
        </div>` : '';

    const rowsHTML = result.rows.map((r) => {
        const d = r.draft;
        const opening = r.opening
            ? `<span class="fluxy-table-cell-primary">${esc(count(r.opening.quantity))} ${esc(d.base_unit)}</span>
               <span class="fluxy-table-cell-meta">${esc(money(r.opening.amount_minor))} · ${esc(r.opening.date_key)}</span>`
            // Blank is not zero: an item with no opening balance says so, because
            // an empty cell reads as "we looked and found none".
            : '<span class="fluxy-table-cell-meta">No opening stock</span>';
        const meta = [d.sku, d.base_unit, d.track_stock ? null : 'Untracked'].filter(Boolean).join(' · ');
        // A POINTER, not the prose. The full sentence is already in the grouped
        // "cannot be imported" section above with its row numbers; repeating it
        // in the cell duplicates nearby content and — measured at 720px — grew
        // the row to eleven lines and squeezed the item name into a ribbon,
        // which costs the table the scanability it exists for.
        // The reference sheet prefixes its opening-balance headers with `#`. That
        // is fidelity in the template and noise in a one-line pointer, where it
        // pushes "#Opening Balance Stock" onto three wrapped lines.
        const badColumns = Array.from(new Set(r.errors
            .map((e) => (e.column && templateColumn(e.column) ? templateColumn(e.column).header.replace(/^#/, '') : null))
            .filter(Boolean)));
        const why = badColumns.length
            ? `<span class="inv-import-row-why">Check: ${esc(badColumns.join(' · '))}</span>` : '';
        return `<tr class="fluxy-table-row${r.status === 'error' ? ' inv-import-row--error' : ''}">
            <td class="fluxy-table-cell inv-import-line">${r.line}</td>
            <td class="fluxy-table-cell">
                <span class="fluxy-table-cell-primary">${esc(d.name || '—')}</span>
                <span class="fluxy-table-cell-meta">${esc(meta)}</span>
                ${why}
            </td>
            <td class="fluxy-table-cell fluxy-table-money">${d.sales_price == null ? '<span class="fluxy-table-cell-meta">Not sold</span>' : esc(money(d.sales_price))}</td>
            <td class="fluxy-table-cell">${opening}</td>
            <td class="fluxy-table-cell">${statusBadge(r.status)}</td>
        </tr>`;
    }).join('');

    return `
    <div class="inv-import-filename">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"></path></svg>
        <span>${esc(fileName)}</span>
        <button type="button" id="inv-import-change-file" class="inv-import-change">Choose a different file</button>
    </div>

    <div class="inv-import-tiles">
        ${tile('Will import', count(s.ready), 'good')}
        ${tile('Already in FluxyOS', count(s.skipped), s.skipped ? 'muted' : '')}
        ${tile('Cannot import', count(s.errors), s.errors ? 'bad' : '')}
        ${tile('Opening stock', s.withOpening ? money(s.openingValueMinor) : '—', s.withOpening ? 'info' : '')}
    </div>

    <p class="inv-import-currency-note">${esc(
        `Every amount in this file is read as ${currencyName()} — the currency this workspace keeps its books in. The template has no currency column, so a price list in another currency has to be converted before it is uploaded.`
    )}</p>

    ${notices.length ? `<div class="fluxy-drawer-callout fluxy-drawer-callout--info">${notices.join('<br>')}</div>` : ''}
    ${formatBlock}

    ${s.errors ? `
    <div class="fluxy-drawer-section">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">${count(s.errors)} ${s.errors === 1 ? 'row cannot' : 'rows cannot'} be imported</h3>
        </div>
        <p class="fluxy-drawer-section-desc">Fix these in your file and upload it again, or import the ${count(s.ready)} good ${s.ready === 1 ? 'row' : 'rows'} now and add the rest later. Nothing here is guessed at.</p>
        ${issueListHTML(errorGroups, 'error')}
    </div>` : ''}

    ${warningGroups.length ? `
    <div class="fluxy-drawer-section">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">Worth knowing before you import</h3>
        </div>
        <p class="fluxy-drawer-section-desc">These rows import fine. This is what FluxyOS will and will not do with them.</p>
        ${issueListHTML(warningGroups, 'warn')}
    </div>` : ''}

    ${unmappedBlock}
    ${mappingHTML(state)}
    ${openingBlock}

    <div class="fluxy-drawer-section">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">Every row</h3>
        </div>
        <div class="fluxy-table-scroll" style="margin-top:8px;">
            <table class="fluxy-table inv-import-preview">
                <thead>
                    <tr class="fluxy-table-header">
                        <th>Row</th>
                        <th>Item</th>
                        <th class="fluxy-table-money">Sell price</th>
                        <th>Opening stock</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>
        </div>
    </div>

    <div id="inv-import-error" class="fluxy-drawer-callout fluxy-drawer-callout--warning hidden"></div>`;
}

// ── Step 3: done ─────────────────────────────────────────────────────────────

function doneStepHTML(outcome) {
    const t = outcome.totals;
    const journals = outcome.journals || [];
    return `
    <div class="inv-import-done">
        <span class="inv-import-done-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
        </span>
        <h3 class="inv-import-done-title">${count(t.items)} ${t.items === 1 ? 'item' : 'items'} added to your inventory</h3>
        ${t.opening_items ? `<p class="inv-import-done-sub">${count(t.opening_items)} of them opened with stock worth ${esc(money(t.opening_amount))}.</p>` : ''}
    </div>

    ${journals.length ? `
    <div class="fluxy-drawer-section">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">Posted to the ledger</h3>
        </div>
        <p class="fluxy-drawer-section-desc">Opening stock is real value on your balance sheet, so it is a numbered journal like any other — reviewable, and reversible from the Accounting Center.</p>
        <ul class="inv-import-issues inv-import-issues--muted">
            ${journals.map((j) => `<li>
                <span class="inv-import-issue-col">${esc(j.journal_number)}</span>
                <span class="inv-import-issue-text">Dr 1200 Inventory · Cr 3900 Opening Balance Equity — ${esc(money(j.amount))} across ${count(j.item_count)} ${j.item_count === 1 ? 'item' : 'items'}</span>
                <span class="inv-import-issue-rows">${esc(j.date_key)}</span>
            </li>`).join('')}
        </ul>
        <a href="/accounting?tab=journals" class="fluxy-drawer-btn fluxy-drawer-btn--secondary fluxy-drawer-btn--block" style="margin-top:12px;">Open the Accounting Center</a>
    </div>` : ''}

    ${outcome.skipped && outcome.skipped.length ? `
    <div class="fluxy-drawer-section fluxy-drawer-section--muted">
        <div class="fluxy-drawer-section-head">
            <h3 class="fluxy-drawer-section-title">${count(outcome.skipped.length)} skipped</h3>
        </div>
        <p class="fluxy-drawer-section-desc">These already existed and were left exactly as they were — an import never overwrites an item you already keep.</p>
        <ul class="inv-import-issues inv-import-issues--muted">
            ${outcome.skipped.slice(0, 12).map((s) => `<li><span class="inv-import-issue-text">${esc(s.name)} — ${esc(s.reason)}</span></li>`).join('')}
            ${outcome.skipped.length > 12 ? `<li><span class="inv-import-issue-text">…and ${outcome.skipped.length - 12} more.</span></li>` : ''}
        </ul>
    </div>` : ''}`;
}

// ── Controller ───────────────────────────────────────────────────────────────

const STEPS = [
    { key: 'upload', label: 'Upload' },
    { key: 'review', label: 'Map & review' },
    { key: 'done', label: 'Imported' }
];

function footerHTML(step, state) {
    if (step === 'upload') {
        return `<button type="button" id="inv-import-cancel" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Cancel</button>
                <button type="button" id="inv-import-next" class="fluxy-drawer-btn fluxy-drawer-btn--primary" disabled>Preview the file</button>`;
    }
    if (step === 'review') {
        const ready = state.result && !state.result.needsMapping ? state.result.summary.ready : 0;
        return `<button type="button" id="inv-import-back" class="fluxy-drawer-btn fluxy-drawer-btn--secondary">Back</button>
                <button type="button" id="inv-import-confirm" class="fluxy-drawer-btn fluxy-drawer-btn--primary"${ready ? '' : ' disabled'}>
                    ${ready ? `Import ${count(ready)} ${ready === 1 ? 'item' : 'items'}` : 'Nothing to import'}
                </button>`;
    }
    return `<button type="button" id="inv-import-done" class="fluxy-drawer-btn fluxy-drawer-btn--primary fluxy-drawer-btn--block">Done</button>`;
}

export function openInventoryImport({ ds, user, onImported } = {}) {
    if (mounted) return mounted;
    if (!ds || !user) throw new Error('openInventoryImport needs { ds, user }');

    const state = {
        step: 'upload',
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
        busy: false
    };

    const host = document.createElement('div');
    host.innerHTML = window.FluxyDrawer.build({
        ids: ID,
        title: 'Bulk import inventory',
        description: 'Bring an existing item list into FluxyOS. You will see exactly what it creates before anything is saved.',
        size: 'xl',
        stepper: { steps: STEPS, current: 'upload' },
        bodyHTML: uploadStepHTML(),
        footerHTML: footerHTML('upload', state)
    });
    document.body.appendChild(host.firstElementChild);

    const root = document.getElementById(ID.root);
    const panel = document.getElementById(ID.panel);
    const overlay = document.getElementById(ID.overlay);
    const body = document.getElementById(ID.body);
    const footer = document.getElementById(ID.footer);
    let dispose = null;

    function close() {
        if (state.busy) return;
        panel.classList.add('translate-x-full');
        overlay.classList.add('opacity-0');
        document.body.style.overflow = '';
        if (dispose) dispose();
        window.setTimeout(() => { root.remove(); }, 300);
        mounted = null;
    }

    function render(step) {
        state.step = step;
        body.innerHTML = step === 'upload' ? uploadStepHTML()
            : step === 'review' ? (state.result && state.result.needsMapping
                ? mappingStepHTML(state) : reviewStepHTML(state))
            : doneStepHTML(state.outcome);
        footer.innerHTML = footerHTML(step, state);
        window.FluxyDrawer.updateStepper(panel, step);
        body.scrollTop = 0;
        // Selects added after load are enhanced by the shared MutationObserver,
        // but calling it directly avoids a frame of native <select>.
        try { window.FluxySelect && window.FluxySelect.enhanceAll && window.FluxySelect.enhanceAll(body); } catch (_) { /* progressive */ }
        wire();
    }

    function showUploadError(message) {
        const el = document.getElementById('inv-import-upload-error');
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('hidden', !message);
    }

    function showReviewError(message) {
        const el = document.getElementById('inv-import-error');
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('hidden', !message);
        if (message) el.scrollIntoView({ block: 'nearest' });
    }

    // Re-runs the pure analyzer against the rows already in memory. Called on
    // first parse and whenever the number-format choice changes — re-reading the
    // file would be the same work plus an I/O round trip.
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
        // what already exists, which account codes are real, and which periods
        // are shut. Fetched once, when a file is picked, rather than on open —
        // most opens are somebody looking at the template.
        const [items, chart, periods, dims] = await Promise.all([
            ds.getItems(user.uid, { includeArchived: true }).catch(() => []),
            // The PICKER chart, not getChartOfAccounts: it falls back to the
            // canonical seed for a workspace that has never opened the Accounting
            // Center. Without that fallback the chart reads empty and every single
            // account code in the file is reported as unresolvable — a wall of
            // warnings about a chart that is simply not seeded yet.
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
        showUploadError('');
        const next = document.getElementById('inv-import-next');
        if (next) { next.disabled = true; next.textContent = 'Reading…'; }
        try {
            const [read] = await Promise.all([readFile(file), loadWorkspaceContext()]);
            state.fileName = file.name;
            state.rawRows = read.rows;
            state.sheetName = read.sheetName;
            state.sheetCount = read.sheetCount;
            state.columnOverrides = {};
            const result = analyze();
            // A file we cannot read AT ALL stops here, on the step that owns the
            // file. A file whose columns we merely cannot place is a different
            // thing and goes forward — that is what the mapping step is for.
            if (!result.ok && !result.needsMapping) {
                showUploadError(result.fatal.message);
                state.rawRows = null;
                return;
            }
            render('review');
        } catch (err) {
            showUploadError(err && err.message ? err.message : 'Could not read that file.');
        } finally {
            const btn = document.getElementById('inv-import-next');
            if (btn) { btn.textContent = 'Preview the file'; btn.disabled = !state.rawRows; }
        }
    }

    async function confirmImport() {
        const rows = state.result.rows.filter((r) => r.status === 'ready');
        if (!rows.length) return;
        const s = state.result.summary;

        // Opening stock writes to the general ledger. A journal is reversible but
        // never silent, so it is named and confirmed separately from "create some
        // items" — the two are different promises.
        if (s.withOpening) {
            const ok = await window.showConfirmDialog({
                title: `Import ${count(s.ready)} items and post ${esc(money(s.openingValueMinor))} of opening stock?`,
                body: esc(`This creates the items and posts ${money(s.openingValueMinor)} to 1200 Inventory against 3900 Opening Balance Equity, as a numbered journal you can review or reverse in the Accounting Center.`),
                confirmLabel: 'Import and post',
                cancelLabel: 'Not yet',
                icon: 'check'
            });
            if (!ok) return;
        }

        const btn = document.getElementById('inv-import-confirm');
        state.busy = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
        showReviewError('');
        try {
            const outcome = await ds.importInventoryItems(user.uid, {
                rows: rows.map((r) => ({ draft: r.draft, opening: r.opening })),
                dimension_id: state.openingDimensionId || null
            });
            state.outcome = outcome;
            state.busy = false;
            render('done');
            window.showToast(`${outcome.totals.items} ${outcome.totals.items === 1 ? 'item' : 'items'} imported.`, 'success');
            if (typeof onImported === 'function') { try { await onImported(outcome); } catch (_) { /* the page reload is best-effort */ } }
        } catch (err) {
            state.busy = false;
            if (btn) { btn.disabled = false; btn.textContent = `Import ${count(s.ready)} ${s.ready === 1 ? 'item' : 'items'}`; }
            // The DAL's period and duplicate errors already read as sentences; a
            // generic "import failed" would throw that away.
            showReviewError(err && err.message ? err.message : 'The import could not be completed. Nothing was saved.');
        }
    }

    function wire() {
        const on = (id, event, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(event, fn);
        };

        on('inv-import-cancel', 'click', close);
        on('inv-import-done', 'click', close);
        on('inv-import-back', 'click', () => { state.rawRows = null; render('upload'); });
        on('inv-import-change-file', 'click', () => { state.rawRows = null; render('upload'); });
        on('inv-import-confirm', 'click', confirmImport);

        on('inv-import-template', 'click', () => {
            const csv = buildTemplateCsv({ todayKey: todayKey() });
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'fluxyos-inventory-import-template.csv';
            a.click();
            URL.revokeObjectURL(url);
            window.showToast('Template downloaded.', 'success');
        });

        on('inv-import-file', 'change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) handleFile(file);
        });

        on('inv-import-next', 'click', () => {
            const input = document.getElementById('inv-import-file');
            const file = input && input.files && input.files[0];
            if (file) handleFile(file);
        });

        on('inv-import-outlet', 'change', (e) => { state.openingDimensionId = e.target.value || ''; });

        // Column mapping. Re-analyzes the rows already in memory, so the preview
        // updates as the answer is given rather than after another upload.
        Array.from(document.querySelectorAll('[data-map-key]')).forEach((sel) => {
            sel.addEventListener('change', () => {
                const key = sel.getAttribute('data-map-key');
                state.columnOverrides[key] = Number(sel.value);
                analyze();
                render('review');
            });
        });

        // Number format. Re-analyzes in place: same rows, different reading.
        Array.from(document.querySelectorAll('[data-amount-mode]')).forEach((btn) => {
            btn.addEventListener('click', () => {
                state.amountMode = btn.getAttribute('data-amount-mode');
                analyze();
                render('review');
            });
        });
    }

    // Open.
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
        panel.classList.remove('translate-x-full');
        overlay.classList.remove('opacity-0');
    });
    dispose = window.FluxyDrawer.mountBehavior(panel, {
        overlayEl: overlay,
        closeOnEscape: true,
        closeOnOverlay: true,
        onClose: close
    });
    Array.from(root.querySelectorAll('.fluxy-drawer-close')).forEach((b) => b.addEventListener('click', close));
    wire();

    mounted = { close };
    return mounted;
}

export default { open: openInventoryImport };
