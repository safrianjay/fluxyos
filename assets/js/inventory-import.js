// FluxyOS — Inventory bulk import engine
//
// Pure parse → map → validate for the inventory master. No Firestore, no DOM,
// mirroring `inventory-engine.js` so the arithmetic and the rules a person's
// spreadsheet is judged against stay testable in one place.
//
// ── The source of truth for this format ──────────────────────────────────────
// The column set below is the Head of Finance's reference template ("Contoh Bulk
// import Inventory - from Jurnal.id"), reproduced column-for-column INCLUDING
// each column's own requirement label and instruction text. It is an INPUT
// CONTRACT, not a storage schema: a client exporting from Jurnal.id must be able
// to drop that file in unchanged.
//
// `maps` records where each column lands in the FluxyOS item model, and it is
// deliberately not 1:1 — three columns describe capabilities FluxyOS does not
// have (Batch/Serial tracking, per-item inventory and revenue accounts, per-item
// tax names). Those are STORED but not acted on, and both the drawer and
// `docs/data-model/items.md` say so in as many words. Silently accepting
// `Tracking Type: Serial Number` and tracking nothing is the failure class this
// codebase keeps re-learning: no error, and a number that is quietly wrong.
//
// ── Amounts are the dangerous part ───────────────────────────────────────────
// `10.000` is ten thousand under Indonesian grouping and ten under Anglo
// decimals — a 1000x fork, and the cell does not say which.
//
// What differs by currency is not the arithmetic but whether the cell is
// ambiguous AT ALL. **IDR has no minor unit**, so a decimal reading of a money
// cell is never valid and grouping is the only reading there is. PHP, SGD and
// MYR have cents, so a separator genuinely carries meaning and the same cell has
// two defensible readings. That is why the flag below is raised only for a
// currency with minor units — not because rupiah is safer arithmetic. `parseAmountCell` therefore reports
// `ambiguous` rather than guessing, the caller offers an explicit format choice,
// and the preview renders every amount through the money seam so the number the
// user confirms is the number that gets stored.
export const TEMPLATE_COLUMNS = [
    { key: "name", header: "Product Name", requirement: "Mandatory",
      maps: "name", note: "Item name. Must be unique in this workspace.",
      instruction: "Enter product name below. Maximum character limit is 255 and must be unique (no duplicated name)" },
    { key: "sku", header: "Product Code", requirement: "Optional",
      maps: "sku", note: "SKU. Must be unique — it is the join to marketplace order lines.",
      instruction: "You can enter product code / SKU if needed." },
    { key: "description", header: "Description", requirement: "Optional",
      maps: "notes", note: "Stored as the item note (trimmed to 500 characters).",
      instruction: "You can enter description if needed. Maximum character limit is 6.000" },
    { key: "barcode", header: "Barcode", requirement: "Optional",
      maps: "barcode", note: "Stored for lookup and round-trip. Nothing scans it yet.",
      instruction: "You can enter barcode in numbers if needed." },
    { key: "unit", header: "Unit", requirement: "Mandatory",
      maps: "base_unit", note: "The base unit. IMMUTABLE once the item exists.",
      instruction: "Enter product unit below. Example: pcs, kg, liter" },
    { key: "categories", header: "Product Categories", requirement: "Optional",
      maps: "categories", note: "Semicolon-separated. Stored as a list.",
      instruction: "You can enter product category if needed.\n \n Separate with semicolon (;) for entering multiple categories. Example: Main menu; Side menu; Beverages" },
    { key: "track_stock", header: "Track Stock for This Item", requirement: "Mandatory",
      maps: "track_stock", note: "Track = held as stock. Untrack = a service; it can never receive stock or be counted.",
      instruction: "Enter one of inventory tracking preferences below:\n 1) Track -- if you want to track the physical product stocks.\n 2) Untrack -- if your product is a service or don't want to track physical product stocks." },
    { key: "tracking_type", header: "Tracking Type", requirement: "Conditional Mandatory",
      maps: "tracking_type", note: "FluxyOS tracks by quantity. Batch and Serial are recorded but NOT enforced.",
      instruction: "Only for \"Track\" products. \n \n Enter one of tracking types below:\n 1) Qty\n 2) Batch\n 3) Serial Number" },
    { key: "inventory_account", header: "Default Inventory Account Code", requirement: "Conditional Mandatory",
      maps: "default_inventory_account_code", note: "Recorded. Stock always posts to 1200 Inventory, which is closed to direct posting.",
      instruction: "Only for \"Track\" products. \n \n Enter account code below or if you leave it blank, Jurnal system will select the default account based on your company's account settings." },
    { key: "buffer_quantity", header: "Buffer Quantity", requirement: "Optional",
      maps: "reorder_point", note: "Low-stock threshold, in base units. Blank means no warning; 0 is refused.",
      instruction: "You can enter buffer quantity if needed. Jurnal system will remind you when stock has reached the minimum quantity." },
    { key: "is_sold", header: "I Sell This Item", requirement: "Mandatory",
      maps: "is_sold", note: "Yes also makes the item visible on the POS till.",
      instruction: "Enter one of the options below:\n 1) Yes -- if you sell this product.\n 2) No -- if you don't sell it." },
    { key: "sell_price", header: "Sell Price", requirement: "Conditional Mandatory",
      maps: "sales_price", note: "Menu / selling price, stored in minor units.",
      instruction: "Only for \"Yes\" to sell products.\n \n Enter selling price below or if you leave it blank, Jurnal system will fill it in with 0" },
    { key: "sell_account", header: "Default Sell Account Code", requirement: "Conditional Mandatory",
      maps: "default_sales_account_code", note: "Recorded. Revenue routing is set in Accounting → Account Mapping.",
      instruction: "Only for \"Yes\" to sell products. This account will record revenue in accounting reports.\n \n Enter account code below or if you leave this blank, Jurnal system will select the default account based on your company's account settings." },
    { key: "sell_tax", header: "Default Sell Tax Name", requirement: "Conditional Mandatory",
      maps: "default_sales_tax_name", note: "Recorded. Tax is applied in the Tax Center, not per item.",
      instruction: "Only for \"Yes\" to sell products.\n \n Enter selling tax name below. It will appear when creating sales transactions." },
    { key: "is_bought", header: "I Buy This Item", requirement: "Mandatory",
      maps: "is_purchased", note: "Marks the item as something you buy.",
      instruction: "Enter one of the options below:\n 1) Yes -- if you buy this product.\n 2) No -- if you don't buy it." },
    { key: "buy_price", header: "Buy Price", requirement: "Conditional Mandatory",
      maps: "purchase_price", note: "Reference buy price. Actual cost is weighted average from stock movements.",
      instruction: "Only for \"Yes\" to buy products.\n \n Enter buying price below or if you leave it blank, Jurnal system will fill it in with 0." },
    { key: "buy_account", header: "Default Buy Account Code", requirement: "Conditional Mandatory",
      maps: "default_cogs_account_code", note: "Resolved against your chart of accounts. Unresolvable codes fall back to 5100.",
      instruction: "Only for \"Yes\" to buy products. This account will record cost of sales in accounting reports.\n \n Enter account code below or if you leave this blank, Jurnal system will select the default account based on your company's account settings." },
    { key: "buy_tax", header: "Default Buy Tax Name", requirement: "Conditional Mandatory",
      maps: "default_purchase_tax_name", note: "Recorded. Tax is applied in the Tax Center, not per item.",
      instruction: "Only for \"Yes\" to buy products.\n \n Enter buying tax name below. It will appear when creating purchase transactions." },
    { key: "opening_qty", header: "#Opening Balance Stock", requirement: "Optional",
      maps: "stock_movements", note: "Opening stock. Posts Dr 1200 Inventory / Cr 3900 Opening Balance Equity.",
      instruction: "You can enter opening balance stock if needed. It will be recorded after adding a new product.\n \n For \"Batch\" tracking type, Jurnal system will refer to the batch stock." },
    { key: "opening_price", header: "#Opening Balance Price", requirement: "Conditional Mandatory",
      maps: "stock_movements", note: "Total value of the opening stock, in minor units. Required when a quantity is given.",
      instruction: "Enter price if your product has opening balance stock.\n \n For \"Batch\" or \"Serial Number\" tracking type, enter either price." },
    { key: "opening_date", header: "#Opening Balance Date", requirement: "Conditional Mandatory",
      maps: "stock_movements", note: "DD/MM/YYYY. The period it lands in must still be open.",
      instruction: "Enter date if your product has opening balance stock. It will mark the first time you are recording its stock." },
    { key: "custom_field", header: "custom_field_custom field name", requirement: "Conditional",
      maps: "custom_fields", note: "Any custom_field_* column is stored as a name/value pair.",
      instruction: "- Rename the header using your custom field name with prefix \"custom_field\" e.g custom_field_country origin\n - fill the value based on your custom type e.g 1 -> for number. a,b,c for multiselect dropdown" }
];


