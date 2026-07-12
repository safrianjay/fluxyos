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
