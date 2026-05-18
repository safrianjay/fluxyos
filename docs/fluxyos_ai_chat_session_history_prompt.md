# FluxyOS Standalone AI Command Center — Chat Sessions, History, Deletion, and 14-Day Retention Prompt

Use this prompt in Codex / Claude Code to update the existing standalone Fluxy AI Command Center implementation.

---

## Prompt

You are working on the existing FluxyOS codebase.

Task:
Update the standalone Fluxy AI Command Center so the AI page supports a proper AI chat interaction model with persistent chat sessions, recent chat history, delete chat behavior, and 14-day inactive chat auto-removal logic.

This should be added into the existing standalone AI Command Center implementation. Do not create a separate product concept. Do not redesign the full page from scratch.

The AI page should behave more like ChatGPT, Claude, and Gemini:

- AI Home shows greeting, prompt cards, composer, and recent chat history.
- When the user starts a chat, it opens a dedicated chat session view.
- The full page should scroll naturally.
- The chat should not be trapped inside a small internal scroll container.
- The composer should be smaller and positioned lower after chat starts.
- Chat history should be saved and accessible from the AI Home page.
- Users can delete chats with confirmation.
- Chats should show a note that inactive chats are automatically removed after 14 days.

This is an interaction architecture and UI behavior update.

Do not change finance analysis logic.
Do not change document detection logic.
Do not change bill capture logic.
Do not redesign the full visual style.
Do not introduce React, npm, or a new frontend framework.
Do not break the current FluxyOS app theme.

---

## Required References

Before coding, read:

1. `docs/PROJECT_BACKGROUND.md`
2. `docs/product_ux_feature_intake_framework.md`
3. `docs/ROADMAP.md`
4. `docs/WORKFLOW.md`
5. `docs/fluxy_ai_financial_analyst_plan.md`
6. `docs/fluxyos_ai_bill_capture_feature_spec.md`
7. `docs/fluxyos_standalone_ai_command_center_prompt_recreated.md`
8. `CLAUDE.md` or `AGENTS.md` if available

Respect repo-level coding-agent instructions if `AGENTS.md` exists.

---

## Current Problem

The current AI page behaves like one long page with an internal constrained chat container.

Problems:
- The page does not scroll naturally.
- Chat result content is trapped inside an internal scroll area.
- The composer takes too much space.
- The answer area becomes visually compressed.
- The user cannot use it like a normal AI chat product.
- Returning to the AI page does not show recent chat history.
- There is no saved session behavior.
- There is no delete chat behavior.
- There is no lifecycle or expiration information.

---

## New Interaction Model

Implement two states using the same standalone AI page route.

### State A: AI Home

This is the default page when the user opens Fluxy AI from the sidebar.

AI Home includes:
- Greeting section
- Finance prompt cards
- Refresh prompts
- Composer
- Recent chat history section

The home page should preserve the current AI landing feel.

### State B: Chat Session

This state starts when:
- User submits a prompt from the home page.
- User clicks a prompt card.
- User clicks one of the recent chat history entries.
- User opens a saved chat by its chat session ID.

Chat Session includes:
- Chat messages
- Compact composer
- Attachment/image controls
- Back to AI Home action
- Optional session title
- Natural full-page scroll

The Chat Session should feel like ChatGPT/Gemini/Claude after the user starts a conversation.

---

## Important UX Rule

Do not trap the chat inside a small internal scroll container.

Preferred behavior:
- The full page scrolls naturally.
- Conversation content uses normal document flow.
- Composer is visible and compact.
- Composer does not cover or overlap chat messages.
- Long answers are readable from top to bottom.
- The user should not feel like they are scrolling a box inside the page.

If sticky composer is used:
- It must not hide message content.
- It must have safe bottom padding.
- It should feel like a bottom input bar, not a giant card.

---

## AI Home Requirements

### 1. Greeting

Keep the current greeting style.

Example:
- “Hi there, [name]”
- “What would you like to understand about your finance?”

The user name should keep the gradient styling if already implemented.

### 2. Prompt Cards

Keep the existing finance-specific prompt cards.

