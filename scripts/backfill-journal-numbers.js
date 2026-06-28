// =============================================================================
// FluxyOS — Journal-number backfill (accounting kernel)
//
// Assigns a professional Journal Number (JE-YYYY-NNNNNN) to EXISTING journals
// that predate the numbering system, and seeds the per-year `counters/journal-YYYY`
// docs so the live posting paths continue the sequence without collision.
//
// Numbering follows the journal's accounting-period year (period_key.slice(0,4))
// in chronological posting order, so the earliest entry of a year is JE-YYYY-000001.
//
// Built defensively:
//   • DRY-RUN BY DEFAULT. Writes only with --commit.
//   • IDEMPOTENT: a journal that already has journal_number is skipped; the per-year
//     cursor resumes from the highest existing journal_seq (and the counter doc),
//     so a re-run assigns nothing new and never reissues a number.
//   • DRAFTS ARE SKIPPED: drafts carry no posted_at and are not numbered until posted.
//   • Batched (≤400 writes/batch) to stay under the 500-write ceiling.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-journal-numbers.js --workspace <wsId> --dry-run
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     node scripts/backfill-journal-numbers.js --workspace <wsId> --commit
//
// Tip: find a workspace id — for an owner it equals their Firebase uid.
// =============================================================================

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const COMMIT = args.includes('--commit');
const WORKSPACE = flag('workspace', null);
const BATCH_DOCS = 400;

if (!WORKSPACE) {
    console.error('ERROR: --workspace <workspaceId> is required.');
    process.exit(1);
}

if (admin.apps.length === 0) {
    admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'fluxyos' } : {});
}
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const yearOf = (j) => String(j.period_key || '').slice(0, 4) || String(new Date().getFullYear());
const journalNumber = (year, seq) => `JE-${year}-${String(seq).padStart(6, '0')}`;
const millis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0));

async function main() {
    const base = db.collection('workspaces').doc(WORKSPACE);
    console.log(`\nWorkspace ${WORKSPACE} · journal-number backfill · ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    const [journalsSnap, countersSnap] = await Promise.all([
        base.collection('journals').get(),
        base.collection('counters').get()
    ]);

    // Seed per-year cursors from existing counters + the highest existing seq, so
    // a re-run never collides with numbers already issued by the live app.
    const cursor = {};
    countersSnap.forEach((d) => {
        const m = d.id.match(/^journal-(\d{4})$/);
        if (m) cursor[m[1]] = Math.max(cursor[m[1]] || 0, Number(d.data().seq || 0));
    });

    const numbered = [];
    const unnumbered = [];
    journalsSnap.forEach((d) => {
        const j = { id: d.id, ref: d.ref, ...d.data() };
        if (j.status === 'draft') return; // drafts are numbered only on post
        if (j.journal_number) {
            numbered.push(j);
            const y = yearOf(j);
            if (Number.isFinite(Number(j.journal_seq))) cursor[y] = Math.max(cursor[y] || 0, Number(j.journal_seq));
        } else {
            unnumbered.push(j);
        }
    });

    // Chronological order so the earliest journal of a year gets the lowest number.
    unnumbered.sort((a, b) => millis(a.posted_at) - millis(b.posted_at) || String(a.id).localeCompare(String(b.id)));

    const plan = [];
    const byYear = {};
    for (const j of unnumbered) {
        const y = yearOf(j);
        cursor[y] = (cursor[y] || 0) + 1;
        plan.push({ ref: j.ref, journal_number: journalNumber(y, cursor[y]), journal_seq: cursor[y] });
        byYear[y] = (byYear[y] || 0) + 1;
    }

    console.log(`Existing numbered journals: ${numbered.length}`);
    console.log(`Drafts skipped: ${journalsSnap.size - numbered.length - unnumbered.length}`);
    console.log('Numbers to assign by year:');
    Object.keys(byYear).sort().forEach((y) => console.log(`  ${y}   ${String(byYear[y]).padStart(5)} journals   → highest ${journalNumber(y, cursor[y])}`));
    console.log(`\nTotal to assign: ${plan.length}`);

    if (!plan.length) {
        console.log('\nNothing to backfill. Re-seeding counters anyway…');
    }
    if (!COMMIT) {
        console.log('\nDRY-RUN: no writes. Re-run with --commit to assign numbers.');
        return;
    }

    let written = 0;
    for (let i = 0; i < plan.length; i += BATCH_DOCS) {
        const chunk = plan.slice(i, i + BATCH_DOCS);
        const batch = db.batch();
        chunk.forEach(({ ref, journal_number, journal_seq }) => batch.update(ref, { journal_number, journal_seq }));
        await batch.commit();
        written += chunk.length;
        console.log(`  …assigned ${written}/${plan.length}`);
    }

    // Persist the final per-year counters so the live app continues the sequence.
    const cBatch = db.batch();
    Object.keys(cursor).forEach((y) => {
        cBatch.set(base.collection('counters').doc(`journal-${y}`), {
            seq: cursor[y],
            entity_id: WORKSPACE,
            updated_at: FieldValue.serverTimestamp()
        }, { merge: true });
    });
    await cBatch.commit();

    console.log(`\nDone. Assigned ${written} numbers; counters seeded for years [${Object.keys(cursor).sort().join(', ')}].`);
}

main().catch((err) => { console.error('\nBackfill failed:', err); process.exit(1); });
