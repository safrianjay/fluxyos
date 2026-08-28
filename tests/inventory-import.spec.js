const { test, expect } = require('@playwright/test');

// Pure-logic tests for assets/js/inventory-import.js — same pattern as
// inventory-engine.spec.js and accounting-engine.spec.js: no auth, no Firestore,
// the module imported into a page and exercised directly.
//
// What these guard: the import format is the Head of Finance's reference sheet,
// and the failure mode of an importer is never a crash. It is a file that
// imports "successfully" with a quantity rounded, an amount off by 1000x, or an
// opening balance booked into the wrong month — none of which raises anything.

const ANALYZE_CTX = {
    minorPerUnit: 1,
    chartCodes: ['1200', '5100', '4000'],
    todayKey: '2026-08-28'
};

async function engine(page) {
    await page.goto('/pricing');
    return page;
}

test('our own template round-trips: it parses back with no errors', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (ctx) => {
        const m = await import('/assets/js/inventory-import.js');
        const csv = m.buildTemplateCsv({ todayKey: ctx.todayKey });
        // Read back with an INDEPENDENT RFC-4180 parser written here rather than
        // with the app's own. The point of a round-trip test is that a quoting
        // bug in the writer cannot hide behind a matching bug in the reader —
        // and the instruction row genuinely carries commas, quotes AND newlines.
        const parse = (text) => {
            const rows = [];
            let row = [], cur = '', q = false;
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '"' && q && text[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = !q;
                else if (ch === ',' && !q) { row.push(cur); cur = ''; }
                else if ((ch === '\n' || ch === '\r') && !q) {
                    if (ch === '\r' && text[i + 1] === '\n') i++;
                    row.push(cur); cur = '';
                    if (row.some((v) => v !== '')) rows.push(row);
                    row = [];
                } else cur += ch;
            }
            row.push(cur);
            if (row.some((v) => v !== '')) rows.push(row);
            return rows;
        };
        const rows = parse(csv.replace(/^\uFEFF/, ''));
        const out = m.analyzeImport(rows, ctx);
        return {
            ok: out.ok,
            meta: out.skippedMetaRows,
            summary: out.summary,
            names: out.rows.map((x) => x.name),
            statuses: out.rows.map((x) => x.status)
        };
    }, ANALYZE_CTX);

    expect(r.ok).toBe(true);
    // Header + requirement row + instruction row + the "delete this" marker:
    // three non-data rows that must never import as products.
    expect(r.meta).toBe(3);
    expect(r.summary.errors).toBe(0);
    expect(r.statuses.every((s) => s === 'ready')).toBe(true);
    expect(r.names).toContain('Kopi Arabika Gayo');
    // The sample's two opening balances: 25.000 g @ Rp150 and 48.000 ml @ Rp18.
    expect(r.summary.withOpening).toBe(2);
    expect(r.summary.openingValueMinor).toBe(25000 * 150 + 48000 * 18);
});

