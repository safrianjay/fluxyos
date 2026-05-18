# FluxyOS Standalone AI Command Center — Product & Implementation Spec

## Output file name

`docs/fluxyos_standalone_ai_command_center_prompt.md`

## 0. Required Reading Before Implementation

Before implementing this feature, the code agent must read these files first:

1. `docs/PROJECT_BACKGROUND.md`
2. `docs/product_ux_feature_intake_framework.md`
3. `docs/ROADMAP.md`
4. `docs/WORKFLOW.md`
5. `docs/fluxy_ai_financial_analyst_plan.md`
6. `docs/fluxyos_ai_bill_capture_feature_spec.md`
7. `CLAUDE.md` or `AGENTS.md` if available

### Why these dependencies matter

The standalone AI page is not an isolated chatbot screen. It is an entry point into the broader FluxyOS intelligence system.

- `fluxy_ai_financial_analyst_plan.md` defines the AI’s core finance-analysis scope, supported finance questions, backend tool/function approach, structured output schema, refusal rules, tone, and data-grounding behavior.
- `fluxyos_ai_bill_capture_feature_spec.md` defines the specialized bill/invoice extraction, review, and save workflow. The standalone AI page must reuse that workflow when users upload bills or invoices.

The standalone AI page should **detect and route**. It should not duplicate every specialized workflow inside the page.

---

# 1. Feature Name

## Fluxy AI Command Center

A standalone authenticated app page where users can ask Fluxy AI finance/project questions, use suggested prompts, upload images/documents, and let the AI detect the uploaded file type so it can route extracted information to the correct FluxyOS area.

---

# 2. Feature Type

- Page-level feature
- Intelligence feature
- Workflow-support feature
- Document-routing feature
- Finance command center

This is more than a chat page. It is a central AI workspace that connects finance questions, financial document upload, OCR/extraction, and routing into existing FluxyOS modules.

---

# 3. Main Objective

Create a standalone Fluxy AI page that lets users ask finance-related questions, upload financial documents, and route detected documents into the right FluxyOS workflow without changing existing module logic.

---

# 4. Product Context

FluxyOS already has an AI sidebar entry point. The goal is to turn that entry point into a real authenticated app page.

The standalone AI page should feel like a central command workspace, inspired by the provided reference image:

- Large personalized greeting
- Suggested prompt cards
- Refresh prompts action
- Large AI composer
- Attachment upload
- Image upload
- Send button
- Clean whitespace
- Focused AI-first experience

The reference image is a layout benchmark only. Do not copy the exact theme, content, colors, or generic prompts.

FluxyOS must keep its existing:

- Brand identity
- App theme
- Sidebar behavior
- Auth rules
- Finance data model
- Existing module workflows
- Existing copy conventions
- Existing design system patterns

---

# 5. Job To Be Done

When I need help understanding or processing my business finance,
I want one AI command page where I can ask questions or upload financial documents,
so I can quickly understand what the data means and move the document into the correct FluxyOS workflow.

## Secondary JTBDs

### Finance question
When I want to understand my business performance,
I want to ask Fluxy AI open-ended finance questions,
so I can understand revenue, expenses, margin, bills, subscriptions, and risks faster.

### Bill upload
When I receive a bill or invoice,
I want to upload it into Fluxy AI,
so the system can detect it, extract key details, and prepare it for review before saving it to Bills.

### Receipt upload
When I have a receipt or payment screenshot,
I want to upload it into Fluxy AI,
so the system can detect whether it belongs to Ledger or another module.

### Routing
When I upload a financial document,
I want Fluxy AI to recommend where it belongs,
so I do not need to manually decide whether it should go to Bills, Ledger, Subscriptions, or Revenue Sync.

---

# 6. Target Users

- Founder
- Business owner
- Finance admin
- Accountant
- Operations manager
- Internal finance team member

## User Needs

