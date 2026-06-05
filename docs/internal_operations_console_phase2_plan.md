# Internal Operations Console — Phase 2 Plan (DRAFT)

> Customer-facing **manual payment submission + proof upload**, feeding the
> existing internal Payment Review queue. Builds on Phase 1
> (`docs/internal_operations_console_plan.md`). **Draft — open decisions are
> listed in §11 and should be resolved before build.**

## 1. Feature type & objective

Workflow feature (customer side) that completes the activation loop started in
Phase 1. Today the internal console can *review* payment status, but nothing lets
a customer *submit* a payment + proof — `internal_users.payment_status` only ever
reaches `pending` via self-sync. Phase 2 lets an authenticated user see payment
instructions, enter what they paid, and upload a transfer proof, which moves them
to `payment_status: submitted` so the team can verify in the existing console.

**Job to be done:** *When I've paid for FluxyOS by manual bank transfer, I want to
submit the amount and a proof image, so the team can verify it and activate my
account.*

Out of scope (later phases): account access **gating** (Phase 3 —
pending/payment/suspended screens), payment-gateway integration, automatic
activation, and admin **viewing of the proof image** without auth (see §6 + §11).

## 2. Reuse — do not rebuild

Phase 2 is mostly assembly of existing pieces:

- **Upload component** `window.FluxyDocumentAttachment.mount({ hostEl, role: 'payment_proof', sourceContext })` ([assets/js/document-attachment.js](../assets/js/document-attachment.js)) — `payment_proof` is already a valid `document_role`.
- **DataService** `uploadDocument`, `addDocumentMetadata`, `linkDocumentTarget` ([assets/js/db-service.js](../assets/js/db-service.js)) and the `users/{uid}/documents/{documentId}` model (PROJECT_BACKGROUND §4h).
- **Storage rules** already allow `users/{uid}/documents/{documentId}/{fileName}` (owner-only, ≤5 MB, JPG/PNG/WebP/PDF) — no Storage rules change needed.
- **Self-sync** `DataService.syncSelfToInternalIndex` and the open `internal_users` collection (PROJECT_BACKGROUND §4j) — the submission denormalizes payment fields here so the unauthenticated console can read them.
- Shared dialog/toast/empty-state helpers and the dashboard design system.

⚠️ `sourceContext` enum in `document-attachment.js` currently covers
`transaction|revenue|bill|subscription`. Add a `payment` (or `account`) context, or
upload the proof directly via `DataService.uploadDocument` + `addDocumentMetadata`
with `document_role: 'payment_proof'` and skip the attach-to-record helper.

## 3. New files / changes

**New**
- `payment-required.html` — authenticated customer page: payment instructions
  (bank details + amount), amount-paid input, proof upload, submit. App-page shell
  (auth guard, sidebar optional or minimal), no marketing footer.
- `assets/js/payment-submission.js` — page logic: load plan/amount, mount uploader,
  validate, write submission, redirect back with a toast.

**Modified**
- [assets/js/db-service.js](../assets/js/db-service.js) — add `createPaymentVerification`, `getMyPaymentVerification`, and `submitPaymentForReview` (atomic: write `payment_verifications` doc + denormalize onto `internal_users`).
- [firestore.rules](../firestore.rules) — add owner-scoped `users/{uid}/payment_verifications/{paymentId}` rules (create/read/update; delete blocked; validation).
- [assets/js/internal-dashboard.js](../assets/js/internal-dashboard.js) — Payment Review drawer shows submitted metadata (amount, method, note, proof filename, submitted date) read from `internal_users`; "View proof" handling per §6.
- Customer entry point (light) — see §5.
- Docs: PROJECT_BACKGROUND §4k (payment_verifications), ROADMAP, QA_CHECKLIST.

## 4. Data model — `users/{userId}/payment_verifications/{paymentId}`

Owner-scoped (only the user + future backend admin can read the proof). Schema
(amounts are **raw integers**, never formatted strings; no secrets/card data):

```js
{
  amount: number,                 // raw integer Rupiah
  currency: 'IDR',
  plan_id: string | null,
  billing_period: 'monthly' | 'annual' | 'custom' | null,
  payment_method: 'bank_transfer' | 'manual' | 'other',
  proof_document_id: string | null,   // -> users/{uid}/documents/{id}
  proof_file_name: string | null,
  submitted_note: string | null,       // <=500 chars
  status: 'submitted' | 'under_review' | 'verified' | 'rejected',
  reviewer_id: string | null,          // set by backend admin phase, not the open console
  reviewer_note: string | null,
  submitted_at, reviewed_at, created_at, updated_at: Timestamp
}
```

On submit, `submitPaymentForReview` also denormalizes onto `internal_users/{uid}`
(open, console-readable): `payment_status: 'submitted'`, `payment_submitted_at`,
`plan_id`, `payment_amount`, `payment_method`, and a `payment_proof_file_name`
field for display. The console's existing verify/reject actions continue to drive
`internal_users.payment_status`; Phase 2 leaves them unchanged.

## 5. Customer flow & entry point

