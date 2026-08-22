/**
 * FluxyOS — Duplicate Guard (pre-save orchestration)
 *
 * The seam every record-creation path calls just before it writes:
 *
 *     const verdict = await window.FluxyDuplicateGuard.check({
 *         ds, userId, kind: 'bills', payload, source: 'scan'
 *     });
 *     if (!verdict.proceed) return;      // user cancelled or opened the original
 *
 * It fetches a bounded candidate set (db-service.findDuplicateCandidates),
 * scores it (duplicate-engine.js, pure), and — only when the signal is strong
 * enough to be worth interrupting for — shows the side-by-side review dialog.
 *
 * Three rules this module exists to enforce:
 *
 *   1. A duplicate check NEVER costs a user their save. Every failure path
 *      (offline, rules not yet deployed, engine import failure) resolves to
 *      `proceed: true` — the same outcome as before this feature existed.
 *   2. Nothing is written, voided, or merged here. The guard reports a verdict;
 *      the caller does the writing.
 *   3. Every decision that lets a record through is logged to
 *      `duplicate_reviews` BEFORE the caller saves, so the user's intent
 *      survives even if the save itself then fails.
 *
 * See docs/DUPLICATE_PREVENTION.md.
 */
(function () {
    'use strict';

    var enginePromise = null;
    function engine() {
        if (!enginePromise) enginePromise = import('/assets/js/duplicate-engine.js');
        return enginePromise;
    }

    // Which of the existing pages owns each record type, for "Open existing".
    var RECORD_PAGES = {
        transactions: '/ledger',
        bills: '/bill',
        subscriptions: '/subscription',
        invoices: '/invoices',
        journals: '/accounting-journal'
    };

    var KIND_NOUN = {
        transactions: 'transaction',
        bills: 'bill',
        subscriptions: 'subscription',
        invoices: 'invoice',
        journals: 'journal entry'
    };

    // Complete sentences per record type rather than noun concatenation. Two
    // reasons: Indonesian does not put the noun where English does, and the i18n
    // audit can only see whole string literals — a sentence assembled at runtime
    // is invisible to it and silently ships untranslated.
    var TITLE_BY_KIND = {
        transactions: 'This looks like a transaction you already have',
        bills: 'This looks like a bill you already have',
        subscriptions: 'This looks like a subscription you already have',
        invoices: 'This looks like an invoice you already have',
        journals: 'This looks like a journal entry you already have'
    };

    var KEEP_BOTH_NOTE_BY_KIND = {
        transactions: 'Keeping both means this transaction will be counted twice. Only do that if they are genuinely two separate transactions.',
        bills: 'Keeping both means this bill will be counted twice. Only do that if they are genuinely two separate bills.',
        subscriptions: 'Keeping both means this subscription will be counted twice. Only do that if they are genuinely two separate subscriptions.',
        invoices: 'Keeping both means this invoice will be counted twice. Only do that if they are genuinely two separate invoices.',
        journals: 'Keeping both means this journal entry will be counted twice. Only do that if they are genuinely two separate entries.'
    };

    var REASON_BODY_BY_KIND = {
        transactions: 'This is recorded against both transactions so the reason is there when someone reviews the books.',
        bills: 'This is recorded against both bills so the reason is there when someone reviews the books.',
        subscriptions: 'This is recorded against both subscriptions so the reason is there when someone reviews the books.',
        invoices: 'This is recorded against both invoices so the reason is there when someone reviews the books.',
        journals: 'This is recorded against both entries so the reason is there when someone reviews the books.'
    };

    function money(amount, currency) {
        if (amount == null) return '';
        try {
            if (window.FluxyMoney && typeof window.FluxyMoney.format === 'function') {
                return window.FluxyMoney.format(amount, currency || 'IDR');
            }
        } catch (_) { /* fall through to the plain Rupiah format */ }
        return window.FluxyMoney.formatBase(Math.round(Math.abs(Number(amount) || 0)));
    }

    function dateLabel(ms) {
        if (!ms) return '';
        try {
            return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (_) { return ''; }
    }

    // Turn an engine `display` block into the strings the dialog renders.
    function toPanel(display) {
        display = display || {};
        return {
            number: display.number || '',
            party: display.party || '',
            date: dateLabel(display.dateMs),
            amount: money(display.amount, display.currency),
            status: display.status || '',
            source: display.source || ''
        };
    }

    // The document number an incoming payload would collide on. Only the
    // COUNTERPARTY's number is probed — our own generated series is unique by
    // construction, so probing it would return nothing and cost a read.
    function probeDocNumber(payload) {
        return payload.invoice_number || payload.payment_reference || null;
    }

    function amountOf(payload, kind) {
        if (kind === 'invoices') return payload.total_amount != null ? payload.total_amount : payload.amount;
        return payload.amount;
    }

    /**
     * Score an incoming payload against what is already stored.
     * Returns { matches, top } — never throws.
     */
    async function inspect(opts) {
        var ds = opts.ds, userId = opts.userId;
        var kind = opts.kind || 'transactions';
        var payload = opts.payload || {};
        if (!ds || !userId || typeof ds.findDuplicateCandidates !== 'function') {
            return { matches: [], top: null };
        }
        try {
            var e = await engine();
            var results = await Promise.all([
                ds.findDuplicateCandidates(userId, {
                    collectionName: kind,
                    amount: amountOf(payload, kind),
                    docNumber: probeDocNumber(payload)
                }),
                typeof ds.getDuplicateDecisions === 'function'
                    ? ds.getDuplicateDecisions(userId, { kind: kind })
                    : Promise.resolve({})
            ]);
            // `candidateFilter` narrows the probe result before scoring — the
            // journals collection needs it, because every transaction and bill
            // also posts a journal there and only OTHER MANUAL entries are
            // comparable.
            var candidates = (results[0] || []).filter(function (c) {
                if (opts.ignoreId && c.id === opts.ignoreId) return false;
                if (typeof opts.candidateFilter === 'function') return !!opts.candidateFilter(c);
                return true;
            });
            var matches = e.findDuplicates({
                incoming: Object.assign({ id: opts.ignoreId || null }, payload),
                candidates: candidates,
                kind: kind,
                decisions: results[1] || {}
            });
            return { matches: matches, top: matches[0] || null };
        } catch (err) {
            // Never block a save on a detection failure.
            console.warn('[duplicates] check skipped:', err && err.message ? err.message : err);
            return { matches: [], top: null };
        }
    }

    /**
     * Full pre-save guard: inspect, and if warranted, ask.
     *
     * @returns {Promise<{proceed:boolean, decision:string, match:object|null}>}
     *   decision ∈ 'clean' | 'kept_both' | 'ignored' | 'cancelled' | 'opened' | 'attached'
     */
    async function check(opts) {
        opts = opts || {};
        var kind = opts.kind || 'transactions';
        var source = opts.source || 'manual';
        var found = await inspect(opts);
        var match = found.top;

        // Nothing, or only a weak signal: save without interrupting. A `low`
        // band is deliberately silent here — interrupting on a 30% hunch is how
        // users learn to dismiss the dialog without reading it.
        if (!match || match.band === 'low' || match.band === 'none') {
            return { proceed: true, decision: 'clean', match: match };
        }

        var e = await engine();
        var noun = KIND_NOUN[kind] || 'record';
        var isHigh = match.band === 'high';

        // Actions, ordered least-to-most consequential. "Attach to existing" is
        // offered only when the caller can actually do it — a scanned document
        // whose value is the file itself, against a record that has none.
        var actions = [{ id: 'cancel', label: 'Cancel' }];
        actions.push({ id: 'open', label: 'Open existing' });
        if (opts.allowAttach) {
            actions.push({ id: 'attach', label: 'Attach to existing', primary: true });
        }
        actions.push({
            id: 'keep_both',
            label: isHigh ? 'Keep both' : 'Save anyway',
            primary: !opts.allowAttach
        });

        var note = isHigh ? (KEEP_BOTH_NOTE_BY_KIND[kind] || KEEP_BOTH_NOTE_BY_KIND.transactions) : '';

        var chosen = await window.showDuplicateDialog({
            title: TITLE_BY_KIND[kind] || TITLE_BY_KIND.transactions,
            lead: e.explain(match),
            evidence: match.evidence || [],
            existing: toPanel(match.existing),
            incoming: toPanel(match.incoming),
            note: note,
            actions: actions,
            tone: isHigh ? 'danger' : 'warn'
        });

        if (!chosen || chosen === 'cancel') {
            return { proceed: false, decision: 'cancelled', match: match };
        }

        if (chosen === 'open') {
            // Logged as `pending`: the user went to look, they have not decided.
            await record(opts, match, 'pending', '', source);
            var page = RECORD_PAGES[kind] || '/ledger';
            window.location.href = page + '?record=' + encodeURIComponent(match.existing_id);
            return { proceed: false, decision: 'opened', match: match };
        }

        if (chosen === 'attach') {
            await record(opts, match, 'attached', 'Document attached to the existing ' + noun + '.', source);
            return { proceed: false, decision: 'attached', match: match };
        }

        // Keep both. A high-confidence pair demands a written reason — that
        // sentence is the evidence for why two identical records are genuine,
        // and it is the first thing anyone reviewing the books will ask for.
        var reason = '';
        if (isHigh) {
            reason = await window.showReasonDialog({
                title: 'Why are both correct?',
                body: REASON_BODY_BY_KIND[kind] || REASON_BODY_BY_KIND.transactions,
                confirmLabel: 'Save both',
                tone: 'default',
                reasonLabel: 'Reason',
                options: [
                    'Two genuine transactions, same day',
                    'Split payment to the same vendor',
                    'Vendor reused the document number',
                    'Correcting an earlier entry',
                    'Other'
                ]
            });
            if (!reason) return { proceed: false, decision: 'cancelled', match: match };
        }

        await record(opts, match, 'kept_both', reason, source);
        return { proceed: true, decision: 'kept_both', match: match };
    }

    // Persist the decision. Best-effort by design: if the log write fails the
    // user still gets the outcome they chose — losing the record they were
    // saving because its provenance note failed would be the worse trade.
    async function record(opts, match, decision, reason, source) {
        try {
            if (!opts.ds || typeof opts.ds.recordDuplicateDecision !== 'function') return;
            await opts.ds.recordDuplicateDecision(opts.userId, {
                kind: opts.kind || 'transactions',
                primaryId: match.existing_id || '',
                duplicateId: opts.ignoreId || '',
                score: match.score,
                rules: match.rules || [match.rule],
                decision: decision,
                reason: reason || '',
                source: source
            });
        } catch (err) {
            console.warn('[duplicates] decision not logged:', err && err.message ? err.message : err);
        }
    }

    /**
     * Batch pre-flight for CSV / statement imports. Scores every parsed row
     * against what is stored AND against the other rows in the same file
     * (a file that repeats a line internally is the commonest import mistake).
     *
     * Returns the same rows with `duplicate_match` and `selected_for_import`
     * stamped on the flagged ones — no dialog, because the import preview is
     * already the right place to review a hundred rows at once.
     */
    async function inspectBatch(opts) {
        opts = opts || {};
        var rows = opts.rows || [];
        var kind = opts.kind || 'transactions';
        if (!rows.length) return { rows: rows, flagged: 0 };
        try {
            var e = await engine();
            var candidates = [];
            // One probe per DISTINCT amount, so a 200-row file of repeated
            // amounts costs a handful of reads rather than 200.
            var amounts = {};
            rows.forEach(function (r) {
                var a = Math.round(Math.abs(Number(amountOf(r, kind)) || 0));
                if (a > 0) amounts[a] = true;
            });
            var distinct = Object.keys(amounts).slice(0, 40);
            var fetched = await Promise.all(distinct.map(function (a) {
                return opts.ds.findDuplicateCandidates(opts.userId, {
                    collectionName: kind, amount: Number(a), amountLimit: 10
                });
            }));
            fetched.forEach(function (list) { candidates = candidates.concat(list || []); });

            var decisions = typeof opts.ds.getDuplicateDecisions === 'function'
                ? await opts.ds.getDuplicateDecisions(opts.userId, { kind: kind })
                : {};

            var flagged = 0;
            var seenInFile = [];
            rows.forEach(function (row, index) {
                var incoming = Object.assign({ id: '__row' + index }, row);
                var matches = e.findDuplicates({
                    incoming: incoming,
                    candidates: candidates.concat(seenInFile),
                    kind: kind,
                    decisions: decisions,
                    minScore: e.BAND_MEDIUM_MIN
                });
                seenInFile.push(incoming);
                if (matches.length) {
                    row.duplicate_match = matches[0];
                    // Flagged rows arrive DESELECTED. Opting a duplicate in is a
                    // deliberate act; opting one out should not be homework.
                    row.selected_for_import = false;
                    flagged += 1;
                }
            });
            return { rows: rows, flagged: flagged };
        } catch (err) {
            console.warn('[duplicates] import pre-flight skipped:', err && err.message ? err.message : err);
            return { rows: rows, flagged: 0 };
        }
    }

    window.FluxyDuplicateGuard = {
        check: check,
        inspect: inspect,
        inspectBatch: inspectBatch,
        recordDecision: record,
        engine: engine
    };
})();
