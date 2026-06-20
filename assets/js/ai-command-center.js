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
        greetingInterval: null,
        greetingPhrases: [],
        greetingIndex: 0,
        historyChats: [],
        historyExpanded: false,
        titleBeforeEdit: '',
        titleDirty: false,
        titleSaving: false,
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
        els.sessionTitleSave = document.getElementById('ai-session-title-save');
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
        els.historyMoreWrap = document.getElementById('ai-history-more-wrap');
        els.historySeeMore = document.getElementById('ai-history-see-more');
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
        els.sessionTitle?.addEventListener('focus', () => {
            state.titleBeforeEdit = getSessionTitleText();
        });
        els.sessionTitle?.addEventListener('input', markSessionTitleDirty);
        els.sessionTitle?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveSessionTitle();
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                setSessionTitleText(state.titleBeforeEdit || state.currentChat?.title || 'AI chat', { force: true });
                els.sessionTitle?.blur();
            }
        });
        els.sessionTitle?.addEventListener('paste', (event) => {
            event.preventDefault();
            const text = event.clipboardData?.getData('text/plain') || '';
            document.execCommand('insertText', false, text.replace(/\s+/g, ' ').slice(0, 90));
        });
        els.sessionTitleSave?.addEventListener('click', saveSessionTitle);
        els.historySeeMore?.addEventListener('click', () => {
            state.historyExpanded = true;
            renderRecentChats(state.historyChats);
        });
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
        setupGreetingFlip(name);
    }

    function setupGreetingFlip(name) {
        if (!els.name) return;
        window.clearInterval(state.greetingInterval);
        state.greetingInterval = null;
        state.greetingIndex = 0;
        state.greetingPhrases = [
            name,
            'how are you?',
            'hope everything goes well',
            'ready to review finance?',
        ];
        els.name.textContent = state.greetingPhrases[0];
        if (prefersReducedMotion()) return;
        state.greetingInterval = window.setInterval(() => {
            if (state.mode !== 'home' || !els.greeting || els.greeting.offsetParent === null) return;
            state.greetingIndex = (state.greetingIndex + 1) % state.greetingPhrases.length;
            els.name.classList.remove('is-flipping');
            void els.name.offsetWidth;
            els.name.textContent = state.greetingPhrases[state.greetingIndex];
            els.name.classList.add('is-flipping');
        }, 3600);
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
        state.historyExpanded = false;
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
        hideHistoryMore();
        try {
            state.historyChats = await ds.getRecentAIChats(state.user.uid, 20);
            renderRecentChats(state.historyChats);
        } catch (err) {
            state.historyChats = [];
            renderHistoryEmpty('Could not load recent AI chats right now.');
        }
    }

    function renderRecentChats(chats) {
        if (!els.historyList) return;
        const safeChats = Array.isArray(chats) ? chats : [];
        if (!safeChats.length) {
            renderHistoryEmpty('No recent AI chats yet. Start with a finance prompt above.');
            hideHistoryMore();
            return;
        }
        const visibleChats = state.historyExpanded ? safeChats : safeChats.slice(0, 5);
        els.historyList.innerHTML = visibleChats.map(renderHistoryItem).join('');
        wireHistoryItems();
        if (safeChats.length > 5 && !state.historyExpanded) {
            showHistoryMore();
        } else {
            hideHistoryMore();
        }
    }

    function wireHistoryItems() {
        els.historyList?.querySelectorAll('[data-ai-open-chat]').forEach(button => {
            button.addEventListener('click', () => openChatFromHistory(button.dataset.aiOpenChat));
        });
        els.historyList?.querySelectorAll('[data-ai-delete-chat]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                openDeleteModal(button.dataset.aiDeleteChat);
            });
        });
    }

    function showHistoryMore() {
        els.historyMoreWrap?.classList.remove('hidden');
        els.historyMoreWrap?.classList.add('flex');
    }

    function hideHistoryMore() {
        els.historyMoreWrap?.classList.add('hidden');
        els.historyMoreWrap?.classList.remove('flex');
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
        setSessionTitleText(title || 'AI chat', { force: true });
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
            const financeSnapshot = await buildFinanceSnapshot();
            const response = await fetch('/api/v1/brain/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    message: prompt,
                    chat_id: state.currentChatId || undefined,
                    page_context: 'ai_command_center',
                    // Business-level context (the Command Center is not page-scoped)
                    // so the analyst can orient on workspace coverage.
                    page_summary: buildCommandCenterPageSummary(financeSnapshot),
                    period: getCurrentPeriod(prompt),
                    finance_snapshot: financeSnapshot,
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || body.success === false) {
                maybeShowTrialLimit(body);
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

    function maybeShowTrialLimit(body) {
        if (body?.error?.code !== 'trial_ai_limit_reached') return false;
        window.FluxyAccessGuard?.showSubscriptionLimitModal?.({
            title: 'Trial AI limit reached',
            body: body.error.message || 'Your trial includes 3 Fluxy AI chats. Activate your subscription to keep chatting.',
            confirmLabel: 'Activate subscription'
        });
        return true;
    }

    // Business-level page context for the full-page Command Center. Unlike the
    // drawer (which reflects the originating finance page), this summarizes
    // workspace coverage from the snapshot the request already carries.
    function buildCommandCenterPageSummary(snapshot) {
        const counts = snapshot?.meta?.counts || {};
        return {
            page: 'ai_command_center',
            pageTitle: 'Fluxy AI',
            summary: [
                { label: 'Transactions', value: String(counts.transactions ?? 0), status: 'neutral' },
                { label: 'Bills', value: String(counts.bills ?? 0), status: 'neutral' },
                { label: 'Subscriptions', value: String(counts.subscriptions ?? 0), status: 'neutral' },
            ],
            filters: {},
            selectedRecord: null,
        };
    }

    async function buildFinanceSnapshot() {
        const ds = getDataService();
        const uid = state.user?.uid;
        const generatedAt = new Date().toISOString();
        if (!ds || !uid) {
            const error = !uid ? 'missing_user' : 'missing_data_service';
            return buildEmptyFinanceSnapshot(generatedAt, error);
        }
        const [transactions, bills, subscriptions] = await Promise.all([
            readSnapshotCollection('transactions', () => ds.getTransactions(uid, 1000)),
            readSnapshotCollection('bills', () => ds.getBills(uid)),
            readSnapshotCollection('subscriptions', () => ds.getSubscriptions(uid)),
        ]);
        return {
            transactions: transactions.records,
            bills: bills.records,
            subscriptions: subscriptions.records,
            meta: {
                source: 'ai_command_center_browser_snapshot',
                generated_at: generatedAt,
                counts: {
                    transactions: transactions.records.length,
                    bills: bills.records.length,
                    subscriptions: subscriptions.records.length,
                },
                reads: {
                    transactions: transactions.read,
                    bills: bills.read,
                    subscriptions: subscriptions.read,
                },
            },
        };
    }

    async function readSnapshotCollection(key, loader) {
        try {
            const value = await loader();
            const records = normalizeSnapshotRecords(Array.isArray(value) ? value : []);
            return {
                records,
                read: { success: true, error: null },
            };
        } catch (err) {
            return {
                records: [],
                read: { success: false, error: sanitizeSnapshotError(err) },
            };
        }
    }

    function buildEmptyFinanceSnapshot(generatedAt, error) {
        const read = { success: false, error };
        return {
            transactions: [],
            bills: [],
            subscriptions: [],
            meta: {
                source: 'ai_command_center_browser_snapshot',
                generated_at: generatedAt,
                counts: { transactions: 0, bills: 0, subscriptions: 0 },
                reads: { transactions: read, bills: read, subscriptions: read },
            },
        };
    }

    function sanitizeSnapshotError(err) {
        const code = String(err?.code || '').toLowerCase();
        const message = String(err?.message || '').toLowerCase();
        if (code.includes('permission') || message.includes('permission')) return 'permission_denied';
        if (code.includes('unauth') || message.includes('auth')) return 'unauthenticated';
        if (code.includes('unavailable') || message.includes('network')) return 'network_unavailable';
        return 'read_failed';
    }

    function normalizeSnapshotRecords(records) {
        return records.slice(0, 1000).map(record => ({
            id: String(record.id || ''),
            vendor_name: String(record.vendor_name || record.name || record.label || 'Unnamed record'),
            name: record.name ? String(record.name) : undefined,
            category: String(record.category || 'Uncategorized'),
            type: String(record.type || 'unknown'),
            status: String(record.status || 'Unknown'),
            amount: Number(record.amount) || 0,
            timestamp: serializeSnapshotDate(record.timestamp),
            due_date: serializeSnapshotDate(record.due_date),
            renewal_date: serializeSnapshotDate(record.renewal_date),
        }));
    }

    function serializeSnapshotDate(value) {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value.toDate === 'function') {
            try {
                return value.toDate().toISOString();
            } catch {
                return null;
            }
        }
        if (Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString();
        return null;
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
            const base64 = await readFileAsBase64(file);
            if (els.input) els.input.value = '';
            updateCharCount();
            autoGrowComposer();
            clearFile();
            scrollToLatest(true);
            const token = await getAuthToken();
            const response = await fetch('/api/v1/ai/input-from-file', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    file_base64: base64,
                    file_name: file.name,
                    mime_type: file.type || guessMimeFromName(file.name),
                    size_bytes: file.size,
                    source_page: 'ai_command_center',
                    destination_hint: 'auto',
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
        setSessionTitleText(patch.title);
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
        setSessionTitleText(patch.title);
    }

    function getSessionTitleText() {
        return sanitizeSessionTitle(els.sessionTitle?.textContent || '');
    }

    function sanitizeSessionTitle(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    }

    function setSessionTitleText(title, options = {}) {
        if (!els.sessionTitle) return;
        if (state.titleDirty && !options.force) return;
        const safeTitle = sanitizeSessionTitle(title) || 'AI chat';
        els.sessionTitle.textContent = safeTitle;
        els.sessionTitle.dataset.savedTitle = safeTitle;
        state.titleBeforeEdit = safeTitle;
        state.titleDirty = false;
        updateTitleSaveState();
    }

    function markSessionTitleDirty() {
        const current = getSessionTitleText();
        const saved = sanitizeSessionTitle(els.sessionTitle?.dataset.savedTitle || state.currentChat?.title || 'AI chat');
        state.titleDirty = Boolean(current && current !== saved);
        updateTitleSaveState();
    }

    function updateTitleSaveState() {
        if (!els.sessionTitleSave) return;
        const show = state.titleDirty || state.titleSaving;
        els.sessionTitleSave.classList.toggle('hidden', !show);
        els.sessionTitleSave.disabled = state.titleSaving;
        els.sessionTitleSave.textContent = state.titleSaving ? 'Saving...' : 'Save';
    }

    async function saveSessionTitle() {
        if (state.titleSaving) return;
        const title = getSessionTitleText();
        if (!title) {
            setSessionTitleText(state.currentChat?.title || state.titleBeforeEdit || 'AI chat', { force: true });
            return;
        }
        const saved = sanitizeSessionTitle(els.sessionTitle?.dataset.savedTitle || state.currentChat?.title || 'AI chat');
        if (title === saved) {
            state.titleDirty = false;
            updateTitleSaveState();
            els.sessionTitle?.blur();
            return;
        }
        const ds = getDataService();
        if (!state.user || !state.currentChatId || !ds?.updateAIChatMeta) return;
        state.titleSaving = true;
        updateTitleSaveState();
        try {
            await ds.updateAIChatMeta(state.user.uid, state.currentChatId, { title });
            state.currentChat = { ...(state.currentChat || {}), title, id: state.currentChatId };
            setSessionTitleText(title, { force: true });
            els.sessionTitle?.blur();
            window.showToast?.('AI chat title saved.', 'success');
        } catch (err) {
            window.showToast?.('Could not save this chat title.', 'error');
            state.titleDirty = true;
            updateTitleSaveState();
        } finally {
            state.titleSaving = false;
            updateTitleSaveState();
        }
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

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the selected file.'));
            reader.onload = () => {
                const result = String(reader.result || '');
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.readAsDataURL(file);
        });
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
            clarification: 'border-gray-200 bg-white ring-1 ring-amber-100',
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
            cash_pressure: [
                ['Show upcoming bills', 'Show upcoming bills.'],
                ['Which bills are risky?', 'Which bills are risky?'],
                ['What should I fix first?', 'What should I fix first?'],
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
        const isClarification = answerType === 'clarification';
        const stateBadge = renderAnalystStateBadge(answerType, lowConfidence);
        const confidenceBadge = hasConfidence
            ? `<span class="rounded-full border ${lowConfidence ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-gray-200 text-gray-500 bg-white'} px-2.5 py-1 text-[11px] font-medium">${Math.round(confidence * 100)}% confidence</span>`
            : '';
        const keyNumbers = Array.isArray(answer.key_numbers) && answer.key_numbers.length
            ? `<section class="mt-5"><p class="text-[12px] font-semibold text-gray-500">Key numbers</p><div class="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">${answer.key_numbers.map(item => renderKeyNumber(item, answer)).join('')}</div></section>`
            : '';
        const insights = Array.isArray(answer.insights) && answer.insights.length
            ? `<section class="mt-5"><p class="text-[12px] font-semibold text-gray-500">What this means</p><div class="mt-2 space-y-3">${answer.insights.map(item => renderInsight(item, answer)).join('')}</div></section>`
            : '';
        const actions = Array.isArray(answer.recommended_actions) && answer.recommended_actions.length
            ? `<section class="mt-5"><p class="text-[12px] font-semibold text-gray-500">Recommended next actions</p><div class="mt-2 grid gap-3">${answer.recommended_actions.slice(0, 3).map(renderAction).join('')}</div></section>`
            : '';
        const limitations = Array.isArray(answer.limitations) && answer.limitations.length
            ? `<section class="mt-5 rounded-xl border ${lowConfidence ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'} px-4 py-3"><p class="text-[12px] font-semibold ${lowConfidence ? 'text-amber-900' : 'text-gray-700'}">Risk or limitation</p><div class="mt-2 space-y-1">${answer.limitations.map(item => `<p class="text-[12px] leading-relaxed ${lowConfidence ? 'text-amber-800' : 'text-gray-500'}">${escapeHtml(item)}</p>`).join('')}</div></section>`
            : '';
        const records = Array.isArray(relatedRecords) && relatedRecords.length
            ? `<div class="mt-5 rounded-xl border border-gray-200 overflow-hidden"><div class="px-4 py-3 bg-gray-50 border-b border-gray-200 text-[12px] font-bold text-gray-700">Related records</div>${relatedRecords.slice(0, 5).map(record => renderRelatedRecord(record, { answer })).join('')}</div>`
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
                <p class="mt-4 ${isClarification ? 'text-[15px] sm:text-[16px] font-medium leading-7 text-gray-900' : 'text-[17px] font-semibold leading-relaxed text-gray-950'}">${escapeHtml(answer.direct_answer || '')}</p>
                ${keyNumbers}
                ${insights}
                ${limitations}
                ${actions}
                ${records}
        `, answerType === 'clarification' ? 'clarification' : answerType === 'refusal' ? 'warning' : 'neutral');
        wireFollowUpActions(renderedId);
        renderSessionPromptChips(answer);
    }

    function renderKeyNumber(item, answer) {
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
        const href = buildKeyNumberDrilldownHref(item, answer);
        const tag = href ? 'a' : 'div';
        const attrs = href
            ? `href="${escapeHtml(href)}" aria-label="Open ${escapeHtml(item.label)} drilldown" class="group block rounded-xl border ${statusClass} px-4 py-3 transition-colors hover:bg-gray-50"`
            : `class="rounded-xl border ${statusClass} px-4 py-3"`;
        return `
            <${tag} ${attrs}>
                <p class="flex items-center gap-2 text-[11px] font-medium text-gray-500"><span class="h-1.5 w-1.5 rounded-full ${statusDot}"></span>${escapeHtml(item.label)}</p>
                <p class="mt-1 flex items-center gap-2 text-[18px] font-extrabold text-gray-950 break-words">
                    <span>${escapeHtml(item.formatted_value)}</span>
                    ${href ? '<svg class="h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-[#EA580C]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>' : ''}
                </p>
            </${tag}>
        `;
    }

    function renderInsight(item, answer) {
        const severityClass = {
            critical: 'border-red-200 bg-red-50',
            warning: 'border-amber-200 bg-amber-50',
            info: 'border-gray-200 bg-white',
        }[item.severity] || 'border-gray-200 bg-white';
        const evidence = Array.isArray(item.evidence) && item.evidence.length
            ? `<div class="mt-3 rounded-lg border border-gray-200 overflow-hidden">${item.evidence.slice(0, 3).map(record => renderRelatedRecord(record, { answer, insight: item })).join('')}</div>`
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
            comparison: ['Comparison', 'border-blue-200 bg-blue-50 text-blue-700'],
            recommendation: ['Next actions', 'border-green-200 bg-green-50 text-green-700'],
            no_data: ['No data found', 'border-gray-200 bg-white text-gray-600'],
            refusal: ['Finance scope only', 'border-amber-200 bg-amber-50 text-amber-700'],
            clarification: ['Needs clarification', 'border-amber-200 bg-white text-amber-700'],
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

    function renderRelatedRecord(record, context = {}) {
        const name = record.vendor_name || record.label || 'Record';
        const amount = record.formatted_amount || record.formatted_value || '';
        const href = buildRelatedRecordHref(record, context);
        const sourceLabel = toLabel(record.source || inferRelatedRecordSource(record, context) || 'record');
        const content = `
            <span class="min-w-0">
                <span class="block truncate text-[12px] font-semibold text-gray-700">${escapeHtml(name)}</span>
                <span class="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">${escapeHtml(sourceLabel)}</span>
            </span>
            <span class="flex flex-shrink-0 items-center gap-2">
                <strong class="text-[12px] font-mono text-gray-900">${escapeHtml(amount)}</strong>
                <svg class="h-3.5 w-3.5 text-gray-300 group-hover:text-[#EA580C]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
            </span>
        `;
        if (href) {
            return `
                <a href="${escapeHtml(href)}" class="group flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-2.5 transition-colors last:border-b-0 hover:bg-gray-50" aria-label="Open ${escapeHtml(name)}">
                    ${content}
                </a>
            `;
        }
        return `
            <div class="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0 bg-white">
                ${content}
            </div>
        `;
    }

    function buildRelatedRecordHref(record, context = {}) {
        const id = record?.id;
        const source = inferRelatedRecordSource(record, context);
        if (id) {
            const encodedId = encodeURIComponent(id);
            if (source === 'bills') return `/bill?record=${encodedId}`;
            if (source === 'subscriptions') return `/subscription?record=${encodedId}`;
            if (source === 'revenue_sync') return `/revenue-sync?record=${encodedId}`;
            if (source === 'ledger') return `/ledger?record=${encodedId}`;
        }
        const search = record?.label || record?.vendor_name || record?.category || record?.status;
        if (!search) return '';
        return buildSearchHref(source, search);
    }

    function buildKeyNumberDrilldownHref(item, answer = {}) {
        const label = String(item?.label || '').toLowerCase();
        const intent = String(answer?.intent || '').toLowerCase();
        if (label.includes('revenue') || label.includes('live revenue')) return buildSearchHref('revenue_sync', 'income');
        if (label.includes('opex') || label.includes('expense')) return buildSearchHref('ledger', 'expense');
        if (label.includes('missing receipt')) return buildSearchHref('ledger', 'Missing Receipt');
        if (label.includes('uncategorized')) return buildSearchHref('ledger', 'Uncategorized');
        if (label.includes('quality issue')) return buildSearchHref('ledger', 'Missing Receipt');
        if (label.includes('unpaid') || label.includes('cash pressure') || intent === 'bills_analysis') return buildSearchHref('bills', 'unpaid');
        if (label.includes('subscription')) return buildSearchHref('subscriptions', 'Active');
        return '';
    }

    function buildSearchHref(source, query) {
        const encodedQuery = encodeURIComponent(query);
        if (source === 'bills') return `/bill?search=${encodedQuery}`;
        if (source === 'subscriptions') return `/subscription?search=${encodedQuery}`;
        if (source === 'revenue_sync') return `/revenue-sync?search=${encodedQuery}`;
        if (source === 'ledger') return `/ledger?search=${encodedQuery}`;
        return '';
    }

    function inferRelatedRecordSource(record, context = {}) {
        // Prefer the authoritative record_kind the backend now tags on evidence.
        const kind = String(record?.record_kind || '').toLowerCase();
        if (kind === 'bill') return 'bills';
        if (kind === 'subscription') return 'subscriptions';
        if (kind === 'revenue') return 'revenue_sync';
        if (kind === 'transaction') return 'ledger';
        const rawSource = String(record?.source || record?.collection || '').toLowerCase();
        if (['bill', 'bills', 'invoice'].includes(rawSource)) return 'bills';
        if (['subscription', 'subscriptions'].includes(rawSource)) return 'subscriptions';
        if (['revenue', 'revenue_sync', 'revenue-sync'].includes(rawSource)) return 'revenue_sync';
        if (['ledger', 'transaction', 'transactions'].includes(rawSource)) return 'ledger';

        const type = String(record?.type || '').toLowerCase();
        if (record?.due_date) return 'bills';
        if (record?.renewal_date) return 'subscriptions';
        const intent = String(context.answer?.intent || '').toLowerCase();
        const insightTitle = String(context.insight?.title || '').toLowerCase();
        if (intent === 'bills_analysis' || insightTitle.includes('bill')) return 'bills';
        if (intent === 'subscription_analysis' || insightTitle.includes('subscription') || insightTitle.includes('renewal')) return 'subscriptions';
        if (intent === 'revenue_analysis' || insightTitle.includes('revenue')) return 'revenue_sync';
        if (insightTitle.includes('expense') || insightTitle.includes('vendor') || insightTitle.includes('ledger') || insightTitle.includes('receipt')) return 'ledger';
        if (['income', 'revenue', 'refund', 'pending_receivable'].includes(type)) return 'revenue_sync';
        if (['expense', 'opex', 'operating_expense'].includes(type)) return 'ledger';
        return 'ledger';
    }

    function renderDocumentDetection(result, messageId, file) {
        const actionId = messageId || nextMessageId('assistant');
        const confidence = Math.round((Number(result.confidence) || 0) * 100);
        const lowConfidence = confidence < 70;
        const detectionPreview = result.extracted_preview || {};
        const extractedPreview = result.extracted || {};
        const mappedPreview = result.mapped_fields && Object.keys(result.mapped_fields).length
            ? result.mapped_fields
            : {};
        const previewData = {
            ...detectionPreview,
            ...extractedPreview,
            ...mappedPreview,
        };
        const hiddenPreviewKeys = new Set(['confidence', 'warnings', 'raw_text_preview', 'validation_errors']);
        const previewEntries = Object.entries(previewData || {})
            .filter(([key, value]) => !hiddenPreviewKeys.has(key) && value != null && value !== '' && !(Array.isArray(value) && !value.length));
        const preview = previewEntries.length
            ? `<div class="mt-4 rounded-xl border border-gray-200 overflow-hidden">${previewEntries.map(([key, value]) => `
                <div class="flex items-center justify-between gap-3 border-b border-gray-100 last:border-b-0 px-4 py-2.5">
                    <span class="text-[12px] font-bold text-gray-500">${escapeHtml(toLabel(key))}</span>
                    <strong class="min-w-0 text-right text-[12px] font-semibold text-gray-900 break-words">${escapeHtml(formatPreviewValue(value))}</strong>
                </div>
            `).join('')}</div>`
            : '';
        const issueList = [
            ...(Array.isArray(result.missing_required_fields) ? result.missing_required_fields.map(item => `Missing required field: ${toLabel(item)}`) : []),
            ...(Array.isArray(result.validation_errors) ? result.validation_errors : []),
            ...(Array.isArray(result.warnings) ? result.warnings : []),
        ];
        const warnings = issueList.length
            ? `<div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">${issueList.map(item => `<p class="text-[12px] font-medium text-amber-800">${escapeHtml(item)}</p>`).join('')}</div>`
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
        if (!file && ['review_and_save_to_bills', 'review_as_expense', 'review_transaction', 'review_as_subscription', 'review_csv_import'].includes(action)) {
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
            review_as_subscription: 'Review and Save as Subscription',
            review_csv_import: 'Review CSV Import',
            ask_user: 'Choose Destination',
        }[action] || 'Review';
        if (result.recommended_destination === 'ai_review' || action === 'ask_user') {
            return `
                <div class="mt-5">
                    <p class="text-[12px] font-semibold text-gray-500">Choose where to review it</p>
                    <div class="mt-2 flex flex-wrap gap-2">
                        ${['bills', 'ledger', 'subscriptions', 'revenue_sync', 'ignore'].map(destination => `
                            <button type="button" data-ai-route-document-destination="${escapeAttr(destination)}" class="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-3 py-2 text-[12px] font-bold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-[#EA580C]">${escapeHtml(toLabel(destination))}</button>
                        `).join('')}
                    </div>
                </div>
            `;
        }
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
        root?.querySelectorAll('[data-ai-route-document-destination]').forEach(button => {
            button.addEventListener('click', () => {
                const destination = button.dataset.aiRouteDocumentDestination;
                if (destination === 'ignore') {
                    root.remove();
                    return;
                }
                if (destination === 'bills') return openExistingReview('bill', file, result);
                if (destination === 'ledger') return openExistingReview('transaction', file, result);
                if (destination === 'subscriptions') return openExistingReview('subscription', file, result);
                if (destination === 'revenue_sync') window.location.href = '/revenue-sync';
            });
        });
        root?.querySelector(`[data-ai-primary-document-action="${cssEscape(messageId || '')}"]`)?.addEventListener('click', () => {
            const action = result.recommended_action;
            const type = result.detected_type;
            if (['review_and_save_to_bills'].includes(action) || ['bill', 'invoice'].includes(type)) {
                openExistingReview('bill', file, result);
                return;
            }
            if (['review_as_expense', 'review_transaction'].includes(action) || ['receipt', 'bank_statement', 'payment_screenshot', 'bank_transfer'].includes(type)) {
                openExistingReview('transaction', file, result);
                return;
            }
            if (action === 'review_csv_import') {
                if (typeof window.showAddTransactionModal === 'function') {
                    window.showAddTransactionModal({ openBulk: true, csvFile: file });
                } else {
                    window.location.href = '/ledger';
                }
                return;
            }
            if (action === 'review_as_subscription') {
                openExistingReview('subscription', file, result);
                return;
            }
            if (result.recommended_destination === 'revenue_sync') {
                window.location.href = '/revenue-sync';
            }
        });
    }

    function openExistingReview(mode, file, result = {}) {
        if (!file) return;
        const extracted = result.extracted || result.extracted_preview || {};
        const mapped = result.mapped_fields || {};
        const warnings = [
            ...(Array.isArray(result.missing_required_fields) ? result.missing_required_fields.map(item => `Missing required field: ${toLabel(item)}`) : []),
            ...(Array.isArray(result.validation_errors) ? result.validation_errors : []),
            ...(Array.isArray(result.warnings) ? result.warnings : []),
            ...(Array.isArray(extracted.warnings) ? extracted.warnings : []),
        ];
        const options = {
            extraction: {
                ...extracted,
                ...mapped,
                document_type: result.detected_type || extracted.document_type || 'unknown_financial_document',
                confidence: extracted.confidence || { overall: Number(result.confidence) || 0 },
                warnings,
            },
            extractionSource: result.provider_state || 'ai_command_center',
            provider_state: result.provider_state || null,
        };
        if (typeof window.openScanDrawerWithFile === 'function') {
            window.openScanDrawerWithFile(mode, file, options);
            return;
        }
        if (mode === 'bill' && typeof window.openScanBillDrawer === 'function') {
            window.openScanBillDrawer();
            return;
        }
        if (mode === 'transaction' && typeof window.openScanTransactionDrawer === 'function') {
            window.openScanTransactionDrawer();
            return;
        }
        if (mode === 'subscription' && typeof window.openScanSubscriptionDrawer === 'function') {
            window.openScanSubscriptionDrawer();
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
        if (lower.includes('cash pressure') || lower.includes('can i cover') || lower.includes('cover upcoming')) return 'cash_pressure';
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

    function getCurrentPeriod(prompt) {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const periodType = inferPromptPeriodType(prompt);
        const monthOffset = periodType === 'last_month' ? -1 : 0;
        const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
        return { type: periodType, start_date: toDateKey(start), end_date: toDateKey(end) };
    }

    function inferPromptPeriodType(prompt) {
        const text = String(prompt || '').toLowerCase();
        if (/\b(last|previous|prior)\s+(performance\s+)?(month|period)\b/.test(text)) return 'last_month';
        if (/\b(last|previous|prior) month's\b/.test(text) || text.includes('month before') || text.includes('previous performance')) return 'last_month';
        if (text.includes('bulan lalu') || text.includes('bulan kemarin') || text.includes('periode sebelumnya')) return 'last_month';
        return 'this_month';
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
        if (typeof value === 'number' && Number.isFinite(value)) return `Rp${Math.abs(value).toLocaleString('id-ID')}`;
        if (Array.isArray(value)) {
            if (value.every(item => item == null || ['string', 'number', 'boolean'].includes(typeof item))) {
                const labels = value.filter(item => item != null && item !== '').slice(0, 6).map(String);
                return `${labels.join(', ')}${value.length > labels.length ? ` +${value.length - labels.length} more` : ''}`;
            }
            return `${value.length} row${value.length === 1 ? '' : 's'}`;
        }
        if (value && typeof value === 'object') return JSON.stringify(value);
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
