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
