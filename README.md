# FluxyOS

**FluxyOS is an Intelligent Finance Operating System that connects financial
operations, accounting, business operations, enterprise workflows, and
intelligence into one continuously connected system.**

Built for businesses across their growth journey — from small and growing
companies to medium-sized and enterprise organizations. Indonesia is the home
market and operating context, not the product ceiling.

It is more than bookkeeping, accounting, financial reporting, ERP, a dashboard,
or an AI chatbot. It may include those capabilities; none of them defines it.

## Where the direction is written down

Read these before proposing or building anything. They are the source of truth,
and they disagree with nothing — precedence is explicit.

| Document | Owns |
|---|---|
| [`docs/PRODUCT_STRATEGY.md`](docs/PRODUCT_STRATEGY.md) | **Start here.** Positioning, the five layers, the maturity ladder, the audited status baseline, and the tests a new module must pass |
| [`docs/PROJECT_BACKGROUND.md`](docs/PROJECT_BACKGROUND.md) | Architecture, Firestore schema, conventions, the workspace-scoping invariant |
| [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) | How the system is built — module contracts and extension recipes |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What is shipped, stubbed, planned, and strategic |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Visual system, component reuse, anti-slop rules |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Working rules for AI agents, including the QA gate |

**`PRODUCT_STRATEGY.md` §3 is an audited reality baseline.** Multi-entity,
inventory, point-of-sale, purchasing, approvals and enterprise controls are
**not built** — they are strategic direction. Never describe them as present.

## What exists today

A double-entry accounting kernel with operational modules feeding it:

- Accounting kernel — chart of accounts (SAK-aligned), journals, general ledger,
  trial balance, income statement, balance sheet, cash flow, period close with
  retained earnings, AP/AR aging
- Financial operations — transaction ledger, bills, subscriptions, budgets,
  invoices with multi-currency, reports and exports
- Bank reconciliation and statement import
- Indonesian Tax Center; marketplace/commerce order sync
- Fluxy AI — analyst chat, receipt and document extraction
- Team workspaces with role-based access

## Stack

Static HTML + Tailwind CSS + vanilla JS (ES modules), Firebase Auth + Firestore,
Netlify hosting with a two-site deploy split. **No build step** for the app
itself; `npm` scripts cover CSS builds, QA, and generators.

## Working on it

```bash
npm run qa      # BE + FE + PRODUCT lanes — required before any push to main
npm test        # Playwright suite
```

The QA gate is enforced by hooks, not convention: pushes to `main` are blocked
unless `npm run qa` passed against the exact commit being pushed. See
[`CLAUDE.md`](CLAUDE.md) for the full workflow.
