#!/usr/bin/env node
/**
 * sync-org-schema.js — one Organization entity across every page's JSON-LD.
 *
 * The site has no build step, so the Organization block was copy-pasted into
 * every landing page and drifted into 7 variants carrying 5 different
 * descriptions of the same company. Search engines build an entity out of
 * consistent repeated signals, so that drift actively works against the
 * knowledge-panel/AI-Overview goal in docs/SEO_STRATEGY.md.
 *
 * This script makes seo/organization.json the single source of truth:
 *
 *   - every Organization node gets the canonical identity fields + a stable
 *     `@id`, so all 33 pages describe ONE entity rather than 33 similar ones
 *   - `contactPoint` is preserved per page — support/sales/legal/privacy
 *     genuinely differ and are not identity fields
 *   - WebSite + SoftwareApplication `publisher` and Product `brand` are
 *     rewritten to `{"@id": …}` references, so the product nodes point at the
 *     same entity instead of minting anonymous duplicates
 *   - `/id/` pages get the Indonesian description; everything else English
 *
 * ⚠️ RUN THIS *AFTER* `node scripts/build-id-mirrors.js`, never before. That
 * generator rebuilds each /id/ page by copying the root page's JSON-LD verbatim,
 * which reinstates the ENGLISH Organization block and silently undoes this
 * script's work. `--check` exits 1 on that state and runs in the QA PRODUCT lane.
 *
 * Usage:
 *   node scripts/sync-org-schema.js            # write
 *   node scripts/sync-org-schema.js --check    # exit 1 if anything is stale
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_PATH = path.join(ROOT, 'seo', 'organization.json');
const CHECK = process.argv.includes('--check');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', '.qa', 'cbm-extracted', 'docs', 'dist', 'coverage',
]);

// Identity fields, in the order they should appear in the emitted JSON.
const IDENTITY_ORDER = [
  '@context', '@type', '@id', 'name', 'legalName', 'url', 'logo',
  'description', 'foundingDate', 'areaServed', 'address', 'sameAs',
];

/** Drop empty strings, empty arrays, and objects whose values are all empty. */
function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const out = value.map(pruneEmpty).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const pruned = pruneEmpty(v);
      if (pruned !== undefined) out[k] = pruned;
    }
    // An address that is only {"@type","addressCountry"} carries no information.
    const meaningful = Object.keys(out).filter((k) => k !== '@type' && k !== 'addressCountry');
    if (!Object.keys(out).length) return undefined;
    if (out['@type'] === 'PostalAddress' && !meaningful.length) return undefined;
    return out;
  }
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function loadCanonical() {
  const raw = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf8'));
  delete raw._comment;
  return raw;
}

function htmlFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      htmlFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Build the canonical Organization node for one page's locale. */
function buildOrganization(canonical, locale, existing) {
  const merged = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': canonical['@id'],
    name: canonical.name,
    legalName: canonical.legalName,
    url: canonical.url,
    logo: canonical.logo,
    description: canonical.description[locale] || canonical.description.en,
    foundingDate: canonical.foundingDate,
    areaServed: canonical.areaServed,
    address: canonical.address,
    sameAs: canonical.sameAs,
  };

  // Preserve everything the page declared that identity does not own —
  // contactPoint above all, which is legitimately per-page.
  for (const [k, v] of Object.entries(existing)) {
    if (!(k in merged)) merged[k] = v;
  }

  const pruned = pruneEmpty(merged) || {};
  const ordered = {};
  for (const key of IDENTITY_ORDER) {
    if (key in pruned) ordered[key] = pruned[key];
  }
  for (const [k, v] of Object.entries(pruned)) {
    if (!(k in ordered)) ordered[k] = v;
  }
  return ordered;
}

/**
 * Point a node's organization-valued property at the canonical @id instead of
 * an inline anonymous copy. Product uses `brand`; CreativeWork-ish types use
 * `publisher`.
 */
function linkToOrganization(node, orgId) {
  const prop = node['@type'] === 'Product' ? 'brand' : 'publisher';
  if (!['WebSite', 'SoftwareApplication', 'Product'].includes(node['@type'])) return false;

  const current = node[prop];
  if (current && typeof current === 'object' && current['@id'] === orgId
      && Object.keys(current).length === 1) {
    return false; // already a clean reference
  }
  node[prop] = { '@id': orgId };
  return true;
}

function processFile(file, canonical) {
  const original = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const locale = /(^|[\\/])id[\\/]/.test(rel) ? 'id' : 'en';
  const orgId = canonical['@id'];

  let changed = false;
  // The brace sits on its own line in most pages but on the tag line in the
  // founder-ceo pair, so match anything between the tags and trim it. Output is
  // always re-emitted in the majority format, which normalises the outliers.
  const blockRe = /(^[ \t]*)<script type="application\/ld\+json">([\s\S]*?)<\/script>/gm;

  const updated = original.replace(blockRe, (match, indent, body) => {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      console.warn(`  ! ${rel}: skipping unparseable JSON-LD block`);
      return match;
    }

    const nodes = Array.isArray(data) ? data : [data];
    let touched = false;

    const rebuilt = nodes.map((node) => {
      if (!node || typeof node !== 'object') return node;
      if (node['@type'] === 'Organization') {
        const next = buildOrganization(canonical, locale, node);
        if (JSON.stringify(next) !== JSON.stringify(node)) touched = true;
        return next;
      }
      if (linkToOrganization(node, orgId)) touched = true;
      return node;
    });

    if (!touched) return match;
    changed = true;

    const payload = Array.isArray(data) ? rebuilt : rebuilt[0];
    const json = JSON.stringify(payload, null, 2)
      .split('\n')
      .map((line) => indent + line)
      .join('\n');

    return `${indent}<script type="application/ld+json">\n${json}\n${indent}</script>`;
  });

  if (!changed) return null;
  if (!CHECK) fs.writeFileSync(file, updated);
  return rel;
}

function main() {
  const canonical = loadCanonical();

  if (!canonical['@id']) {
    console.error('seo/organization.json is missing "@id" — it is the anchor every reference points at.');
    process.exit(1);
  }

  const files = htmlFiles(ROOT).filter((f) => {
    const s = fs.readFileSync(f, 'utf8');
    return s.includes('application/ld+json') && s.includes('"Organization"');
  });

  const stale = files.map((f) => processFile(f, canonical)).filter(Boolean);

  const sameAs = canonical.sameAs || [];
  console.log(`Scanned ${files.length} pages carrying an Organization node.`);
  console.log(`sameAs profiles declared: ${sameAs.length}${sameAs.length ? ` (${sameAs.join(', ')})` : ' — none yet'}`);

  if (CHECK) {
    if (stale.length) {
      console.error(`\n${stale.length} page(s) out of sync with seo/organization.json:`);
      stale.forEach((f) => console.error(`  - ${f}`));
      console.error('\nRun: npm run seo:sync-org');
      process.exit(1);
    }
    console.log('All pages match seo/organization.json.');
    return;
  }

  if (!stale.length) {
    console.log('Already in sync — nothing to write.');
    return;
  }
  console.log(`\nUpdated ${stale.length} page(s):`);
  stale.forEach((f) => console.log(`  - ${f}`));
}

main();