// One file, one batch. Matches the bulk-transaction CSV ceiling in
// `shared-dashboard.js`: a Firestore batch is capped at 500 writes, and an
// opening balance turns one row into two writes (item + movement), so 250 rows
// is the real limit once opening stock is in play. Enforced against the write
// count, not the row count, in `analyzeImport`.
export const MAX_IMPORT_ROWS = 500;
export const MAX_WRITES_PER_BATCH = 450;

// Structured codes on the INV_*/GL_* contract: callers discriminate on the code,
// never on message prose, so translating a string cannot change control flow.
export const IMP = {
    NO_HEADER: 'IMP_001',
    MISSING_COLUMN: 'IMP_002',
    NO_ROWS: 'IMP_003',
    TOO_MANY_ROWS: 'IMP_004',
    BAD_NUMBER: 'IMP_005',
    BAD_DATE: 'IMP_006',
    BAD_ENUM: 'IMP_007',
    DUPLICATE_IN_FILE: 'IMP_008',
    ALREADY_EXISTS: 'IMP_009',
    OPENING_INCOMPLETE: 'IMP_010',
    OPENING_ON_UNTRACKED: 'IMP_011',
    UNIT_IS_NUMERIC: 'IMP_012',
    PERIOD_CLOSED: 'IMP_013'
};

export function importError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details) err.details = details;
    return err;
}

const COLUMN_BY_KEY = TEMPLATE_COLUMNS.reduce((m, c) => { m[c.key] = c; return m; }, {});
export function templateColumn(key) { return COLUMN_BY_KEY[key] || null; }

