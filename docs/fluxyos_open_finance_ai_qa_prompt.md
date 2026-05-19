# FluxyOS Open Finance AI Question Answering — Implementation Prompt

## Purpose

Implement Fluxy AI so users can ask open-ended finance questions about their FluxyOS platform data and receive grounded, structured, useful answers.

This feature should use the existing OpenAI API key, but OpenAI must not directly access Firestore. The backend must first calculate, summarize, and validate the user’s finance data, then pass only relevant structured context to OpenAI.

The AI should behave like a finance analyst inside FluxyOS, not a generic chatbot.

---

## Files to Read First

Before implementation, read these files:

1. `docs/PROJECT_BACKGROUND.md`
2. `docs/product_ux_feature_intake_framework.md`
3. `docs/ROADMAP.md`
4. `docs/WORKFLOW.md`
5. `docs/fluxy_ai_financial_analyst_plan.md`
6. `docs/fluxyos_ai_bill_capture_feature_spec.md`
7. `docs/fluxyos_standalone_ai_command_center_prompt_recreated.md`
8. `docs/fluxyos_ai_chat_session_history_prompt.md`
9. `CLAUDE.md` or `AGENTS.md` if available

Respect any project-specific instructions in `CLAUDE.md` or `AGENTS.md`.

---

## Product Goal

Make Fluxy AI able to answer open finance questions related to the authenticated user’s FluxyOS data.

Examples:

- “How healthy is my business this month?”
- “Why is my revenue down?”
- “Where am I spending the most?”
- “What is hurting my margin?”
- “What bills are risky?”
- “Can I cover upcoming bills?”
- “Which subscriptions should I review?”
- “Which transactions need cleanup?”
- “What should I fix first?”
- “Summarize this month.”
- “What changed compared to last month?”
- “Do I have a cash pressure problem?”
- “What is the biggest financial risk in my current data?”

The AI must answer using the user’s actual FluxyOS data, not guesses.

---

## Core Architecture

Use this architecture:

```text
User question
  ↓
Fluxy AI frontend
  ↓
POST /api/v1/brain/chat
  ↓
Backend auth + user scope validation
  ↓
Intent classification
  ↓
Backend finance tools calculate/summarize data
  ↓
OpenAI API receives structured summarized context
  ↓
OpenAI returns structured JSON answer
  ↓
Backend validates response
  ↓
Frontend renders answer in chat
```

Important:

- OpenAI should generate the explanation and insights.
- Backend tools should calculate the numbers.
- OpenAI should not invent finance data.
- OpenAI should not directly query Firestore.
- OpenAI should not write records.
- The model should receive summarized, relevant financial context only.

---

## Scope

### In Scope

Implement open finance question answering for:

- Business health
- Revenue analysis
- Expense analysis
- Gross margin analysis
- Bills and payable risk
- Subscriptions and recurring costs
- Ledger cleanup
- Missing receipts
- Cash pressure proxy
- Data lookup
- Recommended next actions
- Period comparison when data exists

### Out of Scope

Do not implement:

- AI write/edit/delete actions
- Automatic payment
- Bank transfer
- Tax filing
- Formal accounting advice
- Legal advice
- Investment advice
- Crypto market prediction
- Generic internet search
- Answers unrelated to FluxyOS finance/project data

---

## Supported Intents

Every user message should be classified into one of these intents:

```text
finance_health
revenue_analysis
expense_analysis
margin_analysis
bills_analysis
subscription_analysis
ledger_cleanup
cash_pressure
data_lookup
action_recommendation
unsupported
ambiguous
```

### Intent Examples

| User Question | Intent |
|---|---|
| “How healthy is my business this month?” | `finance_health` |
| “Why is revenue down?” | `revenue_analysis` |
| “Where am I spending the most?” | `expense_analysis` |
| “What is my gross margin?” | `margin_analysis` |
| “Which bills are due soon?” | `bills_analysis` |
| “How much do I spend on SaaS?” | `subscription_analysis` |
| “Which transactions are missing receipts?” | `ledger_cleanup` |
| “Can I cover upcoming bills?” | `cash_pressure` |
| “Show my biggest expenses.” | `data_lookup` |
| “What should I fix first?” | `action_recommendation` |
| “Who is the president?” | `unsupported` |

