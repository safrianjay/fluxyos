(function() {
    const chatHTML = `
        <div id="ai-chat-container">
            <div id="ai-chat-window">
                <div class="chat-header">
                    <div class="w-8 h-8 rounded bg-[#EA580C] flex items-center justify-center text-white shadow-lg">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </div>
                    <div>
                        <p class="font-bold text-[14px]">Fluxy AI Brain</p>
                        <p class="text-[10px] text-gray-400">Online & Ready to analyze</p>
                    </div>
                    <button id="close-chat" class="ml-auto text-gray-500 hover:text-white">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="chat-messages" id="chat-messages">
                    <div class="message ai">
                        Hi Safrian! I'm your AI financial brain. How can I help you analyze your data today?
                    </div>
                </div>
                <form class="chat-input-area" id="chat-form">
                    <input type="text" id="chat-input" placeholder="Ask anything about your money..." autocomplete="off">
                    <button type="submit">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                    </button>
                </form>
            </div>
            <div id="ai-chat-trigger">
                <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            </div>
        </div>
    `;

    function init() {
        if (document.getElementById('ai-chat-container')) return;
        
        // Inject HTML
        const wrapper = document.createElement('div');
        wrapper.innerHTML = chatHTML;
        document.body.appendChild(wrapper);

        // Elements
        const trigger = document.getElementById('ai-chat-trigger');
        const windowElem = document.getElementById('ai-chat-window');
        const closeBtn = document.getElementById('close-chat');
        const form = document.getElementById('chat-form');
        const input = document.getElementById('chat-input');
        const messages = document.getElementById('chat-messages');

        // Toggle
        trigger.onclick = () => windowElem.classList.toggle('active');
        closeBtn.onclick = () => windowElem.classList.remove('active');

        // Handle Chat
        form.onsubmit = async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;

            // User Message
            addMessage(text, 'user');
            input.value = '';

            // AI Thinking
            const thinking = addMessage('Thinking...', 'ai');
            
            try {
                const response = await fetch('/api/v1/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });
                const data = await response.json();
                thinking.innerText = data.reply || "I'm sorry, I couldn't process that right now.";
            } catch (err) {
                thinking.innerText = "Error connecting to AI brain. Please try again later.";
            }
        };

        function addMessage(text, type) {
            const msg = document.createElement('div');
            msg.className = `message ${type}`;
            msg.innerText = text;
            messages.appendChild(msg);
            messages.scrollTop = messages.scrollHeight;
            return msg;
        }
    }

    // Run when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