// Header matching is deliberately loose on punctuation and case but never on
// meaning: `#Opening Balance Stock` and `opening_balance_stock` are the same
// column, `Sell Price` and `Buy Price` never are.
export function normalizeHeader(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Accepted spellings per column. The template header is always first; the rest
// are what an export or a hand-built file actually produces, including the
// Bahasa forms an Indonesian client will type.
const HEADER_ALIASES = {
    name: ['product name', 'name', 'item name', 'nama produk', 'nama barang', 'nama'],
    sku: ['product code', 'sku', 'code', 'kode produk', 'kode barang', 'kode'],
    description: ['description', 'notes', 'deskripsi', 'keterangan'],
    barcode: ['barcode', 'kode batang'],
    unit: ['unit', 'uom', 'satuan', 'base unit', 'satuan dasar'],
    categories: ['product categories', 'product category', 'category', 'categories', 'kategori', 'kategori produk'],
    track_stock: ['track stock for this item', 'track stock', 'track', 'lacak stok'],
    tracking_type: ['tracking type', 'tipe pelacakan', 'jenis pelacakan'],
    inventory_account: ['default inventory account code', 'inventory account code', 'inventory account', 'akun persediaan'],
    buffer_quantity: ['buffer quantity', 'buffer', 'reorder point', 'minimum stock', 'stok minimum', 'kuantitas penyangga'],
    is_sold: ['i sell this item', 'sell this item', 'is sold', 'dijual'],
    sell_price: ['sell price', 'selling price', 'sales price', 'harga jual'],
    sell_account: ['default sell account code', 'sell account code', 'sales account code', 'akun penjualan'],
    sell_tax: ['default sell tax name', 'sell tax name', 'sales tax name', 'pajak penjualan'],
    is_bought: ['i buy this item', 'buy this item', 'is purchased', 'dibeli'],
    buy_price: ['buy price', 'buying price', 'purchase price', 'harga beli'],
    buy_account: ['default buy account code', 'buy account code', 'purchase account code', 'akun pembelian'],
    buy_tax: ['default buy tax name', 'buy tax name', 'purchase tax name', 'pajak pembelian'],
    opening_qty: ['opening balance stock', 'opening stock', 'opening quantity', 'saldo awal stok', 'stok awal'],
    opening_price: ['opening balance price', 'opening price', 'harga saldo awal', 'harga awal'],
    opening_date: ['opening balance date', 'opening date', 'tanggal saldo awal', 'tanggal awal']
};

const ALIAS_LOOKUP = (() => {
    const map = new Map();
    Object.keys(HEADER_ALIASES).forEach((key) => {
        HEADER_ALIASES[key].forEach((alias) => {
            const k = normalizeHeader(alias);
            // First writer wins, so a shared alias can never silently re-point an
            // earlier column at a later one.
            if (!map.has(k)) map.set(k, key);
        });
    });
    return map;
})();

export const CUSTOM_FIELD_PREFIX = 'custom_field_';

function cell(row, index) {
    if (index == null || index < 0) return '';
    const v = row ? row[index] : '';
    if (v instanceof Date) return v;
    return v == null ? '' : String(v).trim();
}

// ── Meta rows ────────────────────────────────────────────────────────────────
//
// The reference sheet puts three non-data rows between the header and the first
// product: the requirement labels, the instructions, and a "delete this example"
// marker. A client who edits the sheet in place and exports it hands us all
// three. Dropping them silently would be wrong (they would import as products
// named "Mandatory"), and rejecting the file would be worse — so they are
// detected and skipped, and the skip is REPORTED in the preview.
const META_FIRST_CELLS = new Set([
    normalizeHeader('Mandatory'), normalizeHeader('Optional'),
    normalizeHeader('Conditional Mandatory'), normalizeHeader('Conditional')
]);

export function isMetaRow(cells, columns) {
    const first = normalizeHeader(cell(cells, 0));
    if (!first) return false;
    if (META_FIRST_CELLS.has(first)) return true;
    // The instruction row and the "please delete this example" marker are both
    // prose in the first column. Prose is distinguished from a product name by
    // length — a name is capped at 255 and never runs to a paragraph.
    if (String(cell(cells, 0)).length > 160) return true;
    // Covers the reference sheet's marker ("Please delete this example bellow…")
    // and the one our own template writes. Both are instructions to the reader
    // sitting in the product-name column, and both import as a product if missed.
    if (/^\s*(please\s+)?delete this (row|example)/i.test(String(cell(cells, 0)))) return true;
    // A row whose Unit and Track cells hold instruction prose rather than values.
    if (columns) {
        const unit = String(cell(cells, columns.unit) || '');
        if (unit.length > 40) return true;
    }
    return false;
}

// Find the row that carries the column headers. Not assumed to be row 0: an
// export may carry a title row, and a client may paste the table lower down.
export function detectHeaderRow(rows) {
    const limit = Math.min(rows.length, 20);
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < limit; i++) {
        const score = (rows[i] || []).reduce((n, c) => {
            const k = normalizeHeader(c);
            return n + (k && (ALIAS_LOOKUP.has(k) || k.startsWith(normalizeHeader(CUSTOM_FIELD_PREFIX))) ? 1 : 0);
        }, 0);
        if (score > bestScore) { bestScore = score; best = i; }
    }
    // Two recognized headers is the floor. One is noise — a "Name" column in an
    // unrelated sheet would otherwise be enough to start parsing garbage.
    return bestScore >= 2 ? best : -1;
}

/*
 * Manual column mapping.
 *
 * Auto-detection covers the template's own headers plus the spellings an export
 * or a hand-built file actually produces, in English and Bahasa. It cannot cover
 * what somebody called a column in their own spreadsheet, and a file is not
 * wrong for saying "Nama Bahan" — so `overrides` ({ templateKey: columnIndex })
 * lets the user say what auto-detection could not infer.
 *
 * An override always wins, including over a detected column: the person looking
 * at the file knows better than the alias list.
 */
export const SUPPRESS_COLUMN = -1;

export function applyColumnOverrides(columns, overrides) {
    if (!overrides || !Object.keys(overrides).length) return columns;
    const byKey = { ...columns.byKey };
    const claimed = new Set();
    Object.keys(overrides).forEach((key) => {
        const index = Number(overrides[key]);
        if (!COLUMN_BY_KEY[key] || !Number.isInteger(index)) return;
        // -1 is "do not import this", which has to be expressible: auto-detection
        // can match the wrong column, and without a way to say no the user could
        // only ever ADD a mapping, never remove one.
        if (index === SUPPRESS_COLUMN) { delete byKey[key]; return; }
        if (index < 0) return;
        byKey[key] = index;
        claimed.add(index);
    });
    return {
        ...columns,
        byKey,
        // A column the user has just assigned is no longer "we will not import
        // this" — leaving it in that list would contradict what they just did.
        unknown: (columns.unknown || []).filter((u) => !claimed.has(u.index))
    };
}

export function mapColumns(headerCells) {
    const byKey = {};
    const unknown = [];
    const custom = [];
    const duplicates = [];
    (headerCells || []).forEach((raw, index) => {
        const text = String(raw == null ? '' : raw).trim();
        if (!text) return;
        const norm = normalizeHeader(text);
        if (norm.startsWith(normalizeHeader(CUSTOM_FIELD_PREFIX))) {
            // `custom_field_country origin` → the field is named "country origin".
            const label = text.replace(/^\s*custom[_\s-]*field[_\s-]*/i, '').trim();
            // The template ships the column named literally
            // `custom_field_custom field name` as a placeholder. It is a prompt,
            // not a field, so it is not imported as one.
            if (label && normalizeHeader(label) !== normalizeHeader('custom field name')) {
                custom.push({ index, label: label.slice(0, 40) });
            }
            return;
        }
        const key = ALIAS_LOOKUP.get(norm);
        if (!key) { unknown.push({ index, header: text }); return; }
        if (byKey[key] !== undefined) { duplicates.push({ index, header: text, key }); return; }
        byKey[key] = index;
    });
    return { byKey, unknown, custom, duplicates };
}

// ── Value parsers ────────────────────────────────────────────────────────────

export const AMOUNT_MODES = ['auto', 'id', 'en'];

