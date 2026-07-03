#!/usr/bin/env node
/**
 * FluxyOS dashboard i18n coverage audit.
 *
 * Re-runnable coverage harvester for the dashboard language engine
 * (assets/js/dashboard-i18n.js) — the permanent version of the /tmp harvester
 * described in docs/LOCALIZATION_PLAN.md §12.
 *
 * What it does:
 *   1. Parses the ID dictionary + PATTERNS regexes out of dashboard-i18n.js.
 *   2. Extracts candidate user-facing strings from every app page (markup text
 *      nodes, placeholder/aria-label/title/alt/data-tooltip attributes, <title>)
 *      and from JS (inline page scripts + assets/js): showToast / dialog copy,
 *      textContent/innerHTML writes, setAttribute display attrs, and the text
 *      inside HTML-building template literals.
 *   3. Classifies every uncovered candidate as English (needs a dictionary
 *      key), interpolated (needs a PATTERNS entry or FluxyI18n.t()), or
 *      unclassified (manual review), and writes .qa/i18n-gap-report.md.
 *
 * Usage:  node scripts/i18n-audit.js [--strict] [--landing]
 *   --strict   exit 1 when any "English" gaps remain (CI-friendly).
 *   --landing  audit the marketing/landing pages against assets/js/i18n.js
 *              (casual register) instead of the dashboard.
 *
 * Caveat: markup candidates are whitespace-collapsed before matching. A text
 * node that hard-wraps inside the HTML source can be reported as covered while
 * the runtime walker (which matches the raw trimmed node) misses it — QA each
 * page at lang=id remains the final check.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const LANDING = process.argv.includes('--landing');
const ENGINE = path.join(ROOT, 'assets', 'js', LANDING ? 'i18n.js' : 'dashboard-i18n.js');
const REPORT = path.join(ROOT, '.qa', LANDING ? 'i18n-gap-report-landing.md' : 'i18n-gap-report.md');

// Marketing/landing pages (casual register, assets/js/i18n.js).
const LANDING_PAGES = [
    'fluxyos.html', 'pricing.html', 'vendorspend.html', 'revenuesync.html',
    'receiptcapture.html', 'aiagents.html', 'budgetlanding.html',
];

// Authenticated app pages in localization scope (docs/LOCALIZATION_PLAN.md §12).
// login.html and the marketing/landing pages are handled by assets/js/i18n.js.
const APP_PAGES = [
    'dashboard.html', 'ledger.html', 'bill.html', 'subscription.html', 'invoices.html',
    'budget.html', 'budget-period.html', 'budget-allocation.html',
    'accounting.html', 'accounting-journal.html', 'accounting-journal-new.html', 'accounting-records.html',
    'balance-sheet.html', 'balance-sheet-records.html', 'reports.html', 'report-preview.html',
    'tax-center.html', 'revenue-sync.html', 'integration.html', 'ai.html', 'activity-log.html',
    'settings.html', 'settings-personal.html', 'settings-business.html', 'settings-finance.html',
    'settings-language.html', 'settings-notifications.html', 'settings-security.html', 'settings-team.html',
    'settings-ai.html', 'settings-billing.html', 'settings-budget.html', 'settings-cash.html',
    'settings-import-rules.html', 'settings-whatsapp.html',
    'onboarding.html', 'checkout.html', 'payment-pending.html',
    'internal.html',
];

// Shared/page JS that renders user-facing copy. Everything in assets/js except
// the two i18n engines, vendor bundles, and landing-only scripts.
const JS_EXCLUDE = new Set([
    'dashboard-i18n.js', 'i18n.js', 'footer-loader.js', 'universe-canvas.js',
    'fluxyos.js', 'investor.js', // landing-page scripts (assets/js/i18n.js territory)
]);

// Strings that intentionally stay English (docs/LOCALIZATION_PLAN.md §2), plus
// non-UI noise the harvester should never report. Full-string, case-sensitive.
const ALLOWLIST = new Set([
    // Product surfaces + pricing tiers
    'FluxyOS', 'Fluxy AI', 'Revenue Sync', 'Vendor Spend', 'Receipt Capture',
    'Dynamic Budgeting', 'AI Agents', 'Starter', 'Core Ops', 'Growth Engine',
    'Enterprise AI', 'Fluxy',
    // 3rd-party brands
    'AWS', 'Stripe', 'Shopify', 'Tokopedia', 'TikTok Shop', 'Alibaba', 'Moka',
    'Xendit', 'Midtrans', 'WooCommerce', 'Slack', 'Notion', 'Figma', 'Adobe',
    'GitHub', 'Vercel', 'Cloudflare', 'Discord', 'Loom', 'Zoom',
    'Google Workspace', 'Microsoft 365', 'Asana', 'Canva', 'Dribbble',
    'Mandiri', 'BCA', 'BNI', 'BRI', 'GoPay', 'OVO', 'QRIS', 'Google', 'Netlify',
    'WhatsApp', 'Instagram', 'Facebook', 'OpenAI',
    // Loanwords / codes / tax acronyms that stay as-is
    'Dashboard', 'Invoice', 'Invoices', 'Email', 'Online', 'Link', 'File',
    'Upload', 'Scan', 'Screenshot', 'CSV', 'PDF', 'XLS', 'XLSX', 'JPG', 'PNG',
    'WebP', 'OK', 'ID', 'EN', 'AI', 'API', 'URL', 'IDR', 'USD', 'EUR', 'Rp',
    'NPWP', 'NIK', 'SPT', 'PPN', 'PPh', 'e-Faktur', 'Faktur Pajak',
    'Bukti Potong', 'PKP', 'Non-PKP', 'DJP', 'Coretax', 'PPh Final UMKM',
    'KPP', 'KLU', 'DPP', 'P&L', 'ARR', 'KPI', 'WIB', 'E.164',
    'Burn rate', 'Runway', 'Live', 'Vendor', 'Supplier', 'Admin', 'Log',
    // Country-code option labels identical in Indonesian
    'Indonesia +62', 'Malaysia +60', 'Australia +61',
    // Loanwords in Indonesian business usage / technical identifiers & samples
    'Meeting', 'Outreach', 'Username', 'fluxyos admin', 'LAUNCH20', 'KYC',
    'PDF + CSV', 'YYYY-MM', 'INV-2026-001', 'users/<you>/bank_statement_imports/',
    'action: export.create', 'target: report_exports',
    // Identical-in-Indonesian labels, codes, and samples
    'FluxyOS Core System v2.4.1', 'PPh 23', 'PPh 26', 'PPh 4(2)', 'SPT PPN',
    'SPT PPh Unifikasi', 'PPN —', 'BCA Business', 'Meta Ads', 'Bank / Indonesia',
    'AP', 'DQ', 'EX', 'LG', 'SA', 'Asia/Jakarta', 'Asia/Jayapura', 'Asia/Makassar',
    'DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'Vendor: —', 'Indonesia', 'Manual',
    'F.', 'Voucher',
]);

const ENGLISH_WORDS = new Set(('the a an to of and or for your you is are was be been with this that from in on at by ' +
    'no not yet all any add save cancel delete edit new name date amount account loading please failed could would will ' +
    'has have can cannot select choose enter upload download export import search filter show showing view manage set ' +
    'get more less total paid unpaid pending overdue due done next previous back continue confirm close open create ' +
    'update remove required optional error success warning week month year day days today yesterday tomorrow when what ' +
    'how why where which who first last before after only need needs try again something went wrong sure want').split(' '));

const INDONESIAN_WORDS = new Set(('dan atau yang untuk dengan dari akan sudah belum tidak bisa jika ini itu di ke pada ' +
    'oleh saat semua tanpa dalam anda kami telah lebih baru tambah simpan batal hapus ubah tagihan anggaran pajak ' +
    'transaksi pendapatan pengeluaran langganan laporan pengaturan berhasil gagal pilih masukkan menampilkan catatan ' +
    'terpakai sisa memuat hari bulan tahun jatuh tempo lunas tertunda selesai coba lagi periksa ulang belum ada ' +
    'silakan atur kelola lihat unduh ekspor impor cari muat perbarui terjadi kesalahan').split(' '));

const INTERP = '⟨x⟩'; // placeholder for ${…} in template literals

// ── Engine parsing ──────────────────────────────────────────────────────────

function loadEngine() {
    const src = fs.readFileSync(ENGINE, 'utf8');
    const idStart = src.indexOf('var ID = {');
    // The landing engine has no PATTERNS list — its dictionary ends at the
    // first top-of-IIFE "};" line after the object opens.
    const patternsStart = LANDING ? src.indexOf('\n    };', idStart) + '\n    };'.length : src.indexOf('var PATTERNS = [');
    if (idStart === -1 || patternsStart === -1) {
        throw new Error('Could not locate the ID dictionary in ' + path.basename(ENGINE));
    }
    let dictText = src.slice(idStart + 'var ID ='.length, patternsStart);
    dictText = dictText.slice(0, dictText.lastIndexOf('};') + 1);
    const dict = vm.runInNewContext('(' + dictText + ')', {});

    const patterns = [];
    let m;
    if (!LANDING) {
        const patternsText = src.slice(patternsStart, src.indexOf('\n    ];', patternsStart));
        const reLit = /re:\s*\/((?:\\.|[^/\n])+)\/([a-z]*)/g;
        while ((m = reLit.exec(patternsText))) patterns.push(new RegExp(m[1], m[2]));
    }

    // Duplicate keys silently shadow each other in the object literal — flag them.
    const seen = new Set();
    const duplicates = [];
    const keyLine = /^\s{8}"((?:\\.|[^"\\])+)":/gm;
    while ((m = keyLine.exec(dictText))) {
        if (seen.has(m[1])) duplicates.push(m[1]);
        seen.add(m[1]);
    }

    return { dict, patterns, duplicates };
}

// ── Candidate extraction ────────────────────────────────────────────────────

function decodeEntities(s) {
    return s
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
        .replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&larr;/g, '←')
        .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“')
        .replace(/&rdquo;/g, '”').replace(/&times;/g, '×').replace(/&ndash;/g, '–')
        .replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&rsaquo;/g, '›')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function normalize(s) {
    return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

// Pull text-node candidates + display-attribute values out of an HTML fragment.
function extractFromMarkup(html, out) {
    let t;
    const text = />([^<>]+)</g;
    while ((t = text.exec(html))) out.add(normalize(t[1]));
    const attrs = /(?:placeholder|aria-label|title|alt|data-tooltip)\s*=\s*("([^"]*)"|'([^']*)')/g;
    while ((t = attrs.exec(html))) out.add(normalize(t[2] !== undefined ? t[2] : t[3]));
}

// Pull user-facing string literals out of JS source.
function extractFromJs(js, out) {
    let m;
    // Dialog bodies etc. may embed inline HTML — at runtime the walker sees the
    // text SEGMENTS between tags, so audit those segments, not the raw string.
    const addLiteral = (raw) => {
        if (/<[a-zA-Z]/.test(raw)) {
            extractFromMarkup(' >' + raw.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, INTERP) + '< ', out);
        } else {
            out.add(normalizeJsLiteral(raw));
        }
    };
    // showToast('…') / alert('…') / confirm('…') — first string arg (any quote)
    const call = /(?:showToast|window\.alert|window\.confirm)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    while ((m = call.exec(js))) addLiteral(m[2]);
    // showConfirmDialog / showAlertDialog copy props
    const prop = /\b(?:title|body|confirmLabel|cancelLabel|label|placeholder|emptyText|helperText)\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    while ((m = prop.exec(js))) addLiteral(m[2]);
    // .textContent = / .innerText = / document.title = — string or template literal
    const assign = /\.(?:textContent|innerText|title)\s*=\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    while ((m = assign.exec(js))) out.add(normalizeJsLiteral(m[2]));
    // setAttribute('placeholder'|'aria-label'|'title'|'alt'|'data-tooltip', '…')
    const setAttr = /setAttribute\(\s*['"](?:placeholder|aria-label|title|alt|data-tooltip)['"]\s*,\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    while ((m = setAttr.exec(js))) out.add(normalizeJsLiteral(m[2]));
    // HTML built in template literals (innerHTML writes, drawer/modal markup):
    // treat every backtick literal that contains a tag as markup.
    const tpl = /`((?:\\.|[^`\\])*)`/g;
    while ((m = tpl.exec(js))) {
        const body = m[1];
        if (!/<[a-zA-Z]/.test(body)) continue;
        extractFromMarkup(body.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, INTERP), out);
    }
}

function normalizeJsLiteral(raw) {
    return normalize(
        raw.replace(/\$\{[^}]*\}/g, INTERP)
           .replace(/\\n/g, ' ').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')
    );
}

// ── Classification ──────────────────────────────────────────────────────────

function classify(candidate, engine, dictValues) {
    const c = candidate;
    if (!c || c.length < 2) return null;
    if (!/[A-Za-z]/.test(c)) return null;                                   // numbers, icons, punctuation
    if (!/[A-Za-z]/.test(c.split(INTERP).join(''))) return null;            // pure-interpolation artifacts
    if (/^[\d\s.,:%+\-–—/()RpQ]*$/.test(c)) return null;                    // amounts, "Q1 2026" fragments
    if (/^(https?:|mailto:|tel:|\/|#|\.|@|[A-Za-z]:\\)/.test(c)) return null; // URLs/paths/anchors
    if (/^[A-Za-z][\w-]*(\.(js|css|html|svg|png|jpg|json|md))$/.test(c)) return null; // file names
    if (ALLOWLIST.has(c)) return null;
    if (Object.prototype.hasOwnProperty.call(engine.dict, c)) return null;  // covered by a key
    if (dictValues.has(c)) return null;                                     // already Indonesian
    // Probe PATTERNS with plausible runtime values: markers directly after a
    // letter are plural suffixes ('s'); the rest are tried as a number, an
    // amount, and a percentage.
    const probes = ['1', 'Rp1.000', '1%'].map((v) => c
        .replace(new RegExp('([A-Za-z])' + INTERP, 'g'), '$1s')
        .replace(new RegExp(INTERP, 'g'), v)
        .replace(/\s+/g, ' ').trim());
    if (probes.some((p) => /^[\d\s.,:%+\-–—/()RpQ]*$/.test(p))) return null; // pure amount once interpolated
    if (probes.some((p) => engine.patterns.some((re) => re.test(p)))) return null; // covered by PATTERNS

    const words = c.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
    const en = words.filter((w) => ENGLISH_WORDS.has(w)).length;
    const idn = words.filter((w) => INDONESIAN_WORDS.has(w)).length;
    if (idn > en) return null;                                              // Indonesian copy — fine
    const bucket = c.includes(INTERP) ? 'interpolated' : (en > 0 ? 'english' : 'unclassified');
    return bucket;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
    const strict = process.argv.includes('--strict');
    const engine = loadEngine();
    const dictValues = new Set(Object.values(engine.dict));

    const results = [];  // { source, english[], interpolated[], unclassified[], noEngine }
    let totals = { english: 0, interpolated: 0, unclassified: 0 };

    const auditSource = (label, candidates, noEngine) => {
        const buckets = { english: [], interpolated: [], unclassified: [] };
        for (const c of candidates) {
            const b = classify(c, engine, dictValues);
            if (b) buckets[b].push(c);
        }
        for (const k of Object.keys(buckets)) {
            buckets[k] = [...new Set(buckets[k])].sort();
            totals[k] += buckets[k].length;
        }
        if (buckets.english.length || buckets.interpolated.length || buckets.unclassified.length || noEngine) {
            results.push({ source: label, ...buckets, noEngine });
        }
    };

    for (const page of (LANDING ? LANDING_PAGES : APP_PAGES)) {
        const file = path.join(ROOT, page);
        if (!fs.existsSync(file)) continue;
        const html = fs.readFileSync(file, 'utf8');
        const candidates = new Set();
        // <title>
        const title = html.match(/<title>([^<]*)<\/title>/i);
        if (title) candidates.add(normalize(title[1]));
        // Inline scripts → JS extraction; remaining markup → markup extraction.
        let inline = '';
        const markup = html
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body) => { inline += body + '\n'; return ''; })
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
        extractFromMarkup(markup, candidates);
        extractFromJs(inline, candidates);
        auditSource(page, candidates, LANDING ? !/assets\/js\/i18n\.js/.test(html) : !/dashboard-i18n\.js/.test(html));
    }

    if (!LANDING) {
        for (const name of fs.readdirSync(path.join(ROOT, 'assets', 'js')).sort()) {
            if (!name.endsWith('.js') || name.endsWith('.min.js') || JS_EXCLUDE.has(name)) continue;
            const candidates = new Set();
            extractFromJs(fs.readFileSync(path.join(ROOT, 'assets', 'js', name), 'utf8'), candidates);
            auditSource('assets/js/' + name, candidates, false);
        }
    }

    // ── Report ──
    const lines = [];
    lines.push(LANDING ? '# FluxyOS Landing-Page i18n Gap Report' : '# FluxyOS Dashboard i18n Gap Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()} · dictionary keys: ${Object.keys(engine.dict).length} · patterns: ${engine.patterns.length}`);
    lines.push('');
    lines.push(`**Totals: ${totals.english} English · ${totals.interpolated} interpolated · ${totals.unclassified} unclassified (review)**`);
    lines.push('');
    if (engine.duplicates.length) {
        lines.push(`⚠️ **Duplicate dictionary keys (${engine.duplicates.length})** — later entries shadow earlier ones: ${engine.duplicates.map((d) => `\`${d}\``).join(', ')}`);
        lines.push('');
        console.warn(`WARNING: ${engine.duplicates.length} duplicate dictionary keys: ${engine.duplicates.join(' | ')}`);
    }
    lines.push('| Source | English | Interpolated | Review |');
    lines.push('|---|---:|---:|---:|');
    for (const r of results) {
        lines.push(`| ${r.source}${r.noEngine ? ' ⚠️ no engine' : ''} | ${r.english.length} | ${r.interpolated.length} | ${r.unclassified.length} |`);
    }
    lines.push('');
    for (const r of results) {
        lines.push(`## ${r.source}`);
        if (r.noEngine) lines.push('\n> ⚠️ This page does not load `assets/js/dashboard-i18n.js`.');
        const section = (title, items) => {
            if (!items.length) return;
            lines.push(`\n### ${title} (${items.length})`);
            for (const s of items) lines.push(`- \`${s}\``);
        };
        section('Needs dictionary key (English)', r.english);
        section('Interpolated — needs PATTERNS or FluxyI18n.t()', r.interpolated);
        section('Review (unclassified)', r.unclassified);
        lines.push('');
    }

    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, lines.join('\n'));
    console.log(`i18n audit → ${path.relative(ROOT, REPORT)}`);
    console.log(`English gaps: ${totals.english} · interpolated: ${totals.interpolated} · review: ${totals.unclassified}`);
    if (strict && totals.english > 0) process.exit(1);
}

main();
