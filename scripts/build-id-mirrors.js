#!/usr/bin/env node
/**
 * Build the /id/ SEO mirror pages from the current root landing pages.
 *
 * The landing runtime switcher (assets/js/i18n.js) is client-side only, so
 * Google never sees the Indonesian copy. These static mirrors are the
 * crawlable Bahasa pages (LOCALIZATION_PLAN section 1). This generator renders
 * each root landing page through the SAME dictionary the runtime switcher
 * uses, so the mirrors can never drift from the toggle again. Re-run after any
 * landing copy change:
 *
 *     node scripts/build-id-mirrors.js
 *
 * Per page it: translates text segments + display attributes via the i18n.js
 * dictionary, swaps the SEO head (lang, title, description, canonical,
 * hreflang pair, OG/Twitter), absolutizes local asset paths, rewrites internal
 * links to their /id/ counterparts, and statically activates the Bahasa row in
 * the language dropdown (the English row links back to the root page).
 *
 * JSON-LD blocks are copied as-is from the root page (English) - acceptable to
 * Google alongside a correct hreflang pair; localize them here if that changes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://fluxyos.com';

// slug -> pretty path served for the root page; title/description are the
// Indonesian head copy (titles match the runtime dictionary).
const PAGES = {
    'fluxyos.html': {
        slug: 'fluxyos', rootPath: '/',
        title: 'FluxyOS — Visibilitas Operasional Keuangan',
        description: 'Satukan pendapatan, pengeluaran, anggaran, dan pergerakan kas dalam satu tampilan operasional keuangan untuk bisnis Indonesia.',
    },
    'pricing.html': {
        slug: 'pricing', rootPath: '/pricing',
        title: 'Harga FluxyOS — Paket untuk Bisnis Indonesia',
        description: 'Harga sederhana dan transparan. Mulai gratis. Paket untuk founder solo, tim yang berkembang, dan departemen keuangan. Semua dalam Rupiah.',
    },
    'vendorspend.html': {
        slug: 'vendorspend', rootPath: '/vendorspend',
        title: 'Manajemen Vendor Spend untuk UKM Indonesia | FluxyOS',
        description: 'Pusatkan invoice vendor, otomatiskan persetujuan, tangkap pembayaran ganda. Hemat 12+ jam tiap bulan untuk manajemen vendor.',
    },
    'revenuesync.html': {
        slug: 'revenuesync', rootPath: '/revenuesync',
        title: 'Revenue Sync — Hubungkan Stripe, Tokopedia, Shopify | FluxyOS',
        description: 'Sinkronkan pendapatan dari 240+ platform pembayaran secara real-time. Setiap transaksi masuk ke buku besar terpadu Anda dalam hitungan detik.',
    },
    'receiptcapture.html': {
        slug: 'receiptcapture', rootPath: '/receiptcapture',
        title: 'Receipt Capture AI via WhatsApp, Email, atau Upload | FluxyOS',
        description: 'Kirim struk via WhatsApp, email, atau upload. AI mengekstrak vendor, jumlah, pajak, dan kategori dalam hitungan detik. Dibuat untuk UKM Indonesia.',
    },
    'aiagents.html': {
        slug: 'aiagents', rootPath: '/aiagents',
        title: 'AI Finance Agents — 6 Spesialis untuk Pembukuan Anda | FluxyOS',
        description: 'Enam agent AI menangani rekonsiliasi bank, penandaan transaksi, penagihan invoice, dan laporan bulanan — otomatis. Hemat 32+ jam per bulan.',
    },
    'budgetlanding.html': {
        slug: 'budgetlanding', rootPath: '/budgetlanding',
        title: 'Dynamic Budgeting untuk Bisnis Modern | FluxyOS',
        description: 'Alokasikan, pantau, dan sesuaikan anggaran secara real-time. Visibilitas pengeluaran live untuk setiap kategori anggaran. Dibuat untuk bisnis Indonesia.',
    },
};

const MIRROR_SLUGS = Object.keys(PAGES).map((f) => PAGES[f].slug);

// Dictionary: same source of truth as the runtime switcher.
function loadDict() {
    const src = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'i18n.js'), 'utf8');
    const start = src.indexOf('var ID = {');
    const end = src.indexOf('\n    };', start) + '\n    };'.length;
    let text = src.slice(start + 'var ID ='.length, end);
    text = text.slice(0, text.lastIndexOf('};') + 1);
    return vm.runInNewContext('(' + text + ')', {});
}

function decodeEntities(s) {
    return s
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
        .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
        .replace(/&middot;/g, '·').replace(/&rarr;/g, '→').replace(/&larr;/g, '←')
        .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function encodeBasic(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function main() {
    const dict = loadDict();
    const translate = (raw) => {
        const decoded = decodeEntities(raw).replace(/\s+/g, ' ').trim();
        return Object.prototype.hasOwnProperty.call(dict, decoded) ? dict[decoded] : null;
    };

    for (const file of Object.keys(PAGES)) {
        const meta = PAGES[file];
        let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const rootUrl = SITE + meta.rootPath;
        const idUrl = SITE + '/id/' + meta.slug;

        // Absolutize local asset/include paths FIRST (mirrors live one level
        // down), including script src attributes and paths referenced inside
        // inline scripts — the shield step below would otherwise hide them.
        html = html.replace(/(src|href)="(assets|includes)\//g, '$1="/$2/');

        // Shield <script>/<style> so no dictionary replacement touches them.
        const shields = [];
        html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
            shields.push(m);
            return ' SHIELD' + (shields.length - 1) + ' ';
        });

        // 1. Translate text segments (what the runtime walker sees as text nodes).
        html = html.replace(/>([^<>]+)</g, (m, seg) => {
            const t = translate(seg);
            if (t === null) return m;
            const lead = seg.match(/^\s*/)[0];
            const trail = seg.match(/\s*$/)[0];
            return '>' + lead + encodeBasic(t) + trail + '<';
        });

        // 2. Translate display attributes.
        html = html.replace(/(placeholder|aria-label|title|alt|data-tooltip)="([^"]*)"/g, (m, attr, val) => {
            const t = translate(val);
            return t === null ? m : attr + '="' + encodeBasic(t).replace(/"/g, '&quot;') + '"';
        });

        // 3. Head: language, title, description, canonical, hreflang, OG/Twitter.
        html = html
            .replace(/<html lang="en"/, '<html lang="id"')
            .replace(/<title>[^<]*<\/title>/, '<title>' + meta.title + '</title>')
            .replace(/(<meta name="description" content=")[^"]*(")/, '$1' + meta.description + '$2')
            .replace(/(<link rel="canonical" href=")[^"]*(")/, '$1' + idUrl + '$2')
            .replace(/(<link rel="alternate" hreflang="en" href=")[^"]*(")/, '$1' + rootUrl + '$2')
            .replace(/(<link rel="alternate" hreflang="x-default" href=")[^"]*(")/, '$1' + rootUrl + '$2')
            .replace(/(<meta property="og:url" content=")[^"]*(")/, '$1' + idUrl + '$2')
            .replace(/(<meta property="og:title" content=")[^"]*(")/, '$1' + meta.title + '$2')
            .replace(/(<meta property="og:description" content=")[^"]*(")/, '$1' + meta.description + '$2')
            .replace(/(<meta property="og:locale" content=")[^"]*(")/, '$1id_ID$2')
            .replace(/(<meta name="twitter:title" content=")[^"]*(")/, '$1' + meta.title + '$2')
            .replace(/(<meta name="twitter:description" content=")[^"]*(")/, '$1' + meta.description + '$2');
        if (/hreflang="id"/.test(html)) {
            html = html.replace(/(<link rel="alternate" hreflang="id" href=")[^"]*(")/, '$1' + idUrl + '$2');
        } else {
            html = html.replace(/(<link rel="alternate" hreflang="x-default"[^>]*>)/, '$1\n    <link rel="alternate" hreflang="id" href="' + idUrl + '">');
        }
        if (!/og:locale:alternate/.test(html) && /og:locale/.test(html)) {
            html = html.replace(/(<meta property="og:locale" content="id_ID">)/, '$1\n    <meta property="og:locale:alternate" content="en_US">');
        }

        // 4. Point internal links at their /id/ counterparts.
        html = html.replace(new RegExp('href="/(' + MIRROR_SLUGS.join('|') + ')([/"#?])', 'g'), 'href="/id/$1$2');
        html = html.replace(/href="\/use-cases\//g, 'href="/id/use-cases/');
        html = html.replace(/href="\/"/g, 'href="/id/fluxyos"');

        // 6. Language dropdown: statically activate the Bahasa row; the English
        //    row navigates back to the root page (i18n.js stores the choice).
        const CHECK = '<svg class="w-4 h-4 text-[#EA580C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>';
        html = html.replace(
            /<a href="[^"]*"[^>]*>\s*English \(EN\)\s*<svg[\s\S]*?<\/svg>\s*<\/a>/g,
            '<a href="' + meta.rootPath + '" class="block px-4 py-2.5 text-[14px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">English (EN)</a>'
        );
        html = html.replace(
            /<a href="[^"]*"[^>]*>\s*Bahasa \(ID\)\s*<\/a>/g,
            '<a href="/id/' + meta.slug + '" class="flex items-center justify-between px-4 py-2.5 text-[14px] font-medium text-gray-900 bg-gray-50">Bahasa (ID)' + CHECK + '</a>'
        );
        // Trigger label EN -> ID (text node between globe icon and the rotating
        // chevron; the chevron's w-3.5 class is distinctive).
        html = html.replace(/(<\/svg>\s*)EN(\s*<svg class="w-3\.5)/g, '$1ID$2');

        // Restore shielded blocks.
        html = html.replace(/ SHIELD(\d+) /g, (_, i) => shields[Number(i)]);

        const out = path.join(ROOT, 'id', meta.slug + '.html');
        fs.writeFileSync(out, html);
        console.log('built id/' + meta.slug + '.html  (' + (html.length / 1024).toFixed(0) + ' KB)');
    }
}

main();