/*
 * A spreadsheet money cell → integer MINOR units.
 *
 * The separator problem, stated plainly: `10.000` is ten thousand written the
 * Indonesian way and ten written the Anglo way. Which one it is cannot be
 * recovered from the cell — only from the convention the file was written in.
 *
 * Rules, in order:
 *   • Both separators present → the LAST one is the decimal. `1.234,56` and
 *     `1,234.56` both resolve, and neither is a guess.
 *   • One separator, exactly three trailing digits → grouping. `10.000` is ten
 *     thousand. Three decimal places do not exist in any currency FluxyOS keeps
 *     books in, so the other reading is not merely unlikely, it is invalid.
 *   • One separator, one or two trailing digits → decimal. `10.50` is ten-fifty.
 *   • Anything else → grouping.
 *
 * `ambiguous` is raised for the three-trailing-digit case in a currency that HAS
 * minor units, because that is the only reading the rules above resolve by
 * elimination rather than by evidence. The caller surfaces a format choice; it
 * does not silently pick.
 */
export function parseAmountCell(raw, { mode = 'auto', minorPerUnit = 1 } = {}) {
    if (raw instanceof Date) return { minor: null, error: IMP.BAD_NUMBER };
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        // A real spreadsheet number never went through a separator convention.
        if (raw < 0) return { minor: null, error: IMP.BAD_NUMBER };
        return { minor: Math.round(raw * minorPerUnit), ambiguous: false };
    }
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { minor: null, empty: true };
    // Currency symbols and spaces are decoration on an amount, never data.
    const stripped = text.replace(/[\s ]/g, '').replace(/^(rp|idr|php|sgd|myr|rm|s\$|₱)/i, '');
    if (/^-/.test(stripped)) return { minor: null, error: IMP.BAD_NUMBER };
    if (!/^[\d.,]+$/.test(stripped)) return { minor: null, error: IMP.BAD_NUMBER };

    const lastDot = stripped.lastIndexOf('.');
    const lastComma = stripped.lastIndexOf(',');
    let decimalSep = '';
    let ambiguous = false;

    if (mode === 'id') decimalSep = lastComma !== -1 ? ',' : '';
    else if (mode === 'en') decimalSep = lastDot !== -1 ? '.' : '';
    else if (lastDot !== -1 && lastComma !== -1) decimalSep = lastDot > lastComma ? '.' : ',';
    else if (lastDot !== -1 || lastComma !== -1) {
        const sep = lastDot !== -1 ? '.' : ',';
        const at = Math.max(lastDot, lastComma);
        const trailing = stripped.length - at - 1;
        const occurrences = stripped.split(sep).length - 1;
        if (trailing === 3 && occurrences === 1) {
            decimalSep = '';                       // grouping
            ambiguous = minorPerUnit > 1;
        } else if (trailing >= 1 && trailing <= 2 && occurrences === 1) {
            decimalSep = sep;                      // decimal
        } else {
            decimalSep = '';                       // 1.234.567 — grouping throughout
        }
    }

    let whole = stripped;
    let fraction = '';
    if (decimalSep) {
        const at = stripped.lastIndexOf(decimalSep);
        whole = stripped.slice(0, at);
        fraction = stripped.slice(at + 1);
    }
    whole = whole.replace(/[.,]/g, '');
    fraction = fraction.replace(/[.,]/g, '');
    if (!whole && !fraction) return { minor: null, error: IMP.BAD_NUMBER };
    const value = Number(`${whole || '0'}.${fraction || '0'}`);
    if (!Number.isFinite(value)) return { minor: null, error: IMP.BAD_NUMBER };
    return { minor: Math.round(value * minorPerUnit), ambiguous };
}

// A quantity cell → a whole number of base units.
//
// Fractional is REFUSED, not rounded, for the reason `toBase` refuses it: the
// quantity multiplies into a journal amount, so a silent 1.5 → 2 puts an
// invented number in the ledger with nothing to show for it.
export function parseQuantityCell(raw, { mode = 'auto' } = {}) {
    if (raw instanceof Date) return { quantity: null, error: IMP.BAD_NUMBER };
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (raw < 0) return { quantity: null, error: IMP.BAD_NUMBER };
        if (!Number.isInteger(raw)) return { quantity: null, error: IMP.BAD_NUMBER };
        return { quantity: raw };
    }
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { quantity: null, empty: true };
    const parsed = parseAmountCell(text, { mode, minorPerUnit: 1 });
    if (parsed.error) return { quantity: null, error: parsed.error };
    if (parsed.minor == null) return { quantity: null, empty: true };
    // parseAmountCell rounds; a fractional input must fail rather than arrive
    // here already rounded, so the raw text is re-checked for a decimal part.
    const decimalTail = /[.,](\d{1,2})\s*$/.exec(text.replace(/[\s ]/g, ''));
    if (decimalTail && Number(decimalTail[1]) !== 0) return { quantity: null, error: IMP.BAD_NUMBER };
    return { quantity: parsed.minor };
}

