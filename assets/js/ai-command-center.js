(function () {
    'use strict';

    const MAX_CHARS = 1000;
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel']);
    const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'csv']);

    const PROMPT_SETS = [
        {
            label: 'Dashboard health',
            prompts: [
                ['Analyze my business health', 'How healthy is my business this month?'],
                ['Find what needs attention', 'What needs attention?'],
                ['Summarize this month', 'Summarize this month.'],
                ['What should I do next?', 'What should I do next?'],
            ],
        },
        {
            label: 'Ledger cleanup',
            prompts: [
                ['Find missing receipts', 'Find missing receipts.'],
                ['Check ledger trust', 'Can I trust my ledger?'],
                ['Review incomplete records', 'Which records need cleanup?'],
                ['Show largest expenses', 'Show my largest expenses.'],
            ],
        },
        {
            label: 'Bills risk',
            prompts: [
                ['Show upcoming bills', 'Show upcoming bills.'],
                ['Find risky bills', 'Which bills are risky?'],
                ['Check cash pressure', 'Can I cover upcoming bills?'],
                ['Show overdue bills', 'Show overdue bills.'],
            ],
        },
        {
            label: 'Subscriptions',
            prompts: [
                ['Review subscription costs', 'Review subscription costs.'],
                ['Upcoming renewals', 'Which subscriptions renew soon?'],
                ['SaaS spend', 'How much do I spend on SaaS?'],
                ['Recurring costs to review', 'Which recurring costs should I review?'],
            ],
        },
        {
            label: 'Revenue sync',
            prompts: [
                ['Revenue this month', 'What was my revenue this month?'],
                ['Strongest revenue source', 'Which revenue source is strongest?'],
                ['Revenue changes', 'What revenue changed this month?'],
                ['Revenue limitation', 'What can Revenue Sync analyze right now?'],
            ],
        },
        {
            label: 'Founder summary',
            prompts: [
                ['Founder summary', 'Explain this month like I am the founder.'],
                ['Fix first', 'What should I fix first?'],
                ['Biggest risk', 'What is the biggest problem this month?'],
                ['Margin pressure', 'Why is OpEx high?'],
            ],
        },
    ];

    const state = {
        user: null,
        promptSetIndex: 0,
        file: null,
        previewUrl: null,
        busy: false,
        context: window.__fluxyAICommandContext || null,
        mode: 'home',
        bootedFor: null,
        currentChatId: null,
        currentChat: null,
        messageCount: 0,
        pendingDeleteChatId: null,
        chatStarted: false,
        messageId: 0,
    };

    const els = {};

    function init() {
        cacheElements();
        if (!els.form) return;
        renderPrompts();
        updateCharCount();
        wireEvents();
        window.FluxyAICommandCenter = {
            setUser(user) {
                state.user = user || null;
                renderUserName();
                if (state.user) bootRoute();
            },
        };
        if (window.__fluxyAICommandContext?.auth?.currentUser) {
            window.FluxyAICommandCenter.setUser(window.__fluxyAICommandContext.auth.currentUser);
        }
    }

    function cacheElements() {
        els.name = document.getElementById('ai-user-name');
        els.appHeader = document.getElementById('ai-app-header');
        els.homeTopbar = document.getElementById('ai-home-topbar');
        els.sessionTopbar = document.getElementById('ai-session-topbar');
        els.workspace = document.getElementById('ai-workspace');
        els.greeting = document.getElementById('ai-greeting-section');
        els.promptSection = document.getElementById('ai-prompt-section');
        els.promptGrid = document.getElementById('ai-prompt-grid');
        els.refreshPrompts = document.getElementById('ai-refresh-prompts');
        els.sessionTitle = document.getElementById('ai-session-title');
        els.backHome = document.getElementById('ai-back-home');
        els.newChat = document.getElementById('ai-new-chat');
        els.responseArea = document.getElementById('ai-response-area');
        els.chatThread = null;
        els.sessionPromptChips = null;
        els.composerSection = document.getElementById('ai-composer-section');
        els.form = document.getElementById('ai-command-form');
        els.input = document.getElementById('ai-command-input');
        els.charCount = document.getElementById('ai-char-count');
        els.send = document.getElementById('ai-send-btn');
        els.attachBtn = document.getElementById('ai-attach-btn');
        els.imageBtn = document.getElementById('ai-image-btn');
        els.fileInput = document.getElementById('ai-file-input');
        els.imageInput = document.getElementById('ai-image-input');
        els.filePreview = document.getElementById('ai-file-preview');
        els.error = document.getElementById('ai-composer-error');
        els.dropZone = document.getElementById('ai-drop-zone');
        els.scrollContainer = document.querySelector('main > div.flex-1.overflow-y-auto');
        els.historySection = document.getElementById('ai-history-section');
        els.historyList = document.getElementById('ai-history-list');
        els.deleteModal = document.getElementById('ai-delete-modal');
        els.deleteCancel = document.getElementById('ai-delete-cancel');
        els.deleteConfirm = document.getElementById('ai-delete-confirm');
    }

    function wireEvents() {
        els.refreshPrompts?.addEventListener('click', () => {
            state.promptSetIndex = (state.promptSetIndex + 1) % PROMPT_SETS.length;
            renderPrompts();
        });
        els.input?.addEventListener('input', updateCharCount);
        els.input?.addEventListener('input', autoGrowComposer);
        els.input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                els.form?.requestSubmit();
            }
        });
        els.form?.addEventListener('submit', submitComposer);
        els.backHome?.addEventListener('click', () => renderHome({ updateRoute: true }));
        els.newChat?.addEventListener('click', () => renderHome({ updateRoute: true }));
        els.deleteCancel?.addEventListener('click', closeDeleteModal);
        els.deleteModal?.addEventListener('click', (event) => {
            if (event.target === els.deleteModal) closeDeleteModal();
        });
        els.deleteConfirm?.addEventListener('click', confirmDeleteChat);
        els.attachBtn?.addEventListener('click', () => els.fileInput?.click());
        els.imageBtn?.addEventListener('click', () => els.imageInput?.click());
        els.fileInput?.addEventListener('change', event => selectFile(event.target.files?.[0]));
        els.imageInput?.addEventListener('change', event => selectFile(event.target.files?.[0]));
        els.form?.addEventListener('dragover', (event) => {
            event.preventDefault();
            els.dropZone?.classList.remove('hidden');
            els.form?.classList.add('ring-2', 'ring-gray-200');
        });
        els.form?.addEventListener('dragleave', () => {
            els.dropZone?.classList.add('hidden');
            els.form?.classList.remove('ring-2', 'ring-gray-200');
        });
        els.form?.addEventListener('drop', (event) => {
            event.preventDefault();
            els.dropZone?.classList.add('hidden');
            els.form?.classList.remove('ring-2', 'ring-gray-200');
            selectFile(event.dataTransfer?.files?.[0]);
        });
        window.addEventListener('fluxy-ai-context-ready', (event) => {
            state.context = event.detail || window.__fluxyAICommandContext || null;
            if (state.context?.auth?.currentUser) {
                window.FluxyAICommandCenter?.setUser(state.context.auth.currentUser);
            }
        });
        window.addEventListener('popstate', () => bootRoute({ force: true }));
    }

    function renderUserName() {
        if (!els.name) return;
        const user = state.user;
        const name = user?.displayName || user?.email?.split('@')[0] || 'there';
        els.name.textContent = name;
    }

    async function bootRoute(options = {}) {
        if (!state.user) return;
        const chatId = getRouteChatId();
        const routeKey = `${state.user.uid}:${chatId || 'home'}`;
        if (!options.force && state.bootedFor === routeKey) return;
        state.bootedFor = routeKey;
        if (chatId) {
            await loadChatSession(chatId);
        } else {
            await renderHome();
        }
    }

    async function renderHome(options = {}) {
        state.mode = 'home';
        state.currentChatId = null;
        state.currentChat = null;
        state.messageCount = 0;
        state.chatStarted = false;
        state.messageId = 0;
        state.bootedFor = state.user ? `${state.user.uid}:home` : null;
        els.workspace?.classList.remove('ai-chat-active');
        els.workspace?.classList.add('justify-center');
        els.workspace?.classList.remove('justify-start');
        els.appHeader?.classList.remove('ai-session-mode');
        els.homeTopbar?.classList.remove('hidden');
        els.sessionTopbar?.classList.add('hidden');
        els.sessionTopbar?.classList.remove('flex');
        els.newChat?.classList.add('hidden');
        els.newChat?.classList.remove('inline-flex');
        els.responseArea?.classList.add('hidden');
        if (els.responseArea) els.responseArea.innerHTML = '';
        els.chatThread = null;
        els.sessionPromptChips = null;
        els.historySection?.classList.remove('hidden');
        if (els.input) {
            els.input.rows = 5;
            els.input.style.height = '';
        }
        if (options.updateRoute) {
            history.pushState({}, '', getAIHomePath());
        }
        await loadRecentChats();
    }

    async function loadRecentChats() {
        if (!els.historyList || !state.user) return;
        const ds = getDataService();
        if (!ds?.getRecentAIChats) {
            renderHistoryEmpty('Recent AI chats are unavailable in this build.');
            return;
        }
        els.historyList.innerHTML = renderHistorySkeleton();
        try {
            const chats = await ds.getRecentAIChats(state.user.uid, 5);
            if (!chats.length) {
                renderHistoryEmpty('No recent AI chats yet. Start with a finance prompt above.');
                return;
            }
            els.historyList.innerHTML = chats.map(renderHistoryItem).join('');
            els.historyList.querySelectorAll('[data-ai-open-chat]').forEach(button => {
                button.addEventListener('click', () => openChatFromHistory(button.dataset.aiOpenChat));
            });
            els.historyList.querySelectorAll('[data-ai-delete-chat]').forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    openDeleteModal(button.dataset.aiDeleteChat);
                });
            });
        } catch (err) {
            renderHistoryEmpty('Could not load recent AI chats right now.');
        }
    }

    function renderHistorySkeleton() {
        return `
            <div class="rounded-2xl border border-gray-200 bg-white px-4 py-4 text-[13px] font-medium text-gray-500">
                Loading recent AI chats...
            </div>
        `;
    }

    function renderHistoryEmpty(message) {
        if (!els.historyList) return;
        els.historyList.innerHTML = `
            <div class="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-5 text-[13px] font-medium text-gray-500">
                ${escapeHtml(message)}
            </div>
        `;
    }

    function renderHistoryItem(chat) {
        const updated = formatRelativeTime(chat.updated_at || chat.last_activity_at || chat.created_at);
        const preview = chat.last_message_preview || chat.summary || 'Open this AI chat.';
        return `
            <div class="group rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition-all hover:border-gray-300 hover:shadow-md">
                <div class="flex items-start gap-3">
                    <button type="button" data-ai-open-chat="${escapeAttr(chat.id)}" class="min-w-0 flex-1 text-left">
                        <span class="flex items-center gap-2">
                            <span class="truncate text-[14px] font-extrabold text-gray-950">${escapeHtml(chat.title || 'AI chat')}</span>
                            <span class="hidden sm:inline-flex rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">${escapeHtml(chat.intent || 'finance')}</span>
                        </span>
                        <span class="mt-1 block truncate text-[13px] text-gray-500">${escapeHtml(preview)}</span>
                        <span class="mt-2 block text-[11px] font-bold text-gray-400">${escapeHtml(updated)}</span>
                    </button>
                    <button type="button" data-ai-delete-chat="${escapeAttr(chat.id)}" class="rounded-lg p-2 text-gray-400 opacity-100 transition-colors hover:bg-gray-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100" aria-label="Delete chat">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }

    async function openChatFromHistory(chatId) {
        if (!chatId) return;
        history.pushState({}, '', `${getAIHomePath()}?chat=${encodeURIComponent(chatId)}`);
        await loadChatSession(chatId);
    }

    async function loadChatSession(chatId) {
        const ds = getDataService();
        if (!state.user || !ds?.getAIChat || !ds?.getAIChatMessages) return;
        setSessionShell({ title: 'Loading AI chat...', chatId });
        try {
            const chat = await ds.getAIChat(state.user.uid, chatId);
            if (!chat || chat.status === 'deleted') {
                renderUnavailableChat('This chat is no longer available.');
                return;
            }
            if (isExpired(chat.expires_at)) {
                renderUnavailableChat('This chat is no longer available because it has expired.');
                return;
            }
            state.currentChat = chat;
            state.currentChatId = chat.id;
            state.messageCount = Number(chat.message_count || 0);
            setSessionShell({ title: chat.title || 'AI chat', chatId: chat.id });
            const messages = await ds.getAIChatMessages(state.user.uid, chat.id);
            renderStoredMessages(messages);
        } catch (err) {
            renderUnavailableChat('Could not load this AI chat right now.');
        }
    }

    function setSessionShell({ title, chatId }) {
        state.mode = 'session';
        state.currentChatId = chatId || state.currentChatId;
        state.chatStarted = true;
        els.workspace?.classList.add('ai-chat-active');
        els.workspace?.classList.remove('justify-center');
        els.workspace?.classList.add('justify-start');
        els.appHeader?.classList.add('ai-session-mode');
        els.homeTopbar?.classList.add('hidden');
        els.sessionTopbar?.classList.remove('hidden');
        els.sessionTopbar?.classList.add('flex');
        els.newChat?.classList.remove('hidden');
        els.newChat?.classList.add('inline-flex');
        els.responseArea?.classList.remove('hidden');
        els.historySection?.classList.add('hidden');
        if (els.sessionTitle) els.sessionTitle.textContent = title || 'AI chat';
        if (!els.chatThread) {
            els.responseArea.innerHTML = '<div id="ai-chat-thread" class="space-y-5"></div><div id="ai-session-prompt-chips" class="mt-5 flex flex-wrap gap-2"></div>';
            els.chatThread = document.getElementById('ai-chat-thread');
            els.sessionPromptChips = document.getElementById('ai-session-prompt-chips');
            renderSessionPromptChips();
        }
        if (els.input) els.input.rows = 2;
        autoGrowComposer();
    }

    function renderStoredMessages(messages) {
        const thread = ensureChatThread({ reset: true });
        if (!thread) return;
        state.messageId = 0;
        if (!messages.length) {
            thread.innerHTML = `
                <article class="flex justify-start">
                    <div class="max-w-full sm:max-w-[88%] rounded-2xl rounded-bl-md border border-gray-200 bg-white px-5 py-4 shadow-sm">
                        <p class="text-[14px] font-bold text-gray-900">No messages in this chat yet.</p>
                    </div>
                </article>
            `;
            return;
        }
        messages.forEach(message => renderStoredMessage(message));
        scrollToLatest(true);
    }

    function renderStoredMessage(message) {
        if (message.role === 'user') {
            appendUserMessage({ text: message.content || '', attachments: message.attachments || [], persist: false });
            return;
        }
        const structured = message.structured_answer;
        if (structured?.kind === 'document_detection') {
            renderDocumentDetection(structured.result || {}, null, null);
            return;
        }
        if (structured?.kind === 'finance_answer') {
            renderFinanceAnswer(structured.answer, structured.related_records || [], null);
            return;
        }
        renderAssistantMessage(null, `<p class="text-[14px] leading-relaxed text-gray-700">${escapeHtml(message.content || 'Fluxy AI response')}</p>`);
    }

    function renderUnavailableChat(message) {
        setSessionShell({ title: 'AI chat unavailable' });
        const thread = ensureChatThread({ reset: true });
        if (!thread) return;
        thread.innerHTML = `
            <article class="flex justify-start">
                <div class="max-w-full sm:max-w-[88%] rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50 px-5 py-4 shadow-sm">
                    <p class="text-[15px] font-bold text-amber-900">${escapeHtml(message)}</p>
                    <button type="button" data-ai-back-empty class="mt-4 inline-flex items-center justify-center rounded-xl bg-[#0B0F19] px-4 py-2.5 text-[13px] font-bold text-white">Back to AI Home</button>
                </div>
            </article>
        `;
        thread.querySelector('[data-ai-back-empty]')?.addEventListener('click', () => renderHome({ updateRoute: true }));
    }

    function renderPrompts() {
        const set = PROMPT_SETS[state.promptSetIndex];
        if (!els.promptGrid || !set) return;
        els.promptGrid.innerHTML = set.prompts.map(([title, prompt], index) => `
            <button type="button" class="group min-h-[108px] sm:min-h-[126px] text-left rounded-xl border border-gray-200 bg-white p-3 sm:p-4 hover:border-gray-300 hover:shadow-sm transition-all" data-prompt="${escapeAttr(prompt)}">
                <span class="flex h-full flex-col justify-between gap-4 sm:gap-6">
                    <span class="block text-[13px] sm:text-[14px] font-semibold leading-snug text-gray-950">${escapeHtml(title)}</span>
                    <span class="flex items-center justify-between gap-3">
                        <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 group-hover:text-[#EA580C]">
                            ${promptIcon(index)}
                        </span>
                        <span class="truncate text-[11px] font-semibold text-gray-400">${escapeHtml(set.label)}</span>
                    </span>
                </span>
            </button>
        `).join('');
        els.promptGrid.querySelectorAll('[data-prompt]').forEach(button => {
            button.addEventListener('click', () => submitText(button.dataset.prompt));
        });
    }

    function promptIcon(index) {
        const icons = [
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m7 14 3-3 3 2 5-6"/></svg>',
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 9v4"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 17h.01"/></svg>',
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 2v4"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2" stroke-width="2"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 10h18"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 16h6"/></svg>',
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 19V5"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 17V9"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 17V7"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16 17v-5"/><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 17V4"/></svg>',
        ];
        return icons[index % icons.length];
    }

    async function submitComposer(event) {
        event.preventDefault();
        const text = String(els.input?.value || '').trim();
        if (state.file) {
            await detectSelectedFile(text);
            return;
        }
        await submitText(text);
    }

    async function submitText(text) {
        const prompt = String(text || '').trim();
        if (!prompt || state.busy) return;
        clearError();
        setBusy(true, 'thinking');
        let loadingId = null;
        try {
            await ensureActiveChat(prompt);
            appendUserMessage({ text: prompt });
            await saveChatMessage({
                role: 'user',
                content: prompt,
                attachments: [],
            });
            loadingId = appendAssistantLoading();
            if (els.input) els.input.value = '';
            updateCharCount();
            autoGrowComposer();
            scrollToLatest(true);
            const token = await getAuthToken();
            const response = await fetch('/api/v1/brain/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    message: prompt,
                    page_context: 'ai_command_center',
                    period: getCurrentPeriod(),
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || body.success === false) {
                renderErrorResult(body?.error?.message || 'Fluxy AI could not read your finance data right now.', loadingId);
                await saveAssistantMessage({
                    content: body?.error?.message || 'Fluxy AI could not read your finance data right now.',
                    structured_answer: null,
                    intent: 'error',
                });
                return;
            }
            renderFinanceAnswer(body.answer, body.related_records || [], loadingId);
            await saveAssistantMessage({
                content: body.answer?.direct_answer || 'Fluxy AI returned a finance analysis.',
                structured_answer: {
                    kind: 'finance_answer',
                    answer: body.answer || null,
                    related_records: body.related_records || [],
                },
                intent: body.answer?.intent || 'finance_analysis',
                title: deriveTitle(prompt, body.answer?.intent),
                summary: body.answer?.direct_answer || '',
            });
        } catch (err) {
            if (loadingId) {
                renderErrorResult(err?.message || 'Fluxy AI could not connect. Please try again.', loadingId);
            } else {
                setError(err?.message || 'Fluxy AI could not connect. Please try again.');
            }
        } finally {
            setBusy(false);
        }
    }

    async function detectSelectedFile(userIntent) {
        if (!state.file || state.busy) return;
        const file = state.file;
        clearError();
        setBusy(true, 'detecting');
        let loadingId = null;
        try {
            const prompt = userIntent || 'Please review this finance document.';
            await ensureActiveChat(prompt);
            appendUserMessage({ text: prompt, file });
            await saveChatMessage({
                role: 'user',
                content: prompt,
                attachments: [serializeAttachment(file)],
            });
            loadingId = appendAssistantLoading();
            if (els.input) els.input.value = '';
            updateCharCount();
            autoGrowComposer();
            clearFile();
            scrollToLatest(true);
            const token = await getAuthToken();
            const response = await fetch('/api/v1/ai/detect-document', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    file_name: file.name,
                    mime_type: file.type || guessMimeFromName(file.name),
                    size_bytes: file.size,
                    page_context: 'ai_command_center',
                    user_intent: userIntent || null,
                    locale: 'id-ID',
                    currency_hint: 'IDR',
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || body.success === false) {
                renderDocumentError(body?.message || body?.error?.message || 'Fluxy AI could not detect this document.', loadingId);
                await saveAssistantMessage({
                    content: body?.message || body?.error?.message || 'Fluxy AI could not detect this document.',
                    structured_answer: null,
                    intent: 'document_error',
                });
                return;
            }
            renderDocumentDetection(body, loadingId, file);
            await saveAssistantMessage({
                content: body.message || 'Fluxy AI detected a document.',
                structured_answer: {
                    kind: 'document_detection',
                    result: body,
                },
                intent: body.detected_type || 'document_detection',
                title: deriveTitle(prompt, body.detected_type),
                summary: body.message || '',
            });
        } catch (err) {
            if (loadingId) {
                renderDocumentError(err?.message || 'Could not detect this document right now.', loadingId);
            } else {
                setError(err?.message || 'Could not detect this document right now.');
            }
        } finally {
            setBusy(false);
        }
    }

    async function ensureActiveChat(prompt) {
        if (state.currentChatId && state.mode === 'session') return state.currentChatId;
        const ds = getDataService();
        if (!state.user || !ds?.createAIChat) throw new Error('AI chat history is not ready yet.');
        const title = deriveTitle(prompt);
        const ref = await ds.createAIChat(state.user.uid, {
            title,
            summary: '',
            last_message_preview: prompt,
            intent: inferIntent(prompt),
            message_count: 0,
        });
        const chat = await ds.getAIChat(state.user.uid, ref.id);
        state.currentChatId = ref.id;
        state.currentChat = chat || { id: ref.id, title };
        state.messageCount = 0;
        history.pushState({}, '', `${getAIHomePath()}?chat=${encodeURIComponent(ref.id)}`);
        state.bootedFor = `${state.user.uid}:${ref.id}`;
        setSessionShell({ title, chatId: ref.id });
        ensureChatThread({ reset: true });
        return ref.id;
    }

    async function saveChatMessage(data) {
        const ds = getDataService();
        if (!state.user || !state.currentChatId || !ds?.addAIChatMessage) return;
        await ds.addAIChatMessage(state.user.uid, state.currentChatId, data);
        state.messageCount += 1;
        const patch = {
            title: state.currentChat?.title || deriveTitle(data.content),
            summary: state.currentChat?.summary || '',
            last_message_preview: truncateText(data.content, 180),
            intent: state.currentChat?.intent || inferIntent(data.content),
            message_count: state.messageCount,
        };
        await ds.updateAIChatMeta(state.user.uid, state.currentChatId, patch);
        state.currentChat = { ...(state.currentChat || {}), ...patch, id: state.currentChatId };
        if (els.sessionTitle) els.sessionTitle.textContent = patch.title;
    }

    async function saveAssistantMessage({ content, structured_answer, intent, title, summary }) {
        const ds = getDataService();
        if (!state.user || !state.currentChatId || !ds?.addAIChatMessage) return;
        await ds.addAIChatMessage(state.user.uid, state.currentChatId, {
            role: 'assistant',
            content: content || '',
            structured_answer: structured_answer || null,
            attachments: [],
        });
        state.messageCount += 1;
        const nextTitle = title || state.currentChat?.title || deriveTitle(content);
        const patch = {
            title: nextTitle,
            summary: truncateText(summary || content || '', 260),
            last_message_preview: truncateText(content || '', 180),
            intent: intent || state.currentChat?.intent || 'finance_analysis',
            message_count: state.messageCount,
        };
        await ds.updateAIChatMeta(state.user.uid, state.currentChatId, patch);
        state.currentChat = { ...(state.currentChat || {}), ...patch, id: state.currentChatId };
        if (els.sessionTitle) els.sessionTitle.textContent = patch.title;
    }

    function serializeAttachment(file) {
        if (!file) return null;
        return {
            file_name: file.name,
            mime_type: file.type || guessMimeFromName(file.name),
            size_bytes: file.size,
        };
    }

    function selectFile(file) {
        if (!file) return;
        const error = validateFile(file);
        if (error) {
            setError(error);
            clearFile();
            return;
        }
        clearError();
        clearFile();
        state.file = file;
        if (file.type?.startsWith('image/')) {
            state.previewUrl = URL.createObjectURL(file);
        }
        renderFilePreview();
    }

    function validateFile(file) {
        const ext = getExtension(file.name);
        const mime = file.type || guessMimeFromName(file.name);
        if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(mime)) {
            return 'Unsupported file type. Please upload a JPG, PNG, WEBP, PDF, or CSV financial document.';
        }
        if (file.size > MAX_FILE_BYTES) {
            return `File is too large (${formatBytes(file.size)}). Max size is ${formatBytes(MAX_FILE_BYTES)}.`;
        }
        return null;
    }

    function renderFilePreview() {
        if (!els.filePreview || !state.file) return;
        const file = state.file;
        const thumb = state.previewUrl
            ? `<img src="${state.previewUrl}" alt="Selected document preview" class="h-14 w-14 rounded-lg object-cover border border-gray-200 bg-white">`
            : `<div class="h-14 w-14 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-[#EA580C]">${fileIcon(file)}</div>`;
        els.filePreview.classList.remove('hidden');
        els.filePreview.innerHTML = `
            <div class="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                ${thumb}
                <div class="min-w-0 flex-1">
                    <p class="truncate text-[13px] font-bold text-gray-900">${escapeHtml(file.name)}</p>
                    <p class="mt-0.5 text-[12px] text-gray-500">${escapeHtml(file.type || guessMimeFromName(file.name))} - ${formatBytes(file.size)}</p>
                </div>
                <button id="ai-remove-file" type="button" class="rounded-lg p-2 text-gray-400 hover:text-gray-700 hover:bg-white transition-colors" aria-label="Remove selected file">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18 18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        `;
        document.getElementById('ai-remove-file')?.addEventListener('click', clearFile);
    }

    function clearFile() {
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.file = null;
        state.previewUrl = null;
        if (els.fileInput) els.fileInput.value = '';
        if (els.imageInput) els.imageInput.value = '';
        if (els.filePreview) {
            els.filePreview.classList.add('hidden');
            els.filePreview.innerHTML = '';
        }
    }

    function ensureChatThread(options = {}) {
        if (!els.responseArea) return null;
        if (!els.chatThread || options.reset) {
            els.responseArea.classList.remove('hidden');
            els.responseArea.innerHTML = '<div id="ai-chat-thread" class="space-y-5"></div><div id="ai-session-prompt-chips" class="mt-5 flex flex-wrap gap-2"></div>';
            els.chatThread = document.getElementById('ai-chat-thread');
            els.sessionPromptChips = document.getElementById('ai-session-prompt-chips');
            renderSessionPromptChips();
        }
        if (!state.chatStarted) {
            state.chatStarted = true;
            els.workspace?.classList.add('ai-chat-active');
            els.workspace?.classList.remove('justify-center');
            els.workspace?.classList.add('justify-start');
            if (els.input) els.input.rows = 3;
        }
        return els.chatThread;
    }

    function appendUserMessage({ text, file, attachments }) {
        const thread = ensureChatThread();
        if (!thread) return null;
        const id = nextMessageId('user');
        const firstAttachment = file ? serializeAttachment(file) : Array.isArray(attachments) ? attachments[0] : null;
        const fileMeta = firstAttachment ? `
            <div class="mt-3 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-left">
                <p class="truncate text-[12px] font-bold text-gray-900">${escapeHtml(firstAttachment.file_name || 'Attachment')}</p>
                <p class="mt-0.5 text-[11px] text-gray-500">${escapeHtml(firstAttachment.mime_type || 'file')} - ${formatBytes(Number(firstAttachment.size_bytes || 0))}</p>
            </div>
        ` : '';
        thread.insertAdjacentHTML('beforeend', `
            <article id="${id}" class="flex justify-end">
                <div class="max-w-[82%] sm:max-w-[70%] rounded-2xl rounded-br-md bg-[#0B0F19] px-4 py-3 text-white shadow-sm">
                    <p class="whitespace-pre-wrap text-[14px] leading-relaxed">${escapeHtml(text)}</p>
                    ${fileMeta}
                </div>
            </article>
        `);
        return id;
    }

    function appendAssistantLoading() {
        const thread = ensureChatThread();
        if (!thread) return null;
        clearSessionPromptChips();
        const id = nextMessageId('assistant');
        thread.insertAdjacentHTML('beforeend', `
            <article id="${id}" class="flex justify-start">
                <div class="max-w-full sm:max-w-[88%] rounded-2xl rounded-bl-md border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <div class="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-700">
                        <span>FluxyOS thinking</span>
                        <span class="inline-flex items-center gap-1" aria-hidden="true">
                            <span class="h-1.5 w-1.5 rounded-full bg-[#EA580C] animate-bounce"></span>
                            <span class="h-1.5 w-1.5 rounded-full bg-[#EA580C] animate-bounce [animation-delay:120ms]"></span>
                            <span class="h-1.5 w-1.5 rounded-full bg-[#EA580C] animate-bounce [animation-delay:240ms]"></span>
                        </span>
                    </div>
                </div>
            </article>
        `);
        scrollToLatest(true);
        return id;
    }

    function renderAssistantMessage(messageId, html, tone) {
        const thread = ensureChatThread();
        if (!thread) return null;
        const id = messageId || nextMessageId('assistant');
        const existing = document.getElementById(id);
        const autoScroll = true;
        const toneClass = {
            error: 'border-red-200 bg-red-50',
            warning: 'border-amber-200 bg-amber-50',
            neutral: 'border-gray-200 bg-white',
        }[tone] || 'border-gray-200 bg-white';
        const markup = `
            <article id="${id}" class="flex justify-start">
                <div class="max-w-full sm:max-w-[88%] rounded-2xl rounded-bl-md border ${toneClass} px-5 py-4 shadow-sm">
                    ${html}
                </div>
            </article>
        `;
        if (existing) {
            existing.outerHTML = markup;
        } else {
            thread.insertAdjacentHTML('beforeend', markup);
        }
        scrollToLatest(autoScroll);
        return id;
    }

    function renderSessionPromptChips(context) {
        if (!els.sessionPromptChips) return;
        const chips = getSessionPromptChips(context);
        if (!chips.length) {
            clearSessionPromptChips();
            return;
        }
        els.sessionPromptChips.classList.remove('hidden');
        els.sessionPromptChips.innerHTML = chips.map(([label, prompt]) => `
            <button type="button" data-ai-session-prompt="${escapeAttr(prompt)}" class="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-[#EA580C]">
                ${escapeHtml(label)}
            </button>
        `).join('');
        els.sessionPromptChips.querySelectorAll('[data-ai-session-prompt]').forEach(button => {
            button.addEventListener('click', () => submitText(button.dataset.aiSessionPrompt || ''));
        });
        if (state.chatStarted) scrollToLatest(true);
    }

    function clearSessionPromptChips() {
        if (!els.sessionPromptChips) return;
        els.sessionPromptChips.innerHTML = '';
        els.sessionPromptChips.classList.add('hidden');
    }

    function getSessionPromptChips(context) {
        const followUps = Array.isArray(context?.follow_up_questions)
            ? context.follow_up_questions.filter(Boolean).slice(0, 4)
            : [];
        if (followUps.length) {
            return followUps.map(question => [question, question]);
        }
        const intent = String(context?.intent || '').toLowerCase();
        const byIntent = {
            finance_health: [
                ['What should I fix first?', 'What should I fix first?'],
                ['Why is OpEx high?', 'Why is OpEx high?'],
                ['Show upcoming bills', 'Show upcoming bills.'],
            ],
            ledger_cleanup: [
                ['Find missing receipts', 'Find missing receipts.'],
                ['Can I trust my ledger?', 'Can I trust my ledger?'],
                ['Show largest expenses', 'Show my largest expenses.'],
            ],
            bills_risk: [
                ['Show upcoming bills', 'Show upcoming bills.'],
                ['Which bills are risky?', 'Which bills are risky?'],
                ['Check cash pressure', 'Can I cover upcoming bills?'],
            ],
            revenue_sync: [
                ['Revenue this month', 'What was my revenue this month?'],
                ['Strongest revenue source', 'Which revenue source is strongest?'],
                ['Revenue changes', 'What revenue changed this month?'],
            ],
            bills: [
                ['Show upcoming bills', 'Show upcoming bills.'],
                ['Check cash pressure', 'Can I cover upcoming bills?'],
                ['Find risky bills', 'Which bills are risky?'],
            ],
            ledger: [
                ['Find missing receipts', 'Find missing receipts.'],
                ['Review ledger quality', 'Can I trust my ledger?'],
                ['Show largest expenses', 'Show my largest expenses.'],
            ],
            subscriptions: [
                ['Review subscription costs', 'Review subscription costs.'],
                ['Upcoming renewals', 'Which subscriptions renew soon?'],
                ['Recurring costs', 'Which recurring costs should I review?'],
            ],
        };
        return byIntent[intent] || [
            ['Analyze my business health', 'How healthy is my business this month?'],
            ['Summarize this month', 'Summarize this month.'],
            ['Show upcoming bills', 'Show upcoming bills.'],
            ['Find missing receipts', 'Find missing receipts.'],
        ];
    }

    function documentFollowUps(result) {
        const action = result?.recommended_action;
        const destination = result?.recommended_destination;
        if (action === 'review_and_save_to_bills' || destination === 'bills') {
            return ['Show upcoming bills.', 'Which bills are risky?', 'Can I cover upcoming bills?'];
        }
        if (action === 'review_as_expense' || action === 'review_transaction' || destination === 'ledger') {
            return ['Find missing receipts.', 'Can I trust my ledger?', 'Show my largest expenses.'];
        }
        if (action === 'review_as_subscription' || destination === 'subscriptions') {
            return ['Review subscription costs.', 'Which subscriptions renew soon?', 'Which recurring costs should I review?'];
        }
        if (destination === 'revenue_sync') {
            return ['What was my revenue this month?', 'Which revenue source is strongest?', 'What revenue changed this month?'];
        }
        return ['Analyze my business health.', 'Summarize this month.', 'What should I fix first?'];
    }

    function nextMessageId(prefix) {
        state.messageId += 1;
        return `ai-${prefix}-message-${state.messageId}`;
    }

    function shouldAutoScroll() {
        const scroller = getActiveScroller();
        if (!scroller || !state.chatStarted) return true;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 280;
    }

    function scrollToLatest(force) {
        if (!force) return;
        const scroller = getActiveScroller();
        if (!scroller) return;
        requestAnimationFrame(() => {
            const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
            if (scroller === document.documentElement || scroller === document.body) {
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
                return;
            }
            scroller.scrollTo({ top: scroller.scrollHeight, behavior });
        });
    }

    function getActiveScroller() {
        return els.scrollContainer || document.documentElement;
    }

    function renderFinanceAnswer(answer, relatedRecords, messageId) {
        if (!answer) {
            renderErrorResult('Fluxy AI did not return a usable finance answer.', messageId);
            return;
        }
        const answerType = answer.answer_type || 'analysis';
        const confidence = Number(answer.confidence);
        const hasConfidence = Number.isFinite(confidence);
        const lowConfidence = hasConfidence && confidence < 0.7;
        const stateBadge = renderAnalystStateBadge(answerType, lowConfidence);
        const confidenceBadge = hasConfidence
            ? `<span class="rounded-full border ${lowConfidence ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-gray-200 text-gray-500 bg-white'} px-2.5 py-1 text-[11px] font-medium">${Math.round(confidence * 100)}% confidence</span>`
            : '';
        const keyNumbers = Array.isArray(answer.key_numbers) && answer.key_numbers.length
            ? `<section class="mt-5"><p class="text-[12px] font-semibold text-gray-500">Key numbers</p><div class="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">${answer.key_numbers.map(renderKeyNumber).join('')}</div></section>`
            : '';
        const insights = Array.isArray(answer.insights) && answer.insights.length
            ? `<section class="mt-5"><p class="text-[12px] font-semibold text-gray-500">What this means</p><div class="mt-2 space-y-3">${answer.insights.map(renderInsight).join('')}</div></section>`
            : '';
        const actions = Array.isArray(answer.recommended_actions) && answer.recommended_actions.length
            ? `<section class="mt-5"><p class="text-[12px] font-semibold text-gray-500">Recommended next actions</p><div class="mt-2 grid gap-3">${answer.recommended_actions.slice(0, 3).map(renderAction).join('')}</div></section>`
            : '';
        const limitations = Array.isArray(answer.limitations) && answer.limitations.length
            ? `<section class="mt-5 rounded-xl border ${lowConfidence ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'} px-4 py-3"><p class="text-[12px] font-semibold ${lowConfidence ? 'text-amber-900' : 'text-gray-700'}">Risk or limitation</p><div class="mt-2 space-y-1">${answer.limitations.map(item => `<p class="text-[12px] leading-relaxed ${lowConfidence ? 'text-amber-800' : 'text-gray-500'}">${escapeHtml(item)}</p>`).join('')}</div></section>`
            : '';
        const records = Array.isArray(relatedRecords) && relatedRecords.length
            ? `<div class="mt-5 rounded-xl border border-gray-200 overflow-hidden"><div class="px-4 py-3 bg-gray-50 border-b border-gray-200 text-[12px] font-bold text-gray-700">Related records</div>${relatedRecords.slice(0, 5).map(renderRelatedRecord).join('')}</div>`
            : '';
        const renderedId = renderAssistantMessage(messageId, `
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="flex flex-wrap items-center gap-2">
                        ${stateBadge}
                        <span class="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">${escapeHtml(answer.period?.label || 'Selected period')}</span>
                        <span class="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500">${escapeHtml(toLabel(answer.intent || 'finance_analysis'))}</span>
                        ${confidenceBadge}
                    </div>
                </div>
                <p class="mt-4 text-[17px] font-semibold leading-relaxed text-gray-950">${escapeHtml(answer.direct_answer || '')}</p>
                ${keyNumbers}
                ${insights}
                ${limitations}
                ${actions}
                ${records}
        `, answerType === 'refusal' || answerType === 'clarification' ? 'warning' : 'neutral');
        wireFollowUpActions(renderedId);
        renderSessionPromptChips(answer);
    }

    function renderKeyNumber(item) {
        const statusClass = {
            good: 'border-green-200 bg-green-50',
            warning: 'border-amber-200 bg-amber-50',
            critical: 'border-red-200 bg-red-50',
            neutral: 'border-gray-200 bg-white',
        }[item.status] || 'border-gray-200';
        const statusDot = {
            good: 'bg-green-500',
            warning: 'bg-amber-500',
            critical: 'bg-red-500',
            neutral: 'bg-gray-300',
        }[item.status] || 'bg-gray-300';
        return `
            <div class="rounded-xl border ${statusClass} px-4 py-3">
                <p class="flex items-center gap-2 text-[11px] font-medium text-gray-500"><span class="h-1.5 w-1.5 rounded-full ${statusDot}"></span>${escapeHtml(item.label)}</p>
                <p class="mt-1 text-[18px] font-extrabold text-gray-950 break-words">${escapeHtml(item.formatted_value)}</p>
            </div>
        `;
    }

    function renderInsight(item) {
        const severityClass = {
            critical: 'border-red-200 bg-red-50',
            warning: 'border-amber-200 bg-amber-50',
            info: 'border-gray-200 bg-white',
        }[item.severity] || 'border-gray-200 bg-white';
        const evidence = Array.isArray(item.evidence) && item.evidence.length
            ? `<div class="mt-3 rounded-lg border border-gray-200 overflow-hidden">${item.evidence.slice(0, 3).map(renderRelatedRecord).join('')}</div>`
            : '';
        return `
            <div class="rounded-xl border ${severityClass} px-4 py-3">
                <p class="text-[14px] font-semibold text-gray-900">${escapeHtml(item.title)}</p>
                <p class="mt-1 text-[13px] leading-relaxed text-gray-500">${escapeHtml(item.description)}</p>
                ${evidence}
            </div>
        `;
    }

    function renderAction(item) {
        const priorityClass = {
            high: 'border-red-200 text-red-700 bg-red-50',
            medium: 'border-amber-200 text-amber-700 bg-amber-50',
            low: 'border-gray-200 text-gray-500 bg-gray-50',
        }[item.priority] || 'border-gray-200 text-gray-500 bg-gray-50';
        return `
            <div class="rounded-xl border border-gray-200 px-4 py-3">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <p class="text-[14px] font-semibold text-gray-900">${escapeHtml(item.title)}</p>
                    <span class="inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityClass}">${escapeHtml(toLabel(item.priority || 'next'))}</span>
                </div>
                <p class="mt-1 text-[13px] leading-relaxed text-gray-500">${escapeHtml(item.description)}</p>
            </div>
        `;
    }

    function renderAnalystStateBadge(answerType, lowConfidence) {
        if (lowConfidence) {
            return '<span class="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Low confidence</span>';
        }
        const config = {
            analysis: ['Analyst answer', 'border-green-200 bg-green-50 text-green-700'],
            lookup: ['Data lookup', 'border-blue-200 bg-blue-50 text-blue-700'],
            refusal: ['Finance scope only', 'border-amber-200 bg-amber-50 text-amber-700'],
            clarification: ['Needs clarification', 'border-amber-200 bg-amber-50 text-amber-700'],
        }[answerType] || ['Analyst answer', 'border-gray-200 bg-white text-gray-500'];
        return `<span class="rounded-full border px-2.5 py-1 text-[11px] font-semibold ${config[1]}">${config[0]}</span>`;
    }

    function wireFollowUpActions(messageId) {
        if (!messageId) return;
        const root = document.getElementById(messageId);
        root?.querySelectorAll('[data-ai-follow-up]').forEach(button => {
            button.addEventListener('click', () => submitText(button.dataset.aiFollowUp || button.textContent || ''));
        });
    }

    function renderRelatedRecord(record) {
        const name = record.vendor_name || record.label || 'Record';
        const amount = record.formatted_amount || record.formatted_value || '';
        return `
            <div class="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0 bg-white">
                <span class="min-w-0 truncate text-[12px] font-semibold text-gray-700">${escapeHtml(name)}</span>
                <strong class="flex-shrink-0 text-[12px] font-mono text-gray-900">${escapeHtml(amount)}</strong>
            </div>
        `;
    }

    function renderDocumentDetection(result, messageId, file) {
        const actionId = messageId || nextMessageId('assistant');
        const confidence = Math.round((Number(result.confidence) || 0) * 100);
        const lowConfidence = confidence < 70;
        const preview = result.extracted_preview && Object.keys(result.extracted_preview).length
            ? `<div class="mt-4 rounded-xl border border-gray-200 overflow-hidden">${Object.entries(result.extracted_preview).filter(([, value]) => value != null && value !== '').map(([key, value]) => `
                <div class="flex items-center justify-between gap-3 border-b border-gray-100 last:border-b-0 px-4 py-2.5">
                    <span class="text-[12px] font-bold text-gray-500">${escapeHtml(toLabel(key))}</span>
                    <strong class="min-w-0 text-right text-[12px] font-semibold text-gray-900 break-words">${escapeHtml(formatPreviewValue(value))}</strong>
                </div>
            `).join('')}</div>`
            : '';
        const warnings = Array.isArray(result.warnings) && result.warnings.length
            ? `<div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">${result.warnings.map(item => `<p class="text-[12px] font-medium text-amber-800">${escapeHtml(item)}</p>`).join('')}</div>`
            : '';
        const action = renderDocumentAction(result, actionId, file);

        renderAssistantMessage(actionId, `
                <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Detected document</p>
                        <h2 class="mt-1 text-[22px] font-extrabold text-gray-950">${escapeHtml(toLabel(result.detected_type || 'unknown_financial_document'))}</h2>
                        <p class="mt-2 text-[14px] leading-relaxed text-gray-600">${escapeHtml(result.message || '')}</p>
                    </div>
                    <div class="rounded-xl border ${lowConfidence ? 'border-amber-200' : 'border-gray-200'} px-4 py-3 text-right">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Confidence</p>
                        <p class="text-[24px] font-extrabold text-gray-950">${confidence}%</p>
                    </div>
                </div>
                <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="rounded-xl border border-gray-200 px-4 py-3">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Destination</p>
                        <p class="mt-1 text-[15px] font-bold text-gray-900">${escapeHtml(toLabel(result.recommended_destination || 'ai_review'))}</p>
                    </div>
                    <div class="rounded-xl border border-gray-200 px-4 py-3">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">Recommended action</p>
                        <p class="mt-1 text-[15px] font-bold text-gray-900">${escapeHtml(toLabel(result.recommended_action || 'ask_user'))}</p>
                    </div>
                </div>
                ${preview}
                ${warnings}
                ${action}
        `);
        wireDocumentActions(result, actionId, file);
        renderSessionPromptChips({
            intent: result.recommended_destination || result.detected_type || 'document_detection',
            follow_up_questions: documentFollowUps(result),
        });
    }

    function renderDocumentAction(result, messageId, file) {
        const action = result.recommended_action;
        if (action === 'refuse') return '';
        if (!file && ['review_and_save_to_bills', 'review_as_expense', 'review_transaction'].includes(action)) {
            return `
                <div class="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <p class="text-[12px] font-medium text-gray-500">Upload the file again to open the review workflow. FluxyOS does not store raw document contents in chat history.</p>
                </div>
            `;
        }
        const label = {
            review_and_save_to_bills: 'Review and Save to Bills',
            review_as_expense: 'Review as Expense',
            review_transaction: 'Review Transaction',
            review_as_subscription: 'Open Subscriptions',
            review_csv_import: 'Review CSV Import',
            ask_user: 'Choose Destination',
        }[action] || 'Review';
        return `
            <div class="mt-5 flex flex-col sm:flex-row gap-3">
                <button type="button" data-ai-primary-document-action="${escapeAttr(messageId || '')}" class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B0F19] px-4 py-3 text-[13px] font-bold text-white hover:bg-gray-800 transition-colors">
                    ${escapeHtml(label)}
                </button>
                <button type="button" data-ai-clear-document="${escapeAttr(messageId || '')}" class="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 transition-colors">
                    Dismiss
                </button>
            </div>
        `;
    }

    function wireDocumentActions(result, messageId, file) {
        const root = messageId ? document.getElementById(messageId) : document;
        root?.querySelector(`[data-ai-clear-document="${cssEscape(messageId || '')}"]`)?.addEventListener('click', () => {
            root.remove();
        });
        root?.querySelector(`[data-ai-primary-document-action="${cssEscape(messageId || '')}"]`)?.addEventListener('click', () => {
            const action = result.recommended_action;
            const type = result.detected_type;
            if (['review_and_save_to_bills'].includes(action) || ['bill', 'invoice'].includes(type)) {
                openExistingReview('bill', file);
                return;
            }
            if (['review_as_expense', 'review_transaction'].includes(action) || ['receipt', 'bank_statement', 'payment_screenshot'].includes(type)) {
                openExistingReview('transaction', file);
                return;
            }
            if (action === 'review_csv_import') {
                window.location.href = '/ledger';
                return;
            }
            if (action === 'review_as_subscription') {
                window.location.href = '/subscription';
                return;
            }
            if (result.recommended_destination === 'revenue_sync') {
                window.location.href = '/revenue-sync';
            }
        });
    }

    function openExistingReview(mode, file) {
        if (!file) return;
        if (typeof window.openScanDrawerWithFile === 'function') {
            window.openScanDrawerWithFile(mode, file);
            return;
        }
        if (mode === 'bill' && typeof window.openScanBillDrawer === 'function') {
            window.openScanBillDrawer();
            return;
        }
        if (mode === 'transaction' && typeof window.openScanTransactionDrawer === 'function') {
            window.openScanTransactionDrawer();
        }
    }

    function renderErrorResult(message, messageId) {
        renderAssistantMessage(messageId, `
            <p class="text-[15px] font-bold text-red-900">Fluxy AI could not finish that.</p>
            <p class="mt-1 text-[13px] text-red-700">${escapeHtml(message)}</p>
        `, 'error');
    }

    function renderDocumentError(message, messageId) {
        renderAssistantMessage(messageId, `
            <p class="text-[15px] font-bold text-red-900">Document check failed</p>
            <p class="mt-1 text-[13px] text-red-700">${escapeHtml(message)}</p>
        `, 'error');
    }

    function openDeleteModal(chatId) {
        if (!chatId || !els.deleteModal) return;
        state.pendingDeleteChatId = chatId;
        els.deleteModal.classList.remove('hidden');
        els.deleteModal.classList.add('flex');
    }

    function closeDeleteModal() {
        state.pendingDeleteChatId = null;
        els.deleteModal?.classList.add('hidden');
        els.deleteModal?.classList.remove('flex');
    }

    async function confirmDeleteChat() {
        const chatId = state.pendingDeleteChatId;
        const ds = getDataService();
        if (!chatId || !state.user || !ds?.softDeleteAIChat) return;
        if (els.deleteConfirm) els.deleteConfirm.disabled = true;
        try {
            await ds.softDeleteAIChat(state.user.uid, chatId);
            closeDeleteModal();
            window.showToast?.('AI chat deleted.', 'success');
            if (state.currentChatId === chatId) {
                await renderHome({ updateRoute: true });
            } else {
                await loadRecentChats();
            }
        } catch (err) {
            window.showToast?.('Could not delete this chat.', 'error');
        } finally {
            if (els.deleteConfirm) els.deleteConfirm.disabled = false;
        }
    }

    function setBusy(busy, mode) {
        state.busy = busy;
        if (els.send) els.send.disabled = busy;
        if (els.input) els.input.disabled = busy;
        if (els.attachBtn) els.attachBtn.disabled = busy;
        if (els.imageBtn) els.imageBtn.disabled = busy;
        if (busy && els.send) {
            els.send.setAttribute('aria-label', mode === 'detecting' ? 'Detecting document' : 'Fluxy AI thinking');
        } else if (els.send) {
            els.send.setAttribute('aria-label', 'Send to Fluxy AI');
        }
    }

    function getDataService() {
        return state.context?.ds || window.__fluxyAICommandContext?.ds || null;
    }

    function getRouteChatId() {
        const params = new URLSearchParams(window.location.search);
        const queryId = params.get('chat');
        if (queryId) return queryId;
        const hash = window.location.hash || '';
        const match = hash.match(/chat=([^&]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    function getAIHomePath() {
        return window.location.pathname || '/ai';
    }

    function deriveTitle(text, intent) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        const lower = clean.toLowerCase();
        if (intent === 'bill' || intent === 'invoice') return 'Document review';
        if (lower.includes('health')) return 'Business health this month';
        if (lower.includes('upcoming bill') || lower.includes('bill')) return 'Upcoming bill risk';
        if (lower.includes('receipt')) return 'Missing receipts';
        if (lower.includes('opex') || lower.includes('expense')) return 'OpEx review';
        if (lower.includes('subscription')) return 'Subscription costs';
        if (lower.includes('revenue')) return 'Revenue review';
        return truncateText(clean || 'AI chat', 64);
    }

    function inferIntent(text) {
        const lower = String(text || '').toLowerCase();
        if (lower.includes('receipt')) return 'ledger_cleanup';
        if (lower.includes('bill')) return 'bills_risk';
        if (lower.includes('subscription')) return 'subscriptions';
        if (lower.includes('revenue')) return 'revenue_sync';
        if (lower.includes('health') || lower.includes('margin') || lower.includes('opex')) return 'finance_health';
        return 'finance_analysis';
    }

    function autoGrowComposer() {
        if (!els.input) return;
        els.input.style.height = 'auto';
        const max = state.mode === 'session' ? 132 : 220;
        const next = Math.min(els.input.scrollHeight, max);
        els.input.style.height = `${next}px`;
        els.input.style.overflowY = els.input.scrollHeight > max ? 'auto' : 'hidden';
    }

    async function getAuthToken() {
        const auth = state.context?.auth || window.__fluxyAICommandContext?.auth;
        const user = auth?.currentUser || state.user;
        if (!user) throw new Error('Please sign in again before using Fluxy AI.');
        return user.getIdToken();
    }

    function getCurrentPeriod() {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { type: 'this_month', start_date: toDateKey(start), end_date: toDateKey(end) };
    }

    function toDateKey(date) {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function updateCharCount() {
        const len = String(els.input?.value || '').length;
        if (els.charCount) els.charCount.textContent = `${len}/${MAX_CHARS}`;
    }

    function setError(message) {
        if (!els.error) return;
        els.error.textContent = message;
        els.error.classList.remove('hidden');
    }

    function clearError() {
        if (!els.error) return;
        els.error.textContent = '';
        els.error.classList.add('hidden');
    }

    function fileIcon(file) {
        const ext = getExtension(file.name);
        if (ext === 'csv') return '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4"></path></svg>';
        return '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6M7 3h7l5 5v13H7z"></path></svg>';
    }

    function getExtension(name) {
        return String(name || '').split('.').pop().toLowerCase();
    }

    function guessMimeFromName(name) {
        const ext = getExtension(name);
        if (ext === 'csv') return 'text/csv';
        if (ext === 'pdf') return 'application/pdf';
        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
        if (ext === 'png') return 'image/png';
        if (ext === 'webp') return 'image/webp';
        return 'application/octet-stream';
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    function toLabel(value) {
        return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    function formatPreviewValue(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return `Rp ${Math.abs(value).toLocaleString('id-ID')}`;
        return value;
    }

    function truncateText(value, max) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length <= max) return text;
        return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
    }

    function timestampToDate(value) {
        if (!value) return null;
        if (typeof value.toDate === 'function') return value.toDate();
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function isExpired(value) {
        const date = timestampToDate(value);
        return !!date && date.getTime() <= Date.now();
    }

    function formatRelativeTime(value) {
        const date = timestampToDate(value);
        if (!date) return 'Recently updated';
        const diffMs = Date.now() - date.getTime();
        const minutes = Math.max(0, Math.floor(diffMs / 60000));
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 14) return `${days}d ago`;
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    }

    function prefersReducedMotion() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        })[char]);
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function cssEscape(value) {
        if (window.CSS?.escape) return window.CSS.escape(String(value || ''));
        return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