| User | Need | Example question/action |
|---|---|---|
| Founder | Understand business health quickly | “What should I fix first?” |
| Business owner | Turn messy finance data into action | Upload bill and ask “What is this?” |
| Finance admin | Process documents faster | Upload invoice and save to Bills |
| Accountant | Validate finance records | “Which records are missing receipts?” |
| Operations manager | Understand payable pressure | “Which bills are due soon?” |
| Internal finance team | Search and summarize finance activity | “Show my largest expenses this month.” |

---

# 7. Business Value

This feature helps FluxyOS become more than a dashboard. It turns the product into an interactive finance operating system.

It supports:

- Higher engagement
- Better onboarding
- Stronger product differentiation
- Faster finance workflows
- Increased trust in AI-assisted operations
- Better path toward premium AI features
- Reduced manual finance admin work
- Cleaner routing from unstructured documents into structured modules

---

# 8. Relationship With Fluxy AI Financial Analyst

This standalone AI page must follow the scope and behavior defined in:

`docs/fluxy_ai_financial_analyst_plan.md`

## What to reuse from the Financial Analyst plan

- Project-scoped AI behavior
- Supported finance intents
- Unsupported question refusal rules
- Backend tool/function calling approach
- Structured response schema
- Finance calculation logic
- Data grounding rules
- Tone and answer style
- User-scoped data access rules
- No hallucinated numbers
- No generic chatbot behavior

## Implementation rule

Do not create a separate AI personality or separate finance logic for this standalone page.

The standalone AI page should use the same AI orchestration, backend finance analysis functions, and structured response format defined in the financial analyst plan.

The standalone page is the **main surface area** for Fluxy AI.
The financial analyst plan is the **intelligence contract** behind the page.

---

# 9. Relationship With AI Bill Capture Feature

This standalone AI page must integrate with:

`docs/fluxyos_ai_bill_capture_feature_spec.md`

## Why this matters

The standalone AI page supports document upload, but bill/invoice extraction should not be rebuilt from scratch inside this page.

The Bill Capture feature owns:

- Bill/invoice extraction schema
- Bill review state
- Bill validation rules
- Save-to-Bills behavior
- Bill-specific confidence/warning rules
- Bill-specific Firestore mapping

The standalone AI page owns:

- General upload entry point
- File preview
- AI document-type detection
- Routing recommendation
- User-facing explanation
- Entry into specialized review workflows

## Integration rule

When a user uploads a bill or invoice from the standalone AI page:

1. Detect the file as `bill` or `invoice`.
2. Route it to the same extraction logic defined in `fluxyos_ai_bill_capture_feature_spec.md`.
3. Use the same backend endpoint or shared service if it already exists.
4. Use the same extraction schema.
5. Show the same review-before-save behavior.
6. Recommend destination: `Bills`.
7. Save only after user confirmation.
8. Save confirmed bill records into `users/{userId}/bills`.
9. Do not create a transaction automatically.
10. Do not mark the bill as paid automatically.

## Expected AI response for bill/invoice upload

“Looks like this is a bill. I can extract the vendor, amount, due date, invoice number, and category, then prepare it for review before saving it to Bills.”

The UI should then show:

- Extracted vendor
- Amount
- Due date
- Invoice number
- Category
- Confidence score
- Warnings if extraction is uncertain
- Primary action: `Review and Save to Bills`

---

# 10. Page Placement

## Route

Recommended route:

`/ai`

Alternative route if current routing convention prefers named pages:

`/fluxy-ai`

## Sidebar

The existing Fluxy AI sidebar entry point should navigate to this page.

If the sidebar currently opens an AI drawer, update behavior carefully:

- If product direction says standalone page replaces drawer, route sidebar to `/ai`.
- If drawer is still used globally, keep the drawer and add a “Open full AI page” action.
- Do not break existing sidebar behavior on app pages.

## Page file

Recommended app page:

`ai.html`

Recommended JS:

`assets/js/ai-command-center.js`

Recommended shared service if needed:

`assets/js/ai-shared.js`

Use the existing project conventions. Do not add frameworks or build tooling.

---

# 11. Reference Image Layout Direction

Use the attached reference image as layout inspiration only.

Borrow:

- Centered page composition
- Large greeting headline
- Personalized user name
- Suggested prompt cards
- Refresh prompts action
- Large composer card
- Attachment and image actions
- Send button placement
- Clean whitespace
- AI-first workspace layout

Do not borrow:

- Exact copy
- Generic AI prompt examples
- Purple gradient if not aligned with FluxyOS app style
- Non-finance prompts
- Non-FluxyOS use cases
- Any dark/light theme mismatch
- Any unrelated feature

---

# 12. UX Structure

## Page shell

The page should be an authenticated app page with sidebar.

It should not load marketing footer.

## Main content structure

### 1. Greeting section

Use authenticated user display name if available.

Example:

“Hi, Safrian”
“What do you want to understand today?”

Alternative if user name missing:

“Hi there”
“What do you want to understand today?”

Subtitle:

“Ask about your finance health, revenue, bills, subscriptions, or upload a document to process.”

### 2. Suggested prompt cards

Use finance/project-specific prompts only.

Examples:

- “How healthy is my business this month?”
- “What needs attention?”
- “Why is OpEx high?”
- “Which bills are due soon?”
- “Find missing receipts”
- “Summarize this month”
- “What should I fix first?”
- “How much do I spend on subscriptions?”

Each prompt card should:

- Be clickable
- Fill composer or submit directly depending on existing UX pattern
- Use small icon
- Use clean card layout

### 3. Refresh prompts

Add a “Refresh prompts” action that rotates prompt cards.

The refresh should only rotate finance/project prompts.

Do not show unrelated generic prompts like:

- Write a to-do list
- Generate job email
- Summarize article
- Explain generic AI topic

### 4. Composer

Large composer card with:

- Textarea
- Placeholder: “Ask about your business finance…”
- Attachment button
- Image upload button
- Optional document type/source dropdown if needed
- Character count if already part of design direction
- Send button

### 5. Conversation / result area

After the user asks a question or uploads a document, show the response below or above the composer depending on page layout.

The result area should support:

- Finance answer cards
- Key numbers
- Insights
- Recommended actions
- Limitations
- Related records
- Document detection card
- Extraction preview
- Review/save action

---

# 13. Supported Interaction Types

## A. Ask finance question

User types:

“How healthy is my business this month?”

Expected behavior:

- Classify intent using Financial Analyst logic
- Call finance analysis backend tools
- Return structured answer
- Render key numbers and recommended actions

## B. Upload bill/invoice

User uploads image/PDF of bill.

Expected behavior:

- Detect document type: bill/invoice
- Route to Bill Capture logic
- Extract bill fields
- Show review state
- Recommend save to Bills
- Save only after confirmation

## C. Upload receipt

User uploads receipt.

Expected behavior:

- Detect document type: receipt
- Recommend Ledger destination
- Extract possible vendor, amount, date, category
- Show review state
- Do not create transaction automatically unless user confirms and there is an existing approved add-transaction flow

## D. Upload subscription invoice

User uploads SaaS/subscription invoice.

Expected behavior:

- Detect document type: subscription_invoice
- Recommend Subscriptions destination
- Extract vendor, amount, renewal/billing date, billing frequency if possible
- Show review state
- Save only after confirmation

## E. Upload revenue/order report

User uploads revenue report, order CSV/image, payment summary, or marketplace screenshot.

Expected behavior:

- Detect document type: revenue_report
- Recommend Revenue Sync or Ledger depending on extracted fields
- If Revenue Sync real integration is not connected, explain limitation
- Do not invent integration data

## F. Upload unknown financial document

Expected behavior:

- Show “I’m not fully sure what this is.”
- Extract visible financial fields if possible
- Ask user where they want to place it
- Recommend possible destinations

## G. Upload non-financial image

Expected behavior:

- Politely reject or redirect
- Explain Fluxy AI only supports business finance/project documents

---

# 14. Document Type Detection Matrix