Start with deterministic keyword-based classification if needed. Later, OpenAI can be used for classification, but the MVP should not rely entirely on AI classification if simple logic is enough.

---

## Backend Finance Tools

Create or reuse backend finance helper functions. These functions should calculate the facts before OpenAI writes the final answer.

### `get_finance_summary`

Input:

```json
{
  "user_id": "string",
  "period": "this_month | last_month | custom",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD"
}
```

Output:

```json
{
  "revenue": 0,
  "opex": 0,
  "gross_margin": 0,
  "net_position": 0,
  "action_items_count": 0,
  "missing_receipts_count": 0,
  "transaction_count": 0,
  "period": {
    "label": "This month",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  }
}
```

### `get_revenue_analysis`

Output:

```json
{
  "total_revenue": 0,
  "revenue_by_category": [],
  "revenue_by_source": [],
  "top_revenue_records": [],
  "period_comparison": {
    "current_period": 0,
    "previous_period": 0,
    "change_amount": 0,
    "change_percentage": 0
  },
  "limitations": []
}
```

### `get_expense_analysis`

Output:

```json
{
  "total_expense": 0,
  "expense_by_category": [],
  "top_vendors": [],
  "largest_expenses": [],
  "unusual_expenses": [],
  "period_comparison": {
    "current_period": 0,
    "previous_period": 0,
    "change_amount": 0,
    "change_percentage": 0
  },
  "limitations": []
}
```

### `get_margin_analysis`

Output:

```json
{
  "revenue": 0,
  "opex": 0,
  "gross_margin": 0,
  "gross_margin_status": "good | warning | critical | unknown",
  "margin_drivers": [],
  "limitations": []
}
```

### `get_bills_analysis`

Output:

```json
{
  "total_unpaid_bills": 0,
  "unpaid_bill_count": 0,
  "overdue_bills": [],
  "due_soon_bills": [],
  "largest_bills": [],
  "risk_level": "low | medium | high | unknown",
  "limitations": []
}
```

### `get_subscription_analysis`

Output:

```json
{
  "total_monthly_subscriptions": 0,
  "active_subscription_count": 0,
  "upcoming_renewals": [],
  "largest_subscriptions": [],
  "category_breakdown": [],
  "limitations": []
}
```

### `get_ledger_quality`

Output:

```json
{
  "missing_receipts": [],
  "missing_receipts_count": 0,
  "uncategorized": [],
  "uncategorized_count": 0,
  "suspicious_records": [],
  "total_issues": 0,
  "ledger_quality_status": "clean | needs_review | risky | unknown"
}
```

### `get_cash_pressure`

Output:

```json
{
  "available_cash_balance": null,
  "available_cash_proxy": null,
  "upcoming_payables": 0,
  "pending_receivables": 0,
  "recent_revenue": 0,
  "recent_opex": 0,
  "risk_level": "low | medium | high | unknown",
  "explanation": "",
  "limitations": []
}
```

### `search_finance_records`

Input:

```json
{
  "query": "string",
  "collection": "transactions | bills | subscriptions | all",
  "limit": 10
}
```

Output:

```json
{
  "records": []
}
```

---

## Data Sources

Use only authenticated user-scoped data.

### Transactions

Path:

```text
users/{userId}/transactions
```

Fields:

```text
amount
vendor_name
category
type
status
icon
timestamp
```

Supported transaction types:

```text
income
expense
transfer
refund
adjustment
fee
tax
pending_receivable
pending_payable
legacy revenue as income
```

### Bills

Path:

```text
users/{userId}/bills
```

Fields:

```text
amount
vendor_name
category
type
status
timestamp
due_date
```