test('the reference sheet imports, with its foreign account codes reported not guessed', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (ctx) => {
        const m = await import('/assets/js/inventory-import.js');
        // The reference file's own shape: Jurnal account codes (`1-10200`),
        // a Serial Number item, a Batch item, and an Untrack service.
        const rows = [
            m.TEMPLATE_COLUMNS.map((c) => c.header),
            ['Product A', 'SKUA', '', '', 'Pcs', 'Clothes', 'Track', 'Qty', '1-10200', '',
                'Yes', '10000', '4-40000', '', 'Yes', '5000', '5-50000', '', '100', '6000', '12/12/2024', ''],
            ['Product B', 'SKUB', 'Laptop', '', 'Pcs', 'Machine', 'Track', 'Serial Number', '1-10201', '',
                'Yes', '20000', '4-40005', '', 'Yes', '5000', '5-50005', '', '', '', '', ''],
            ['Product C', '', 'Jasa', '', 'Liter', 'Beverages', 'Untrack', '', '', '',
                'No', '', '', '', 'Yes', '7000', '5-50007', '', '', '', '', '']
        ];
        const out = m.analyzeImport(rows, ctx);
        const byName = {};
        out.rows.forEach((x) => { byName[x.name] = x; });
        return {
            statuses: out.rows.map((x) => x.status),
            // An unresolvable code must NOT become a FluxyOS code.
            aCogs: byName['Product A'].draft.default_cogs_account_code,
            aSource: byName['Product A'].draft.source_account_codes,
            serialWarned: byName['Product B'].warnings.some((w) => /not enforced/.test(w.message)),
            serialStored: byName['Product B'].draft.tracking_type,
            untracked: byName['Product C'].draft.track_stock,
            aOpening: byName['Product A'].opening,
            unenforced: out.summary.unenforcedTracking
        };
    }, ANALYZE_CTX);

    // Every row is importable — a foreign chart is not a broken file.
    expect(r.statuses).toEqual(['ready', 'ready', 'ready']);
    // `5-50000` resolves to nothing, so the item falls back to the real COGS
    // account and the original is kept beside it. It must never be mangled into
    // a plausible-looking FluxyOS code.
    expect(r.aCogs).toBe('5100');
    expect(r.aSource.cogs).toBe('5-50000');
    // Serial tracking is stored (a migration must not destroy it) AND reported
    // as unenforced. Storing it silently is the failure this guards.
    expect(r.serialStored).toBe('serial');
    expect(r.serialWarned).toBe(true);
    expect(r.unenforced).toBe(1);
    expect(r.untracked).toBe(false);
    // Opening Balance Price is a UNIT price: 100 × 6000 is what posts.
    expect(r.aOpening.amount_minor).toBe(600000);
});

test('an amount that could be read two ways is flagged, never guessed', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/inventory-import.js');
        const p = (raw, mode, minorPerUnit) => m.parseAmountCell(raw, { mode, minorPerUnit });
        return {
            // Two separators resolve from evidence: the last one is the decimal.
            idGrouped: p('1.234,56', 'auto', 100).minor,
            enGrouped: p('1,234.56', 'auto', 100).minor,
            // Rupiah has no minor unit, so a decimal reading of a money cell is
            // never valid: grouping is the only reading, and there is nothing to
            // flag. (The VALUES still differ — 10.000 is ten thousand, not ten.)
            idrThousand: p('10.000', 'auto', 1),
            // In a 2-decimal currency the same cell is a 1000x fork.
            phpThousand: p('10.000', 'auto', 100),
            phpForcedId: p('10.000', 'id', 100).minor,
            phpForcedEn: p('10.000', 'en', 100).minor,
            // Two decimal places is unambiguous in either convention.
            phpDecimal: p('10.50', 'auto', 100),
            negative: p('-5', 'auto', 1).error,
            junk: p('abc', 'auto', 1).error
        };
    });

    expect(r.idGrouped).toBe(123456);
    expect(r.enGrouped).toBe(123456);
    expect(r.idrThousand.minor).toBe(10000);
    expect(r.idrThousand.ambiguous).toBe(false);
    expect(r.phpThousand.minor).toBe(1000000);
    expect(r.phpThousand.ambiguous).toBe(true);
    expect(r.phpForcedId).toBe(1000000);
    expect(r.phpForcedEn).toBe(1000);
    expect(r.phpDecimal.minor).toBe(1050);
    expect(r.phpDecimal.ambiguous).toBe(false);
    expect(r.negative).toBeTruthy();
    expect(r.junk).toBeTruthy();
});

