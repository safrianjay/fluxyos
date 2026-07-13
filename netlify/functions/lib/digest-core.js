'use strict';

/**
 * Weekly Financial Digest engine (no-Blaze, Netlify Scheduled Function).
 *
 * Reuses the deterministic finance engine + AI narrator from `api.js`
 * (`exports.digest`) — every number is computed there; OpenAI only narrates.
 * Reads user finance data via the Firebase Admin SDK, renders with
 * `functions/lib/digest-template.js`, and sends through the shared
 * `sendNotificationEmail` pipeline (idempotency + audit + Resend).
 */

const admin = require('firebase-admin');

const finance = require('../api').digest;
const { sendNotificationEmail } = require('../../../functions/lib/email');
const { buildWeeklyDigest } = require('../../../functions/lib/digest-template');
const { resolveUserLocale } = require('../../../functions/lib/locale');
const { firstName } = require('../../../functions/lib/format');
const { resolveUserEmail } = require('./notify-core');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fluxyos.com';
const OPEX_TYPES = ['expense', 'fee', 'tax'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEFAULT_METRICS = {
    financial_health: true, cash_position: true, bills: true, budgets: true,
    revenue: true, expenses: true, subscriptions: true, vendors: true,
};

async function fetchCollection(db, uid, name, limit) {
    const snap = await db.collection(`users/${uid}/${name}`).limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function tsToMs(v) {
    if (!v) return null;
    if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v === 'string') { const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+07:00` : v); return Number.isNaN(t) ? null : t; }
    if (v instanceof Date) return v.getTime();
    return null;
}

// ISO-week idempotency key (one digest per user per ISO week).
function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}_W${String(week).padStart(2, '0')}`;
}

function formatRange(startKey, endKey, locale) {
    const months = locale === 'id'
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const s = String(startKey).split('-'); const e = String(endKey).split('-');
    if (s.length !== 3 || e.length !== 3) return '';
    const sd = +s[2]; const ed = +e[2]; const sm = months[+s[1] - 1]; const em = months[+e[1] - 1]; const ey = e[0];
    return s[1] === e[1] ? `${sd}–${ed} ${em} ${ey}` : `${sd} ${sm} – ${ed} ${em} ${ey}`;
}

// Best-effort budget performance for the active budget covering "now".
function computeBudget(budgets, transactions) {
    try {
        const active = (budgets || []).filter((b) => (b.status || 'active') === 'active' && Number(b.total_budget) > 0);
        if (!active.length) return null;
        const now = Date.now();
        const chosen = active.find((b) => {
            const ps = tsToMs(b.period_start); const pe = tsToMs(b.period_end);
            return ps && pe && now >= ps && now <= pe;
        }) || active[0];
        const ps = tsToMs(chosen.period_start); const pe = tsToMs(chosen.period_end);
        if (!ps || !pe) return null;
        let used = 0;
        for (const tx of transactions) {
            if (!OPEX_TYPES.includes(String(tx.type || '').toLowerCase())) continue;
            const ms = tsToMs(tx.timestamp);
            if (ms != null && ms >= ps && ms <= pe) used += Math.abs(Number(tx.amount) || 0);
        }
        const total = Number(chosen.total_budget) || 0;
        return { label: chosen.period_label || chosen.name || null, used, total, percent: total > 0 ? (used / total) * 100 : 0 };
    } catch (_e) {
        return null;
    }
}

async function writeAudit(db, uid, action, after) {
    return db.collection(`users/${uid}/audit_logs`).add({
        actor_uid: uid, actor_role: null, action,
        target_collection: 'mail_log', target_id: 'weekly_digest',
        before: null, after, reason: null, source: 'system',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
}

/**
 * Generate (and unless dryRun, send) one user's weekly digest.
 * `prefs` = { metrics, email, name, ... }. Returns a result descriptor.
 */
async function generateWeeklyDigest(db, uid, prefs = {}, { now = new Date(), logger = console, to: toOverride, dryRun = false } = {}) {
    const [transactions, bills, subscriptions, budgets] = await Promise.all([
        fetchCollection(db, uid, 'transactions', 1000),
        fetchCollection(db, uid, 'bills', 500),
        fetchCollection(db, uid, 'subscriptions', 500),
        fetchCollection(db, uid, 'budgets', 50).catch(() => []),
    ]);

    // Skip accounts with zero finance records ever.
    if (transactions.length + bills.length + subscriptions.length === 0) {
        return { skipped: 'no_records' };
    }

    // Recap the last COMPLETED week — the 7 days before the current week starts
    // (e.g. on Mon Jun 15 → Jun 8–14), NOT the in-progress/future current week.
    // Comparison = the week before that.
    const thisWeekStart = finance.startOfWeek(now);
    const period = finance.buildPeriod('rolling', 'last week', finance.addDays(thisWeekStart, -7), finance.addDays(thisWeekStart, -1));
    const comparisonPeriod = finance.previousEquivalentPeriod(period);
    const plan = finance.buildQuestionPlan({
        intent: 'period_performance', period, comparison_period: comparisonPeriod, filters: {},
        tools_to_call: ['get_period_performance', 'get_finance_summary', 'get_revenue_analysis', 'get_expense_analysis', 'get_bills_analysis', 'get_subscription_analysis', 'get_cash_pressure', 'comparison'],
    });
    const tools = finance.executeFinancePlan(plan, transactions, bills, subscriptions, 'Weekly financial digest');
    const coverage = finance.calculateDataCoverage(plan, tools);

    // Resolve the email language FIRST so the AI-generated content (executive
    // summary, insights, recommended actions) is written in the same language
    // as the template chrome — never mixed within one email.
    const locale = await resolveUserLocale(db, uid);

    let answer = finance.buildPlannedDeterministicAnswer({ plan, message: 'Weekly financial digest', pageContext: 'global', tools, language: locale });
    if (process.env.OPENAI_API_KEY) {
        try {
            const ai = await finance.callOpenAIFinanceAnalyst({
                message: 'Weekly financial digest', pageContext: 'global', period,
                intent: 'period_performance', plan, dataCoverage: coverage, deterministicAnswer: answer, tools, language: locale,
            });
            const validated = finance.validateFinanceAnswer(ai, 'period_performance', period);
            if (validated) answer = validated;
        } catch (e) {
            (logger.warn || console.warn)('digest AI failed; using deterministic', { uid, error: e.message });
        }
    }

    const metrics = prefs.metrics || DEFAULT_METRICS;
    const emailData = {
        name: prefs.name || null,
        baseUrl: APP_BASE_URL,
        periodLabel: formatRange(period.start_date, period.end_date, locale),
        summaryOnly: !coverage.has_data,
        metrics,
        budget: metrics.budgets ? computeBudget(budgets, transactions) : null,
        answer: { direct_answer: answer.direct_answer, insights: answer.insights, recommended_actions: answer.recommended_actions },
        tools,
    };
    const prebuilt = buildWeeklyDigest({ locale, data: emailData });

    if (dryRun) return { dryRun: true, prebuilt, summaryOnly: emailData.summaryOnly, coverage };

    const to = toOverride || prefs.email || (await resolveUserEmail(db, uid));
    if (!to) return { skipped: 'no_recipient' };

    const eventKey = `weekly_digest_${isoWeekKey(now)}`;
    await writeAudit(db, uid, 'weekly_digest.generated', { period: emailData.periodLabel, summary_only: emailData.summaryOnly, has_data: coverage.has_data });
    try {
        const res = await sendNotificationEmail({ db, uid, to, eventKey, locale, prebuilt, logger });
        await writeAudit(db, uid, 'weekly_digest.sent', { period: emailData.periodLabel, to, result: res.sent ? 'sent' : (res.skipped || 'unknown') });
        return { ...res, summaryOnly: emailData.summaryOnly };
    } catch (e) {
        await writeAudit(db, uid, 'weekly_digest.failed', { period: emailData.periodLabel, to, error: e.message });
        throw e;
    }
}

// Resolve effective preferences (missing doc = enabled defaults per spec).
async function getEffectivePrefs(db, uid, rosterUser) {
    let ep = null;
    try { const snap = await db.doc(`users/${uid}/settings/email_preferences`).get(); ep = snap.exists ? snap.data() : null; } catch (_e) { /* default */ }
    let timezone = ep && ep.timezone;
    if (!timezone) {
        try { const f = await db.doc(`users/${uid}/settings/finance`).get(); timezone = (f.exists && f.data().timezone) || 'Asia/Jakarta'; } catch (_e) { timezone = 'Asia/Jakarta'; }
    }
    return {
        weekly_digest_enabled: ep ? ep.weekly_digest_enabled !== false : true,
        delivery_day: (ep && ep.delivery_day) || 'monday',
        delivery_hour: ep && Number.isInteger(ep.delivery_hour) ? ep.delivery_hour : 9,
        timezone,
        metrics: (ep && ep.metrics) || DEFAULT_METRICS,
        email: rosterUser && rosterUser.email,
        name: rosterUser && firstName(rosterUser.display_name),
    };
}

function localParts(now, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', hour: 'numeric', hour12: false }).formatToParts(now);
        const weekday = ((parts.find((p) => p.type === 'weekday') || {}).value || '').toLowerCase();
        let hour = parseInt((parts.find((p) => p.type === 'hour') || {}).value, 10);
        if (hour === 24) hour = 0;
        return { weekday, hour };
    } catch (_e) {
        return null;
    }
}

function shouldDeliverNow(prefs, now) {
    if (!prefs || prefs.weekly_digest_enabled === false) return false;
    const lp = localParts(now, prefs.timezone) || localParts(now, 'Asia/Jakarta');
    if (!lp) return false;
    return lp.weekday === (prefs.delivery_day || 'monday') && lp.hour === (Number.isInteger(prefs.delivery_hour) ? prefs.delivery_hour : 9);
}

// Roster sweep. The scheduler calls it with defaults (send to users whose local
// delivery slot is now). `force` sends to ALL enabled users regardless of slot
// (one-time broadcast); `dryRun` counts without sending. Idempotency + zero-record
// skips always apply.
async function runWeeklyDigestSweep(db, { now = new Date(), logger = console, limit = 1000, force = false, dryRun = false } = {}) {
    const snap = await db.collection('internal_users').limit(limit).get();
    let due = 0; let sent = 0; let wouldSend = 0; let skippedNoRecords = 0;
    for (const doc of snap.docs) {
        const uid = doc.id;
        const u = doc.data() || {};
        try {
            const prefs = await getEffectivePrefs(db, uid, u);
            if (!prefs.weekly_digest_enabled) continue;
            if (!force && !shouldDeliverNow(prefs, now)) continue;
            due += 1;
            const r = await generateWeeklyDigest(db, uid, prefs, { now, logger, dryRun });
            if (dryRun) { if (r && r.prebuilt) wouldSend += 1; else if (r && r.skipped === 'no_records') skippedNoRecords += 1; }
            else if (r && r.sent) sent += 1;
        } catch (e) {
            (logger.error || console.error)('weekly digest: user failed', { uid, error: e.message });
        }
    }
    (logger.info || console.log)('weekly digest sweep complete', { scanned: snap.size, due, sent, wouldSend, skippedNoRecords, force, dryRun });
    return { scanned: snap.size, due, sent, wouldSend, skippedNoRecords };
}

module.exports = { generateWeeklyDigest, getEffectivePrefs, shouldDeliverNow, runWeeklyDigestSweep, isoWeekKey, DEFAULT_METRICS };
