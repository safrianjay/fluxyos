(function() {
    const PROMPTS = {
        global: [
            'How healthy is my business?',
            'What needs attention?',
            'Why is OpEx high?',
            'Show upcoming bills',
            'Find missing receipts',
            'Summarize this month',
            'What should I do next?'
        ],
        dashboard: [
            'How is my business doing?',
            'What should I fix first?',
            'What is hurting my margin?',
            'What changed this month?',
            'What are my biggest risks?'
        ],
        ledger: [
            'Can I trust this ledger?',
            'Analyze cash movement',
            'Show unusual transactions',
            'Explain spending patterns',
            'Show largest vendors'
        ],
        bills: [
            'Which bills need attention?',
            'Show overdue bills',
            'What payments are coming soon?',
            'Can I cover upcoming bills?',
            'Which vendors cost the most?'
        ],
        budget: [
            'Which budgets are at risk?',
            'Where am I overspending?',
            'Forecast budget usage',
            'Recommend budget adjustments',
            'Show highest risk category'
        ],
        subscriptions: [
            'How much am I spending on SaaS?',
            'Which renewals are coming?',
            'Which recurring costs should I review?'
        ],
        revenue_sync: [
            'What revenue changed?',
            'Which revenue source is strongest?',
            'Is there a revenue anomaly?'
        ],
        reports: [
            'Is my data ready to report?',
            'Summarize this period',
            'What is hurting my margin?',
            'What changed this month?'
        ]
    };
    const MIN_THINKING_MS = 700;

    const chatHTML = `
        <div id="ai-chat-container" style="display: none;">
            <div id="ai-chat-window" role="dialog" aria-modal="true" aria-label="Fluxy AI Analyst">
                <div class="chat-header">
                    <div class="chat-header-icon" aria-hidden="true">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </div>
                    <div>
                        <p class="chat-title">Fluxy AI Analyst</p>
                        <p class="chat-subtitle">Project finance analysis</p>
                    </div>
                    <button id="close-chat" class="chat-close" type="button" aria-label="Close Fluxy AI">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="chat-messages" id="chat-messages" aria-live="polite">
                    <div id="ai-session-intro"></div>
                </div>
                <form class="chat-input-area" id="chat-form">
                    <input type="text" id="chat-input" placeholder="Ask about your finances..." autocomplete="off" maxlength="500">
                    <button type="submit" aria-label="Send message">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                    </button>
                </form>
            </div>
        </div>
    `;

    function init() {
        if (document.getElementById('ai-chat-container')) return;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = chatHTML;
        document.body.appendChild(wrapper);

        const container = document.getElementById('ai-chat-container');
        const windowElem = document.getElementById('ai-chat-window');
        const closeBtn = document.getElementById('close-chat');
        const form = document.getElementById('chat-form');
        const input = document.getElementById('chat-input');
        const messages = document.getElementById('chat-messages');
        const intro = document.getElementById('ai-session-intro');

        // Render the per-session intro (Current Context card + page-aware prompt
        // chips) fresh, so period/filter/KPI changes are reflected each open.
        function renderSessionIntro() {
            const context = readPageContext();
            intro.innerHTML = renderContextCard(context) + `<div class="prompt-chip-list" id="prompt-chip-list"></div>`;
            const promptList = intro.querySelector('#prompt-chip-list');
            renderPromptChips(promptList, context, submitPrompt);
        }

        renderSessionIntro();

        window.toggleFluxyAI = (state) => {
            container.style.display = 'flex';
            const open = () => {
                renderSessionIntro();
                windowElem.classList.add('active');
                input.focus();
            };
            if (state === true) {
                open();
                return;
            }
            if (state === false) {
                windowElem.classList.remove('active');
                setTimeout(() => { container.style.display = 'none'; }, 400);
                return;
            }
            if (!windowElem.classList.contains('active')) {
                open();
            } else {
                windowElem.classList.remove('active');
                setTimeout(() => { container.style.display = 'none'; }, 400);
            }
        };

        closeBtn.onclick = () => window.toggleFluxyAI(false);

        form.onsubmit = async (event) => {
            event.preventDefault();
            await submitPrompt(input.value);
        };

        async function submitPrompt(rawText) {
            const text = String(rawText || '').trim();
            if (!text) return;

            addUserMessage(messages, text);
            input.value = '';

            const thinkingStartedAt = Date.now();
            const loading = addLoadingMessage(messages);
            setFormDisabled(form, true);

            try {
                const token = await getAuthToken();
                const response = await fetch('/api/v1/brain/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        message: text,
                        workspace_id: window.FluxyWorkspace?.id || null,
                        page_context: getPageContext(),
                        // Lightweight page context (title, filters, on-screen
                        // metrics) so the analyst can acknowledge what the user
                        // is viewing. Orientation only — never a numeric source.
                        page_summary: readPageContext(),
                        period: getCurrentPeriod(),
                        // App display language (set in Settings → Language & Region).
                        // The brain replies in Bahasa Indonesia when this is 'id'.
                        language: (window.FluxyI18n && window.FluxyI18n.getLang()) || 'en',
                    }),
                });
                const data = await response.json().catch(() => ({}));
                await waitForMinimumThinkingTime(thinkingStartedAt);
                loading.remove();
                if (!response.ok || data.success === false) {
                    maybeShowTrialLimit(data);
                    addErrorMessage(messages, data?.error?.message || data?.message || 'Fluxy AI could not read your finance data right now.');
                    return;
                }
                addAnswerMessage(messages, data.answer);
            } catch (err) {
                await waitForMinimumThinkingTime(thinkingStartedAt);
                loading.remove();
                addErrorMessage(messages, err?.message || 'Error connecting to Fluxy AI. Please try again later.');
            } finally {
                setFormDisabled(form, false);
                input.focus();
            }
        }
    }

    function maybeShowTrialLimit(data) {
        if (data?.error?.code !== 'trial_ai_limit_reached') return false;
        window.FluxyAccessGuard?.showSubscriptionLimitModal?.({
            title: 'Trial AI limit reached',
            body: data.error.message || 'Your trial includes 1 Fluxy AI generation. Activate your subscription to keep using Fluxy AI.',
            confirmLabel: 'Activate subscription'
        });
        return true;
    }

    function renderPromptChips(container, context, onSelect) {
        if (!container) return;
        const page = (context && context.page) || 'global';
        // Dynamic, signal-driven chips come first when the page surfaces a live
        // risk; then the page's curated prompts; then the global fallback tail.
        const prompts = [];
        const seen = new Set();
        const push = (prompt) => {
            const key = prompt.toLowerCase();
            if (prompt && !seen.has(key)) { seen.add(key); prompts.push(prompt); }
        };
        dynamicPromptsFor(context).forEach(push);
        (PROMPTS[page] || []).forEach(push);
        PROMPTS.global.forEach(push);
        container.innerHTML = prompts.slice(0, 7).map(prompt => (
            `<button type="button" class="prompt-chip" data-prompt="${escapeAttribute(prompt)}">${escapeHTML(prompt)}</button>`
        )).join('');
        container.querySelectorAll('.prompt-chip').forEach(button => {
            button.addEventListener('click', () => onSelect(button.dataset.prompt));
        });
    }

    // Build at most two context-derived prompts from live page signals. Reads the
    // summary row statuses the page provider supplied — no new computation.
    function dynamicPromptsFor(context) {
        const out = [];
        const rows = (context && Array.isArray(context.summary)) ? context.summary : [];
        const findRow = (re) => rows.find(row => re.test(String(row.label || '')));
        if (context && context.page === 'bills') {
            const overdue = findRow(/overdue/i);
            if (overdue && parseFirstNumber(overdue.value) > 0) out.push('Show overdue bills');
        }
        if (context && context.page === 'budget') {
            const usage = findRow(/usage|used/i);
            const risk = findRow(/risk/i);
            if ((usage && parseFirstNumber(usage.value) >= 85) || (risk && /watch|risk|exceed/i.test(String(risk.value)))) {
                out.push('Why is this budget at risk?');
            }
        }
        if (context && (context.page === 'ledger')) {
            const missing = findRow(/missing receipt/i);
            if (missing && parseFirstNumber(missing.value) > 0) out.push('Find missing receipts');
        }
        return out;
    }

    function parseFirstNumber(value) {
        const match = String(value == null ? '' : value).replace(/[.,](?=\d{3}\b)/g, '').match(/-?\d+(\.\d+)?/);
        return match ? Number(match[0]) : 0;
    }

    // Full lightweight context object (page, title, filters, selectedRecord,
    // summary[]). Prefers the shared registry; falls back to a bare object so the
    // drawer still works if a page registered no provider.
    function readPageContext() {
        if (window.FluxyAIContext && typeof window.FluxyAIContext.get === 'function') {
            return window.FluxyAIContext.get();
        }
        return { page: getPageContext(), pageTitle: 'FluxyOS', filters: {}, selectedRecord: null, summary: [] };
    }

    function getPageContext() {
        if (window.FluxyAIContext && typeof window.FluxyAIContext.detectPage === 'function') {
            return window.FluxyAIContext.detectPage();
        }
        const path = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '');
        if (path.includes('ledger')) return 'ledger';
        if (path.includes('bill')) return 'bills';
        if (path.includes('subscription')) return 'subscriptions';
        if (path.includes('revenue-sync') || path.includes('revenuesync')) return 'revenue_sync';
        if (path.includes('budget')) return 'budget';
        if (path.includes('report')) return 'reports';
        if (path.includes('dashboard')) return 'dashboard';
        return 'global';
    }

    // "Current Context" card shown at the top of every AI session. White card,
    // status-dot rows reusing the answer key-number visual language.
    function renderContextCard(context) {
        const title = escapeHTML((context && context.pageTitle) || 'FluxyOS');
        const rows = (context && Array.isArray(context.summary)) ? context.summary : [];
        const rowsHTML = rows.map(row => `
            <div class="ai-context-row ai-ctx-${escapeAttribute(row.status || 'neutral')}">
                <span><i aria-hidden="true"></i>${escapeHTML(row.label)}</span>
                <strong>${escapeHTML(row.value)}</strong>
            </div>
        `).join('');
        return `
            <div class="ai-context-card">
                <p class="ai-context-eyebrow">Current Context</p>
                <p class="ai-context-title">${title}</p>
                ${rowsHTML ? `<div class="ai-context-grid">${rowsHTML}</div>` : ''}
            </div>
        `;
    }

    function getCurrentPeriod() {
        if (getPageContext() === 'dashboard' && window.FluxyDashboardRange?.start && window.FluxyDashboardRange?.end) {
            return {
                type: 'custom',
                start_date: window.FluxyDashboardRange.start,
                end_date: window.FluxyDashboardRange.end,
            };
        }
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
            type: 'this_month',
            start_date: toDateKey(start),
            end_date: toDateKey(end),
        };
    }

    function toDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async function getAuthToken() {
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) throw new Error('Please sign in again before using Fluxy AI.');
        return user.getIdToken();
    }

    function setFormDisabled(form, disabled) {
        form.querySelectorAll('input, button').forEach(control => {
            control.disabled = disabled;
        });
    }

    function addUserMessage(messages, text) {
        const msg = document.createElement('div');
        msg.className = 'message user';
        msg.textContent = text;
        messages.appendChild(msg);
        scrollToBottom(messages);
    }

    function addLoadingMessage(messages) {
        const msg = document.createElement('div');
        msg.className = 'loading-message';
        msg.innerHTML = `
            <div class="thinking-heading">
                <span>FluxyOS thinking</span>
                <span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
            </div>
        `;
        messages.appendChild(msg);
        scrollToBottom(messages);
        return {
            remove() {
                msg.remove();
            }
        };
    }

    function addErrorMessage(messages, text) {
        const msg = document.createElement('div');
        msg.className = 'message ai chat-error';
        msg.innerHTML = `<p class="message-title">Fluxy AI could not finish that.</p><p>${escapeHTML(text)}</p>`;
        messages.appendChild(msg);
        scrollToBottom(messages);
    }

    function addAnswerMessage(messages, answer) {
        const msg = document.createElement('div');
        msg.className = `message ai answer-card answer-${answer?.answer_type || 'analysis'}`;
        const shouldReveal = !prefersReducedMotion();
        msg.innerHTML = renderAnswer(answer, shouldReveal);
        messages.appendChild(msg);
        if (shouldReveal) revealAnswerSteps(msg, messages);
        scrollToBottom(messages);
    }

    function renderAnswer(answer, shouldReveal = false) {
        if (!answer) {
            return `<p class="message-title">No answer available</p><p>Fluxy AI did not receive a usable finance answer.</p>`;
        }
        const keyNumbers = Array.isArray(answer.key_numbers) && answer.key_numbers.length
            ? `<div class="answer-grid">${answer.key_numbers.map(renderKeyNumber).join('')}</div>`
            : '';
        const fallbackKind = fallbackKindForIntent(answer.intent);
        const insights = Array.isArray(answer.insights) && answer.insights.length
            ? `<div class="answer-section"><h4>Signals</h4>${answer.insights.map(item => renderInsight(item, fallbackKind)).join('')}</div>`
            : '';
        const actions = Array.isArray(answer.recommended_actions) && answer.recommended_actions.length
            ? `<div class="answer-section"><h4>Next steps</h4>${answer.recommended_actions.map(renderAction).join('')}</div>`
            : '';
        const limitations = Array.isArray(answer.limitations) && answer.limitations.length
            ? `<div class="answer-limitations"><span>Notes</span>${answer.limitations.map(item => `<p>${escapeHTML(item)}</p>`).join('')}</div>`
            : '';
        const followUps = Array.isArray(answer.follow_up_questions) && answer.follow_up_questions.length
            ? `<div class="answer-section"><h4>Follow-up</h4>${answer.follow_up_questions.map(q => `<p class="follow-up">${escapeHTML(q)}</p>`).join('')}</div>`
            : '';

        return `
            ${revealWrap(`
            <div class="answer-meta">
                <span>${escapeHTML(answer.period?.label || 'Selected period')}</span>
                <span>${escapeHTML(answer.intent || 'finance_analysis')}</span>
            </div>
            <p class="direct-answer">${escapeHTML(answer.direct_answer || '')}</p>
            `, 0, shouldReveal)}
            ${revealWrap(keyNumbers, 1, shouldReveal)}
            ${revealWrap(insights, 2, shouldReveal)}
            ${revealWrap(actions, 3, shouldReveal)}
            ${revealWrap(limitations, 4, shouldReveal)}
            ${revealWrap(followUps, 5, shouldReveal)}
        `;
    }

    function revealWrap(html, index, shouldReveal) {
        if (!html) return '';
        if (!shouldReveal) return html;
        return `<div class="answer-reveal-step" data-reveal-step="${index}" style="transition-delay: ${index * 120}ms">${html}</div>`;
    }

    function revealAnswerSteps(message, messages) {
        const steps = message.querySelectorAll('.answer-reveal-step');
        requestAnimationFrame(() => {
            steps.forEach(step => step.classList.add('is-visible'));
            window.setTimeout(() => scrollToBottom(messages), Math.max(220, steps.length * 120));
        });
    }

    function waitForMinimumThinkingTime(startedAt) {
        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, MIN_THINKING_MS - elapsed);
        return new Promise(resolve => window.setTimeout(resolve, wait));
    }

    function prefersReducedMotion() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    function renderKeyNumber(item) {
        return `
            <div class="key-number key-${escapeAttribute(item.status || 'neutral')}">
                <span><i aria-hidden="true"></i>${escapeHTML(item.label)}</span>
                <strong>${escapeHTML(item.formatted_value)}</strong>
            </div>
        `;
    }

    function renderInsight(item, fallbackKind) {
        const evidence = Array.isArray(item.evidence) && item.evidence.length
            ? `<div class="evidence-list">${item.evidence.slice(0, 3).map(record => renderEvidence(record, fallbackKind)).join('')}</div>`
            : '';
        return `
            <div class="insight insight-${escapeAttribute(item.severity || 'info')}">
                <p class="insight-title">${escapeHTML(item.title)}</p>
                <p>${escapeHTML(item.description)}</p>
                ${evidence}
            </div>
        `;
    }

    // Deep-link target page per record kind. Reuses the existing
    // /<page>?record=<id> contract every list page already consumes
    // (highlightFluxyLinkedTarget). No new navigation architecture.
    const KIND_TO_PATH = {
        transaction: '/ledger',
        bill: '/bill',
        subscription: '/subscription',
        revenue: '/revenue-sync',
    };

    function fallbackKindForIntent(intent) {
        if (intent === 'bills_analysis' || intent === 'cash_pressure') return 'bill';
        if (intent === 'subscription_analysis') return 'subscription';
        if (intent === 'revenue_analysis') return 'revenue';
        return 'transaction';
    }

    function evidenceHref(record, fallbackKind) {
        const kind = (record.record_kind && record.record_kind !== 'none') ? record.record_kind : fallbackKind;
        const base = KIND_TO_PATH[kind];
        if (!base || !record.id) return null;
        return `${base}?record=${encodeURIComponent(record.id)}`;
    }

    function renderEvidence(record, fallbackKind) {
        const name = record.vendor_name || record.label || 'Record';
        const amount = record.formatted_amount || record.formatted_value || '';
        const status = record.status ? ` · ${record.status}` : '';
        const inner = `<span>${escapeHTML(name)}${escapeHTML(status)}</span><strong>${escapeHTML(amount)}</strong>`;
        const href = evidenceHref(record, fallbackKind);
        if (href) {
            return `<a class="evidence-item evidence-link" href="${escapeAttribute(href)}">${inner}<svg class="evidence-arrow" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg></a>`;
        }
        return `<div class="evidence-item">${inner}</div>`;
    }

    function renderAction(item) {
        return `
            <div class="recommended-action priority-${escapeAttribute(item.priority || 'medium')}">
                <p class="insight-title"><span class="priority-dot" aria-hidden="true"></span>${escapeHTML(item.title)}</p>
                <p>${escapeHTML(item.description)}</p>
            </div>
        `;
    }

    function scrollToBottom(messages) {
        messages.scrollTop = messages.scrollHeight;
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        })[char]);
    }

    function escapeAttribute(value) {
        return escapeHTML(value).replace(/`/g, '&#96;');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
