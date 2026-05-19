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