Examples:
- Analyze my business health
- Find what needs attention
- Summarize this month
- What should I do next?
- Show upcoming bills
- Find missing receipts
- Review subscription costs

Prompt card behavior:
- Clicking a prompt starts a new chat session.
- The prompt becomes the first user message.
- Assistant response appears inside Chat Session state.

### 3. Refresh Prompts

Keep refresh prompt behavior.

### 4. Recent Chat History Section

Add a recent chat history area on the AI Home page.

Show up to 5 recent chats.

Each history item should show:
- Chat title
- Last message preview or summary
- Last updated time
- Optional category or intent badge
- Delete action

Example chat titles:
- Business health this month
- Upcoming bill risk
- OpEx cost drivers
- Missing receipts review
- Subscription renewal check

If there are no chats, show:
“No recent AI chats yet. Start with a finance prompt above.”

The history area can be scrollable if needed, but the full page itself should still scroll naturally.

### 5. 14-Day Retention Note

Show a small note near Recent Chat History:

“Chats with no new activity are automatically removed after 14 days.”

Keep it subtle. Do not make it feel like an error or warning.

---

## Chat History Data Model

Persist chat sessions in Firestore under the authenticated user.

Suggested path:

`users/{userId}/ai_chats/{chatId}`

Each chat document should include:

```json
{
  "title": "Business health this month",
  "summary": "Revenue, OpEx, margin, and overdue bill risk.",
  "last_message_preview": "Here is what I am seeing for this month...",
  "intent": "finance_health",
  "source": "ai_command_center",
  "created_at": "serverTimestamp",
  "updated_at": "serverTimestamp",
  "last_activity_at": "serverTimestamp",
  "expires_at": "timestamp 14 days after last_activity_at",
  "message_count": 2,
  "status": "active"
}
```

Messages should preferably be stored as a subcollection:

`users/{userId}/ai_chats/{chatId}/messages/{messageId}`

Message fields:

```json
{
  "role": "user | assistant | system",
  "content": "",
  "structured_answer": {},
  "attachments": [],
  "created_at": "serverTimestamp"
}
```

If subcollections create too much implementation scope, messages may be embedded in the chat document for MVP, but only if safe and limited.

Preferred approach:
Use a messages subcollection for scalability.

---

## 14-Day Auto Removal Logic

Chats should auto-remove after 14 days with no new activity.

Add these fields:
- `last_activity_at`
- `expires_at`

On every new message:
1. Update `last_activity_at`.
2. Set `expires_at` to 14 days after the new activity.
3. Update `updated_at`.
4. Update `message_count`.

On AI Home:
- Do not show expired chats.
- Filter out chats where `expires_at` is before the current time.
- Show only active, non-expired chats.

If Firestore TTL is configured:
- Use `expires_at` as the TTL field.
- Document that Firestore TTL deletion is not immediate.
- Expired documents may continue to appear until the TTL process deletes them.
- Data is typically deleted within 24 hours after expiration.
- Firestore TTL deletion does not delete subcollections under the deleted document, so message subcollections need separate cleanup logic or a matching TTL field.

If Firestore TTL is not configured:
- Still store `expires_at`.
- Filter expired chats out of the UI.
- Add a TODO for backend scheduled cleanup or Firestore TTL policy setup.
- Do not pretend TTL is active if it is not configured.

Implementation note:
If using message subcollections, also add `expires_at` to each message document so a collection group TTL policy can clean messages independently, or use a backend cleanup job / Cloud Function to remove subcollections.

---

## Delete Chat Behavior

Each recent chat history item should have a delete action.

When the user clicks delete:
Show a confirmation prompt/modal.

Confirmation copy:

Title:
“Delete this chat?”

Body:
“This will remove the conversation from your AI history. This action can’t be undone.”

Actions:
- Cancel
- Delete chat

On Cancel:
- Close confirmation.
- Do not delete anything.

On Delete:
- Delete the chat from UI.
- Show success toast if toast helper exists.
- Persist the deletion safely.

Preferred deletion approach:
If the backend supports recursive delete:
- Delete the chat document.
- Delete all messages in its messages subcollection.

Safe MVP approach:
If recursive subcollection deletion is not safe from the frontend:
- Soft delete the chat document:
  - `status: "deleted"`
  - `deleted_at: serverTimestamp()`