test('a fractional quantity is refused, not rounded', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/inventory-import.js');
        return {
            whole: m.parseQuantityCell('100').quantity,
            // 25.000 is twenty-five thousand base units, not twenty-five.
            grouped: m.parseQuantityCell('25.000').quantity,
            half: m.parseQuantityCell('1.5').error,
            comma: m.parseQuantityCell('2,5').error
        };
    });
    expect(r.whole).toBe(100);
    expect(r.grouped).toBe(25000);
    // Silently rounding 1.5 to 2 would put an invented number into a journal —
    // the same refusal `toBase` makes in inventory-engine.js.
    expect(r.half).toBeTruthy();
    expect(r.comma).toBeTruthy();
});

test('dates follow the template (DD/MM/YYYY) and impossible ones are refused', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async () => {
        const m = await import('/assets/js/inventory-import.js');
        return {
            // The template's own format. Read MM/DD this would be 8 January.
            ddmm: m.parseDateCell('01/08/2026').key,
            iso: m.parseDateCell('2026-08-01').key,
            dash: m.parseDateCell('5-6-2026').key,
            impossible: m.parseDateCell('31/02/2026').error,
            month13: m.parseDateCell('13/13/2026').error
        };
    });
    expect(r.ddmm).toBe('2026-08-01');
    expect(r.iso).toBe('2026-08-01');
    expect(r.dash).toBe('2026-06-05');
    // 31 February must not roll forward into March.
    expect(r.impossible).toBeTruthy();
    expect(r.month13).toBeTruthy();
});

test('opening stock needs a price and a date, and an open period', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (ctx) => {
        const m = await import('/assets/js/inventory-import.js');
        const header = m.TEMPLATE_COLUMNS.map((c) => c.header);
        const row = (name, track, qty, price, date) => {
            const cells = new Array(header.length).fill('');
            cells[0] = name; cells[4] = 'g'; cells[6] = track;
            cells[10] = 'No'; cells[14] = 'Yes';
            cells[18] = qty; cells[19] = price; cells[20] = date;
            return cells;
        };
        const out = m.analyzeImport([
            header,
            row('Complete', 'Track', '100', '250', '01/08/2026'),
            row('No price', 'Track', '100', '', '01/08/2026'),
            row('No date', 'Track', '100', '250', ''),
            row('Untracked', 'Untrack', '100', '250', '01/08/2026'),
            row('Closed period', 'Track', '100', '250', '01/03/2026'),
            row('Future', 'Track', '100', '250', '01/12/2026')
        ], { ...ctx, isPeriodOpen: (k) => String(k).slice(0, 7) !== '2026-03' });
        const by = {};
        out.rows.forEach((x) => { by[x.name] = x; });
        const code = (n) => (by[n].errors[0] || {}).code;
        return {
            complete: by.Complete.opening,
            noPrice: code('No price'),
            noDate: code('No date'),
            untracked: code('Untracked'),
            closed: code('Closed period'),
            future: code('Future'),
            // One good row among five bad ones still imports.
            ready: out.summary.ready
        };
    }, ANALYZE_CTX);

    expect(r.complete.amount_minor).toBe(25000);
    expect(r.noPrice).toBe('IMP_010');
    expect(r.noDate).toBe('IMP_010');
    // Stock on something that is never held as stock.
    expect(r.untracked).toBe('IMP_011');
    // A closed period is refused rather than silently re-dated to today.
    expect(r.closed).toBe('IMP_013');
    expect(r.future).toBe('IMP_006');
    expect(r.ready).toBe(1);
});