const DATE_PATTERNS = [
    { re: /^(\d{4})-(\d{2})-(\d{2})$/, order: ['y', 'm', 'd'] },
    { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
    { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ['d', 'm', 'y'] }
];

/*
 * A date cell → a `YYYY-MM-DD` day key.
 *
 * The template's own format is DD/MM/YYYY, which is what an Indonesian client
 * writes and what the reference sheet's example (`12/12/2024`) carries. That
 * example is deliberately unhelpful — it reads the same either way — so the
 * order is taken from the template, not inferred per row. A file written
 * MM/DD/YYYY will therefore fail on any day past the 12th rather than silently
 * booking an opening balance in the wrong month.
 */
export function parseDateCell(raw) {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return {
            key: [raw.getFullYear(), String(raw.getMonth() + 1).padStart(2, '0'),
                String(raw.getDate()).padStart(2, '0')].join('-')
        };
    }
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { key: null, empty: true };
    for (const pattern of DATE_PATTERNS) {
        const m = pattern.re.exec(text);
        if (!m) continue;
        const parts = {};
        pattern.order.forEach((slot, i) => { parts[slot] = Number(m[i + 1]); });
        const { y, m: month, d } = parts;
        if (!y || !month || !d || month > 12 || d > 31) return { key: null, error: IMP.BAD_DATE };
        const date = new Date(y, month - 1, d, 12, 0, 0, 0);
        // Rejects 31/02 rather than letting Date roll it forward to March.
        if (date.getFullYear() !== y || date.getMonth() !== month - 1 || date.getDate() !== d) {
            return { key: null, error: IMP.BAD_DATE };
        }
        return { key: `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
    }
    return { key: null, error: IMP.BAD_DATE };
}

const YES = new Set(['yes', 'y', 'true', '1', 'ya', 'iya', 'benar']);
const NO = new Set(['no', 'n', 'false', '0', 'tidak', 'bukan']);

export function parseYesNo(raw, fallback = null) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!v) return { value: fallback, empty: true };
    if (YES.has(v)) return { value: true };
    if (NO.has(v)) return { value: false };
    return { value: fallback, error: IMP.BAD_ENUM };
}

export function parseTrackStock(raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!v) return { value: null, empty: true };
    if (v === 'track' || v === 'tracked' || v === 'lacak' || YES.has(v)) return { value: true };
    if (v === 'untrack' || v === 'untracked' || v === 'tidak dilacak' || NO.has(v)) return { value: false };
    return { value: null, error: IMP.BAD_ENUM };
}

export const TRACKING_TYPES = ['qty', 'batch', 'serial'];
// FluxyOS tracks quantity. `batch` and `serial` are recorded verbatim so a
// migration does not destroy what the client knew about their own stock, and are
// reported as unenforced everywhere they appear. Storing them and saying nothing
// would be the worse half of both options.
export const TRACKING_TYPES_ENFORCED = ['qty'];

export function parseTrackingType(raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!v) return { value: null, empty: true };
    if (v === 'qty' || v === 'quantity' || v === 'kuantitas' || v === 'jumlah') return { value: 'qty' };
    if (v === 'batch' || v === 'lot' || v === 'batchnumber') return { value: 'batch', enforced: false };
    if (v === 'serialnumber' || v === 'serial' || v === 'nomorseri') return { value: 'serial', enforced: false };
    return { value: null, error: IMP.BAD_ENUM };
}

export function parseCategories(raw) {
    return String(raw == null ? '' : raw)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 40))
        .slice(0, 8);
}

// A chart-of-accounts code from a foreign system.
//
// Jurnal writes `1-10200`; FluxyOS writes `1200`. There is no arithmetic that
// turns one into the other, and inventing one would attach a stranger's cost to
// the wrong account on every posting. So: an EXACT match against the live chart
// or nothing — the same refusal `matchCashAccounts` makes for bank accounts, and
// for the same reason. An unmatched code is recoverable; a confidently wrong one
// is not.
export function resolveAccountCode(raw, chartCodes) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { code: null, raw: null, empty: true };
    const set = chartCodes instanceof Set ? chartCodes : new Set(chartCodes || []);
    if (set.has(text)) return { code: text, raw: text };
    return { code: null, raw: text.slice(0, 24), unresolved: true };
}

// Same normalization `db-service.saveItem` uses for `name_key`. Duplicated
// deliberately: this module must stay free of Firestore, and a preview that
// deduped differently from the writer would promise a clean import and then
// fail mid-batch.
export function nameKeyOf(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}

function issue(list, code, message, column) {
    list.push({ code, message, column: column || null });
}

/*
 * The whole file → a reviewable plan. Nothing here writes, and nothing here
 * throws for a bad ROW: a single unusable line must not cost the other 299.
 * Only a file that cannot be read at all comes back with `fatal` set.
 *
 * That is a deliberate departure from `analyzeBulkCsv` (the transaction
 * importer), which throws on the first bad row and aborts the file. It is the
 * right call there — six columns, and a bad one usually means the wrong file.
 * It is the wrong call here: an inventory master is long, hand-maintained, and
 * arrives with a handful of bad cells in a file that is otherwise entirely good.
 */
export function analyzeImport(rows, ctx = {}) {
    const {
        minorPerUnit = 1,
        amountMode = 'auto',
        existingItems = [],
        chartCodes = [],
        isPeriodOpen = null,
        todayKey = null,
        maxWrites = MAX_WRITES_PER_BATCH
    } = ctx;

    const grid = Array.isArray(rows) ? rows : [];
    if (!grid.length) {
        return {
            ok: false,
            fatal: importError(IMP.NO_HEADER, 'That file is empty.'),
            rows: []
        };
    }

    // When nothing in the file matches a known header, the first row is TAKEN as
    // the header and the user is asked to map it. Refusing outright was the
    // obvious first behaviour and it is wrong: a shop keeping its list under
    // "Bahan / Takaran / Harga" has a perfectly good file, and telling them it
    // is unreadable when the only missing piece is which column is which turns a
    // thirty-second answer into a dead end. A genuinely wrong file still fails
    // here — it just fails with the columns on screen, which is the more useful
    // way to find out.
    const detected = detectHeaderRow(grid);
    const headerIndex = detected === -1 ? 0 : detected;
    const headerUnrecognized = detected === -1;

    const columns = applyColumnOverrides(mapColumns(grid[headerIndex]), ctx.columnOverrides);
    const missingRequired = ['name', 'unit'].filter((k) => columns.byKey[k] === undefined);
    if (missingRequired.length) {
        // NOT fatal: the file is readable, we just cannot tell which column is
        // which. Returning `needsMapping` sends the user to the mapping step
        // with the file's own headers to choose from, instead of telling
        // somebody whose column says "Nama Bahan" that their file is wrong.
        return {
            ok: false,
            needsMapping: true,
            columns,
            headerIndex,
            missingRequired,
            headerCells: grid[headerIndex] || [],
            fatal: importError(headerUnrecognized ? IMP.NO_HEADER : IMP.MISSING_COLUMN,
                headerUnrecognized
                    ? 'None of these column names look familiar, so we have taken the first row as your headers. Point us at the right column below.'
                    : `We could not find ${missingRequired.map((k) => `"${templateColumn(k).header}"`).join(' and ')} in this file. Point us at the right column below.`,
                { missing: missingRequired }),
            rows: [],
            summary: { total: 0, ready: 0, errors: 0, skipped: 0, warnings: 0, withOpening: 0, openingValueMinor: 0, ambiguousAmounts: 0, untracked: 0, unenforcedTracking: 0, writes: 0 }
        };
    }

    const chartSet = chartCodes instanceof Set ? chartCodes : new Set(chartCodes || []);
    const existingNames = new Map();
    const existingSkus = new Map();
    (existingItems || []).forEach((i) => {
        if (!i) return;
        if (i.name_key || i.name) existingNames.set(i.name_key || nameKeyOf(i.name), i);
        if (i.sku) existingSkus.set(String(i.sku).toLowerCase(), i);
    });

    const seenNames = new Map();
    const seenSkus = new Map();
    const out = [];
    let skippedMetaRows = 0;

    for (let r = headerIndex + 1; r < grid.length; r++) {
        const cells = grid[r] || [];
        if (!cells.some((c) => String(c == null ? '' : c).trim() !== '')) continue;
        if (isMetaRow(cells, columns.byKey)) { skippedMetaRows++; continue; }
        if (out.length >= MAX_IMPORT_ROWS) break;

        const line = r + 1;                         // 1-based, matches the spreadsheet
        const errors = [];
        const warnings = [];
        const at = (key) => cell(cells, columns.byKey[key]);
        const has = (key) => columns.byKey[key] !== undefined;

        // ── Identity ────────────────────────────────────────────────────────
        const name = String(at('name') || '').trim();
        if (!name) issue(errors, IMP.MISSING_COLUMN, 'Product Name is required.', 'name');
        else if (name.length > 120) {
            issue(errors, IMP.BAD_ENUM,
                `Product Name is ${name.length} characters; FluxyOS allows 120. Shorten it — truncating it here would change the name you meant.`, 'name');
        }

        const sku = String(at('sku') || '').trim().slice(0, 60) || null;

        // ── Unit ────────────────────────────────────────────────────────────
        //
        // A purely numeric unit is almost always the conversion factor typed into
        // the wrong column, and `base_unit` is IMMUTABLE — every recorded
        // quantity is a count of it — so the item can never be repaired
        // afterwards, only replaced. Caught here, once, for free.
        const unit = String(at('unit') || '').trim();
        if (!unit) issue(errors, IMP.MISSING_COLUMN, 'Unit is required — the unit you count this item in.', 'unit');
        else if (/^[\d.,]+$/.test(unit)) {
            issue(errors, IMP.UNIT_IS_NUMERIC,
                `"${unit}" is a number, not a unit. Unit is what you count in — pcs, kg, g, liter. The unit can never be changed after the item exists.`, 'unit');
        } else if (unit.length > 16) {
            issue(errors, IMP.BAD_ENUM, `Unit "${unit}" is longer than 16 characters.`, 'unit');
        }

        // ── Stock tracking ──────────────────────────────────────────────────
        const track = parseTrackStock(at('track_stock'));
        if (track.error) {
            issue(errors, IMP.BAD_ENUM, `Track Stock must be "Track" or "Untrack" — got "${at('track_stock')}".`, 'track_stock');
        } else if (track.empty) {
            if (has('track_stock')) {
                issue(errors, IMP.BAD_ENUM,
                    'Track Stock is blank. It decides whether this item is ever held as stock, so it is not guessed.', 'track_stock');
            }
        }
        const trackStock = track.value === null ? true : track.value;

        const tracking = parseTrackingType(at('tracking_type'));
        if (tracking.error) {
            issue(errors, IMP.BAD_ENUM, `Tracking Type must be Qty, Batch, or Serial Number — got "${at('tracking_type')}".`, 'tracking_type');
        } else if (tracking.value && tracking.enforced === false) {
            issue(warnings, IMP.BAD_ENUM,
                `Tracking Type "${at('tracking_type')}" is recorded but not enforced — FluxyOS tracks this item by quantity. Batch and serial numbers are not held.`, 'tracking_type');
        }
        const trackingType = trackStock ? (tracking.value || 'qty') : null;

        // ── Reorder point ───────────────────────────────────────────────────
        const buffer = parseQuantityCell(at('buffer_quantity'), { mode: amountMode });
        let reorderPoint = null;
        if (buffer.error) {
            issue(errors, IMP.BAD_NUMBER, `Buffer Quantity must be a whole number of ${unit || 'base units'}.`, 'buffer_quantity');
        } else if (buffer.quantity === 0) {
            // The item drawer REFUSES a typed 0 rather than normalizing it. A bulk
            // file is different: one 0 must not cost the row, and 51 items were
            // once stored with a silent 0 precisely because nothing said anything.
            // So it is normalized to "no threshold" — the meaning — and reported.
            issue(warnings, IMP.BAD_NUMBER,
                'Buffer Quantity 0 imported as no threshold. A threshold of 0 can never warn you: reaching zero is already reported as Out of stock.', 'buffer_quantity');
        } else if (buffer.quantity != null) {
            reorderPoint = buffer.quantity;
        }

        // ── Sell / buy ──────────────────────────────────────────────────────
        const sold = parseYesNo(at('is_sold'), false);
        if (sold.error) issue(errors, IMP.BAD_ENUM, `"I Sell This Item" must be Yes or No — got "${at('is_sold')}".`, 'is_sold');
        const bought = parseYesNo(at('is_bought'), false);
        if (bought.error) issue(errors, IMP.BAD_ENUM, `"I Buy This Item" must be Yes or No — got "${at('is_bought')}".`, 'is_bought');

        const sellPrice = parseAmountCell(at('sell_price'), { mode: amountMode, minorPerUnit });
        if (sellPrice.error) issue(errors, IMP.BAD_NUMBER, `Sell Price "${at('sell_price')}" is not a number.`, 'sell_price');
        if (sold.value === true && sellPrice.minor == null && !sellPrice.error) {
            issue(warnings, IMP.BAD_NUMBER, 'Sold with no Sell Price. Imported without a price — set one before it appears on a till.', 'sell_price');
        }
        const buyPrice = parseAmountCell(at('buy_price'), { mode: amountMode, minorPerUnit });
        if (buyPrice.error) issue(errors, IMP.BAD_NUMBER, `Buy Price "${at('buy_price')}" is not a number.`, 'buy_price');

        // ── Account codes ───────────────────────────────────────────────────
        const invAcct = resolveAccountCode(at('inventory_account'), chartSet);
        if (invAcct.unresolved) {
            issue(warnings, IMP.BAD_ENUM,
                `Inventory account "${invAcct.raw}" is not in your chart of accounts. Recorded as-is; stock posts to 1200 Inventory either way.`, 'inventory_account');
        }
        const sellAcct = resolveAccountCode(at('sell_account'), chartSet);
        if (sellAcct.unresolved) {
            issue(warnings, IMP.BAD_ENUM,
                `Sell account "${sellAcct.raw}" is not in your chart of accounts. Recorded as-is; revenue routing is set in Accounting → Account Mapping.`, 'sell_account');
        }
        const buyAcct = resolveAccountCode(at('buy_account'), chartSet);
        if (buyAcct.unresolved) {
            issue(warnings, IMP.BAD_ENUM,
                `Cost account "${buyAcct.raw}" is not in your chart of accounts. This item's cost will post to 5100 Cost of Goods Sold.`, 'buy_account');
        }

        // ── Opening balance ─────────────────────────────────────────────────
        const openQty = parseQuantityCell(at('opening_qty'), { mode: amountMode });
        const openPrice = parseAmountCell(at('opening_price'), { mode: amountMode, minorPerUnit });
        const openDate = parseDateCell(at('opening_date'));
        let opening = null;

        if (openQty.error) {
            issue(errors, IMP.BAD_NUMBER,
                `Opening Balance Stock must be a whole number of ${unit || 'base units'} — "${at('opening_qty')}" is not.`, 'opening_qty');
        } else if (openQty.quantity != null && openQty.quantity > 0) {
            if (!trackStock) {
                issue(errors, IMP.OPENING_ON_UNTRACKED,
                    'This item is set to Untrack but carries opening stock. An untracked item is never held as stock — set Track, or clear the opening balance.', 'opening_qty');
            }
            if (openPrice.error) {
                issue(errors, IMP.BAD_NUMBER, `Opening Balance Price "${at('opening_price')}" is not a number.`, 'opening_price');
            } else if (openPrice.minor == null || openPrice.minor <= 0) {
                issue(errors, IMP.OPENING_INCOMPLETE,
                    'Opening stock needs a price. Stock with no value would put quantity on the shelf and nothing in the ledger, and 1200 Inventory would stop tying to the subledger.', 'opening_price');
            }
            if (openDate.error) {
                issue(errors, IMP.BAD_DATE, `Opening Balance Date "${at('opening_date')}" is not a date. Use DD/MM/YYYY.`, 'opening_date');
            } else if (!openDate.key) {
                issue(errors, IMP.OPENING_INCOMPLETE,
                    'Opening stock needs a date — it decides which accounting period the balance lands in.', 'opening_date');
            } else {
                if (todayKey && openDate.key > todayKey) {
                    issue(errors, IMP.BAD_DATE, 'Opening Balance Date is in the future.', 'opening_date');
                }
                if (typeof isPeriodOpen === 'function' && !isPeriodOpen(openDate.key)) {
                    issue(errors, IMP.PERIOD_CLOSED,
                        `${openDate.key.slice(0, 7)} is a closed accounting period. Reopen it, or date the opening balance in an open one.`, 'opening_date');
                }
            }
            if (!errors.length) {
                opening = {
                    quantity: openQty.quantity,
                    unit_price_minor: openPrice.minor,
                    // The reference template's Opening Balance Price is a UNIT
                    // price (its example pairs 100 units at 6.000 against a buy
                    // price of 5.000). The movement stores the TOTAL, because
                    // `amount` is authoritative and unit cost is derived — so the
                    // multiplication happens once, here, on two integers.
                    amount_minor: openQty.quantity * openPrice.minor,
                    date_key: openDate.key
                };
            }
        } else if ((openPrice.minor != null || openDate.key) && !openQty.error) {
            issue(warnings, IMP.OPENING_INCOMPLETE,
                'Opening price or date given with no opening quantity. No opening balance will be recorded for this item.', 'opening_qty');
        }

        if (sellPrice.ambiguous || buyPrice.ambiguous || openPrice.ambiguous) {
            issue(warnings, IMP.BAD_NUMBER,
                'An amount on this row could be read two ways (1.500 is one thousand five hundred, or one point five). Confirm the number format above.', 'sell_price');
        }

        // ── Duplicates ──────────────────────────────────────────────────────
        const key = nameKeyOf(name);
        let status = errors.length ? 'error' : 'ready';
        if (name && status === 'ready') {
            if (seenNames.has(key)) {
                issue(errors, IMP.DUPLICATE_IN_FILE, `"${name}" appears twice in this file (also on row ${seenNames.get(key)}).`, 'name');
                status = 'error';
            } else if (existingNames.has(key)) {
                issue(warnings, IMP.ALREADY_EXISTS, `"${name}" already exists in your inventory. This row will be skipped, not overwritten.`, 'name');
                status = 'skipped';
            } else {
                seenNames.set(key, line);
            }
        }
        if (sku && status === 'ready') {
            const sk = sku.toLowerCase();
            if (seenSkus.has(sk)) {
                issue(errors, IMP.DUPLICATE_IN_FILE, `SKU "${sku}" appears twice in this file (also on row ${seenSkus.get(sk)}).`, 'sku');
                status = 'error';
            } else if (existingSkus.has(sk)) {
                // A duplicate SKU makes the marketplace join ambiguous and would
                // relieve the wrong item's cost on a sale. Never auto-resolved.
                issue(errors, IMP.ALREADY_EXISTS, `SKU "${sku}" is already used by another item.`, 'sku');
                status = 'error';
            } else {
                seenSkus.set(sk, line);
            }
        }

        const custom = {};
        columns.custom.forEach((c) => {
            const v = String(cell(cells, c.index) || '').trim();
            if (v) custom[c.label] = v.slice(0, 200);
        });

        out.push({
            line,
            name,
            status,
            errors,
            warnings,
            opening: status === 'ready' ? opening : null,
            custom,
            draft: {
                name,
                type: 'stock',
                base_unit: unit,
                units: [],
                sku,
                notes: String(at('description') || '').trim().slice(0, 500) || null,
                barcode: String(at('barcode') || '').trim().slice(0, 32) || null,
                categories: parseCategories(at('categories')),
                track_stock: trackStock,
                tracking_type: trackingType,
                reorder_point: reorderPoint,
                is_sold: sold.value === true,
                sales_price: sellPrice.minor,
                is_purchased: bought.value === true,
                purchase_price: buyPrice.minor,
                // Resolved against the live chart, or the seed default. The raw
                // value the client sent is kept beside it so a migration is
                // reversible and a mis-set code is diagnosable.
                default_cogs_account_code: buyAcct.code || '5100',
                default_inventory_account_code: invAcct.code || null,
                default_sales_account_code: sellAcct.code || null,
                default_sales_tax_name: String(at('sell_tax') || '').trim().slice(0, 40) || null,
                default_purchase_tax_name: String(at('buy_tax') || '').trim().slice(0, 40) || null,
                source_account_codes: (invAcct.unresolved || sellAcct.unresolved || buyAcct.unresolved)
                    ? {
                        inventory: invAcct.unresolved ? invAcct.raw : null,
                        sales: sellAcct.unresolved ? sellAcct.raw : null,
                        cogs: buyAcct.unresolved ? buyAcct.raw : null
                    }
                    : null,
                custom_fields: Object.keys(custom).length ? custom : null,
                // An item that is sold is visible on the till. Nothing else in the
                // template says "put this on the menu", and an F&B client
                // importing their sellable goods means exactly that.
                pos_visible: sold.value === true,
                pos_category: parseCategories(at('categories'))[0] || null
            }
        });
    }

    const ready = out.filter((r) => r.status === 'ready');
    const withOpening = ready.filter((r) => r.opening);
    // Each distinct opening DATE adds a journal plus its two ledger_balances
    // rows (1200 and 3900). Counting only items and movements would under-report
    // the batch and let a file through that Firestore then rejects whole.
    const openingDates = new Set(withOpening.map((r) => r.opening.date_key));
    const writes = ready.length + withOpening.length + openingDates.size * 3;
    const summary = {
        total: out.length,
        ready: ready.length,
        errors: out.filter((r) => r.status === 'error').length,
        skipped: out.filter((r) => r.status === 'skipped').length,
        warnings: out.filter((r) => r.warnings.length).length,
        withOpening: withOpening.length,
        openingValueMinor: withOpening.reduce((s, r) => s + r.opening.amount_minor, 0),
        ambiguousAmounts: out.filter((r) => r.warnings.some((w) => /read two ways/.test(w.message))).length,
        untracked: ready.filter((r) => !r.draft.track_stock).length,
        unenforcedTracking: ready.filter((r) => r.draft.tracking_type && r.draft.tracking_type !== 'qty').length,
        writes
    };

    let fatal = null;
    if (!out.length) {
        fatal = importError(IMP.NO_ROWS,
            'The file has headers but no product rows. Add your items under the header row and upload again.');
    } else if (writes > maxWrites) {
        fatal = importError(IMP.TOO_MANY_ROWS,
            `This file needs ${writes} writes (${ready.length} items plus ${withOpening.length} opening balances) and one import is capped at ${maxWrites}. Split it into smaller files.`,
            { writes, maxWrites });
    }

    return {
        ok: !fatal,
        fatal,
        headerIndex,
        columns,
        headerCells: grid[headerIndex] || [],
        skippedMetaRows,
        rows: out,
        summary
    };
}

