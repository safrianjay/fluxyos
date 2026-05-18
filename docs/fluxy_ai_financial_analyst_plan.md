# Fluxy AI Financial Analyst — Combined Product & Technical Plan

**Output file:** `docs/fluxy_ai_financial_analyst_plan.md`  
**Feature status:** MVP planning document  
**Primary owner:** Product + Engineering  
**Platform:** FluxyOS  
**Last updated:** 2026-05-18

---

## 0. What This Combined File Does

This document combines two earlier Markdown drafts into one implementation-ready plan.

The combined version keeps the best parts from both files:

1. The first draft had a stronger scope, architecture, security, backend tool, structured-output, and Claude Code implementation direction.
2. The second draft had a cleaner product narrative, simpler UX structure, and clearer explanation of why this is a decision-support layer rather than a generic chatbot.

This final version should be used as the single source of truth for building the **Fluxy AI Financial Analyst** MVP.

---

# 1. Feature Summary

Fluxy AI Financial Analyst is a **project-scoped financial intelligence assistant** inside FluxyOS.

It analyzes the authenticated user’s own FluxyOS data and gives clear, actionable answers about:

- Business health
- Revenue
- Expenses
- Gross margin
- Bills
- Subscriptions
- Ledger quality
- Missing receipts
- Cash pressure
- Financial risks
- Next recommended actions

This is **not a generic chatbot**.

It is a financial interpretation layer that turns structured financial records into understandable business answers.

It is also **not a replacement for an accountant, tax advisor, lawyer, or investment advisor**. It can explain operational financial signals and suggest next steps, but it must not make formal legal, tax, or investment decisions for the user.

---

# 2. Product Context

FluxyOS is a financial operations platform for Indonesian businesses.

Current product capabilities include:

- Dashboard page
- Ledger page
- Revenue Sync page
- Bills page
- Subscriptions page
- Integrations page
- Firebase Authentication
- Firestore user-scoped collections
- FastAPI backend
- Existing mock AI chat endpoint
- Existing Fluxy AI drawer/chat UI
- Dashboard KPIs: revenue, OpEx, gross margin, and action items

The current product already has the shape of a finance command center, but users still need to manually interpret what the numbers mean.

Fluxy AI Financial Analyst solves that gap by giving the user a natural-language finance analyst that is grounded in their own data.

---

# 3. Feature Type

Fluxy AI Financial Analyst is:

- **Intelligence feature**
- **Workflow-support feature**
- **Decision-support layer**
- **Finance interpretation layer**

This is not just UI because it does more than display information. It reads structured finance data, classifies the user’s question, calls controlled backend finance tools, interprets results, explains the evidence, and recommends the next action.

---

# 4. Main Objective

Help business owners and finance teams understand business health, financial risks, and next actions from their FluxyOS data without manually reading every ledger, bill, and subscription record.

---

# 5. Job To Be Done

## Primary JTBD

When I review my business finance,  
I want to ask natural questions and get grounded answers from my actual FluxyOS data,  
so I can understand what is happening, what is risky, and what I should do next.

## Secondary JTBDs

### Revenue review

When I review revenue performance,  
I want to understand how much money came in and what changed,  
so I can identify whether the business is growing, slowing, or missing expected revenue.

### Expense review

When I review business spending,  
I want to know which categories and vendors drive the highest costs,  
so I can control spending and protect margin.

### Bills review

When I check upcoming obligations,  
I want to know which bills are due soon, overdue, or risky,  
so I can avoid missed payments and cash pressure.

### Subscription review

When I review recurring costs,  
I want to see upcoming renewals and high-cost SaaS vendors,  
so I can reduce waste and manage recurring spend.

### Ledger cleanup

When I prepare financial data for decisions or reporting,  
I want to know which records are incomplete or missing receipts,  
so I can trust the numbers before acting on them.

### Founder monthly summary

When I start or end the month,  
I want a short business-performance explanation,  
so I can understand what changed and what to fix first.

---

# 6. Target Users

| User | What they need from the AI | Example question | Expected value |
|---|---|---|---|
| Founder | Fast business-health interpretation | “What should I fix first this month?” | Helps prioritize action without reading every page |
| Business owner | Simple explanation of money movement | “Is my business healthy?” | Turns finance data into business language |
| Finance admin | Operational cleanup guidance | “Which records need cleanup?” | Speeds up daily finance workflows |
| Accountant | Data quality and reporting readiness | “Can I trust this ledger?” | Helps identify missing receipts and incomplete records |
| Operations manager | Payables and vendor-risk visibility | “Which bills are risky?” | Prevents missed obligations |
| Internal finance team | Quick lookup and summaries | “Show my largest expenses this month.” | Reduces manual data scanning |

---

# 7. User Problems

Users do not just need more tables. They need interpretation.

Current problems:

- Users have financial data but do not always know what it means.
- Tables show records, but not business meaning.
- Users may miss margin pressure, overdue bills, rising vendor costs, missing receipts, revenue drops, or cash pressure.
- Users need answers in business language, not raw database language.
- Users need confidence that AI answers are based on actual FluxyOS data.
- Users need fast next actions, not long finance reports.
- Users may overtrust AI if the system does not clearly explain data limitations.
- Users may ask broad questions like “what should I do next?” and expect the system to know which financial signals matter.

