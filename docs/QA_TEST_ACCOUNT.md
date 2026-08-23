# QA Test Account Handling

FluxyOS QA sometimes needs a real Firebase Auth session to verify app pages, Firestore reads, and authenticated API calls.

Do not commit real QA credentials to this repository. Passwords, refresh tokens, ID tokens, and one-time login details must stay local only.

Use this local-only file when a temporary QA account is created:

```text
.qa/firebase-test-account.md
```

That folder is ignored by git. The local file may include:

- Firebase project
- QA email
- QA password
- creation date
- intended use
- cleanup notes

If a QA run depends on this account, report the account existence in the QA summary without copying the password into committed docs, tickets, or chat history.

## Manual QA Workflow

Authenticated manual QA should use the local Firebase QA account stored in:

```text
.qa/firebase-test-account.md
```

Before running browser QA that needs sign-in, confirm this file exists locally
and contains the current Firebase project, QA email, password, creation date,
intended use, and cleanup notes.

Never copy the password or saved browser session into committed docs. In QA
reports, refer to it as the local Firebase QA account and include only whether
the account was sufficient for the scenario. If a scenario needs a different
account type, such as a fresh post-cutoff onboarding user or a true pre-cutoff
legacy user, create a temporary local-only QA account and record it in the same
ignored `.qa/` file or in a separate ignored note.

## Member (invited-team) QA account

Some checks must run as an **invited workspace member**, not the owner — most
importantly that finance data is shared (a member must see the SAME
transactions/bills/budgets as the owner). The owner account can't exercise this,
because for an owner `workspaceId === uid`, so a scoping bug is invisible.

The member-path spec is `tests/member-drilldown.spec.js`. It **skips entirely**
until a member credentials file exists, so it's safe to have in the suite.

One-time provisioning (manual — cannot be automated here):

1. Create a **second** Firebase Auth account (a different email from the owner
   QA account).
2. Invite that email as a member **from the owner QA account** — i.e. the
   account in `.qa/firebase-test-account.md`, the one the harness signs in as,
   **not** a personal account. The invite doc must land in that QA account's
   workspace (`workspaces/{qaOwnerUid}/invites/{email}`), or the member spec
   won't find it and the member stays on onboarding. (Send it via Settings →
   Team & roles while signed in as the QA account.)
3. The member spec accepts the invite for you: it resolves the QA owner's
   workspace id and sends the member in through the invite link
   (`/login?invite=<email>&ws=<id>`), which `healFromStoredInvite` accepts on
   load. You do not need to log in as the member or copy any link manually.
4. Save the member credentials locally in the git-ignored file:

   ```text
   .qa/firebase-test-member-account.md
   ```

   Same format as the owner file — the spec parses `Email:` and `Password:`
   backtick fields:

   ```markdown
   # Local Firebase QA MEMBER Account
   Project: `fluxyos`
   Email: `member-qa@example.com`
   Password: `…`
   Notes: invited member of the owner QA workspace; git-ignored.
   ```

Once the file exists, `npx playwright test member-drilldown` runs the member
sharing checks. Never commit the member password or its saved session.

## ⚠️ Do not re-create the QA accounts after the KYC cutoff

`assets/js/kyc-gate.js` locks the **entire app** for any user whose Firebase
`creationTime` is on/after `KYC_ENFORCEMENT_CUTOFF` until a reviewer approves
their KYC in `/internal`. Both QA accounts predate that cutoff, so they are
never enforced.

If either account is ever deleted and re-created, every Playwright spec will
fail at a full-screen "Your details are under review" overlay. Recover by
approving that uid in the Internal Operations Console (KYC Review → Approve),
or by setting `internal_users/{uid}.kyc_status = 'approved'` directly.

---

## Non-IDR QA accounts (per country)

The original QA account is an **Indonesian** workspace. That makes a whole class
of bug invisible: rupiah is both the correct answer and the fallback, so a page
that fails to resolve the workspace looks identical to one that resolves it
correctly. On 2026-08-23 a peso workspace was quoted the rupiah ladder, QRIS and
PPN at checkout with every check green.

`scripts/seed-qa-account.js` provisions an account for one market. It needs the
Admin SDK because a QA account must clear three gates the app deliberately will
not let a client-side script clear:

| Gate | Why a script can't do it from the app |
|---|---|
| KYC review | Locks the app until a human approves in `/internal`. No auto-approve, by design. |
| Onboarding | The gate holds every page until progress is complete. |
| `base_currency` | **Set once**, enforced in `firestore.rules`. A wrong value is not fixable through the app — only the Admin SDK can repair it. |

It refuses to write to any address that is not `qa+<cc>@fluxyos.com`, and it
reads the workspace back from the server after writing to confirm the immutable
currency actually landed.

```bash
# 1) Dry run — prints every planned write, writes nothing
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/seed-qa-account.js --country PH --dry-run

# 2) Apply. Writes .qa/firebase-test-account-ph.md (gitignored)
GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
  node scripts/seed-qa-account.js --country PH
```

That is the whole setup. Playwright picks it up automatically: the `auth-setup-ph`
project derives the account from its own name, and `chromium-ph` runs
`tests/workspace-currency.spec.js` against it.

**Without the fixture everything skips**, so a clone with no credentials still
runs green.

### Why only one extra account, not four

`workers: 1` and `fullyParallel: false`, so a second *full* sweep would add
minutes to every push. The PH project runs **one small spec** (~20s) — what a
second account uniquely buys is the currency assertion, not more page coverage.

SG and MY have no price book yet (billing falls back to IDR) and no customers,
so an account there would assert a state that has not been designed. When it is,
adding them is one `--country SG` run plus two project blocks — the harness is
already generic and the spec already reads the currency from the workspace
rather than hardcoding PHP.
