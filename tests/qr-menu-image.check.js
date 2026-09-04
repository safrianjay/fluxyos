'use strict';

// =============================================================================
// The QR menu-photo endpoint refuses before it reaches Firebase.
//
// This function is the ONLY thing in FluxyOS that serves workspace data to a
// caller with no account. Everything else is gated by Firebase Auth plus rules;
// here the server is the whole boundary, and both of its inputs come from a
// stranger's URL bar.
//
// The checks below run with no credentials and no network, because they exercise
// the refusals that happen BEFORE `initAdmin()` — which is exactly the set that
// must never depend on a service account being present to work.
//
// Run: node tests/qr-menu-image.check.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'netlify/functions/qr-menu-image.js');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`  ✗ ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const is = (actual, expected, label) => {
    if (actual === expected) ok(label);
    else fail(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

(async () => {
    console.log('\nqr menu image\n');

    const raw = fs.readFileSync(SRC, 'utf8');
    // COMMENTS STRIPPED FIRST. This file explains at length why getDownloadURL
    // is banned, and a naive scan of the whole source therefore matched its own
    // rationale — the guard failed on the sentence describing the thing it
    // guards against. Same trap the design linter hit on a comment quoting the
    // rule it enforces. The question is what the function CALLS.
    const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

    // ── The banned API ──────────────────────────────────────────────────────
    // getDownloadURL mints a link Firebase serves with Security Rules BYPASSED,
    // and the token cannot be revoked short of deleting the object. This
    // codebase removed it from the document path after proving the hole with
    // curl. A customer-facing endpoint is the last place it may come back.
    is(/getDownloadURL/.test(src), false,
        'never calls getDownloadURL — that link is public and permanent');
    // A signed URL is the opposite: unguessable and expiring.
    is(/getSignedUrl/.test(src), true, 'uses a short-lived signed URL instead');
    is(/expires:\s*Date\.now\(\)\s*\+/.test(src), true, 'the signed URL actually expires');

    // ── Never a wildcard origin ─────────────────────────────────────────────
    is(/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(src), false,
        'never answers Access-Control-Allow-Origin: *');
    is(/allowed-origins/.test(src), true,
        'takes its origin decision from the one shared allowlist');

    // ── The refusals, exercised for real ────────────────────────────────────
    const { handler } = require(SRC);
    const call = (qs, method = 'GET') => handler({
        httpMethod: method,
        headers: { origin: 'https://pos.fluxyos.com' },
        queryStringParameters: qs
    });

    is((await call({}, 'OPTIONS')).statusCode, 204, 'preflight is answered');
    is((await call({}, 'POST')).statusCode, 405, 'only GET serves an image');

    // Both inputs are attacker-controlled and both become document path
    // segments. A segment carrying `/` or `..` is how one read becomes another.
    const badInputs = [
        [{}, 'no parameters at all'],
        [{ token: 'abc' }, 'a token with no item'],
        [{ item: 'abc' }, 'an item with no token'],
        [{ token: '../../admin', item: 'x' }, 'path traversal in the token'],
        [{ token: 'ok', item: 'a/b' }, 'a slash in the item id'],
        [{ token: 'ok', item: '..' }, 'a dot-dot item id'],
        [{ token: 'x'.repeat(200), item: 'ok' }, 'an over-long token'],
        [{ token: 'has space', item: 'ok' }, 'whitespace in the token'],
        [{ token: 'tok<script>', item: 'ok' }, 'markup in the token']
    ];
    for (const [qs, label] of badInputs) {
        const res = await call(qs);
        is(res.statusCode, 404, `refused: ${label}`);
        // One shape of refusal for every failure. A differing message would let
        // a stranger learn, from the difference, whether an id exists in someone
        // else's workspace.
        is(res.body, 'Not found', `…with nothing leaked: ${label}`);
    }

    // A refusal must not be cached — the next request may be legitimate.
    const refused = await call({});
    is(refused.headers['Cache-Control'], 'no-store', 'refusals are not cached');

    // ── The scoping the Storage rule cannot express ─────────────────────────
    // These are asserted against the SOURCE because they run after initAdmin,
    // which needs a service account this check deliberately does not have. They
    // are the three conditions that make a token for one restaurant unable to
    // fetch another's photo.
    is(/pos_table_directory/.test(src), true,
        'resolves the table token through the deny-all directory');
    is(/pos_visible\s*!==\s*true/.test(src), true,
        'refuses an item that is not on the menu');
    // A revoked token is a printed card that must stop working — an archived
    // table, or a rotated token. The directory keeps the entry rather than
    // deleting it so this check can exist at all.
    is(/revoked\s*===\s*true/.test(src), true,
        'refuses a revoked table token');
    is(/path\.startsWith\(`workspaces\/\$\{workspaceId\}\/items\/\$\{itemId\}\//.test(src), true,
        'refuses an image_path outside this item\'s own tree');

    // ── The outlet cover (?cover=1), added 2026-09-05 ───────────────────────
    //
    // It exists HERE rather than as a URL in the qr-menu payload so it inherits
    // all three gates above. A signed URL handed out in JSON would be a second
    // way for a diner's phone to reach Storage, bypassing every one of them.
    is(/cover\s*\|\|\s*''\)\s*===\s*'1'/.test(src), true,
        'serves the outlet cover behind the same token checks');
    is(/pos_outlet_settings/.test(src), true,
        'reads the cover path from the outlet\'s own settings document');
    // The directory already knows which outlet this table belongs to, so a
    // token for table 4 cannot ask for another outlet's imagery.
    is(/dimensionId\s*=\s*dir\.dimension_id/.test(src), true,
        'scopes the cover to the outlet the scanned table belongs to');
    is(/coverPath\.startsWith\(`workspaces\/\$\{workspaceId\}\/pos_outlets\/\$\{dimensionId\}\//.test(src), true,
        'refuses a cover_image_path outside this outlet\'s own tree');
    // qr-menu must not hand out a URL of its own. It did for about an hour on
    // 2026-09-05 and it never worked — initAdmin there sets no storageBucket, so
    // the call threw and the catch turned it into "this outlet has no photo".
    const menuSrc = fs.readFileSync(path.join(ROOT, 'netlify/functions/qr-menu.js'), 'utf8');
    is(/getSignedUrl/.test(menuSrc), false,
        'qr-menu hands out no Storage URL of its own');

    console.log(failures ? `\n✗ ${failures} failure(s)\n` : '\nqr menu image: clean\n');
    process.exit(failures ? 1 : 0);
})().catch((err) => {
    console.error('\n✗ qr-menu-image check threw:', err);
    process.exit(1);
});
