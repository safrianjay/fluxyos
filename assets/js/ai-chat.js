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
            'Explain my business health',
            'What changed this month?',
            'What should I fix first?'
        ],
        ledger: [
            'Find missing receipts',
            'Show unusual expenses',
            'Can I trust this ledger?'
        ],
        bills: [
            'Which bills are due soon?',
            'What bills are risky?',
            'Summarize upcoming payables'
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
        ]
    };

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
                    <div class="message ai">
                        <p class="message-title">Here’s what I can analyze.</p>
                        <p>I can help with revenue, expenses, margin, bills, subscriptions, ledger cleanup, missing receipts, and operational finance risks from your FluxyOS data.</p>
                    </div>
                    <div class="prompt-chip-list" id="prompt-chip-list"></div>
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
        const promptList = document.getElementById('prompt-chip-list');

        renderPromptChips(promptList, getPageContext(), submitPrompt);

        window.toggleFluxyAI = (state) => {
            container.style.display = 'flex';
            if (state === true) {
                windowElem.classList.add('active');
                input.focus();
                return;
            }
            if (state === false) {
                windowElem.classList.remove('active');
                setTimeout(() => { container.style.display = 'none'; }, 400);
                return;
            }
            const isActive = windowElem.classList.toggle('active');
            if (isActive) input.focus();
            if (!isActive) setTimeout(() => { container.style.display = 'none'; }, 400);
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
                        page_context: getPageContext(),
                        period: getCurrentPeriod(),
                    }),
                });
                const data = await response.json().catch(() => ({}));
                loading.remove();
                if (!response.ok || data.success === false) {
                    addErrorMessage(messages, data?.error?.message || data?.message || 'Fluxy AI could not read your finance data right now.');
                    return;
                }
                addAnswerMessage(messages, data.answer);
            } catch (err) {
                loading.remove();
                addErrorMessage(messages, err?.message || 'Error connecting to Fluxy AI. Please try again later.');
            } finally {
                setFormDisabled(form, false);
                input.focus();
            }
        }
    }

    function renderPromptChips(container, pageContext, onSelect) {
        const prompts = [...(PROMPTS[pageContext] || []), ...PROMPTS.global].slice(0, 7);
        container.innerHTML = prompts.map(prompt => (
            `<button type="button" class="prompt-chip" data-prompt="${escapeAttribute(prompt)}">${escapeHTML(prompt)}</button>`
        )).join('');
        container.querySelectorAll('.prompt-chip').forEach(button => {
            button.addEventListener('click', () => onSelect(button.dataset.prompt));
        });
    }

    function getPageContext() {
        const path = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '');
        if (path.includes('ledger')) return 'ledger';
        if (path.includes('bill')) return 'bills';
        if (path.includes('subscription')) return 'subscriptions';
        if (path.includes('revenue-sync') || path.includes('revenuesync')) return 'revenue_sync';
        if (path.includes('dashboard')) return 'dashboard';
        return 'global';
    }

    function getCurrentPeriod() {
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
        msg.className = 'message ai loading-message';
        msg.innerHTML = `
            <div class="loading-line w-3/4"></div>
            <div class="loading-line w-full"></div>
            <div class="loading-line w-1/2"></div>
        `;
        messages.appendChild(msg);
        scrollToBottom(messages);
        return msg;
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
        msg.innerHTML = renderAnswer(answer);
        messages.appendChild(msg);
        scrollToBottom(messages);
    }

    function renderAnswer(answer) {
        if (!answer) {
            return `<p class="message-title">No answer available</p><p>Fluxy AI did not receive a usable finance answer.</p>`;
        }
        const keyNumbers = Array.isArray(answer.key_numbers) && answer.key_numbers.length
            ? `<div class="answer-grid">${answer.key_numbers.map(renderKeyNumber).join('')}</div>`
            : '';
        const insights = Array.isArray(answer.insights) && answer.insights.length
            ? `<div class="answer-section"><h4>What this means</h4>${answer.insights.map(renderInsight).join('')}</div>`
            : '';
        const actions = Array.isArray(answer.recommended_actions) && answer.recommended_actions.length
            ? `<div class="answer-section"><h4>Recommended next actions</h4>${answer.recommended_actions.map(renderAction).join('')}</div>`
            : '';
        const limitations = Array.isArray(answer.limitations) && answer.limitations.length
            ? `<div class="answer-limitations">${answer.limitations.map(item => `<p>${escapeHTML(item)}</p>`).join('')}</div>`
            : '';
        const followUps = Array.isArray(answer.follow_up_questions) && answer.follow_up_questions.length
            ? `<div class="answer-section"><h4>Follow-up</h4>${answer.follow_up_questions.map(q => `<p class="follow-up">${escapeHTML(q)}</p>`).join('')}</div>`
            : '';

        return `
            <div class="answer-meta">
                <span>${escapeHTML(answer.period?.label || 'Selected period')}</span>
                <span>${escapeHTML(answer.intent || 'finance_analysis')}</span>
            </div>
            <p class="direct-answer">${escapeHTML(answer.direct_answer || '')}</p>
            ${keyNumbers}
            ${insights}
            ${actions}
            ${limitations}
            ${followUps}
        `;
    }

    function renderKeyNumber(item) {
        return `
            <div class="key-number key-${escapeAttribute(item.status || 'neutral')}">
                <span>${escapeHTML(item.label)}</span>
                <strong>${escapeHTML(item.formatted_value)}</strong>
            </div>
        `;
    }

    function renderInsight(item) {
        const evidence = Array.isArray(item.evidence) && item.evidence.length
            ? `<div class="evidence-list">${item.evidence.slice(0, 3).map(renderEvidence).join('')}</div>`
            : '';
        return `
            <div class="insight insight-${escapeAttribute(item.severity || 'info')}">
                <p class="insight-title">${escapeHTML(item.title)}</p>
                <p>${escapeHTML(item.description)}</p>
                ${evidence}
            </div>
        `;
    }

    function renderEvidence(record) {
        const name = record.vendor_name || record.label || 'Record';
        const amount = record.formatted_amount || record.formatted_value || '';
        const status = record.status ? ` · ${record.status}` : '';
        return `<div class="evidence-item"><span>${escapeHTML(name)}${escapeHTML(status)}</span><strong>${escapeHTML(amount)}</strong></div>`;
    }

    function renderAction(item) {
        return `
            <div class="recommended-action priority-${escapeAttribute(item.priority || 'medium')}">
                <p class="insight-title">${escapeHTML(item.title)}</p>
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