| Detected document | Destination | Specialized workflow | Auto-save? |
|---|---|---|---|
| Bill / invoice | Bills | AI Bill Capture | No, review first |
| Receipt | Ledger | Receipt/transaction review | No, review first |
| Bank/payment screenshot | Ledger | Transaction review | No, review first |
| Subscription invoice | Subscriptions | Subscription review | No, review first |
| SaaS renewal notice | Subscriptions | Subscription review | No, review first |
| Revenue/order report | Revenue Sync or Ledger | Revenue review | No, review first |
| Tax document | AI review only | Unsupported/sensitive | No |
| Unknown financial document | AI review | User chooses | No |
| Non-financial image | None | Refusal | No |

---

# 15. Backend Architecture

The AI page should not perform OCR, AI calls, or document extraction directly in frontend JavaScript.

All AI, OCR, and extraction provider calls must happen on the backend.

## Recommended endpoints

### Chat endpoint

`POST /api/v1/brain/chat`

Use the existing Fluxy AI Financial Analyst contract.

Request:

```json
{
  "message": "How healthy is my business?",
  "page_context": "ai_command_center",
  "period": {
    "type": "this_month",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  }
}
```

Response should follow the structured schema defined in `fluxy_ai_financial_analyst_plan.md`.

### Document detection endpoint

`POST /api/v1/ai/detect-document`

Request:

`multipart/form-data`

Fields:

- `file`
- `page_context`: `ai_command_center`
- `user_intent` optional
- `locale`: `id-ID`
- `currency_hint`: `IDR`

Response:

```json
{
  "success": true,
  "document_type": "bill | invoice | receipt | payment_screenshot | subscription_invoice | revenue_report | unknown_financial | non_financial",
  "confidence": 0.86,
  "recommended_destination": "bills | ledger | subscriptions | revenue_sync | ai_review | none",
  "recommended_workflow": "bill_capture | transaction_review | subscription_review | revenue_review | ai_review | refusal",
  "message": "Looks like this is a bill. I can prepare it for review before saving it to Bills.",
  "extracted_preview": {
    "vendor_name": "",
    "amount": 0,
    "date": "",
    "due_date": "",
    "invoice_number": "",
    "category": "",
    "currency": "IDR"
  },
  "warnings": [],
  "next_actions": [
    {
      "label": "Review and Save to Bills",
      "action": "open_bill_capture_review"
    }
  ]
}
```

### Bill extraction endpoint

Use or create the endpoint defined in:

`docs/fluxyos_ai_bill_capture_feature_spec.md`

Recommended:

`POST /api/v1/bills/extract`

The standalone AI page should call this when document type is `bill` or `invoice`.

Do not create a duplicate bill extraction endpoint just for the AI Command Center.

---

# 16. AI Provider / Extraction Pattern

The implementation should use backend-controlled tools/functions and structured outputs.

Reasoning:

- Function/tool calling lets the model connect to application-defined tools and data instead of directly querying systems.
- Structured outputs make model responses conform to a predictable JSON schema, which is important for routing, document detection, extraction preview, and UI rendering.

Supported provider approach:

- OpenAI function calling + Structured Outputs
- Gemini function calling + structured output
- Deterministic fallback when no provider is configured

## Provider rules

- API keys must stay on backend.
- Do not expose provider keys in frontend.
- Do not send more financial data than needed.
- Do not log raw financial documents or extracted sensitive content.
- If provider is not configured, show a useful fallback instead of pretending AI is working.

---

# 17. Frontend Behavior

## File upload states

The AI page must support:

- Default composer state
- File selected state
- File preview state
- Uploading state
- Detecting document state
- Extraction success state
- Extraction low-confidence state
- Unsupported file state
- File too large state
- Provider not configured state
- Error state
- Review required state
- Save success state
- Save failed state