test('a duplicate name is skipped; a duplicate SKU is an error', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (ctx) => {
        const m = await import('/assets/js/inventory-import.js');
        const header = m.TEMPLATE_COLUMNS.map((c) => c.header);
        const row = (name, sku) => {
            const cells = new Array(header.length).fill('');
            cells[0] = name; cells[1] = sku; cells[4] = 'g'; cells[6] = 'Track';
            cells[10] = 'No'; cells[14] = 'Yes';
            return cells;
        };
        const out = m.analyzeImport([
            header,
            row('Tepung Terigu', 'NEW-1'),   // name already in the workspace
            row('Gula Pasir', 'FLR-001'),    // SKU already in the workspace
            row('Garam', 'NEW-2'),
            row('Garam', 'NEW-3')            // repeats a name inside the file
        ], {
            ...ctx,
            existingItems: [{ id: 'a', name: 'Tepung Terigu', name_key: 'tepung terigu', sku: 'FLR-001' }]
        });
        return out.rows.map((x) => ({ name: x.name, status: x.status, code: (x.errors[0] || {}).code }));
    }, ANALYZE_CTX);

    // Re-running an import is not an error: an existing name is left alone.
    expect(r[0].status).toBe('skipped');
    // A duplicate SKU is: it makes the marketplace join ambiguous and would
    // relieve the wrong item's cost on a sale.
    expect(r[1].status).toBe('error');
    expect(r[1].code).toBe('IMP_009');
    expect(r[2].status).toBe('ready');
    expect(r[3].status).toBe('error');
    expect(r[3].code).toBe('IMP_008');
});

test('a numeric unit is caught, because base_unit can never be changed', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (ctx) => {
        const m = await import('/assets/js/inventory-import.js');
        const header = m.TEMPLATE_COLUMNS.map((c) => c.header);
        const cells = new Array(header.length).fill('');
        cells[0] = 'Tepung'; cells[4] = '1000'; cells[6] = 'Track';
        cells[10] = 'No'; cells[14] = 'Yes';
        const out = m.analyzeImport([header, cells], ctx);
        return { status: out.rows[0].status, code: out.rows[0].errors[0].code };
    }, ANALYZE_CTX);
    // Almost always the conversion factor typed into the wrong column. The item
    // could never be repaired afterwards, only replaced.
    expect(r.status).toBe('error');
    expect(r.code).toBe('IMP_012');
});

test('an unmappable file asks which column is which; an empty one just fails', async ({ page }) => {
    await engine(page);
    const r = await page.evaluate(async (ctx) => {
        const m = await import('/assets/js/inventory-import.js');
        // Headers nobody would recognise — a real list kept under its owner's
        // own names. This must ASK, not refuse.
        const custom = m.analyzeImport([['Bahan', 'Takaran'], ['Kopi', 'g']], ctx);
        // A file missing only the unit column: same treatment, narrower question.
        const noUnit = m.analyzeImport([['Product Name', 'Sell Price'], ['Kopi', '1000']], ctx);
        // Headers, no products.
        const noRows = m.analyzeImport([m.TEMPLATE_COLUMNS.map((c) => c.header)], ctx);
        // Once the question is answered, the same rows import.
        const answered = m.analyzeImport([['Bahan', 'Takaran'], ['Kopi', 'g']],
            { ...ctx, columnOverrides: { name: 0, unit: 1 } });
        return {
            customNeedsMapping: custom.needsMapping,
            customHeaders: custom.headerCells,
            noUnitNeedsMapping: noUnit.needsMapping,
            noUnitMissing: noUnit.missingRequired,
            noRows: noRows.fatal.code,
            empty: m.analyzeImport([], ctx).fatal.code,
            answeredOk: answered.ok,
            answeredName: answered.rows[0].name,
            answeredUnit: answered.rows[0].draft.base_unit
        };
    }, ANALYZE_CTX);

    // A file is not wrong for using its owner's words for things.
    expect(r.customNeedsMapping).toBe(true);
    expect(r.customHeaders).toEqual(['Bahan', 'Takaran']);
    expect(r.noUnitNeedsMapping).toBe(true);
    expect(r.noUnitMissing).toEqual(['unit']);
    expect(r.noRows).toBe('IMP_003');
    expect(r.empty).toBe('IMP_001');
    // The answer is all it needed.
    expect(r.answeredOk).toBe(true);
    expect(r.answeredName).toBe('Kopi');
    expect(r.answeredUnit).toBe('g');
});