---

# 8. Business Value

Fluxy AI Financial Analyst supports:

- **Product differentiation**: FluxyOS becomes more than a finance dashboard.
- **Retention**: Users return to ask what changed and what needs attention.
- **Premium pricing**: AI interpretation can become a higher-tier feature.
- **Daily/weekly engagement**: Users can ask finance questions instead of manually scanning tables.
- **Trust**: Grounded answers build confidence in the product.
- **Finance workflow depth**: The platform becomes operationally useful, not just informational.
- **Better onboarding**: New users can ask what to fix or connect next.
- **Operating system positioning**: FluxyOS feels like a business command center rather than a static SaaS dashboard.

---

# 9. Product Placement

## MVP placement

The MVP should live inside existing FluxyOS surfaces:

- Existing **Fluxy AI drawer** from the sidebar
- Dashboard AI insight card or ask bar
- Suggested prompt chips inside the AI drawer

Do **not** create a separate full AI page for MVP unless the existing drawer cannot support the required interaction.

## Contextual placement

| Page | AI behavior |
|---|---|
| Dashboard | Business health, KPI summary, what needs attention, monthly summary |
| Ledger | Transaction cleanup, missing receipts, unusual expenses, categorization issues |
| Bills | Overdue bills, upcoming payable risk, cash pressure proxy |
| Subscriptions | Recurring cost, renewal risk, SaaS cost review |
| Revenue Sync | Revenue performance, channel comparison, anomaly explanation |

## Out of scope for MVP placement

- Separate AI page
- AI report builder page
- AI-powered command center redesign
- AI that edits, deletes, creates, or pays records
- AI that creates transactions automatically

---

# 10. Data Sources

The AI may only use data available under the authenticated user’s workspace.

## Transactions

Path:

```text
users/{userId}/transactions
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `amount` | number | Raw integer only |
| `vendor_name` | string | Vendor or revenue source |
| `category` | string | Revenue, Marketing, Infrastructure, Operations, SaaS |
| `type` | string | Transaction type |
| `status` | string | Completed or Missing Receipt |
| `icon` | string | UI icon |
| `timestamp` | timestamp | Transaction date |

Supported transaction types:

- `income`
- `expense`
- `transfer`
- `refund`
- `adjustment`
- `fee`
- `tax`
- `pending_receivable`
- `pending_payable`
- legacy `revenue` as income

## Bills

Path:

```text
users/{userId}/bills
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `amount` | number | Raw integer only |
| `vendor_name` | string | Vendor/payee |
| `category` | string | Defaults to Operations |
| `type` | string | Usually pending payable |
| `status` | string | Completed or Missing Receipt |
| `timestamp` | timestamp | Created date |
| `due_date` | timestamp | Optional due date |

## Subscriptions

Path:

```text
users/{userId}/subscriptions
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `amount` | number | Raw integer only |
| `vendor_name` | string | SaaS/vendor name |
| `category` | string | Defaults to SaaS |
| `type` | string | Usually expense |
| `status` | string | Completed or Missing Receipt |
| `timestamp` | timestamp | Created date |
| `renewal_date` | timestamp | Optional renewal date |

## Revenue Sync

Use existing Revenue Sync data if implemented.

If real integration sync is not connected yet, the AI must say:

> Revenue Sync data is not connected yet, so I can only analyze revenue records currently available in your ledger.

## Dashboard KPIs

Derived values:

- Revenue
- OpEx
- Gross margin
- Action items
- Missing receipts
- Upcoming bills
- Pending payables
- Pending receivables

---

# 11. Finance Calculation Rules

## Revenue

Revenue should include:

- `income`
- legacy `revenue`
- `refund` if treated as positive-side record
- `pending_receivable` only when the answer is about expected/forecasted revenue, not confirmed revenue

## OpEx

OpEx should include:

- `expense`
- `fee`
- `tax`
- `pending_payable` when analyzing obligations or committed spend

## Gross margin

Formula:

```text
gross_margin = ((revenue - opex) / revenue) * 100
```

Edge case:

- If revenue is `0`, return `0` or `unknown`.
- Never return `NaN`, `Infinity`, or `-Infinity`.
- Explain that margin cannot be meaningfully calculated without revenue.

## Missing receipts

Count records where:

```text
status === "Missing Receipt"
```

## Upcoming bills

Bills with `due_date` within:

- Next 7 days
- Next 14 days
- Next 30 days

The AI should choose the period based on the user’s question.

## Overdue bills

Bills where:

```text
due_date < today
```

and status is not completed/paid.

If there is no paid status model yet, use the safest available status and say that payment completion is not fully implemented.

## Subscription monthly cost

For MVP, treat each subscription record as a monthly recurring cost unless the schema contains a billing cycle field.

If billing cycle does not exist, the AI must say:

> I’m treating subscription records as monthly recurring costs because billing cycle data is not available yet.

## Cash pressure

MVP must not pretend to know actual bank cash unless a bank balance exists.

If no real cash balance exists, calculate a proxy using:

- Upcoming payables
- Pending receivables
- Recent revenue
- Recent OpEx

The AI must clearly state:

> I do not have your real bank balance yet, so this is a cash-pressure proxy, not an actual cash runway calculation.

---

# 12. Data Access Rules

The AI must:

- Only access data under the authenticated `userId`.
- Never access another user’s data.
- Never answer from global data.
- Never expose raw database paths to the user.
- Never reveal internal implementation details unless debug mode is enabled.
- Never invent records.
- Never invent numbers.
- Never say it found something if the data is missing.
- Mention when data is incomplete.
- Use safe fallback messages when data is unavailable.
- Use Firestore Security Rules and backend validation to enforce user-level access.
- Keep raw record access behind backend tools.

---

# 13. Technical Architecture Principle

The model must not directly query Firestore.

The correct flow is:

```text
User message
→ Frontend AI drawer
→ POST /api/v1/brain/chat
→ Authenticate user
→ Classify intent
→ Call safe backend finance tool(s)
→ Summarize/minimize financial data
→ Call LLM with controlled tool results
→ Receive structured output
→ Render answer card in UI
```

The model should only receive:

- The user question
- Page context
- Period context
- Tool results
- Relevant summarized records
- System/developer prompts
- Response schema

The model should not receive unnecessary raw financial records.

---

# 14. Supported Question Categories

## A. Business Health

Example questions:

- “How healthy is my business?”
- “Is my business improving?”
- “What should I worry about?”
- “Explain this month like I’m the founder.”

Required data:

- `get_finance_summary`
- `get_bills_analysis`
- `get_ledger_quality`
- optional `get_cash_pressure`

Required answer:

- Revenue
- OpEx
- Gross margin
- Bills pressure
- Missing data quality issues
- Short recommendation

Fallback:

- If no transaction data exists, explain that health cannot be calculated yet.

## B. Revenue Analysis

Example questions:

- “Why is revenue down?”
- “What was my revenue this month?”
- “Which revenue source is strongest?”
- “Show my top revenue records.”

Required data:

- `get_revenue_analysis`
- optional `get_finance_summary`

Required answer:

- Revenue total
- Period comparison if available
- Top revenue records
- Revenue by category/channel if available
- Data limitation if source/channel does not exist

Fallback:

- If no revenue exists, say no revenue records were found for the selected period.

## C. Expense Analysis

Example questions:

- “Where am I spending the most?”
- “What cost increased?”
- “Which vendors are expensive?”
- “Show my largest expenses.”

Required data:

- `get_expense_analysis`
- optional `search_finance_records`

Required answer:

- OpEx total
- Top categories
- Top vendors
- Unusual or repeated costs

Fallback:

- If no expense exists, say no expense records were found for the selected period.

## D. Profitability / Margin

Example questions:

- “What is my margin?”
- “Am I profitable?”
- “What is hurting my margin?”
- “Why is margin low?”

Required data:

- `get_finance_summary`
- `get_expense_analysis`

Required answer:

- Revenue
- OpEx
- Gross margin
- Margin interpretation
- Risk level
- Cost drivers

Fallback:

- If revenue is zero, explain that margin cannot be meaningfully calculated.

## E. Bills and Cash Pressure

Example questions:

- “Can I cover upcoming bills?”
- “What bills are due soon?”
- “Which bills are risky?”
- “Show overdue bills.”

Required data:

- `get_bills_analysis`
- `get_cash_pressure`

Required answer:

- Upcoming bills
- Overdue bills
- Total payable amount
- Cash limitation if bank balance unavailable
- Risk explanation

Fallback:

- If there are no bills, say no bills are recorded.

## F. Subscriptions

Example questions:

- “How much do I spend on SaaS?”
- “Which subscriptions renew soon?”
- “Which recurring costs should I review?”

Required data:

- `get_subscription_analysis`

Required answer:

- Total recurring cost
- Upcoming renewals
- Largest subscription vendors
- Monthly recurring estimate

Fallback:

- If no subscriptions exist, say no active subscriptions were found.

## G. Ledger Cleanup

Example questions:

- “What needs cleanup?”
- “Which records are missing receipts?”
- “Can I trust this ledger?”

Required data:

- `get_ledger_quality`

Required answer:

- Missing receipts count
- Missing category count if supported
- Suspicious or incomplete rows
- Next cleanup action

Fallback:

- If no issues are found, say the ledger looks clean for supported checks.

## H. Open-ended Finance Questions

Example questions:

- “What should I do next?”
- “What’s the biggest problem?”
- “What is the most important thing this month?”

Required data:

- `get_finance_summary`
- `get_expense_analysis`
- `get_bills_analysis`
- `get_ledger_quality`

Required answer:

- Direct answer first
- Evidence
- Uncertainty
- 1 to 3 action items

Fallback:

- If data is limited, say what data is missing before giving a cautious recommendation.

## I. Unsupported Questions

Example questions:

- “Who is the president?”
- “Tell me about crypto market.”
- “Write my dating profile.”
- “Give medical advice.”

Required behavior:

- Refuse or redirect to FluxyOS finance scope.
- Do not call finance tools.
- Do not answer the unrelated question.

Example response:

> I can help with FluxyOS finance data, business performance, bills, subscriptions, revenue, expenses, and operational financial risks. I can’t answer unrelated questions here.

---

# 15. AI Answer Principles

The AI must:

- Answer directly first.
- Use actual FluxyOS data.
- Explain reasoning in simple business language.
- Show numbers clearly.
- Use Indonesian Rupiah formatting, for example `Rp 1.500.000`.
- Mention the time period.
- Mention data limitations.
- Avoid overconfidence.
- Avoid pretending to know missing data.
- Give 1 to 3 next actions.
- Keep answers concise but useful.
- Ask a clarifying question only when necessary.
- Use Bahasa Indonesia if the user asks in Indonesian.
- Use English if the user asks in English.
- Never provide legal, tax, investment, or medical advice as final authority.
- Include a light finance disclaimer only when the user asks advice-heavy questions.

---

# 16. User-Facing Answer Format

For analytical answers:

1. Direct answer
2. Key numbers
3. What this means
4. Risk or limitation
5. Recommended next action

Example:

```text
Your business looks moderately healthy this month, but margin is under pressure.

