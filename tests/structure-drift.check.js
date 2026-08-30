'use strict';

// =============================================================================
// FluxyOS — structural drift check (no network, no emulator, no browser)
//
// Everything here is a fact the codebase asserts about ITSELF in more than one
// place. Each check exists because one specific instance of it had already
// drifted and nothing caught it:
//
//   1. REGISTRY PARITY   — the finance-collection set is written out in four
//                          files. On 2026-08-14 they read 34 / 34 / 33 / 13.
//   2. RULES COVERAGE    — `vendors` shipped workspace-scoped in firestore.rules
//                          and was never added to any registry, so the scope
//                          guard was blind to it from the day it landed.
//   3. SEED COUNT        — docs claimed "(32 accounts)" and "(33 accounts)"
//                          while CHART_OF_ACCOUNTS_SEED held 34.
//   4. SHARD INDEX       — docs/data-model/ files vs the §4 shard table.
//   5. STATEMENT COVERAGE— every seeded asset/liability sak_category must be
//                          explicitly classified in statements-engine. An
//                          unclassified one falls to a DEFAULT branch and is
//                          silently misreported: 'inventory' was reported as
//                          investing cash flow, and the statement still tied out
//                          because the sections are a partition.
//
// The common shape: a claim duplicated across files, where the copies rot
// independently and no runtime error ever fires. See
// docs/ERP_ARCHITECTURE_REVIEW.md §3.5.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const failures = [];
const notes = [];
function fail(check, msg) { failures.push({ check, msg }); }
function ok(check, msg) { notes.push(`  ✓ ${check}${msg ? ` — ${msg}` : ''}`); }

const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// ---------------------------------------------------------------------------
// 1. Registry parity
// ---------------------------------------------------------------------------
// Three registries must agree exactly. `scripts/migrate-to-workspaces.js` holds
// a fourth, deliberately frozen at the Stage 2 snapshot — it is exempt here and
// carries a comment saying so, because re-running it is a restore operation that
// needs a human reading the current list anyway.

function registryFromQaRun() {
    const src = read('scripts/qa-run.js');
    const m = src.match(/const FINANCE_COLLECTIONS = \[([\s\S]*?)\];/);
    if (!m) { fail('registry', 'could not parse FINANCE_COLLECTIONS in scripts/qa-run.js'); return null; }
    return new Set(m[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)));
}

function registryFromQaGate() {
    const src = read('.claude/hooks/qa-gate.sh');
    const m = src.match(/FIN_RE='[^(]*\(([^)]*)\)'/);
    if (!m) { fail('registry', 'could not parse FIN_RE in .claude/hooks/qa-gate.sh'); return null; }
    return new Set(m[1].split('|').map((s) => s.trim()).filter(Boolean));
}

function registryFromDocsRegex() {
    const src = read('docs/PROJECT_BACKGROUND.md');
    const m = src.match(/users\/\\\$\\\{\[a-zA-Z_\.\]\+\\\}\/\(([^)]*)\)/);
    if (!m) { fail('registry', 'could not parse the §4 rule 6 grep guard in docs/PROJECT_BACKGROUND.md'); return null; }
    return new Set(m[1].split('|').map((s) => s.trim()).filter(Boolean));
}

const qaRun = registryFromQaRun();
const qaGate = registryFromQaGate();
const docsRe = registryFromDocsRegex();

if (qaRun && qaGate && docsRe) {
    if (!setEq(qaRun, qaGate)) {
        fail('registry parity',
            `scripts/qa-run.js vs .claude/hooks/qa-gate.sh disagree.\n` +
            `      only in qa-run.js:  ${diff(qaRun, qaGate).join(', ') || '(none)'}\n` +
            `      only in qa-gate.sh: ${diff(qaGate, qaRun).join(', ') || '(none)'}`);
    }
    if (!setEq(qaRun, docsRe)) {
        fail('registry parity',
            `scripts/qa-run.js vs PROJECT_BACKGROUND.md §4 rule 6 disagree.\n` +
            `      only in qa-run.js: ${diff(qaRun, docsRe).join(', ') || '(none)'}\n` +
            `      only in the docs:  ${diff(docsRe, qaRun).join(', ') || '(none)'}`);
    }
    if (setEq(qaRun, qaGate) && setEq(qaRun, docsRe)) {
        ok('registry parity', `${qaRun.size} collections, 3 registries agree`);
    }
}

