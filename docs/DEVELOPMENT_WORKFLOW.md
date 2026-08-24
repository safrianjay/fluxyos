# FluxyOS Development Workflow

The lifecycle every change follows, what each stage costs, and which parts are
enforced by a machine rather than by memory.

Adapted to what FluxyOS actually has: **one Firebase project**, **two Netlify
sites built from one repo**, **one developer**, and a **300-minute monthly build
budget**. Sections assuming a staging environment are deferred with prerequisites
stated rather than adopted as vocabulary — see §9.

---

## 0. The two facts that shape everything

**Commits are free. Pushes cost.** One push builds *two* sites (fluxyos.com and
dashboard.fluxyos.com via `SITE_ROLE`). August 2026 spent **306 of 300 minutes**
on ~30 single-commit pushes. The same work pushed once would have cost 2 builds.

**On this product the failure mode is a plausible wrong number, not a crash.**
Four bugs reached production in two days — a ₱10,000 invoice posted as
₱1,000,000, a KYC gate that had silently stopped running, a rupiah price shown to
a peso customer, and Indonesian tax codes on a Philippine invoice. None threw an
error. Three were *correct* on an Indonesian workspace, which is what every test
account uses. A longer manual checklist would have passed all four.

This workflow is built around those two facts.

---

## 1. Lifecycle

```
LOCAL DEVELOPMENT → LOCAL VALIDATION → COMMIT ─┐
                                               │  (repeat freely — free)
                                               ▼
                    npm run ship  →  BATCH REVIEW  →  PUSH  →  PRODUCTION
                                                                ↓
                                                        POST-DEPLOY CHECK
```

`commit`, `push`, and `deploy` are **not** the same action. Committing is a save
point. Pushing is a release — `main` auto-deploys. There is no gap between push
and production today, which is exactly why the gate sits at push.

---

## 2. Change level — computed, not declared

Run `npm run classify`, or read it in the QA banner. The level is derived from the
diff, because **a level you type is a level you can get wrong when tired** — which
is what happened: the multi-currency work was Level 4 and was worked as Level 2.

| Level | Surface | Gates enforced |
|---|---|---|
| **L1** | copy, docs, spacing, markdown | design-system lint |
| **L2** | frontend behaviour, CSS, page JS | + console sweep, module-parse |
| **L3** | backend, data model, functions, deploy config | + scoping invariant, structure drift, **all lanes forced** |
| **L4** | money, tax, billing, rules, auth, gating | + money-seam (16), price-book, rules emulator, non-IDR spec, **all lanes forced** |

Financial *pages* escalate on diff **content**, not filename: removing a label
from `invoices.html` is copy; editing its money handling is not. A level that
always fires stops carrying information.

**L3 and above force every QA lane.** Diff-based lane selection is not enough when
the file that breaks is rarely the file that was edited.

### L4 has one extra rule

> **Verify in a non-IDR workspace.** IDR is both the correct answer and the
> fallback, so a currency bug is invisible on an Indonesian account. This is not
> a suggestion; it is the reason three of this week's four bugs shipped.

`npm run qa` prints this automatically at L4.

---

## 3. Local validation

Check the change *and the flow around it*:

- **Frontend** — renders, no console errors, loading/empty/error states, 375px and 1280px, existing components reused
- **Backend** — auth, authorization, validation, error handling, queries still workspace-scoped, no unintended writes
- **Money (L4)** — amounts stored as integer **minor units**, parsed **once** at the input, correct currency and tax for the *workspace's country*, no historical data mutated, no duplicate postings
- **UX** — the whole path: action → loading → success → data update → confirmation, *and* action → loading → error → recovery

The mechanical half is `npm run qa`. The judgement half is not automatable — that
is what this section is for.

---

## 4. Commit

Commit when the change is **stable**, not when it merely runs. One logical change
per commit; a clear subject; the *why* in the body, since the diff shows the what.

Commit as often as useful. It costs nothing and creates the rollback points §8
depends on.

---

## 5. Ship — the batch decision

```
npm run ship
```

Reports, against live data: which commits would go out; **how many builds** the
push triggers (the build-ignore hook skips sites whose output cannot change);
**estimated minutes** and the **live Netlify quota** with reset date; the batch's
**change level**; whether the QA artifact is stamped at HEAD, passing and
non-partial; and any uncommitted tracked files.

It does **not** push. It makes cost visible so the decision is made against
numbers instead of impatience.

**Push when a piece of work is finished end to end** — feature complete, QA green,
verified. Not per fix. Ten commits pushed together cost the same as one.

---

## 6. The push gate (enforced by hook)

`.claude/hooks/qa-gate.sh` blocks pushes to `main` unless `.qa/qa-run.json` shows
a passing, non-partial run whose `head` equals the commit being pushed. `--lane=`
and `--skip-browser` mark the artifact partial and the gate rejects it — they are
for iteration, not shipping.

```
git commit …            # commit first: QA stamps the artifact with HEAD
npm run qa              # on the commit you will actually push
npm run ship            # confirm cost and readiness
QA_PASS=1 git push origin main
```

**`firestore.rules`, `firestore.indexes.json` and `storage.rules` do not ship with
a push.** Each is a separate `firebase deploy`, then *verify it took*, then
`npm run deploy:stamp`, then commit the stamp. `check:deploy-stamp` fails the
build if a rules change is unstamped.

---

## 7. Post-deployment check

- both origins respond (`fluxyos.com` 200, `dashboard.fluxyos.com` → `/login` 200)
- the changed feature works in production
- no console errors on affected pages
- **L4 only** — the changed money path shows correct values in a real workspace, and the resulting journal entry is correct

Deployed bytes are checkable directly:

```
curl -s https://fluxyos.com/assets/js/<file>.js | node --input-type=module --check
```

---

## 8. Rollback

Before an L3/L4 push, know: what changed, what could break, can it be reverted,
does it need a data migration, is that migration reversible?

Reverting code is a commit. Reverting **posted journal entries is not** — an
invoice that posted the wrong amount stays wrong until someone voids and
re-issues it. That asymmetry is why L4 gets the strictest gate.

---

## 9. Deferred, with prerequisites

**Not** adopted yet. Adopting the vocabulary without the substance would produce
paperwork around unverified changes.

| Practice | Blocked on |
|---|---|
| **Staging environment** | A **second Firebase project**. Staging on today's single project would read and write production Firestore — real customer ledgers. That is not staging; it is production with a different URL, and more dangerous than none. |
| **Feature branches + PR previews** | Netlify headroom. Branch deploys multiply builds on a budget already exceeded. Also the QA gate keys on `head == HEAD`, and a **merge commit has a new SHA**, so the artifact never matches — resolve that first or the gate becomes routinely bypassed. |
| **Separate review/approval gate** | A second person. Today it is self-review; naming it a gate would make it feel like safety it does not provide. |

---

## 10. Change report

For any L3 or L4 change, state:

**Change** · **Scope** (files/modules) · **Local QA** (what was actually run) ·
**Regression** (what else was checked) · **Risks** (what could still go wrong) ·
**Status** (ready to commit / ready to push / blocked) · **Notes**

The most valuable line is usually under Risks, and it is usually *"verified on an
IDR workspace only."* Say it when it is true.

---

## The rule

Optimise for **correct → tested → safe → deployed**, never for getting the change
pushed quickly. When uncertain, keep it local. Local costs nothing.