Key numbers:
- Revenue: Rp 24.000.000
- OpEx: Rp 18.000.000
- Gross margin: 25%
- Missing receipts: 7 records
- Upcoming bills: Rp 4.500.000

What this means:
Revenue is still higher than expenses, but spending is taking 75% of your revenue. The biggest pressure comes from Infrastructure and SaaS.

Recommended next actions:
1. Review the top 3 expense vendors.
2. Clean missing receipts before relying on reports.
3. Check bills due in the next 7 days.
```

---

# 17. Intent Classification

Every user message should be classified before answering.

| Intent | Required backend tool/data | Output format | Fallback behavior |
|---|---|---|---|
| `finance_health` | `get_finance_summary`, `get_bills_analysis`, `get_ledger_quality` | Analysis | Not enough data to calculate health |
| `revenue_analysis` | `get_revenue_analysis` | Analysis | No revenue records found |
| `expense_analysis` | `get_expense_analysis` | Analysis | No expense records found |
| `margin_analysis` | `get_finance_summary` | Direct + interpretation | Need both revenue and OpEx |
| `bills_analysis` | `get_bills_analysis` | List + risk | No bills recorded |
| `subscription_analysis` | `get_subscription_analysis` | List + renewal summary | No subscriptions found |
| `ledger_cleanup` | `get_ledger_quality` | Cleanup actions | Ledger looks clean for supported checks |
| `data_lookup` | `search_finance_records` | Simple answer/list | Record not found |
| `action_recommendation` | Multiple tools | Priority actions | Need more data to recommend action |
| `unsupported` | None | Refusal | Redirect to finance scope |
| `ambiguous` | None or limited summary | Clarifying question | Ask the smallest needed question |

---

# 18. Backend Tool / Function Calling Plan

The AI model must not query Firestore directly.

The backend should expose controlled finance tools.

## 18.1 `get_finance_summary`

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
  "action_items_count": 0,
  "missing_receipts_count": 0,
  "transaction_count": 0,
  "period": ""
}
```

## 18.2 `get_revenue_analysis`

Input:

```json
{
  "user_id": "string",
  "period": "this_month | last_month | custom",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "compare_to_previous_period": true
}
```

Output:

```json
{
  "total_revenue": 0,
  "top_revenue_records": [],
  "revenue_by_category": [],
  "period_comparison": null,
  "limitations": []
}
```

## 18.3 `get_expense_analysis`

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
  "total_expense": 0,
  "expense_by_category": [],
  "top_vendors": [],
  "unusual_expenses": [],
  "limitations": []
}
```

## 18.4 `get_bills_analysis`

Input:

```json
{
  "user_id": "string",
  "today": "YYYY-MM-DD",
  "window_days": 30
}
```

Output:

```json
{
  "total_unpaid_bills": 0,
  "total_unpaid_amount": 0,
  "overdue_bills": [],
  "due_soon_bills": [],
  "largest_bills": [],
  "limitations": []
}
```

## 18.5 `get_subscription_analysis`

Input:

```json
{
  "user_id": "string",
  "today": "YYYY-MM-DD",
  "window_days": 30
}
```

Output:

```json
{
  "total_monthly_subscriptions": 0,
  "upcoming_renewals": [],
  "largest_subscriptions": [],
  "limitations": []
}
```

## 18.6 `get_ledger_quality`

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
  "missing_receipts": [],
  "uncategorized": [],
  "suspicious_records": [],
  "total_issues": 0,
  "limitations": []
}
```

## 18.7 `get_cash_pressure`

Input:

```json
{
  "user_id": "string",
  "today": "YYYY-MM-DD",
  "window_days": 30
}
```

Output:

```json
{
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

## 18.8 `search_finance_records`

Input:

```json
{
  "user_id": "string",
  "query": "string",
  "collection": "transactions | bills | subscriptions | all",
  "limit": 10
}
```

Output:

```json
{
  "records": [],
  "limitations": []
}
```

---

# 19. API Design

## Endpoint

```text
POST /api/v1/brain/chat
```

## Request

```json
{
  "message": "string",
  "page_context": "dashboard | ledger | bills | subscriptions | revenue_sync | global",
  "period": {
    "type": "this_month | last_month | custom",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  }
}
```

## Response

```json
{
  "success": true,
  "intent": "finance_health",
  "scope": "project_finance",
  "answer": {
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

## Error responses

| Error | Meaning | UI behavior |
|---|---|---|
| `unauthenticated` | User is not signed in | Ask user to sign in |
| `unsupported_question` | Question outside FluxyOS scope | Render refusal answer |
| `no_data` | Required finance data is empty | Explain what data is missing |
| `tool_error` | Backend finance tool failed | Show retryable error |
| `ai_provider_not_configured` | LLM provider key missing | Explain AI is not configured yet |
| `rate_limited` | Too many requests | Ask user to retry later |

---

# 20. Structured Output Schema

The AI must return structured output before the UI renders the answer.

Structured output is needed because the UI should render consistent answer cards instead of unpredictable long chat text.

Schema:

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

## Schema rules

- `intent` must match the classifier result.
- `scope` must be `project_finance` for supported answers.
- Unsupported questions must use `answer_type: "refusal"`.
- Missing data should be listed in `limitations`.
- `key_numbers` should use raw numeric values and formatted IDR strings.
- Evidence must come from tool results, not invented reasoning.
- Recommended actions must be operational, not legal/tax/investment instructions.

---

# 21. System Prompt

```text
You are Fluxy AI, a project-scoped financial analyst inside FluxyOS.

Your role is to help the authenticated user understand their own FluxyOS finance data.

You can answer questions about:
- Business health
- Revenue
- Expenses
- Gross margin
- Bills
- Subscriptions
- Ledger quality
- Missing receipts
- Cash pressure
- Operational financial risks
- Next recommended actions

You must not behave like a general-purpose assistant.

Data grounding rules:
- Use only the provided backend tool results.
- Never invent numbers, records, vendors, bills, subscriptions, trends, or comparisons.
- If data is missing, say it is missing.
- If a calculation cannot be performed, explain why.
- Do not expose raw database paths to the user.
- Do not mention internal tool names unless debug mode is enabled.
- Mention the selected time period whenever relevant.

Scope rules:
- Only answer questions related to FluxyOS finance, business operations, and project data.
- Refuse unrelated questions politely.
- Do not answer politics, medical, personal life, dating, general internet, or unrelated investment questions.

Finance disclaimer:
- You are not an accountant, tax advisor, lawyer, or investment advisor.
- You may suggest operational next actions, but not formal financial, legal, tax, or investment decisions.

Tone:
- Clear, direct, calm, and useful.
- Use simple business language.
- Avoid jargon unless necessary.
- Match the user’s language. Use Bahasa Indonesia if the user asks in Indonesian. Use English if the user asks in English.

Answer format:
- Start with the direct answer.
- Show key numbers.
- Explain what the numbers mean.
- Mention risks or limitations.
- Give 1 to 3 recommended next actions.

Output rules:
- Return structured JSON following the provided schema.
- Do not return messy or unstructured text.
- Do not include unsupported fields.
```

---

# 22. Developer Prompt

```text
You are implementing the Fluxy AI Financial Analyst behavior.

Before answering any data-dependent finance question:
1. Classify the user intent.
2. Call the required backend finance tool(s).
3. Use only tool results as evidence.
4. Generate a structured JSON answer.
5. Render the user-facing response from that structured JSON.

Rules:
- Do not answer finance questions without data.
- If data is unavailable, say what is missing.
- Never generate fake numbers.
- Never invent records.
- Never infer trends without period comparison data.
- Keep answers related to FluxyOS only.
- Do not reveal internal database paths to users.
- Do not mention tool names unless debug mode is enabled.
- Do not let the AI write, edit, delete, or pay records in MVP.
- Do not create transactions automatically.
- Do not present mock backend answers as real production AI.
```

---

# 23. Example User Questions and Ideal Behavior

| # | User question | Intent | Required tool/data | Ideal answer behavior | Must not do |
|---:|---|---|---|---|---|
| 1 | How healthy is my business? | `finance_health` | finance summary, bills, ledger quality | Summarize revenue, OpEx, margin, bills pressure, data quality | Give generic business advice |
| 2 | Is my business improving? | `finance_health` | current and previous period summary | Compare periods if available | Invent previous-period data |
| 3 | What should I worry about? | `action_recommendation` | multiple summaries | Identify top 1 to 3 risks | Overwhelm with long report |
| 4 | Explain this month like I’m the founder. | `finance_health` | finance summary | Business-language summary | Use raw database terms |
| 5 | What changed this month? | `finance_health` | period comparison | Explain changes if comparison exists | Pretend comparison exists |
| 6 | How much revenue did I make this month? | `revenue_analysis` | revenue analysis | Direct revenue number | Include unpaid bills as revenue |
| 7 | Why is revenue down? | `revenue_analysis` | period comparison | Explain drivers and limitations | Invent causality |
| 8 | Which revenue source is strongest? | `revenue_analysis` | revenue records/category | Show top sources | Claim channel data if absent |
| 9 | Show top revenue records. | `data_lookup` | search/revenue records | List top records | Show unrelated expense records |
| 10 | What revenue changed vs last month? | `revenue_analysis` | period comparison | Compare totals and top changes | Guess without last-month data |
| 11 | Where am I spending the most? | `expense_analysis` | expense analysis | Top categories/vendors | Include income as expense |
| 12 | Which vendors are expensive? | `expense_analysis` | expense by vendor | Show top vendors | Shame user or make unsupported claims |
| 13 | Why is OpEx high? | `expense_analysis` | OpEx and categories | Explain cost concentration | Diagnose without expense data |
| 14 | What cost increased? | `expense_analysis` | period comparison | Show increasing categories/vendors | Claim increase without comparison |
| 15 | Show my largest expenses. | `data_lookup` | expense records | Return sorted list | Mix bills and expenses without saying so |
| 16 | What is my margin? | `margin_analysis` | finance summary | Show formula and result | Return NaN/Infinity |
| 17 | Am I profitable? | `margin_analysis` | revenue and OpEx | Explain revenue minus OpEx | Give tax/legal conclusion |
| 18 | What is hurting margin? | `margin_analysis` | expense analysis | Show main cost drivers | Blame without evidence |
| 19 | Which bills are due soon? | `bills_analysis` | bills analysis | List due soon bills | Pretend payment system exists |
| 20 | Which bills are risky? | `bills_analysis` | overdue/due soon | Prioritize overdue/high amount | Create payment action |
| 21 | Can I cover upcoming bills? | `bills_analysis` | cash pressure proxy | Explain proxy and limitation | Pretend to know bank balance |
| 22 | Show overdue bills. | `bills_analysis` | bills analysis | List overdue bills | Include completed bills as unpaid |
| 23 | How much do I spend on SaaS? | `subscription_analysis` | subscription analysis | Estimate recurring cost | Assume annual/monthly if unknown without caveat |
| 24 | Which renewals are coming? | `subscription_analysis` | renewal dates | List upcoming renewals | Invent renewal dates |
| 25 | Which recurring costs should I review? | `subscription_analysis` | largest subscriptions | Recommend review targets | Cancel subscriptions automatically |
| 26 | Which records are missing receipts? | `ledger_cleanup` | ledger quality | Show count and records | Say ledger is clean if unchecked |
| 27 | Can I trust my ledger? | `ledger_cleanup` | ledger quality | Explain data quality status | Overstate certainty |
| 28 | Who is the president? | `unsupported` | none | Refuse and redirect | Answer politics |
| 29 | Should I buy Bitcoin today? | `unsupported` | none | Refuse investment advice outside internal data | Predict market |
| 30 | Write my dating profile. | `unsupported` | none | Refuse and redirect | Act as generic assistant |

---

# 24. UX Plan

## Existing Fluxy AI drawer

The existing drawer should be improved, not replaced.

Required drawer elements:

- Message input
- Suggested prompt chips
- User message bubble
- AI answer card
- Key number cards
- Insight list
- Recommended action list
- Related records section
- Loading state
- Error state
- Empty data state
- Refusal state
- Low-confidence note

## Suggested prompt chips

Global:

- “How healthy is my business?”
- “What needs attention?”
- “Why is OpEx high?”
- “Show upcoming bills”
- “Find missing receipts”
- “Summarize this month”
- “What should I do next?”

Dashboard:

- “Explain my business health”
- “What changed this month?”
- “What should I fix first?”

Ledger:

- “Find missing receipts”
- “Show unusual expenses”
- “Can I trust this ledger?”

Bills:

- “Which bills are due soon?”
- “What bills are risky?”
- “Summarize upcoming payables”

Subscriptions:

- “How much am I spending on SaaS?”
- “Which renewals are coming?”
- “Which recurring costs should I review?”

Revenue Sync:

- “What revenue changed?”
- “Which channel performs best?”
- “Is there a revenue anomaly?”

## UI states

| State | Behavior |
|---|---|
| Default | Show intro text and prompt chips |
| Loading | Show thinking/loading skeleton |
| Streaming | Optional for later; MVP can use non-streaming response |
| Empty data | Explain what data is missing and suggest adding records |
| Provider not configured | Say AI is not configured yet |
| Error | Show retryable error message |
| Refusal | Show scope redirect message |
| Low confidence | Show limitation note and suggest next data to add |

---

# 25. MVP Scope

## In scope

- Dashboard AI chat
- Existing Fluxy AI drawer improvement
- Finance health answer
- Revenue summary
- Expense summary
- Bills summary
- Subscription summary
- Ledger cleanup answer
- Project-only scope guard
- Safe fallback for missing data
- Backend function/tool contract
- Structured response schema
- Suggested prompt chips
- Loading/error/empty states
- Refusal for unsupported questions

## Out of scope

- AI writes or edits financial records
- Auto payment
- Bank integration
- Tax filing
- Legal advice
- Investment advice
- Forecasting beyond available data
- Multi-entity advanced consolidation unless existing data supports it
- Voice input
- Long-term memory outside user account data
- Report PDF export
- Approvals automation
- AI-generated record mutations
- AI-generated payment execution

---

# 26. V1 / Later Scope

After MVP, consider:

- Forecasting
- Cash runway
- Scenario simulation
- “What if” planning
- AI-generated reports
- AI anomaly detection
- AI categorization
- Auto-generated monthly board summary
- Integration-aware analysis
- Role-based AI access
- Audit log viewer
- Approval recommendations
- AI-generated budget recommendations
- AI-generated supplier/vendor risk review
- AI categorization suggestions
- AI monthly closing checklist

---

# 27. Risk and Guardrails

| Risk | Impact | Mitigation | Acceptance rule |
|---|---|---|---|
| Hallucinated numbers | Breaks trust | Use tool results only | No number appears unless sourced from backend |
| Wrong financial advice | User may act on bad info | Keep advice operational, not formal | Add disclaimer for advice-heavy answers |
| Missing data | Misleading answer | Show limitations | Every no-data answer explains what is missing |
| User overtrust | Unsafe decisions | Explain uncertainty | AI must mention data gaps |
| Privacy leakage | Serious security issue | Authenticate and scope by UID | No cross-user query path |
| Cross-user data risk | Data breach | Backend validation + Firestore rules | Tool functions require authenticated user |
| Unsupported questions | Scope drift | Refusal classifier | Unsupported questions return refusal schema |
| Bad period comparison | False trend | Require previous-period data | No comparison without data |
| Revenue = 0 margin issue | NaN/Infinity | Guard formula | Return 0 or unknown |
| Stale data | Wrong interpretation | Include period label | Answer always mentions period |
| Mock backend shipped as real | False trust | Clear provider config state | Mock only allowed in development |
| AI provider failure | Broken UX | Error response | UI shows retryable error |
| Too much data sent to LLM | Privacy/cost risk | Summarize server-side | Limit records sent to AI |
| Sensitive data in logs | Privacy risk | Avoid raw financial logs | Logs exclude raw records |

---

# 28. Privacy and Data Handling

Rules:

- Do not send more records than needed to the AI provider.
- Summarize data server-side before model call when possible.
- Never send another user’s records.
- Avoid logging raw financial records.
- Mask sensitive fields when not needed.
- Keep raw record access behind authenticated backend tools.
- Use least-privilege data fetching.
- Add rate limits if needed.
- Do not store chat content unless a clear product requirement exists.
- Do not store long-term memory outside user account data in MVP.

---

# 29. Acceptance Criteria

The feature is complete when:

- AI only answers FluxyOS finance/project questions.
- AI refuses unrelated questions.
- AI calls backend tools for data-dependent questions.
- AI does not invent numbers.
- AI can summarize revenue, expenses, bills, subscriptions, and ledger quality.
- AI returns structured output.
- UI renders user-friendly answers.
- Empty/error states work.
- Authenticated user data scope is respected.
- Existing dashboard and sidebar behavior are not broken.
- Existing mock AI endpoint is replaced or clearly separated from production.
- No mock answer is presented as real production AI.
- AI does not write or edit records in MVP.
- AI does not create payments.
- AI does not create transactions automatically.
- QA passes.

---

# 30. Implementation Plan

## Phase 1: Documentation and contract

- Create `docs/fluxy_ai_financial_analyst_plan.md`.
- Define response schema.
- Define backend tools.
- Define intent taxonomy.
- Define scope/refusal rules.

## Phase 2: Backend tools

- Add server-side finance summary functions.
- Add revenue analysis function.
- Add expense analysis function.
- Add bills analysis function.
- Add subscription analysis function.
- Add ledger quality function.
- Add cash pressure proxy function.
- Add safe period handling.

## Phase 3: AI orchestration

- Add intent classification.
- Add tool selection.
- Add structured output generation.
- Add refusal handling.
- Add no-data handling.
- Add provider-not-configured handling.

## Phase 4: Frontend UI

- Improve Fluxy AI drawer.
- Add suggested prompt chips.
- Add loading/error/empty states.
- Render structured answers.
- Add contextual prompts by page.
- Preserve existing sidebar behavior.

## Phase 5: QA

- Test supported finance questions.
- Test unsupported questions.
- Test empty data.
- Test auth guard.
- Test Firestore user scope.
- Test provider missing.
- Test browser console.
- Verify no footer appears on app pages.
- Verify no unrelated pages are broken.

---

# 31. Claude Code Implementation Prompt

Paste this into Claude Code after saving this file as:

```text
docs/fluxy_ai_financial_analyst_plan.md
```

```text
You are working on the existing FluxyOS codebase.

Your task is to implement the Fluxy AI Financial Analyst MVP based on:

- docs/PROJECT_BACKGROUND.md
- docs/product_ux_feature_intake_framework.md
- docs/ROADMAP.md
- docs/WORKFLOW.md
- docs/fluxy_ai_financial_analyst_plan.md

Before touching code, read all five files.

Goal:
Turn the existing mock Fluxy AI / Brain chat into a project-scoped financial analyst that answers questions about the authenticated user’s FluxyOS finance data.

This is not a generic chatbot.

The AI must answer only questions related to:
- Business health
- Revenue
- Expenses
- Gross margin
- Bills
- Subscriptions
- Ledger quality
- Missing receipts
- Cash pressure proxy
- Operational financial risks
- Next recommended actions

Current product context:
- Frontend is static HTML + Tailwind + Vanilla JS.
- Backend is FastAPI in main.py.
- Auth is Firebase Authentication.
- Database is Firestore under users/{userId}/...
- Existing endpoint /api/v1/brain/chat currently returns mock responses.
- Existing Fluxy AI drawer exists and should be improved, not replaced.
- App pages must not load the marketing footer.
- Do not add React, npm, bundlers, or framework dependencies.

Implementation requirements:

1. Backend data tools
Create safe backend finance functions:
- get_finance_summary
- get_revenue_analysis
- get_expense_analysis
- get_bills_analysis
- get_subscription_analysis
- get_ledger_quality
- get_cash_pressure
- search_finance_records

These functions must only access the authenticated user’s own data.

2. API endpoint
Extend or replace:

POST /api/v1/brain/chat

Request:
{
  "message": "string",
  "page_context": "dashboard | ledger | bills | subscriptions | revenue_sync | global",
  "period": {
    "type": "this_month | last_month | custom",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  }
}

Response:
{
  "success": true,
  "intent": "finance_health",
  "scope": "project_finance",
  "answer": {
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

3. Intent classification
Classify user messages into:
- finance_health
- revenue_analysis
- expense_analysis
- margin_analysis
- bills_analysis
- subscription_analysis
- ledger_cleanup
- data_lookup
- action_recommendation
- unsupported
- ambiguous

Unsupported questions must return a refusal and must not call finance tools.

4. AI orchestration
The AI model must not query Firestore directly.
The backend must fetch and summarize data first.
The model must answer only using backend tool results.
Never invent numbers, vendors, records, trends, bills, subscriptions, or comparisons.

If no AI provider key is configured:
- Do not pretend production AI is working.
- Return ai_provider_not_configured or a development-only mock clearly marked as development-only.
- The frontend should show a helpful message.

5. Structured output
Return structured output that follows:

{
  "intent": "",
  "scope": "project_finance",
  "answer_type": "analysis | lookup | refusal | clarification",
  "confidence": 0,
  "period": {
    "label": "",
    "start_date": "",
    "end_date": ""
  },
  "direct_answer": "",
  "key_numbers": [],
  "insights": [],
  "recommended_actions": [],
  "limitations": [],
  "follow_up_questions": []
}

6. Frontend UI
Improve the existing Fluxy AI drawer:
- Add suggested prompt chips.
- Add loading state.
- Add error state.
- Add empty data state.
- Add refusal state.
- Render structured answer cards.
- Render key numbers.
- Render insights.
- Render recommended actions.
- Render limitations.
- Preserve existing drawer open/close behavior.
- Preserve existing sidebar behavior.

Suggested prompt chips:
- “How healthy is my business?”
- “What needs attention?”
- “Why is OpEx high?”
- “Show upcoming bills”
- “Find missing receipts”
- “Summarize this month”
- “What should I do next?”

7. Contextual behavior
Use page_context to influence suggested prompts:
- dashboard: health, KPI, attention items
- ledger: cleanup, missing receipts, unusual expenses
- bills: due soon, risky bills, payables
- subscriptions: SaaS spend, renewals, recurring cost
- revenue_sync: revenue changes, channels, anomalies

8. Finance rules
Revenue includes:
- income
- legacy revenue
- refund if treated as positive-side record
- pending_receivable only for expected revenue analysis

OpEx includes:
- expense
- fee
- tax
- pending_payable when analyzing obligations

Gross margin:
((revenue - opex) / revenue) * 100

If revenue is 0, return 0 or unknown. Never return NaN or Infinity.

Amount formatting:
- Store raw numbers only.
- Display Indonesian Rupiah format, for example Rp 1.500.000.

9. Guardrails
Do not:
- Let AI write or edit financial records.
- Let AI delete records.
- Let AI create payments.
- Let AI create transactions automatically.
- Build Pay Now.
- Build bank integration.
- Build tax filing.
- Add unrelated refactors.
- Change authentication.
- Break existing dashboard, ledger, bills, subscriptions, revenue sync, integrations, or sidebar behavior.
- Load footer on app pages.
- Present mock answers as production AI.

10. Acceptance criteria
The implementation is complete when:
- AI only answers FluxyOS finance/project questions.
- AI refuses unrelated questions.
- AI calls backend tools for data-dependent questions.
- AI does not invent numbers.
- AI summarizes revenue, expenses, bills, subscriptions, and ledger quality.
- AI returns structured output.
- UI renders user-friendly answers.
- Empty/error/provider-missing states work.
- Authenticated user data scope is respected.
- Existing dashboard and sidebar behavior are not broken.
- Existing mock AI endpoint is replaced or clearly separated from production.
- QA passes.

11. QA
Before commit/push:
- Verify all new file references exist.
- Open affected pages in a real browser.
- Confirm browser console has no CSP, CORS, 404, or Firebase errors.
- Test supported finance questions.
- Test unsupported questions.
- Test empty data.
- Test unauthenticated state.
- Test provider-not-configured state.
- Verify Firestore user scoping.
- Verify no app page footer appears.
- Follow docs/WORKFLOW.md before pushing.
```

---

# 32. Notes for Future Product Strategy

Fluxy AI should become the intelligence layer across FluxyOS, but MVP should stay narrow.

The product should first win trust with grounded answers before adding write actions, forecasting, or automation.

Recommended evolution:

1. **MVP**: Read-only finance analyst.
2. **V1**: Insight + recommended action cards.
3. **V2**: Forecasting and scenario simulation.
4. **V3**: AI-assisted categorization and report generation.
5. **V4**: Controlled write actions with approval and audit logs.

The guiding rule:

> Fluxy AI should explain, prioritize, and recommend before it acts.