- Hide deleted chats from AI Home and history queries.
- Add TODO for backend cleanup.

Do not leave deleted chats visible.
Do not delete another user’s chat.
Do not perform global deletes.

---

## Chat Session Behavior

When the user starts a chat:

1. Create a new chat session under `users/{userId}/ai_chats`.
2. Save the first user message.
3. Switch UI state to Chat Session view.
4. Show the user message.
5. Show assistant loading state.
6. Call the finance AI endpoint.
7. Save the assistant response.
8. Render the assistant response.
9. Update chat metadata:
   - `title`
   - `summary`
   - `last_message_preview`
   - `intent`
   - `message_count`
   - `updated_at`
   - `last_activity_at`
   - `expires_at`

When user sends another message in the same chat:
- Append message to the same chat session.
- Do not create a new chat.
- Update session metadata.
- Extend `expires_at` by another 14 days from the latest activity.

When the user clicks “New Chat”:
- Return to AI Home state.
- Clear composer.
- Show prompt cards.
- Show recent chat history.

When the user clicks a recent chat item:
- Load the chat session.
- Load messages in chronological order.
- Switch to Chat Session view.
- Activate compact composer mode.
- Continue conversation in the selected chat.

---

## Navigation / State Behavior

Use one of these approaches based on current routing:

Preferred:
- Same page route with query param:
  - `/ai` = AI Home
  - `/ai?chat={chatId}` = Chat Session

Acceptable:
- Hash route:
  - `/ai#chat={chatId}`

Do not create a heavy router system.

Add:
- “New Chat” action in Chat Session
- “Back to AI Home” action if needed

Browser behavior:
- Reloading `/ai?chat={chatId}` should load that chat if it belongs to the authenticated user.
- Invalid or deleted chat ID should show a safe empty/error state and offer “Back to AI Home.”
- Expired chat should not open. Show:
  “This chat is no longer available because it has expired.”

---

## Composer Behavior

### On AI Home

Composer can be larger, like the current landing state.

### In Chat Session

Composer should be smaller and positioned lower visually.

Requirements:
- Compact bottom composer
- Default textarea height around 52px to 64px
- Max textarea height around 140px to 160px
- Auto-grow only until max height
- Internal textarea scroll after max height
- Attachment row compact
- Send button aligned right
- No overlap with messages
- No giant empty textarea after chat starts

The composer should feel like:
- ChatGPT bottom composer
- Gemini prompt bar
- Claude compact input area

Not like:
- A large dashboard card
- A huge empty text panel
- A blocking overlay

---

## Full Page Scroll Requirement

Remove or avoid the internal constrained chat scroll container that creates a small scroll area.

The page should scroll naturally.

Rules:
- Avoid setting fixed height on the chat message container unless necessary.
- Avoid `overflow-y: auto` on a small internal response container.
- Use normal page flow for messages.
- Composer should not hide content.
- If sticky composer is used, add safe page bottom padding.
- Long answers should be readable from top to bottom.

---

## Message UI

Render chat messages like a real chat.

User message:
- Compact bubble or right-aligned message
- Shows user text
- Shows attached file preview if any

Assistant message:
- Left/full-width readable answer
- Can contain structured finance answer sections:
  - direct answer
  - key numbers
  - insights
  - recommended actions
  - limitations
  - related records

Do not render the assistant answer as a giant static dashboard section disconnected from the conversation.

---

## File Upload Behavior

Keep existing:
- Add attachment
- Use image
- File preview
- Remove file
- Document detection
- Bill Capture integration

When a file is uploaded inside a chat session:
- Attach it to the current user message.
- Run detection/extraction.
- Render result as assistant message.
- Do not save automatically.
- Keep review-before-save behavior.

---

## Backend / Firestore Requirements

Implement only what is needed.

Use existing Firebase/Firestore patterns in the project.

Do not weaken security.

All data must be scoped under:

`users/{userId}/...`

Add chat persistence only under the authenticated user.

Do not create global chat collections.
Do not expose another user’s chat.
Do not store raw sensitive document contents unless necessary.
Avoid logging sensitive message contents to console.

---