## Supported upload types

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.pdf`
- `.csv` only if revenue/transaction import is intentionally supported

Recommended max size:

- 10MB for MVP

If unsupported:

“Unsupported file type. Please upload a JPG, PNG, WEBP, or PDF financial document.”

---

# 18. UI Copy Guidelines

Keep copy finance-specific.

## Greeting examples

- “Hi, {name}”
- “What do you want to understand today?”
- “Ask about finance health, revenue, expenses, bills, subscriptions, or upload a document.”

## Composer placeholder

“Ask about your business finance…”

## Upload helper

“Upload a bill, receipt, invoice, or financial document.”

## Detection messages

Bill:

“Looks like this is a bill. I can prepare it for review before saving it to Bills.”

Receipt:

“Looks like this is a receipt. I can extract the key details and prepare it for Ledger review.”

Subscription:

“Looks like this is a subscription invoice. I can prepare it for Subscriptions review.”

Unknown:

“I found financial information, but I’m not fully sure where this belongs. Choose where you want to review it.”

Non-financial:

“This does not look like a FluxyOS finance document. I can help with bills, receipts, revenue, expenses, subscriptions, and financial records.”

---

# 19. Data Safety Rules

The standalone AI page must:

- Use authenticated user context.
- Never expose another user’s data.
- Never store a document without user confirmation.
- Never create financial records automatically.
- Never create transactions from bills.
- Never mark bills as paid automatically.
- Never send raw financial documents to frontend logs.
- Never expose provider errors containing secrets.
- Keep extraction results editable before save.
- Keep low-confidence results clearly marked.

---

# 20. MVP Scope

## In scope

- Standalone authenticated AI page
- Sidebar entry navigation to AI page
- Personalized greeting
- Suggested finance prompt cards
- Refresh prompts
- Large composer
- Text question submission
- Structured answer rendering
- File/image upload UI
- Document type detection
- Routing recommendation
- Bill/invoice upload integration with AI Bill Capture feature
- Review-before-save principle
- Empty/loading/error states
- Unsupported question/file handling

## Out of scope

- Generic web AI assistant
- AI image generation
- AI writing assistant unrelated to finance
- Automatic record creation
- Payment execution
- Bill paid status changes
- Bank integration
- Tax filing
- Investment advice
- Long-term memory beyond user’s FluxyOS data
- New design system
- Framework migration
- New sidebar redesign

---

# 21. Acceptance Criteria

The feature is complete when:

1. Sidebar Fluxy AI entry opens the standalone AI page.
2. AI page is authenticated and uses app sidebar.
3. Page does not load marketing footer.
4. Greeting renders with user name if available.
5. Suggested prompt cards are finance/project specific.
6. Refresh prompt action rotates finance-specific prompts only.
7. User can ask finance questions from the page.
8. Answers follow `fluxy_ai_financial_analyst_plan.md` behavior.
9. User can upload supported image/PDF files.
10. AI detects document type and recommended destination.
11. Bills/invoices reuse the AI Bill Capture workflow.
12. Uploaded bills are not saved automatically.
13. Uploaded bills do not create transactions automatically.
14. Low-confidence extraction shows warnings.
15. Unsupported files show safe error messages.
16. Non-financial images are rejected or redirected.
17. Existing dashboard, ledger, bills, subscriptions, revenue sync pages are not broken.
18. Existing Add Bill and Add Transaction flows still work.
19. No existing IDs used by JS are renamed or removed.
20. Browser console has no Firebase, CORS, CSP, or 404 errors.
21. QA workflow passes before push.

---

# 22. Implementation Guardrails

- Do not change backend schema unless explicitly required.
- Do not change existing transaction logic.
- Do not change existing bill logic except integrating with Bill Capture workflow.
- Do not refactor unrelated files.
- Do not add React, Vue, or a build system.
- Do not remove current AI drawer unless product direction explicitly requires it.
- Do not duplicate Bill Capture extraction logic.
- Do not duplicate Financial Analyst backend logic.
- Preserve authentication.
- Preserve user-scoped data access.
- Preserve sidebar active state behavior.
- Preserve app page no-footer rule.

---

# 23. Claude / Codex Implementation Prompt

Use this prompt to implement the feature:

```text
You are working on the existing FluxyOS codebase.

Task:
Implement the standalone Fluxy AI Command Center page.

Before coding, read:

1. docs/PROJECT_BACKGROUND.md
2. docs/product_ux_feature_intake_framework.md
3. docs/ROADMAP.md
4. docs/WORKFLOW.md
5. docs/fluxy_ai_financial_analyst_plan.md
6. docs/fluxyos_ai_bill_capture_feature_spec.md
7. docs/fluxyos_standalone_ai_command_center_prompt.md
8. CLAUDE.md or AGENTS.md if available

Goal:
Create a standalone authenticated AI page where users can ask FluxyOS finance questions, use suggested prompts, upload images/documents, and let AI detect and route financial documents to the correct FluxyOS workflow.

This is not a generic chatbot page.
This page must follow the Fluxy AI Financial Analyst plan for finance questions.
This page must reuse the AI Bill Capture feature for bill/invoice upload.

Implementation scope:

- Create `ai.html` or the route/file that matches the existing project routing convention.
- Add sidebar navigation from the existing Fluxy AI entry point to the standalone AI page.
- Keep app page conventions: authenticated, sidebar visible, no marketing footer.
- Build the page layout inspired by the attached AI reference image, but keep FluxyOS theme and finance-specific copy.
- Add personalized greeting.
- Add finance-specific suggested prompt cards.
- Add refresh prompts action.
- Add large composer with text input, attachment upload, image upload, and send button.
- Let users ask finance questions using the same backend behavior from `fluxy_ai_financial_analyst_plan.md`.
- Render structured AI answers: direct answer, key numbers, insights, limitations, recommended actions.
- Add upload support for image/PDF financial documents.
- Add document detection endpoint or frontend integration with an existing endpoint.
- Route detected bill/invoice uploads to the AI Bill Capture workflow from `fluxyos_ai_bill_capture_feature_spec.md`.
- Show review state before any save.
- Do not automatically create records.
- Do not automatically create transactions.
- Do not mark bills as paid.

Required document routing:

- bill/invoice → Bills → AI Bill Capture workflow
- receipt → Ledger review
- payment screenshot → Ledger review
- subscription invoice → Subscriptions review
- revenue/order report → Revenue Sync or Ledger review
- unknown financial document → AI review / user chooses
- non-financial image → refusal / out-of-scope message

Backend requirements:

- Keep provider calls on backend only.
- API keys must never be exposed to frontend.
- Use structured JSON responses for document detection.
- Use user-scoped authenticated data only.
- Do not send more data than needed to AI provider.
- If provider is not configured, return a safe fallback.

Frontend states:

- default
- loading
- thinking
- file selected
- detecting document
- extraction success
- low confidence
- unsupported file
- provider not configured
- error
- review required
- save success
- save failed

Hard rules:

- Do not duplicate Bill Capture logic.
- Do not duplicate Financial Analyst logic.
- Do not change unrelated pages.
- Do not refactor unrelated files.
- Do not rename existing JS IDs.
- Do not break existing dashboard/sidebar behavior.
- Do not add frameworks or build tooling.
- Do not create generic AI prompts unrelated to finance.

Acceptance criteria:

- Standalone AI page works from sidebar.
- Finance questions use Financial Analyst behavior.
- Document upload detects type and destination.
- Bill/invoice upload reuses Bill Capture workflow.
- Nothing is saved without confirmation.
- No transactions are created from bills automatically.
- Unsupported questions/files are handled safely.
- Empty/loading/error states work.
- Browser console is clean.
- Existing FluxyOS app pages still work.
- QA passes according to docs/WORKFLOW.md.

After implementation, report:

1. Files changed.
2. What was implemented.
3. What reuses Financial Analyst logic.
4. What reuses Bill Capture logic.
5. What remains mock/provider-dependent.
6. Manual QA steps performed.

Proceed with implementation.
```

---

# 24. Final Product Rule

The standalone AI Command Center is the front door.

Fluxy AI Financial Analyst is the intelligence brain.

AI Bill Capture is the specialized bill workflow.

Do not collapse these into one messy feature. Keep responsibilities clear:

- AI Command Center: ask, upload, detect, route
- Financial Analyst: analyze finance data and answer questions
- Bill Capture: extract, validate, review, and save bills