// ── The downloadable template ────────────────────────────────────────────────
//
// Column-for-column the reference sheet, INCLUDING its requirement row and its
// instruction row, so a client who already keeps this format can paste straight
// in and a client seeing it for the first time gets the same guidance the Head
// of Finance wrote. `analyzeImport` skips those two rows on the way back in.
//
// The example rows are ours, not the reference's `Product A / SKUA`. Two reasons
// they had to change: the reference's account codes are Jurnal's (`1-10200`) and
// would teach a code that resolves to nothing here, and a template is the one
// piece of documentation everybody reads — a generic example teaches nothing
// about how to describe a real kitchen.
export function buildTemplateRows({ todayKey = null } = {}) {
    // Dated to the first of the current month so the sample's opening balances
    // always land in an open period. A hardcoded date turns the template into a
    // file that silently fails to import a few months after it was written.
    const day = String(todayKey || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
    const firstOfMonth = day ? `01/${day[2]}/${day[1]}` : '01/01/2026';

    const examples = [
        ['Kopi Arabika Gayo', 'KOPI-ARB-001', 'Biji kopi single origin, karung 5 kg', '8991234567890',
            'g', 'Bahan Baku;Kopi', 'Track', 'Qty', '1200', '2000',
            'No', '', '', '', 'Yes', '150', '5100', 'PPN Masukan',
            '25000', '150', firstOfMonth, ''],
        ['Susu UHT Full Cream', 'SUSU-UHT-1L', 'Karton isi 12 x 1 liter', '8991234567891',
            'ml', 'Bahan Baku;Dairy', 'Track', 'Qty', '1200', '12000',
            'No', '', '', '', 'Yes', '18', '5100', 'PPN Masukan',
            '48000', '18', firstOfMonth, ''],
        ['Es Kopi Susu Gula Aren', 'MENU-EKS-001', 'Menu andalan, disajikan dingin', '',
            'porsi', 'Minuman', 'Track', 'Qty', '1200', '',
            'Yes', '22000', '4000', 'PPN Keluaran', 'No', '', '', '',
            '', '', '', ''],
        ['Jasa Konsultasi Menu', 'JASA-KONSUL', 'Layanan — tidak disimpan sebagai stok', '',
            'jam', 'Jasa', 'Untrack', '', '', '',
            'Yes', '500000', '4000', 'PPN Keluaran', 'No', '', '', '',
            '', '', '', '']
    ];

    return [
        TEMPLATE_COLUMNS.map((c) => c.header),
        TEMPLATE_COLUMNS.map((c) => c.requirement),
        TEMPLATE_COLUMNS.map((c) => c.instruction),
        ['Delete this row and the two above it, then enter your products from here down.']
            .concat(new Array(TEMPLATE_COLUMNS.length - 1).fill('')),
        ...examples
    ];
}

// RFC 4180: every field quoted, embedded quotes doubled. The instruction row
// carries commas, quotes AND newlines, so a naive join corrupts the file.
export function toCsv(rows) {
    return (rows || [])
        .map((row) => (row || [])
            .map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`)
            .join(','))
        .join('\r\n');
}

export function buildTemplateCsv(opts) {
    // A BOM so Excel opens the file as UTF-8 instead of mangling "Kopi Arabika
    // Gayo" and every Rupiah figure the user later pastes beside it.
    return `﻿${toCsv(buildTemplateRows(opts))}`;
}

// Columns present in the file that FluxyOS will not import, with the reason.
// Rendered in the preview BEFORE the confirm, because the cost of finding out
// afterwards is a re-migration.
export function unmappedColumnReport(columns) {
    const out = [];
    (columns && columns.unknown ? columns.unknown : []).forEach((u) => {
        out.push({ header: u.header, reason: 'Not a template column — this data will not be imported.' });
    });
    (columns && columns.duplicates ? columns.duplicates : []).forEach((d) => {
        out.push({ header: d.header, reason: `Repeats the "${templateColumn(d.key).header}" column. Only the first is used.` });
    });
    return out;
}