// ---------------------------------------------------------------------------
// 2. Rules coverage — a workspace collection that no registry knows about
// ---------------------------------------------------------------------------
// This is the check that catches the `vendors` class of bug AT ITS SOURCE: the
// moment a collection gets a rules block, it must also be declared finance-scoped
// or explicitly excused. Anything else means the scope guard cannot see it.

// Workspace subcollections that are deliberately NOT finance/operational data.
// Adding to this list is a decision; forgetting a collection is an accident.
const NON_FINANCE_WORKSPACE_COLLECTIONS = new Set([
    'members',                    // team roster (identity, not finance)
    'invites',                    // pending invitations
    'ledger_integrity_reports',   // server-written diagnostics, client read-only
    'duplicate_reviews',          // duplicate-detection decisions
    'invoice_email_jobs',         // delivery pipeline state
]);

function workspaceCollectionsFromRules() {
    const src = read('firestore.rules');
    const start = src.indexOf('match /workspaces/{workspaceId}');
    if (start === -1) { fail('rules coverage', 'could not locate the workspaces block in firestore.rules'); return null; }
    // Collect `match /<name>/{...}` inside the workspaces block. Nested deeper
    // paths (subcollections of a document) are ignored: they inherit the parent's
    // scope and are never addressed independently by the guard.
    const block = src.slice(start);
    const found = new Set();
    const re = /^\s{6}match \/([a-z_]+)\/\{/gm;
    let m;
    while ((m = re.exec(block)) !== null) found.add(m[1]);
    return found;
}

const rulesCollections = workspaceCollectionsFromRules();
if (rulesCollections && qaRun) {
    const unregistered = [...rulesCollections]
        .filter((c) => !qaRun.has(c) && !NON_FINANCE_WORKSPACE_COLLECTIONS.has(c))
        .sort();
    if (unregistered.length) {
        fail('rules coverage',
            `workspace-scoped in firestore.rules but in no registry: ${unregistered.join(', ')}\n` +
            `      Add each to FINANCE_COLLECTIONS (scripts/qa-run.js), the §4 rule 2 list and\n` +
            `      rule 6 regex (docs/PROJECT_BACKGROUND.md), and FIN_RE (.claude/hooks/qa-gate.sh)\n` +
            `      — or to NON_FINANCE_WORKSPACE_COLLECTIONS here if it genuinely is not finance data.`);
    } else {
        ok('rules coverage', `${rulesCollections.size} workspace collections, all accounted for`);
    }
}

// ---------------------------------------------------------------------------
// 3–5 need the engine modules, which are ES modules.
// ---------------------------------------------------------------------------
(async () => {
    const engine = await import(pathToFileURL(path.join(ROOT, 'assets/js/accounting-engine.js')).href);
    const SEED = engine.CHART_OF_ACCOUNTS_SEED;

    // --- 3. Account count claimed in prose vs the seed --------------------
    // Docs quote the seed size in passing. Every quote must be the real number.
    const countClaims = [
        ['docs/data-model/chart-of-accounts.md', /\((?:\*\*)?(\d+)\s+accounts/g],
        ['docs/data-model/accounting.md', /CHART_OF_ACCOUNTS_SEED\`? \((?:\*\*)?(\d+)\s+accounts/g],
    ];
    let countOk = true;
    for (const [file, re] of countClaims) {
        const src = read(file);
        let m;
        while ((m = re.exec(src)) !== null) {
            const claimed = Number(m[1]);
            if (claimed !== SEED.length) {
                countOk = false;
                fail('seed count', `${file} claims ${claimed} accounts; CHART_OF_ACCOUNTS_SEED has ${SEED.length}`);
            }
        }
    }
    if (countOk) ok('seed count', `${SEED.length} accounts, prose agrees`);

    // Codes must be unique — the seed is keyed by code as the Firestore doc id,
    // so a duplicate silently drops an account at seed time.
    const codes = SEED.map((a) => a.code);
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dupes.length) fail('seed codes', `duplicate account codes: ${[...new Set(dupes)].join(', ')}`);
    else ok('seed codes', 'all unique');

    // --- 4. Shard index completeness (both directions) --------------------
    const bg = read('docs/PROJECT_BACKGROUND.md');
    const onDisk = new Set(
        fs.readdirSync(path.join(ROOT, 'docs/data-model'))
            .filter((f) => f.endsWith('.md'))
            .map((f) => f.replace(/\.md$/, ''))
    );
    const indexed = new Set(
        [...bg.matchAll(/data-model\/([a-z-]+)\.md/g)].map((m) => m[1])
    );
    const missingFromIndex = diff(onDisk, indexed);
    const missingFromDisk = diff(indexed, onDisk);
    if (missingFromIndex.length || missingFromDisk.length) {
        fail('shard index',
            `${missingFromIndex.length ? `on disk but not in the §4 shard table: ${missingFromIndex.join(', ')}\n      ` : ''}` +
            `${missingFromDisk.length ? `linked in §4 but no such file: ${missingFromDisk.join(', ')}` : ''}`.trim());
    } else {
        ok('shard index', `${onDisk.size} shards, index matches disk`);
    }

    // --- 5. Statement classification coverage -----------------------------
    // Assets and liabilities are partitioned by sak_category, and BOTH statements
    // classify by exclusion — the cash flow defaults to investing/financing, the
    // balance sheet defaults to current. So an unclassified category is never an
    // error, just a wrong number on a statement that still ties out.
    //
    // Parsed out of the source rather than imported because these are module
    // -private consts; keeping them private is right, and a drift check reading
    // source is the honest trade.
    const se = read('assets/js/statements-engine.js');
    const listOf = (name) => {
        const m = se.match(new RegExp(`${name}\\s*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`));
        return m ? new Set(m[1].match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) || []) : null;
    };
    const cashCat = (se.match(/CASH_CATEGORY\s*=\s*'([a-z_]+)'/) || [])[1];
    const curAsset = listOf('CURRENT_ASSET_CATEGORIES');
    const nonCurAsset = listOf('NON_CURRENT_ASSET_CATEGORIES');
    const curLiab = listOf('CURRENT_LIABILITY_CATEGORIES');
    const nonCurLiab = listOf('NON_CURRENT_LIABILITY_CATEGORIES');

    if (!curAsset || !nonCurAsset || !curLiab || !nonCurLiab || !cashCat) {
        fail('statement coverage', 'could not parse the classification lists in assets/js/statements-engine.js');
    } else {
        const assetCats = new Set([cashCat, ...curAsset, ...nonCurAsset]);
        const liabCats = new Set([...curLiab, ...nonCurLiab]);
        const unclassified = [];
        for (const a of SEED) {
            const cat = a.sak_category;
            if (!cat) continue;
            if (a.type === 'asset' && !assetCats.has(cat)) unclassified.push(`${a.code} ${a.name} (asset/${cat})`);
            if (a.type === 'liability' && !liabCats.has(cat)) unclassified.push(`${a.code} ${a.name} (liability/${cat})`);
        }
        if (unclassified.length) {
            fail('statement coverage',
                `seeded accounts whose sak_category is in NO classification list:\n      ` +
                unclassified.join('\n      ') +
                `\n      These do not error — they fall to a default branch and are silently\n` +
                `      misreported (cash flow defaults to investing/financing, balance sheet to\n` +
                `      current), and the statement still ties out. Add the category to the right\n` +
                `      list in assets/js/statements-engine.js.`);
        } else {
            ok('statement coverage', 'every seeded asset/liability category is explicitly classified');
        }
    }

    // --- 6. Positioning consistency ---------------------------------------
    // Same failure mode as everything above: a claim made in many places that
    // rots independently. Before 2026-08-15 FOUR competing category strings
    // shipped simultaneously — "Finance Operating System" in the strategy doc,
    // "Finance Operations System" in llms.txt (what AI crawlers read),
    // "finance operations platform" on the homepage and in the Organization
    // entity, and "intelligent financial operating system" in the README. No
    // reader could tell which was the real one, and nothing could notice.
    //
    // The category is owned by PRODUCT_STRATEGY.md §1. These sources restate it.
    const CATEGORY = 'Intelligent Finance Operating System';
    const CANONICAL_SOURCES = [
        'docs/PRODUCT_STRATEGY.md',
        'docs/PROJECT_BACKGROUND.md',
        'docs/SYSTEM_DESIGN.md',
        'README.md',
        'llms.txt',
        'seo/organization.json',
    ];
    // Superseded category strings. `Finance Operating System` is deliberately
    // NOT listed: it is a substring of the canonical one, so it can never be
    // matched independently.
    const RETIRED = [
        'finance operations platform',
        'financial operations platform',
        'Finance Operations System',
        'Finance Operation System',
    ];
    // Definitional SMB-ceiling phrasings only. Segment discussion is WANTED —
    // "Indonesian SMBs are the current beachhead" must keep passing — so this
    // matches the specific constructions that cap the product, not the acronym.
    const SMB_CEILING = [
        'for Indonesian SMBs —',
        'built specifically for Indonesian SMBs',
        'Built specifically for Indonesian SMBs',
        'System for Indonesian SMBs',
        'platform for Indonesian SMBs',
    ];

    const posProblems = [];
    for (const src of CANONICAL_SOURCES) {
        let text;
        try { text = read(src); } catch (_) {
            posProblems.push(`${src}: canonical positioning source is missing`);
            continue;
        }
        if (!text.includes(CATEGORY)) {
            posProblems.push(`${src}: does not state the canonical category "${CATEGORY}"`);
        }
        for (const r of RETIRED) {
            if (text.includes(r)) posProblems.push(`${src}: retired category string "${r}"`);
        }
        for (const p of SMB_CEILING) {
            if (text.includes(p)) posProblems.push(`${src}: SMB-ceiling phrasing "${p}"`);
        }
    }
    if (posProblems.length) {
        fail('positioning',
            `canonical positioning has drifted:\n      ` + posProblems.join('\n      ') +
            `\n      The category is owned by docs/PRODUCT_STRATEGY.md §1. Restate it; do not\n` +
            `      invent a variant. Indonesia and SMBs may be discussed as market and\n` +
            `      segment — just not as the definition of what the product is.`);
    } else {
        ok('positioning', `"${CATEGORY}" consistent across ${CANONICAL_SOURCES.length} canonical sources`);
    }

    // --- market chart variants -----------------------------------------------
    //
    // Every market's chart MUST expose the same account codes in the same order.
    // Posting rules in accounting-engine.js, tax-engine.js and db-service.js
    // resolve accounts by literal code ('2100', '1130', …), so a variant that
    // renumbered or dropped one would not fail loudly — it would post to a
    // missing account and corrupt the ledger silently. Only NAMES may differ.
    try {
        const eng = await import('../assets/js/accounting-engine.js');
        const baseline = eng.CHART_OF_ACCOUNTS_SEED.map((a) => a.code).join(',');
        const markets = Object.keys(eng.TAX_ACCOUNT_NAMES || {});
        const drifted = [];
        for (const m of markets) {
            const codes = eng.chartForCountry(m).map((a) => a.code).join(',');
            if (codes !== baseline) drifted.push(m);
        }
        // An unknown country must fall back to the baseline, never to nothing.
        if (eng.chartForCountry('ZZ').length !== eng.CHART_OF_ACCOUNTS_SEED.length) drifted.push('unknown-country fallback');
        if (drifted.length) {
            fail('chart-variants', `market chart(s) diverged from the baseline codes: ${drifted.join(', ')}`);
        } else {
            ok('chart-variants', `${markets.length} market charts share the baseline's ${eng.CHART_OF_ACCOUNTS_SEED.length} codes`);
        }
    } catch (e) {
        fail('chart-variants', `could not verify market charts: ${e.message}`);
    }

    // --- 6. SIDEBAR ICON PARITY --------------------------------------------
    // sidebar-loader.js holds the nav TWICE: inline <svg> in the markup, and a
    // `dashboardLucideIcons` map that replaces them at runtime. Every nav item
    // must be in the map, because the map is what actually renders.
    //
    // Inventory, Point of Sale and Outlet P&L were never migrated into it, so
    // for as long as they existed they rendered from the inline fallback: 20px
    // instead of 16, stroke-width 2 instead of 1.85, and Heroicons geometry in a
    // sidebar that is otherwise entirely Lucide. Nothing failed — they just
    // looked wrong, which is the only symptom this class of drift ever has.
    try {
        const src = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'sidebar-loader.js'), 'utf8');
        const mapped = new Set(
            [...src.matchAll(/'(nav-[a-z0-9-]+)':\s*'<svg class="sidebar-icon"/g)].map((m) => m[1])
        );
        const rendered = new Set(
            [...src.matchAll(/id="(nav-[a-z0-9-]+)"/g)].map((m) => m[1])
        );
        // The scroll container is not a nav item.
        rendered.delete('nav-container');
        const missing = [...rendered].filter((id) => !mapped.has(id));
        if (missing.length) {
            fail('sidebar-icons',
                `nav item(s) with no entry in dashboardLucideIcons, so they render the inline `
                + `fallback at the wrong size, weight and icon family: ${missing.join(', ')}`);
        } else {
            ok('sidebar-icons', `${rendered.size} nav items all resolve to a Lucide icon`);
        }
    } catch (e) {
        fail('sidebar-icons', `could not verify sidebar icons: ${e.message}`);
    }

    // --- business category vocabulary --------------------------------------
    //
    // The category decides which operational modules a workspace is offered, and
    // its vocabulary is written out in FOUR places: the client module, the DAL's
    // deliberately-local allowlist, firestore.rules, and the onboarding <option>
    // list. Each copy exists for a stated reason (see business-category.js), so
    // the answer to drift is a guard rather than a fifth abstraction.
    //
    // Drift here is SILENT both ways: a category rules accept but the picker
    // never offers is dead, and one the picker offers but rules reject fails the
    // whole workspace write with permission-denied at the end of onboarding.
    try {
        const listFrom = (src, re, label) => {
            const m = src.match(re);
            if (!m) throw new Error(`could not find the ${label} list`);
            return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
        };

        // { id: 'fnb', ... } — take only the ids, which are the first quoted
        // token on each entry.
        const canonIds = [...read('assets/js/business-category.js')
            .matchAll(/\{\s*id:\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();

        const dal = listFrom(
            read('assets/js/db-service.js'),
            /const category = \[([^\]]+)\]\s*\n?\s*\.includes\(opts\.businessCategory\)/,
            'db-service ensureWorkspace'
        );
        const rules = listFrom(
            read('firestore.rules'),
            /data\.business_category in \[([^\]]+)\]/,
            'firestore.rules'
        );
        const html = [...read('onboarding.html')
            .matchAll(/<option value="([a-z_]+)">/g)]
            .map((m) => m[1]);
        const onboarding = [...new Set(html.filter((v) => canonIds.includes(v)))].sort();

        const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
        const problems = [];
        if (!eq(canonIds, dal)) problems.push(`db-service [${dal}] vs canonical [${canonIds}]`);
        if (!eq(canonIds, rules)) problems.push(`firestore.rules [${rules}] vs canonical [${canonIds}]`);
        if (!eq(canonIds, onboarding)) problems.push(`onboarding.html [${onboarding}] vs canonical [${canonIds}]`);

        if (problems.length) {
            fail('business-category', `the category vocabulary has drifted: ${problems.join('; ')}`);
        } else {
            ok('business-category', `${canonIds.length} categories agree across business-category.js, db-service.js, firestore.rules and onboarding.html`);
        }
    } catch (e) {
        fail('business-category', `could not verify the category vocabulary: ${e.message}`);
    }

    // --- report ------------------------------------------------------------
    if (failures.length) {
        console.error('\nSTRUCTURAL DRIFT\n');
        for (const f of failures) console.error(`  ✗ ${f.check}: ${f.msg}\n`);
        console.error(`${failures.length} drift issue(s). Each is a claim this repo makes about itself in`);
        console.error('more than one place, where the copies no longer agree.\n');
        process.exit(1);
    }
    console.log('structural drift: clean');
    console.log(notes.join('\n'));
})().catch((e) => {
    console.error('structure-drift check crashed:', e && e.stack ? e.stack : e);
    process.exit(1);
});
