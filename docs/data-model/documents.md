---
status: current
owns: [documents]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Documents & Attachments

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4h. Documents — `users/{userId}/documents/{documentId}`

User-scoped document metadata for the shared receipt / invoice / proof
attachment workflow. Files themselves live in Firebase Storage under
`users/{userId}/documents/{documentId}/{fileName}` (≤5 MB, JPG/PNG/WebP/PDF
only). Spec lives in `docs/RECEIPT_DOCUMENT_ATTACHMENT_PLAN.md`.

| Field | Type | Notes |
|-------|------|-------|
| `file_name` | string | Sanitized filename (≤240 chars). |
| `file_mime_type` | string | One of `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. |
| `file_size` | number | Bytes, ≤ 5 MB. |
| `storage_path` | string | Always under `users/{uid}/documents/{documentId}/`. |
| `document_role` | string | `receipt` \| `invoice` \| `payment_proof` \| `revenue_proof` \| `unknown_finance_document`. |
| `source_context` | string | `transaction` \| `revenue` \| `bill` \| `subscription`. |
| `target_collection` | string \| null | `transactions` \| `bills` \| `subscriptions` once linked. |
| `target_id` | string | Empty until linked. |
| `upload_status` | string | `pending` \| `uploaded` \| `failed` \| `removed`. |
| `extraction_status` | string | Phase 1 always `not_requested`. Reserved for backend AI extraction. |
| `review_status` | string | Phase 1 always `not_required`. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Mutation rule:** owner read/create/update only; delete blocked. The
`storage_path` cannot change after create.

**Linked records:** transactions and bills carry an `attached_documents`
array of `{ document_id, role, storage_path, attached_at }` references
(≤20 entries). Bills additionally accept `invoice_status: "attached"`
when an invoice has been attached. **Attaching never mutates a bill's
`payment_status` and never creates a transaction.**

For backward compatibility with the legacy ledger thumbnail rendering,
image receipt uploads on **transactions** also dual-write the existing
`receipt_url` field with the Storage download URL. New code should prefer
`attached_documents`.

`DataService` exposes `uploadDocument`, `addDocumentMetadata`,
`linkDocumentTarget`, `attachDocumentToRecord`, `getDocumentDownloadURL`,
and `detachDocumentFromRecord`. The shared UI component lives in
`assets/js/document-attachment.js` and is exposed as
`window.FluxyDocumentAttachment`.

**Reading a stored document.** Attachment entries carry only
`storage_path`, and `uploadDocument` returns a download URL for images
only. Any UI that shows or downloads an attachment must resolve the path
through `ds.getDocumentDownloadURL(userId, storagePath)` (session-cached).

**Detaching is a soft-detach.** Financial source documents are never
hard-deleted — `allow delete: if false` is deliberate in both
`storage.rules` and `firestore.rules`.
`ds.detachDocumentFromRecord(userId, targetCollection, targetId, attachment)`
removes the entry from `attached_documents` (via `arrayRemove`, so the
caller MUST pass the entry exactly as read back from the record), flips the
metadata to `upload_status: 'removed'`, clears a bill's `invoice_status`
with `deleteField()` once the last invoice is gone, and writes a
`document.detached` audit log. The Storage object survives.

**Scanned documents are auto-attached.** `assets/js/document-capture.js`
uploads the scanned file before the record create and folds
`attached_documents` (plus `receipt_url` for images, `invoice_status` for
bills) into the create payload, then back-links with `linkDocumentTarget`.
An attachment failure never blocks the save — the record is written and the
user gets a warning toast. Files over 5 MB are compressed when they are
images and skipped otherwise.

**Detail views.** `FluxyDocumentAttachment.renderAttachmentsSection({...})`
renders the Attachments block (chronological list, preview, download,
replace, detach) and is mounted by `ledger.html` (`#tx-detail-attachments`,
`targetCollection: 'transactions'`) and `bill.html` (`#bill-attachments`,
`targetCollection: 'bills'`). `ds.uploadReceipt` / `ds.updateTransactionReceipt`
are the pre-`documents` path and now have **no callers** — do not reuse them:
`uploadReceipt` hardcodes `users/{uid}/receipts/` and bypasses `_scope()`.
