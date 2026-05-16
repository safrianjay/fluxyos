# FluxyOS Change Workflow

How a change moves from request to production. The gates marked **🛑 hook** and **🔔 hook** are enforced by `.claude/hooks/qa-gate.sh` at the harness level — they are not optional guidelines.

---

## Flow

```mermaid
flowchart TD
    Start([User request]) --> Auto[Auto-load CLAUDE.md]
    Auto --> Triv{Trivial change?<br/>typo / single-line}

    Triv -- No --> ReadDocs["Read prerequisite docs<br/>📘 PROJECT_BACKGROUND.md<br/>📘 QA_CHECKLIST.md<br/>📘 SEO/LOCALIZATION as needed"]
    Triv -- Yes --> Implement
    ReadDocs --> Implement[Edit / Write the change]

    Implement --> Risk{High-risk file?<br/>firestore.rules · storage.rules<br/>dashboard HTMLs · netlify.toml}
    Risk -- Yes --> Warn["🔔 hook prints reminder<br/>(non-blocking, points to docs)"]
    Risk -- No --> QA
    Warn --> QA

    QA[Run QA checks] --> Verify1{New file refs<br/>actually EXIST?<br/>(ls each path)}
    Verify1 -- No --> Fix[Fix references]
    Fix --> Implement
    Verify1 -- Yes --> Verify2{Smoke test passes<br/>in browser?<br/>console clean?}
    Verify2 -- No --> Fix
    Verify2 -- Yes --> Commit[git add + commit]

    Commit --> Push["git push origin main"]
    Push --> Gate{Command contains<br/>QA_PASS=1 ?}
    Gate -- No --> Block["🛑 hook BLOCKS<br/>QA checklist printed<br/>(exit 2)"]
    Block --> QA
    Gate -- Yes --> Accept[Push accepted by remote]

    Accept --> Deploy[Netlify auto-deploys from main]
    Deploy --> Live([Live on fluxyos.com])

    classDef hook fill:#fef3c7,stroke:#d97706,color:#78350f
    class Warn,Block hook
```

---

## Gates at a glance

| Gate | Where | Enforced by | Bypassable? |
|---|---|---|---|
| **CLAUDE.md auto-load** | Session start | Claude Code harness | No |
| **Read prerequisite docs** | Before non-trivial change | Claude (self-discipline) | Yes — but the next gate catches mistakes |
| **🔔 High-risk file reminder** | On Edit/Write to security rules, dashboard HTMLs, netlify.toml | `qa-gate.sh` PreToolUse hook | Non-blocking — surfaces every time |
| **Smoke + console check** | After change, before push | Claude (self-discipline) | Yes — but the next gate is the real gate |
| **🛑 Push to main** | On `git push ... main/master` | `qa-gate.sh` PreToolUse hook (exit 2) | Only with `QA_PASS=1` prefix in the command |
| **Production verify** | After Netlify deploy | User (manual reload of fluxyos.com) | N/A |

---

## What `QA_PASS=1` claims

When the push command is prefixed with `QA_PASS=1`, it's an explicit assertion that **all of these were done**:

1. Every new file reference (CSS, JS, image) was `ls`'d locally
2. The affected page was opened in a real browser
3. Browser console had no CSP, CORS, 404, or Firebase errors
4. `docs/QA_CHECKLIST.md` sections for the change type were read
5. `docs/PROJECT_BACKGROUND.md` was read for any Firestore/data change

The hook can't verify these — it trusts the prefix as a signed claim. Lying defeats the purpose.

---

## Files involved

- [.claude/hooks/qa-gate.sh](../.claude/hooks/qa-gate.sh) — the gate script
- [.claude/settings.json](../.claude/settings.json) — registers the hook on `Bash|Edit|Write`
- [../CLAUDE.md](../CLAUDE.md) — auto-loaded session rules pointing here
- [QA_CHECKLIST.md](QA_CHECKLIST.md) — what to actually check during QA
- [PROJECT_BACKGROUND.md](PROJECT_BACKGROUND.md) — schema and convention reference