## Existing Logic Must Not Break

Do not change:
- Finance analysis calculation logic
- Bill Capture extraction logic
- Document detection routing logic
- Existing dashboard logic
- Existing bills/ledger/subscription pages
- Sidebar app behavior except linking to AI page if already required
- Auth guard
- Existing styling system

---

## UI Acceptance Criteria

The implementation is complete when:

1. AI Home shows greeting, prompt cards, composer, and recent chat history.
2. Recent chat history shows up to 5 chats.
3. Recent chat list is readable and can scroll if needed.
4. Empty chat history state exists.
5. Chat history item opens the saved chat session.
6. User can delete a chat.
7. Delete action shows confirmation before deletion.
8. UI explains chats with no new activity are automatically removed after 14 days.
9. Starting a prompt creates or opens a chat session.
10. Chat Session behaves like a normal AI chat.
11. Full page scrolls naturally.
12. Chat is not trapped in a small internal scroll container.
13. Composer becomes compact in Chat Session.
14. Composer moves lower and behaves like a bottom chat input.
15. Composer does not overlap assistant response.
16. Long assistant responses are fully readable.
17. Multiple messages append to the same session.
18. New Chat returns to AI Home.
19. Attachments still work.
20. Document detection still works.
21. Bill/invoice routing to Bill Capture remains intact.
22. Finance Analyst response rendering remains intact.
23. Mobile layout is usable.
24. Browser console has no errors.

---

## Data Acceptance Criteria

The implementation is complete when:

1. Chat sessions are stored under authenticated user scope.
2. Messages are stored under the correct chat session.
3. Chat title, summary, and preview update after messages.
4. `updated_at` and `last_activity_at` update on each message.
5. `expires_at` is set to 14 days after last activity.
6. Expired chats are hidden from recent chat history if TTL cleanup is not active.
7. Deleted chats are removed or hidden.
8. No other user’s chats are accessible.
9. No global chat collection is used.
10. No sensitive data is logged.

---

## Manual QA

### Test AI Home

1. Open Fluxy AI page.
2. Confirm greeting is visible.
3. Confirm prompt cards are visible.
4. Confirm composer is visible.
5. Confirm recent chat history area is visible.
6. If no history, confirm empty state appears.
7. Confirm 14-day auto-removal note appears.

### Test Starting Chat

1. Click “Analyze my business health.”
2. Confirm a new chat session starts.
3. Confirm user message appears.
4. Confirm assistant loading appears.
5. Confirm assistant response appears.
6. Confirm page scrolls naturally.
7. Confirm composer is compact and lower.
8. Confirm composer does not overlap the answer.

### Test Continuing Chat

1. Send another prompt.
2. Confirm it appends to the same chat.
3. Refresh page if possible.
4. Open the same chat from history.
5. Confirm messages load.

### Test History

1. Create more than 5 chats.
2. Confirm only 5 recent chats show.
3. Confirm list is scrollable if needed.
4. Open a history item.
5. Confirm correct chat loads.

### Test Deletion

1. Click delete on a chat.
2. Confirm modal/prompt appears.
3. Click cancel.
4. Confirm chat remains.
5. Click delete again.
6. Confirm deletion.
7. Confirm chat disappears from history.

### Test Upload

1. Attach a bill/invoice image.
2. Confirm detection works.
3. Confirm Bill Capture review flow is preserved.
4. Confirm no automatic save.
5. Attach non-finance image.
6. Confirm refusal/unsupported behavior.

### Test Regression

1. Dashboard still works.
2. Bills page still works.
3. Ledger page still works.
4. Subscription page still works.
5. Sidebar still works.
6. Browser console has no errors.

---

## Final Response

After implementation, report:

1. Files changed.
2. How AI Home and Chat Session states were implemented.
3. Firestore chat data model used.
4. How recent chat history works.
5. How delete confirmation works.
6. How 14-day auto-removal is represented.
7. Whether Firestore TTL is configured or only `expires_at` is stored.
8. How full-page scrolling was fixed.
9. How compact chat composer works.
10. Confirmation that finance/bill capture logic was not changed.
11. QA steps performed.
12. Any known limitations.

Proceed with implementation now.