```
Authenticated user -> /payment-required
  -> sees instructions (bank account name/number, amount, reference)
  -> enters amount paid + optional note
  -> uploads proof (FluxyDocumentAttachment, role: payment_proof)
  -> Submit (disabled until amount + proof present)
  -> writes payment_verifications + denormalizes to internal_users (status: submitted)
  -> toast + redirect to /dashboard
  -> console Payment Review shows the submission
```

**Entry point (no full gating yet):** add a dismissible "Activate your account"
banner/CTA on `/dashboard` shown only when the user's own `internal_users/{uid}`
(`getInternalUser(uid)` — open read) has `payment_status in [pending, rejected]`
and `kyc_status !== rejected`. Links to `/payment-required`. This is the lightweight
Phase 2 surface; the full route-level gate is Phase 3.

## 6. The proof-visibility constraint (important)

The internal console is **unauthenticated** (credential gate, not a Firebase
identity), so it **cannot read** the owner-scoped proof file in Storage or the
`payment_verifications` doc. Phase 2 therefore lets the console see submission
**metadata** (amount, method, note, filename, dates via `internal_users`) and
verify/reject by status — but **viewing the actual proof image is blocked** until
one of:

- **(A) Phase 5 admin auth** — reviewer signs into a Firebase admin account; rules
  grant admin UIDs read on `users/*/payment_verifications` + proof Storage. *(Recommended; also unblocks a real audit actor_uid.)*
- **(B) Backend signed-URL function** — a small server endpoint validates the admin
  session and returns a time-limited download URL for the proof.

Do **not** make proof files publicly readable to work around this. This dependency
should be decided in §11 before committing to a Phase 2 scope that promises
in-console proof viewing.

## 7. DataService methods

```
createPaymentVerification(userId, data)        // owner create
getMyPaymentVerification(userId)               // latest for the signed-in user
submitPaymentForReview(userId, { amount, plan_id, billing_period, payment_method,
                                 proof_document_id, proof_file_name, submitted_note })
  // writeBatch: payment_verifications doc + internal_users denormalization
```

Rules: raw-integer amounts; `updated_at: serverTimestamp()`; never store secrets;
status enum enforced; reuse `_stringOrDefault`/`_nullableString`/`_cleanDefined`.

## 8. firestore.rules

Add under `match /users/{userId}`:

```
match /payment_verifications/{paymentId} {
  allow read:   if isOwner(userId);
  allow create: if isOwner(userId) && isValidPaymentVerification(request.resource.data);
  allow update: if isOwner(userId) && isValidPaymentVerification(request.resource.data);
  allow delete: if false;
}
```

`isValidPaymentVerification`: `amount` is number `>=0` and `<= 999999999999`;
`currency == 'IDR'`; `status in ['submitted','under_review','verified','rejected']`;
`payment_method in ['bank_transfer','manual','other']`; string size caps; no
unexpected secret-like fields. (Admin read of other users' proofs is added with
Phase 5 / option A.)

## 9. UI states & design

Reuse dashboard components and the strict 6-step type scale. States: instructions
(default), upload pending/uploading/success/error (from FluxyDocumentAttachment),
submit disabled until valid, submitted confirmation, already-submitted ("under
review") state, rejected state (show reviewer note + allow re-submit). No orange
backgrounds; primary submit dark-navy. Responsive 375/768/1280.

## 10. QA additions (QA_CHECKLIST §N)

Upload validates type/size; submit blocked until amount + proof; submission writes
`payment_verifications` + flips `internal_users.payment_status` to `submitted`;
console Payment Review shows the new submission + metadata; verify/reject still
work and never create a transaction or mark a bill paid; amounts stored raw;
re-submit after rejection works; no raw Firebase errors; dashboard banner shows
only for pending/rejected; regression on dashboard + document-attachment flows.

## 11. Open decisions (resolve before build)

1. **Pricing model** — single fixed MVP price, or a small plan picker
   (`plan_id` + `billing_period`)? Where do bank-transfer instructions/amount come
   from (hardcoded config vs. a `settings`/`plans` doc)?
2. **Proof viewing** — accept metadata-only review now (defer image viewing to
   Phase 5), or build the option-B backend signed-URL endpoint as part of Phase 2?
3. **Entry point** — dashboard banner only (recommended for Phase 2), or pull the
   route-level gate forward from Phase 3?
4. **`reviewer_id` / verified-by** — stays null until admin auth (Phase 5), or
   capture a free-text reviewer label in the meantime?

## 12. Acceptance criteria (Phase 2)

- Authenticated user can open `/payment-required`, see instructions, enter amount,
  upload a proof, and submit.
- Submission creates `users/{uid}/payment_verifications/{id}` and sets
  `internal_users.payment_status = submitted` with denormalized metadata.
- Proof stored privately under `users/{uid}/documents/...`; never world-readable.
- Internal Payment Review shows the submission; verify/reject update status + write
  an `internal_audit_logs` entry (unchanged from Phase 1); no transaction/bill side
  effects.
- No customer access gating yet; normal app pages unaffected.
- Browser console clean; no raw Firebase errors; amounts stored as raw integers.
