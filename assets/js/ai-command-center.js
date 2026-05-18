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
            },
        };
        if (window.__fluxyAICommandContext?.auth?.currentUser) {
            window.FluxyAICommandCenter.setUser(window.__fluxyAICommandContext.auth.currentUser);
        }
    }

    function cacheElements() {
        els.name = document.getElementById('ai-user-name');
        els.workspace = document.getElementById('ai-workspace');
        els.promptSection = document.getElementById('ai-prompt-section');
        els.promptGrid = document.getElementById('ai-prompt-grid');
        els.refreshPrompts = document.getElementById('ai-refresh-prompts');
        els.responseArea = document.getElementById('ai-response-area');
        els.chatThread = null;
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
    }

    function wireEvents() {
        els.refreshPrompts?.addEventListener('click', () => {
            state.promptSetIndex = (state.promptSetIndex + 1) % PROMPT_SETS.length;
            renderPrompts();
        });
        els.input?.addEventListener('input', updateCharCount);
        els.input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                els.form?.requestSubmit();
            }
        });
        els.form?.addEventListener('submit', submitComposer);
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
    }

    function renderUserName() {
        if (!els.name) return;
        const user = state.user;
        const name = user?.displayName || user?.email?.split('@')[0] || 'there';
        els.name.textContent = name;
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
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z"/></svg>',
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6z"/><path d="M14 2v4a2 2 0 0 0 2 2h3"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>',
            '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
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
        const shouldScroll = shouldAutoScroll();
        appendUserMessage({ text: prompt });
        const loadingId = appendAssistantLoading('Analyzing your finance records...');
        if (els.input) els.input.value = '';
        updateCharCount();
        scrollToLatest(shouldScroll);
        setBusy(true, 'thinking');
        try {
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
                return;
            }
            renderFinanceAnswer(body.answer, body.related_records || [], loadingId);
        } catch (err) {
            renderErrorResult(err?.message || 'Fluxy AI could not connect. Please try again.', loadingId);
        } finally {
            setBusy(false);
        }
    }

    async function detectSelectedFile(userIntent) {
        if (!state.file || state.busy) return;
        const file = state.file;
        clearError();
        const shouldScroll = shouldAutoScroll();
        appendUserMessage({ text: userIntent || 'Please review this finance document.', file });
        const loadingId = appendAssistantLoading('Checking the document type and destination...');
        if (els.input) els.input.value = '';
        updateCharCount();
        clearFile();
        scrollToLatest(shouldScroll);
        setBusy(true, 'detecting');
        try {
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
                return;
            }
            renderDocumentDetection(body, loadingId, file);
        } catch (err) {
            renderDocumentError(err?.message || 'Could not detect this document right now.', loadingId);
        } finally {
            setBusy(false);
        }
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

    function ensureChatThread() {
        if (!els.responseArea) return null;
        if (!els.chatThread) {
            els.responseArea.classList.remove('hidden');
            els.responseArea.innerHTML = '<div id="ai-chat-thread" class="space-y-5"></div>';
            els.chatThread = document.getElementById('ai-chat-thread');
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

    function appendUserMessage({ text, file }) {
        const thread = ensureChatThread();
        if (!thread) return null;
        const id = nextMessageId('user');
        const fileMeta = file ? `
            <div class="mt-3 rounded-xl border border-gray-200 bg-white/70 px-3 py-2 text-left">
                <p class="truncate text-[12px] font-bold text-gray-900">${escapeHtml(file.name)}</p>
                <p class="mt-0.5 text-[11px] text-gray-500">${escapeHtml(file.type || guessMimeFromName(file.name))} - ${formatBytes(file.size)}</p>
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

    function appendAssistantLoading(message) {
        const thread = ensureChatThread();
        if (!thread) return null;
        const id = nextMessageId('assistant');
        thread.insertAdjacentHTML('beforeend', `
            <article id="${id}" class="flex justify-start">
                <div class="max-w-full sm:max-w-[88%] rounded-2xl rounded-bl-md border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <div class="inline-flex items-center gap-2 text-[13px] font-bold text-gray-500">
                        <span>${escapeHtml(message || 'FluxyOS thinking...')}</span>
                        <span class="inline-flex gap-1" aria-hidden="true"><span class="h-1.5 w-1.5 rounded-full bg-gray-900 animate-pulse"></span><span class="h-1.5 w-1.5 rounded-full bg-gray-900 animate-pulse"></span><span class="h-1.5 w-1.5 rounded-full bg-gray-900 animate-pulse"></span></span>
                    </div>
                </div>
            </article>
        `);
        return id;
    }

    function renderAssistantMessage(messageId, html, tone) {
        const thread = ensureChatThread();
        if (!thread) return;
        const id = messageId || nextMessageId('assistant');
        const existing = document.getElementById(id);
        const autoScroll = shouldAutoScroll();
        const toneClass = tone === 'error'
            ? 'border-red-200 bg-red-50'
            : 'border-gray-200 bg-white';
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
        const target = state.chatStarted ? els.chatThread?.lastElementChild : els.composerSection;
        if (!scroller || !target) return;
        requestAnimationFrame(() => {
            if (state.chatStarted && scroller === els.responseArea) {
                scroller.scrollTo({ top: scroller.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                return;
            }
            target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'end' });
        });
    }

    function getActiveScroller() {
        return state.chatStarted ? els.responseArea : els.scrollContainer;
    }

    function renderFinanceAnswer(answer, relatedRecords, messageId) {
        if (!answer) {
            renderErrorResult('Fluxy AI did not return a usable finance answer.', messageId);
            return;
        }
        const keyNumbers = Array.isArray(answer.key_numbers) && answer.key_numbers.length
            ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">${answer.key_numbers.map(renderKeyNumber).join('')}</div>`
            : '';
        const insights = Array.isArray(answer.insights) && answer.insights.length
            ? `<div class="mt-5 space-y-3">${answer.insights.map(renderInsight).join('')}</div>`
            : '';
        const actions = Array.isArray(answer.recommended_actions) && answer.recommended_actions.length
            ? `<div class="mt-5 grid gap-3">${answer.recommended_actions.map(renderAction).join('')}</div>`
            : '';
        const limitations = Array.isArray(answer.limitations) && answer.limitations.length
            ? `<div class="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"><p class="text-[12px] font-bold text-gray-700">Limitations</p><div class="mt-2 space-y-1">${answer.limitations.map(item => `<p class="text-[12px] text-gray-500">${escapeHtml(item)}</p>`).join('')}</div></div>`
            : '';
        const records = Array.isArray(relatedRecords) && relatedRecords.length
            ? `<div class="mt-5 rounded-xl border border-gray-200 overflow-hidden"><div class="px-4 py-3 bg-gray-50 border-b border-gray-200 text-[12px] font-bold text-gray-700">Related records</div>${relatedRecords.slice(0, 5).map(renderRelatedRecord).join('')}</div>`
            : '';

        renderAssistantMessage(messageId, `
                <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">${escapeHtml(answer.period?.label || 'Selected period')}</span>
                    <span class="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">${escapeHtml(answer.intent || 'finance_analysis')}</span>
                </div>
                <p class="mt-4 text-[17px] font-bold leading-relaxed text-gray-950">${escapeHtml(answer.direct_answer || '')}</p>
                ${keyNumbers}
                ${insights}
                ${actions}
                ${limitations}
                ${records}
        `);
    }

    function renderKeyNumber(item) {
        const statusClass = {
            good: 'border-green-200',
            warning: 'border-amber-200',
            critical: 'border-red-200',
            neutral: 'border-gray-200',
        }[item.status] || 'border-gray-200';
        return `
            <div class="rounded-xl border ${statusClass} bg-white px-4 py-3">
                <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">${escapeHtml(item.label)}</p>
                <p class="mt-1 text-[18px] font-extrabold text-gray-950 break-words">${escapeHtml(item.formatted_value)}</p>
            </div>
        `;
    }

    function renderInsight(item) {
        const evidence = Array.isArray(item.evidence) && item.evidence.length
            ? `<div class="mt-3 rounded-lg border border-gray-200 overflow-hidden">${item.evidence.slice(0, 3).map(renderRelatedRecord).join('')}</div>`
            : '';
        return `
            <div class="rounded-xl border border-gray-200 px-4 py-3">
                <p class="text-[14px] font-bold text-gray-900">${escapeHtml(item.title)}</p>
                <p class="mt-1 text-[13px] leading-relaxed text-gray-500">${escapeHtml(item.description)}</p>
                ${evidence}
            </div>
        `;
    }

    function renderAction(item) {
        return `
            <div class="rounded-xl border border-gray-200 px-4 py-3">
                <p class="text-[14px] font-bold text-gray-900">${escapeHtml(item.title)}</p>
                <p class="mt-1 text-[13px] leading-relaxed text-gray-500">${escapeHtml(item.description)}</p>
            </div>
        `;
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
        const action = renderDocumentAction(result, messageId);

        renderAssistantMessage(messageId, `
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
        wireDocumentActions(result, messageId, file);
    }

    function renderDocumentAction(result, messageId) {
        const action = result.recommended_action;
        if (action === 'refuse') return '';
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