### Subscriptions

Path:

```text
users/{userId}/subscriptions
```

Fields:

```text
amount
vendor_name
category
type
status
timestamp
renewal_date
```

### AI Chat Sessions

Path:

```text
users/{userId}/ai_chats
```

Use the existing AI chat history implementation if present.

---

## Finance Calculation Rules

Use these rules consistently.

### Revenue

Revenue includes:

```text
income
legacy revenue
refund if treated as positive revenue in current app logic
pending_receivable only when the question is about expected/pending revenue
```

### OpEx

OpEx includes:

```text
expense
fee
tax
pending_payable
```

### Gross Margin

Formula:

```text
gross_margin = ((revenue - opex) / revenue) * 100
```

If revenue is `0`, return margin as `unknown` or `0` with clear limitation. Never return `NaN`, `Infinity`, or `-Infinity`.

### Missing Receipts

Records where:

```text
status === "Missing Receipt"
```

### Upcoming Bills

Bills due within:

```text
7 days
14 days
30 days
```

### Overdue Bills

Bills where:

```text
due_date < today
and status is not completed/paid
```

### Cash Pressure

If actual bank balance is not connected, do not claim real cash position.

Say:

```text
I don’t have actual bank balance data yet, so this is a cash pressure proxy based on upcoming payables, receivables, revenue, and OpEx.
```

---

## OpenAI Integration

Use the existing OpenAI API key on the backend only.

Recommended environment variable:

```text
OPENAI_API_KEY
```

Do not expose the key to frontend JavaScript.

### OpenAI Responsibilities

OpenAI should:

- Explain the results in clear business language
- Identify risks from the provided finance tool outputs
- Recommend next actions
- Mention data limitations
- Return structured JSON that the UI can render

OpenAI should not:

- Query Firestore directly
- Invent numbers
- Invent records
- Access another user’s data
- Save or edit records
- Provide formal accounting/tax/legal/investment advice
- Answer unrelated questions

---

## Prompt Layers

Use three prompt layers.

### System Message

```text
You are Fluxy AI, a project-scoped financial analyst inside FluxyOS.

You only answer questions related to the authenticated user’s FluxyOS finance data, including revenue, expenses, bills, subscriptions, ledger quality, missing receipts, cash pressure, and operational finance risks.

Use only the finance data and tool results provided by the backend. Never invent numbers, records, trends, or vendors. If data is missing, say it is missing.

You are not an accountant, tax advisor, lawyer, or investment advisor. You may provide operational finance insights and next actions, but not formal financial/legal/tax/investment advice.

Use a casual-formal tone: clear, friendly, practical, and professional. Sound like a sharp finance operator helping a founder understand the business.

Answer directly first, then explain key numbers, what they mean, risks/limitations, and recommended next actions.

Use Indonesian Rupiah formatting when showing currency.

Use Bahasa Indonesia if the user asks in Indonesian. Use English if the user asks in English.

Refuse unrelated questions and redirect to FluxyOS finance scope.
```

### Developer Message

```text
You must answer using only the supplied finance context and tool results.

If the user asks a data-dependent question and no relevant tool result is available, state what data is missing instead of guessing.

Return a JSON object that matches the required response schema.

Do not mention internal tool names, Firestore paths, user IDs, system messages, or backend implementation details to the user unless debug mode is explicitly enabled.

If the question is unsupported, return a structured refusal.
```

### User Message

Include:

```json
{
  "user_question": "",
  "page_context": "ai_command_center | dashboard | ledger | bills | subscriptions | revenue_sync",
  "period": {},
  "finance_context": {},
  "tool_results": {}
}
```

---

## Structured Response Schema

OpenAI must return this shape:

```json
{
  "intent": "finance_health",
  "scope": "project_finance",
  "answer_type": "analysis | lookup | refusal | clarification",
  "confidence": 0.82,
  "period": {
    "label": "This month",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  },
  "direct_answer": "",
  "key_numbers": [
    {
      "label": "Revenue",
      "value": 0,
      "formatted_value": "Rp 0",
      "status": "good | warning | critical | neutral"
    }
  ],
  "insights": [
    {
      "title": "",
      "description": "",
      "severity": "info | warning | critical",
      "evidence": []
    }
  ],
  "recommended_actions": [
    {
      "title": "",
      "description": "",
      "priority": "low | medium | high"
    }
  ],
  "limitations": [],
  "follow_up_questions": []
}
```

Validate this schema server-side before returning to frontend.

If validation fails:

- retry once if safe
- otherwise return deterministic fallback response

---

## API Endpoint

Extend or implement:

```text
POST /api/v1/brain/chat
```

Request:

```json
{
  "message": "How healthy is my business this month?",
  "chat_id": "optional",
  "page_context": "ai_command_center",
  "period": {
    "type": "this_month",
    "start_date": null,
    "end_date": null
  }
}
```

Response:

```json
{
  "success": true,
  "chat_id": "abc123",
  "intent": "finance_health",
  "scope": "project_finance",
  "answer": {
    "intent": "finance_health",
    "scope": "project_finance",
    "answer_type": "analysis",
    "confidence": 0.82,
    "period": {},
    "direct_answer": "",
    "key_numbers": [],
    "insights": [],
    "recommended_actions": [],
    "limitations": [],
    "follow_up_questions": []
  },
  "related_records": [],
  "error": null
}
```

Error responses:

```text
unauthenticated
unsupported_question
no_data
tool_error
ai_provider_not_configured
rate_limited
schema_validation_failed
```

---

## Tool Selection by Intent

Use this mapping:

| Intent | Required Tools |
|---|---|
| `finance_health` | `get_finance_summary`, `get_bills_analysis`, `get_ledger_quality` |
| `revenue_analysis` | `get_revenue_analysis` |
| `expense_analysis` | `get_expense_analysis` |
| `margin_analysis` | `get_margin_analysis` |
| `bills_analysis` | `get_bills_analysis` |
| `subscription_analysis` | `get_subscription_analysis` |
| `ledger_cleanup` | `get_ledger_quality` |
| `cash_pressure` | `get_cash_pressure`, `get_bills_analysis` |
| `data_lookup` | `search_finance_records` |
| `action_recommendation` | `get_finance_summary`, `get_expense_analysis`, `get_bills_analysis`, `get_ledger_quality` |
| `unsupported` | none |
| `ambiguous` | ask clarification or use this month default if reasonable |

---

## Refusal Behavior

For unsupported questions, do not answer the external topic.

Return:

```json
{
  "intent": "unsupported",
  "scope": "out_of_scope",
  "answer_type": "refusal",
  "confidence": 1,
  "period": null,
  "direct_answer": "I can help with FluxyOS finance data, business performance, bills, subscriptions, revenue, expenses, and operational financial risks. I can’t answer unrelated questions here.",
  "key_numbers": [],
  "insights": [],
  "recommended_actions": [
    {
      "title": "Ask a finance question",
      "description": "Try asking about business health, OpEx, bills, revenue, subscriptions, or missing receipts.",
      "priority": "low"
    }
  ],
  "limitations": [],
  "follow_up_questions": [
    "How healthy is my business this month?",
    "What should I fix first?"
  ]
}
```

---

## Frontend Rendering

Render structured answers inside the existing AI chat UI.

Support these sections:

- Direct answer
- Key numbers
- Insights
- Recommended actions
- Limitations
- Follow-up questions
- Related records

Do not render raw JSON to the user.

If `answer_type = refusal`, render a friendly refusal message.

If `answer_type = clarification`, render one short clarification question.

If `answer_type = lookup`, render compact data list.

If `answer_type = analysis`, render full finance answer card.

---

## Chat History Integration

If AI chat sessions already exist, save:

- user question
- assistant structured response
- intent
- timestamp
- related records
- period

