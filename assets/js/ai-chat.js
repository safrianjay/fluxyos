(function() {
    const chatHTML = `
        <div id="ai-chat-container" style="display: none;">
            <div id="ai-chat-window">
                <div class="chat-header">
                    <div class="w-9 h-9 rounded-lg bg-[#EA580C] flex items-center justify-center text-white shadow-lg">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </div>
                    <div>
                        <p class="font-bold text-[15px]">Fluxy AI Analyst</p>
                        <p class="text-[11px] text-gray-400">Neural Intelligence Active</p>
                    </div>
                    <button id="close-chat" class="ml-auto p-2 text-gray-500 hover:text-white transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="chat-messages" id="chat-messages">
                    <div class="message ai">
                        Hi! I'm your Fluxy AI analyst. I can help you reconcile transactions, check spend limits, or project next month's revenue. What's on your mind?
                    </div>
                </div>
                <form class="chat-input-area" id="chat-form">
                    <input type="text" id="chat-input" placeholder="Analyze my finances..." autocomplete="off">
                    <button type="submit">
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

        // Global Toggle Function
        window.toggleFluxyAI = (state) => {
            console.log("Fluxy AI Toggled:", state);
            container.style.display = 'flex'; // Ensure container is visible
            
            if (state === true) {
                windowElem.classList.add('active');
            } else if (state === false) {
                windowElem.classList.remove('active');
                setTimeout(() => { container.style.display = 'none'; }, 400); // Hide after slide
            } else {
                const isActive = windowElem.classList.toggle('active');
                if (!isActive) setTimeout(() => { container.style.display = 'none'; }, 400);
            }
        };

        closeBtn.onclick = () => window.toggleFluxyAI(false);

        form.onsubmit = async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;

            addMessage(text, 'user');
            input.value = '';

            const thinking = addMessage('...', 'ai');
            
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

    // Run init immediately if DOM ready, otherwise wait
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
