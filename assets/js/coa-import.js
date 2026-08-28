// FluxyOS — Chart of Accounts import engine
//
// Pure parse → map → validate for `chart_of_accounts`. No Firestore, no DOM —
// same split as `inventory-import.js`, and for the same reason: the rules a
// person's spreadsheet is judged against have to be testable without a browser.
//
// ── Why the code is the key ──────────────────────────────────────────────────
// `chart_of_accounts/{code}` — the document id IS the account code, enforced in
// `firestore.rules` and immutable (docs/data-model/chart-of-accounts.md §1). So
// an import keys on the code and nothing else:
//
//     code already exists  → UPDATE that account
//     code is new          → CREATE it
//
// That is also how Xero does it, which matters more than it sounds: this is the
// format people are migrating FROM, and matching its semantics means a file
// exported there behaves the same way here. Two of Xero's documented traps do
// not exist for us and it is worth knowing why:
//
//   • Excel strips leading zeros from account codes. Ours are 4 digits in
//     1000–9999, so there are none to strip.
//   • Changing a code AND a name in one file makes Xero archive the account and
//     create a new one. Our code is immutable, so a code is either the same
//     account or a different one — never a rename in disguise.
//
// ── What an import may NOT do ────────────────────────────────────────────────
// System accounts are locked (`is_system`): the posting and tax engines address
// them by code, so renaming or re-typing one silently re-points a journal. They
// are reported as skipped, never quietly updated.

export const COA_TEMPLATE_COLUMNS = [
    { key: 'code', header: 'Code', required: true,
      note: 'Four digits, 1000–9999. This is the account’s identity — an existing code updates that account.' },
    { key: 'name', header: 'Name', required: true,
      note: 'Display name, up to 120 characters.' },
    { key: 'type', header: 'Type', required: true,
      note: 'asset · liability · equity · revenue · expense. Must agree with the code’s thousand block.' },
    { key: 'name_id', header: 'Nama (Indonesian)', required: false,
      note: 'Indonesian name. Falls back to the English one when blank.' },
    { key: 'parent_code', header: 'Parent Code', required: false,
      note: 'One level only. The parent must exist and share this account’s type and thousand block.' },
    { key: 'sak_category', header: 'SAK Category', required: false,
      note: 'Where the account sits on the statements. Blank is allowed; it just will not be classified.' }
];

export const COA = {
    NO_HEADER: 'COA_001',
    MISSING_COLUMN: 'COA_002',
    NO_ROWS: 'COA_003',
    BAD_CODE: 'COA_004',
    BAD_TYPE: 'COA_005',
    BAD_NAME: 'COA_006',
    BAD_CATEGORY: 'COA_007',
    BAD_PARENT: 'COA_008',
    DUPLICATE_IN_FILE: 'COA_009',
    SYSTEM_LOCKED: 'COA_010'
};

export const MAX_COA_ROWS = 400;

export function coaError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details) err.details = details;
    return err;
}

const COLUMN_BY_KEY = COA_TEMPLATE_COLUMNS.reduce((m, c) => { m[c.key] = c; return m; }, {});
export function coaColumn(key) { return COLUMN_BY_KEY[key] || null; }

