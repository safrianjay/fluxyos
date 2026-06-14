# FluxyOS Firebase Functions

## Deploy Auth deletion cleanup

`cleanupInternalUserOnAuthDelete` removes `internal_users/{uid}` after a single
Firebase Authentication user is deleted.

The Firebase project must be on the Blaze plan before Cloud Functions can be
deployed. After the plan upgrade:

```bash
firebase deploy --only functions:cleanupInternalUserOnAuthDelete
```

Firebase Admin SDK bulk deletion does not emit per-user Auth deletion events.
Delete accounts one at a time when this cleanup is required.

---

## Email notifications (Resend)

Transactional/notification emails are sent from Cloud Functions via
[Resend](https://resend.com). Auth emails (verify, password reset) are NOT here —
those are handled by Firebase Auth directly from `login.html`.

### Functions

| Export | Trigger | Sends |
|---|---|---|
| `sendWelcomeEmail` | Auth `onCreate` | Welcome |
| `notifyOnInternalUserUpdate` | Firestore update on `internal_users/{uid}` | KYC approved / needs-revision / rejected; payment verified / rejected |
| `sendTrialEndingReminders` | Daily schedule (09:00 Asia/Jakarta) | "Trial ending soon" when `billing_subscription/current` is `trialing` and ends within 24h |

KYC/payment emails fire off the **internal index** (`internal_users`) because the
internal console has no Firebase identity — the server-side trigger is what turns
a reviewer's decision into a customer email.

### Design notes

- **Idempotency:** every send first `.create()`s `users/{uid}/mail_log/{eventKey}`
  (atomic fail-if-exists). Redelivered triggers dedupe; a failed provider send
  rolls the placeholder back so a retry can resend. `eventKey` carries the Cloud
  Functions `event.id` so a redelivery dedupes but distinct transitions each send.
- **Audit:** each send writes a `notification.email_sent` row to
  `users/{uid}/audit_logs` (best-effort).
- **Locale:** EN/ID chosen from `users/{uid}/settings/finance.locale`, falling back
  to `DEFAULT_LOCALE`. Brand/product names stay English (LOCALIZATION_PLAN.md).
- **Currency:** `Rp1.234.567`, no space after `Rp` (DESIGN_SYSTEM.md).
- Admin SDK writes bypass Firestore rules, so `mail_log` needs no rule changes.

### One-time setup

1. **Blaze plan** on the Firebase project (required for outbound network + schedules).
2. **Verify the sending domain** (`fluxyos.com`) in Resend and add the SPF/DKIM DNS
   records it provides. Without this, mail lands in spam.
3. **Config:** `cp functions/.env.example functions/.env` and adjust
   `EMAIL_FROM` / `APP_BASE_URL` / `DEFAULT_LOCALE` (non-secret).
4. **Secret:** store the Resend API key (never in `.env`):
   ```bash
   firebase functions:secrets:set RESEND_API_KEY
   ```

### Deploy

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

The trial sweep uses a **collection-group query** on `billing_subscription` filtered
by `status`. The first run may print a Firestore console link to create the
single-field collection-group index — follow it once.

### Local smoke test (no real emails)

`npm run smoke` renders every template (EN + ID) and exercises the idempotent
sender against an in-memory Firestore/Resend double — it sends nothing and writes
sample HTML to `functions/.smoke/`.