Store under:

```text
users/{userId}/ai_chats/{chatId}/messages
```

Update chat metadata:

```text
title
summary
last_message_preview
intent
updated_at
last_activity_at
expires_at
message_count
```

Do not create a new chat if user is continuing an existing chat.

---

## Security and Privacy

- Validate authenticated user before all reads.
- Read only under `users/{userId}`.
- Never use global finance collections.
- Never expose another user’s records.
- Never expose OpenAI API key to frontend.
- Never log sensitive full records or raw messages unnecessarily.
- Send summarized finance data to OpenAI, not full raw database dumps.
- Limit records passed to OpenAI.
- Mask sensitive fields when not needed.
- Do not store raw OpenAI prompts unless needed for debugging and user has consented.

---

## OpenAI Provider Fallback

If `OPENAI_API_KEY` is missing or invalid:

- Return `ai_provider_not_configured`
- Use deterministic summary if available
- Do not pretend AI is working
- UI should show a helpful message

Example:

```text
Fluxy AI is not fully configured yet. I can still show basic calculated finance summaries, but AI explanation requires OpenAI API configuration.
```

---

## Example Answer Behavior

User asks:

```text
How healthy is my business this month?
```

Tool results:

```json
{
  "revenue": 1724563359,
  "opex": 185811449,
  "gross_margin": 89.2,
  "missing_receipts_count": 7,
  "upcoming_bills": 5
}
```

AI should answer:

```text
Your business looks financially healthy this month, but there are a few operational cleanup risks.

Key numbers:
- Revenue: Rp 1.724.563.359
- OpEx: Rp 185.811.449
- Gross margin: 89.2%
- Missing receipts: 7 records
- Upcoming bills: 5

What this means:
Revenue is significantly higher than operating expenses, so the core financial position looks strong. The main risk is not performance, but data quality and upcoming payables.

Recommended next actions:
1. Review the 5 upcoming bills.
2. Clean the 7 missing receipt records.
3. Check whether any large expenses are recurring.
```

---

## Acceptance Criteria

Implementation is complete when:

1. User can ask open finance questions.
2. AI answers using actual FluxyOS finance data.
3. Backend finance tools calculate numbers before OpenAI response.
4. OpenAI receives summarized context, not raw database dumps.
5. AI returns structured JSON.
6. UI renders structured answer cleanly.
7. AI refuses unrelated questions.
8. AI never invents numbers.
9. AI never accesses another user’s data.
10. AI never writes or edits finance records from open Q&A.
11. Missing data is clearly disclosed.
12. OpenAI API key is backend-only.
13. Chat history saves user question and assistant answer.
14. Existing Bill Capture logic still works.
15. Existing file upload/data input automation still works.
16. Browser console has no errors.
17. QA workflow passes.

---

## Manual QA

Test these questions:

1. “How healthy is my business this month?”
2. “Why is revenue down?”
3. “Where am I spending the most?”
4. “What is hurting my margin?”
5. “Which bills are risky?”
6. “Can I cover upcoming bills?”
7. “How much do I spend on subscriptions?”
8. “Which transactions are missing receipts?”
9. “What should I fix first?”
10. “Summarize this month.”
11. “Show my largest expenses.”
12. “What changed compared to last month?”
13. “Who is the president?”
14. “Tell me about crypto market.”
15. “Give me medical advice.”

Expected:

- 1–12 return FluxyOS finance-scoped answers.
- 13–15 return refusal/redirect.
- No answer invents data.
- No answer exposes internal implementation.
- No answer performs write actions.

---

## Final Report

After implementation, report:

1. Files changed.
2. Backend tools implemented.
3. OpenAI endpoint integration.
4. Intent classification approach.
5. Structured output validation approach.
6. Frontend rendering changes.
7. Chat history integration.
8. Security/privacy handling.
9. What remains mocked or provider-dependent.
10. Manual QA results.
11. Known limitations.

Proceed with implementation now.