export function normalizeHeader(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Accepted spellings per column — the template's own, plus what an export from
// Xero, Accurate or Jurnal actually produces, plus the Bahasa forms.
const HEADER_ALIASES = {
    code: ['code', 'account code', 'kode', 'kode akun', 'nomor akun', 'account no', 'no akun'],
    name: ['name', 'account name', 'nama', 'nama akun', 'account'],
    type: ['type', 'account type', 'tipe', 'jenis', 'tipe akun', 'jenis akun'],
    name_id: ['nama indonesian', 'nama akun indonesia', 'name id', 'nama id', 'indonesian name'],
    parent_code: ['parent code', 'parent', 'induk', 'kode induk', 'parent account'],
    sak_category: ['sak category', 'category', 'kategori', 'kategori sak', 'classification']
};

const ALIAS_LOOKUP = (() => {
    const map = new Map();
    Object.keys(HEADER_ALIASES).forEach((key) => {
        HEADER_ALIASES[key].forEach((alias) => {
            const k = normalizeHeader(alias);
            if (!map.has(k)) map.set(k, key);
        });
    });
    return map;
})();

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export const SAK_CATEGORIES = [
    'cash_bank', 'accounts_receivable', 'other_current_asset', 'inventory',
    'fixed_asset', 'accumulated_depreciation', 'other_asset',
    'accounts_payable', 'other_current_liability', 'long_term_liability',
    'equity', 'revenue', 'other_income', 'cogs', 'operating_expense', 'other_expense'
];

// The thousand block encodes the type. Kept here rather than imported from
// `accounting-engine.js` so this module stays loadable on its own — the two are
// pinned together by `tests/coa-import.spec.js`, which asserts they agree.
const BLOCK_TYPE = {
    1: 'asset', 2: 'liability', 3: 'equity', 4: 'revenue',
    5: 'expense', 6: 'expense', 7: 'revenue', 8: 'expense'
};

export function typeForCode(code) {
    const c = String(code || '').trim();
    if (!/^[1-9]\d{3}$/.test(c)) return null;
    // 9xxx deliberately has no assigned type — `accountTypeForCode` in
    // accounting-engine.js returns null for it too, which means "any type is
    // allowed here". A stricter copy would reject rows the real validator
    // accepts, and the divergence would only show up on somebody's file.
    return BLOCK_TYPE[Number(c.charAt(0))] || null;
}

function cell(row, index) {
    if (index == null || index < 0) return '';
    const v = row ? row[index] : '';
    return v == null ? '' : String(v).trim();
}

export function detectHeaderRow(rows) {
    const limit = Math.min(rows.length, 20);
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < limit; i++) {
        const score = (rows[i] || []).reduce((n, c) => {
            const k = normalizeHeader(c);
            return n + (k && ALIAS_LOOKUP.has(k) ? 1 : 0);
        }, 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore >= 2 ? best : -1;
}

export function mapColumns(headerCells) {
    const byKey = {};
    const unknown = [];
    (headerCells || []).forEach((raw, index) => {
        const text = String(raw == null ? '' : raw).trim();
        if (!text) return;
        const key = ALIAS_LOOKUP.get(normalizeHeader(text));
        if (!key) { unknown.push({ index, header: text }); return; }
        if (byKey[key] === undefined) byKey[key] = index;
    });
    return { byKey, unknown };
}

export function applyColumnOverrides(columns, overrides) {
    if (!overrides || !Object.keys(overrides).length) return columns;
    const byKey = { ...columns.byKey };
    const claimed = new Set();
    Object.keys(overrides).forEach((key) => {
        const index = Number(overrides[key]);
        if (!COLUMN_BY_KEY[key] || !Number.isInteger(index)) return;
        if (index === -1) { delete byKey[key]; return; }
        if (index < 0) return;
        byKey[key] = index;
        claimed.add(index);
    });
    return { ...columns, byKey, unknown: (columns.unknown || []).filter((u) => !claimed.has(u.index)) };
}

function issue(list, code, message, column) {
    list.push({ code, message, column: column || null });
}

/*
 * The whole file → a reviewable plan.
 *
 * Nothing throws for a bad ROW: a chart is long and hand-maintained, and one
 * unusable line must not cost the other three hundred. Only a file that cannot
 * be read at all comes back with `fatal` set.
 *
 * Each row resolves to one of four outcomes, and they are counted separately
 * because they are different promises to the user:
 *
 *   create     — the code is new
 *   update     — the code exists and something about it differs
 *   unchanged  — the code exists and the file says nothing new
 *   error      — the row cannot be applied at all
 *   skipped    — a system account, which an import may never touch
 */
export function analyzeCoaImport(rows, ctx = {}) {
    const { existingAccounts = [], columnOverrides = null } = ctx;

    const grid = Array.isArray(rows) ? rows : [];
    if (!grid.length) {
        return { ok: false, fatal: coaError(COA.NO_HEADER, 'That file is empty.'), rows: [] };
    }

    const detected = detectHeaderRow(grid);
    const headerIndex = detected === -1 ? 0 : detected;
    const headerUnrecognized = detected === -1;
    const columns = applyColumnOverrides(mapColumns(grid[headerIndex]), columnOverrides);
    const missingRequired = ['code', 'name', 'type'].filter((k) => columns.byKey[k] === undefined);

    if (missingRequired.length) {
        return {
            ok: false,
            needsMapping: true,
            columns,
            headerIndex,
            missingRequired,
            headerCells: grid[headerIndex] || [],
            fatal: coaError(headerUnrecognized ? COA.NO_HEADER : COA.MISSING_COLUMN,
                headerUnrecognized
                    ? 'None of these column names look familiar, so we have taken the first row as your headers. Point us at the right column below.'
                    : `We could not find ${missingRequired.map((k) => `"${coaColumn(k).header}"`).join(', ')} in this file. Point us at the right column below.`,
                { missing: missingRequired }),
            rows: [],
            summary: { total: 0, create: 0, update: 0, unchanged: 0, errors: 0, skipped: 0 }
        };
    }

    const byCode = new Map();
    (existingAccounts || []).forEach((a) => { if (a && a.code) byCode.set(String(a.code), a); });

    // The parent must exist AFTER the import, not before — a file that defines
    // 6400 and 6410 together is correct, and checking only the current chart
    // would reject the child for a parent arriving two rows later.
    const codesInFile = new Set();
    for (let r = headerIndex + 1; r < grid.length; r++) {
        const c = cell(grid[r], columns.byKey.code);
        if (c) codesInFile.add(c);
    }

    const seen = new Map();
    const out = [];
    let skippedNoteRows = 0;

    for (let r = headerIndex + 1; r < grid.length; r++) {
        const cells = grid[r] || [];
        if (!cells.some((c) => String(c == null ? '' : c).trim() !== '')) continue;
        if (out.length >= MAX_COA_ROWS) break;

        const line = r + 1;
        const errors = [];
        const warnings = [];
        const at = (key) => cell(cells, columns.byKey[key]);

        const code = at('code');
        const name = at('name');
        const typeRaw = at('type').toLowerCase();
        const nameId = at('name_id');
        const parentCode = at('parent_code');
        const sak = at('sak_category').toLowerCase().replace(/[\s-]+/g, '_');

        // Skip a repeated header row — an export that concatenates sheets, or a
        // person who pasted a second chart under the first.
        if (normalizeHeader(code) === normalizeHeader(coaColumn('code').header)) continue;

        // Skip the template's own guidance row. A code is four characters; the
        // note under it is a sentence. Reporting it as a bad code instead — which
        // is what the length check below would do — means exporting the chart and
        // importing it straight back reports an error, and an import that cannot
        // round-trip its own template is not one anybody will trust.
        if (code.length > 20) { skippedNoteRows++; continue; }

        if (!/^[1-9]\d{3}$/.test(code)) {
            issue(errors, COA.BAD_CODE, `"${code || '(blank)'}" is not an account code. Codes are four digits from 1000 to 9999.`, 'code');
        }
        if (!name) issue(errors, COA.BAD_NAME, 'Name is required.', 'name');
        else if (name.length > 120) issue(errors, COA.BAD_NAME, `Name is ${name.length} characters; the limit is 120.`, 'name');
        if (nameId && nameId.length > 120) {
            issue(errors, COA.BAD_NAME, `Nama (Indonesian) is ${nameId.length} characters; the limit is 120.`, 'name_id');
        }

        const expected = typeForCode(code);
        if (!ACCOUNT_TYPES.includes(typeRaw)) {
            issue(errors, COA.BAD_TYPE, `Type must be one of ${ACCOUNT_TYPES.join(', ')} — got "${at('type') || '(blank)'}".`, 'type');
        } else if (expected && typeRaw !== expected) {
            // The thousand block IS the type. A 6xxx row calling itself revenue
            // would file a cost under income on every statement it touches.
            issue(errors, COA.BAD_TYPE, `Code ${code} is in the ${code.charAt(0)}000 block, which is ${expected}. Change the code or the type so they agree.`, 'type');
        }

        if (sak && SAK_CATEGORIES.indexOf(sak) === -1) {
            issue(errors, COA.BAD_CATEGORY, `"${at('sak_category')}" is not a SAK category. Leave it blank if you are unsure.`, 'sak_category');
        } else if (!sak) {
            issue(warnings, COA.BAD_CATEGORY, 'No SAK category. The account works, but it will not appear under a heading on the balance sheet or income statement.', 'sak_category');
        }

        if (parentCode) {
            const parent = byCode.get(parentCode);
            const parentInFile = codesInFile.has(parentCode);
            if (parentCode === code) {
                issue(errors, COA.BAD_PARENT, 'An account cannot be its own parent.', 'parent_code');
            } else if (!parent && !parentInFile) {
                issue(errors, COA.BAD_PARENT, `Parent ${parentCode} does not exist and is not in this file.`, 'parent_code');
            } else if (parentCode.charAt(0) !== code.charAt(0)) {
                issue(errors, COA.BAD_PARENT, `Parent ${parentCode} is in a different code block from ${code}. A parent must share its child's type.`, 'parent_code');
            }
        }

        let status = errors.length ? 'error' : 'create';
        const existing = byCode.get(code);

        if (!errors.length && existing) {
            if (existing.is_system) {
                // The posting and tax engines address these by code. Renaming or
                // re-typing one silently re-points a journal, so an import may
                // never touch them — reported, not quietly applied.
                issue(warnings, COA.SYSTEM_LOCKED, `${code} ${existing.name} is a system account and cannot be changed by an import.`, 'code');
                status = 'skipped';
            } else {
                const changed = [];
                if (name && name !== existing.name) changed.push('name');
                if (nameId && nameId !== (existing.name_id || '')) changed.push('name_id');
                if (sak && sak !== (existing.sak_category || '')) changed.push('sak_category');
                if (parentCode !== String(existing.parent_code || '')) changed.push('parent_code');
                status = changed.length ? 'update' : 'unchanged';
                if (changed.length) issue(warnings, COA.SYSTEM_LOCKED, `Updates ${changed.join(', ')} on the existing ${code}.`, 'code');
            }
        }

        if (code && status !== 'error') {
            if (seen.has(code)) {
                issue(errors, COA.DUPLICATE_IN_FILE, `Code ${code} appears twice in this file (also on row ${seen.get(code)}).`, 'code');
                status = 'error';
            } else {
                seen.set(code, line);
            }
        }

        out.push({
            line,
            code,
            status,
            errors,
            warnings,
            existing: existing || null,
            draft: {
                code,
                name,
                name_id: nameId || null,
                type: typeRaw,
                parent_code: parentCode || null,
                sak_category: sak || null
            }
        });
    }

    const count = (s) => out.filter((r) => r.status === s).length;
    const summary = {
        total: out.length,
        create: count('create'),
        update: count('update'),
        unchanged: count('unchanged'),
        errors: count('error'),
        skipped: count('skipped'),
        warnings: out.filter((r) => r.warnings.length).length
    };

    let fatal = null;
    if (!out.length) {
        fatal = coaError(COA.NO_ROWS, 'The file has headers but no account rows.');
    } else if (out.length >= MAX_COA_ROWS) {
        fatal = coaError(COA.NO_ROWS, `A chart import is capped at ${MAX_COA_ROWS} rows. Split the file.`);
    }

    return {
        ok: !fatal,
        fatal,
        headerIndex,
        columns,
        headerCells: grid[headerIndex] || [],
        skippedNoteRows,
        rows: out,
        summary
    };
}

// ── The downloadable template ────────────────────────────────────────────────
//
// Seeded from the workspace's own live chart, the way Xero does it. A blank
// template makes a person invent codes; their own chart makes the file a diff
// they can edit, which is what an import of an existing chart actually is.
export function buildCoaTemplateRows(accounts) {
    const header = COA_TEMPLATE_COLUMNS.map((c) => c.header);
    const notes = COA_TEMPLATE_COLUMNS.map((c) => c.note);
    const body = (accounts || [])
        .slice()
        .sort((a, b) => String(a.code).localeCompare(String(b.code)))
        .map((a) => [
            a.code, a.name, a.type, a.name_id || '', a.parent_code || '', a.sak_category || ''
        ]);
    return [header, notes, ...body];
}

export function toCsv(rows) {
    return (rows || [])
        .map((row) => (row || [])
            .map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`)
            .join(','))
        .join('\r\n');
}

export function buildCoaTemplateCsv(accounts) {
    // BOM so Excel opens it as UTF-8 and does not mangle "Kas & Bank".
    return `﻿${toCsv(buildCoaTemplateRows(accounts))}`;
}

// The notes row is guidance, not an account, and `analyzeCoaImport` skips it
// explicitly (a code is four characters; the note under it is a sentence).
// Leaving it to the code check reported it as a BAD CODE, so exporting the
// chart and importing it straight back raised an error — an import that cannot
// round-trip its own template is not one anybody will trust.
export function unmappedColumnReport(columns) {
    return (columns && columns.unknown ? columns.unknown : [])
        .map((u) => ({ header: u.header, reason: 'Not a template column — this data will not be imported.' }));
}
