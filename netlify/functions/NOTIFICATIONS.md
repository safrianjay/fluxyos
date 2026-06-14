# Email notifications — Netlify (no-Blaze) path

This is the **no-Blaze alternative** to the Firebase Cloud Functions in
`functions/`. Same emails, same Resend templates (`functions/lib` is reused
verbatim), but it runs on **Netlify Scheduled Functions** so it needs **no
Firebase Blaze plan** — only a Firebase **service-account key**.

Use this OR the Cloud Functions path, not both (running both double-sends).

## What runs

| File | Schedule | Sends |
|---|---|---|
| `notify-sweep.js` | every 5 min (`*/5 * * * *`) | Welcome + KYC (approved/needs-revision/rejected) + payment (verified/rejected), reconciled from `internal_users` |
| `trial-reminders.js` | daily 02:00 UTC (`0 2 * * *`) | Trial ending within 24h, from `billing_subscription/current` |

Both are **schedule-only** (no public HTTP), so there's no email-relay endpoint
to abuse. The internal console keeps writing status as it already does; the
sweep turns those into emails within ~5 minutes. Logic lives in `lib/notify-core.js`.

- **Idempotency/audit:** identical to the Cloud Functions path — each send
  `.create()`s `users/{uid}/mail_log/{eventKey}` (Admin SDK bypasses rules),
  rolls back on provider failure, and writes a `notification.email_sent` audit row.
- **KYC/payment `eventKey`** includes the review timestamp, so a re-decision
  re-notifies while retries dedupe.
- **Welcome is guarded** so a first deploy never back-emails existing users —
  see `WELCOME_AFTER` below.

## One-time setup

1. **Generate a Firebase service account key** (free, no Blaze):
   Firebase Console → ⚙️ Project settings → **Service accounts** →
   **Generate new private key** → downloads a JSON file.

2. **Verify the Resend domain** (`fluxyos.com`) and SPF/DKIM/DMARC DNS — already done.

3. **Set Netlify environment variables** (Site settings → Environment variables):

   | Variable | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the **entire** service-account JSON, on one line |
   | `RESEND_API_KEY` | your Resend API key |
   | `EMAIL_FROM` | `FluxyOS <notifications@fluxyos.com>` |
   | `EMAIL_REPLY_TO` | `support@fluxyos.com` |
   | `APP_BASE_URL` | `https://fluxyos.com` |
   | `DEFAULT_LOCALE` | `en` or `id` |
   | `WELCOME_AFTER` | **deploy timestamp**, ISO (e.g. `2026-06-14T12:00:00Z`) — only users created after this get a welcome email. Set it to "now" at first deploy so existing users are never emailed. |

   These are secrets — set them in Netlify, never commit them.

4. **Deploy** by pushing to `main` (Netlify auto-deploys). The scheduled
   functions register automatically from the `schedule()` wrapper; confirm them
   under **Netlify → Functions** (they show a "Scheduled" badge).

## Local smoke test (sends nothing)

```bash
npm run smoke:notify
```

Mocks Firestore/Auth/Resend and asserts: welcome/KYC/payment reconcile, welcome
age-gating, EN/ID locale, idempotent re-runs, trial-window filtering, and
failure rollback + retry.

## Trade-offs vs the Cloud Functions path

- **Latency:** KYC/payment/welcome arrive within ~5 min (sweep interval) instead
  of instantly.
- **Cost/scale:** each sweep scans `internal_users` (capped at 500/run). Fine for
  MVP; for large user bases, switch to Blaze + the event-driven Cloud Functions.
