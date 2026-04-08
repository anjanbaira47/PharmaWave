// chatWidget.js - Manages the floating chat interface and Socket.in connection
const API_BASE = window.APP_CONFIG ? window.APP_CONFIG.API_BASE : (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' ? 'http://localhost:3000' : '');

function injectChatWidget(role = 'user') {
    // Inject HTML
    const chatHtml = `
    <div id="pw-chat-widget" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999; font-family: 'Inter', sans-serif;">
        <!-- Chat Bubble Button -->
        <button id="pw-chat-btn" style="width: 60px; height: 60px; border-radius: 50%; background: #10b981; color: white; border: none; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s;">
            <ion-icon name="chatbubbles" style="font-size: 28px;"></ion-icon>
            <span id="pw-chat-badge" style="display: none; position: absolute; top: -5px; right: -5px; background: #ef4444; color: white; font-size: 12px; font-weight: bold; width: 22px; height: 22px; border-radius: 50%; align-items: center; justify-content: center;">0</span>
        </button>

        <!-- Chat Window -->
        <div id="pw-chat-window" style="display: none; position: absolute; bottom: 80px; right: 0; width: 350px; height: 500px; background: white; border-radius: 20px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15); border: 1px solid #e2e8f0; flex-direction: column; overflow: hidden; transform-origin: bottom right; animation: chatPop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; color: white; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; font-size: 18px; font-weight: 800;">PharmaWave Support</h3>
                    <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.9;">We typically reply in minutes</p>
                </div>
                <button id="pw-chat-close" style="background: none; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 5px;">
                    <ion-icon name="close" style="font-size: 24px;"></ion-icon>
                </button>
            </div>

            <!-- Messages Area -->
            <div id="pw-chat-messages" style="flex: 1; padding: 20px; overflow-y: auto; background: #f8fafc; display: flex; flex-direction: column; gap: 15px;">
                <div style="text-align: center; margin-bottom: 10px;">
                    <span style="background: #e2e8f0; color: #64748b; font-size: 11px; padding: 4px 10px; border-radius: 50px; font-weight: 700;">Today</span>
                </div>
            </div>

            <!-- Input Area -->
            <div style="padding: 15px; background: white; border-top: 1px solid #e2e8f0; display: flex; gap: 10px; align-items: center;">
                <input type="text" id="pw-chat-input" placeholder="Type a message..." style="flex: 1; padding: 12px 15px; border: 1px solid #e2e8f0; border-radius: 25px; outline: none; font-size: 14px; background: #f8fafc; transition: all 0.2s;">
                <button id="pw-chat-send" style="background: #10b981; color: white; border: none; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s;">
                    <ion-icon name="send" style="font-size: 18px; transform: translateX(2px);"></ion-icon>
                </button>
            </div>
        </div>
    </div>
    <style>
        @keyframes chatPop { 0% { opacity: 0; transform: scale(0.9); } 100% { opacity: 1; transform: scale(1); } }
        #pw-chat-input:focus { border-color: #10b981; background: white; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1); }
        #pw-chat-btn:hover { transform: scale(1.05); }
        #pw-chat-send:hover { transform: scale(1.05); }
        #pw-chat-send:active { transform: scale(0.95); }
        
        /* Message Styles */
        .msg-bubble { max-width: 80%; padding: 12px 16px; border-radius: 18px; font-size: 14px; line-height: 1.5; position: relative; word-wrap: break-word; }
        .msg-sent { background: #10b981; color: white; align-self: flex-end; border-bottom-right-radius: 4px; }
        .msg-recv { background: white; color: #334155; border: 1px solid #e2e8f0; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.02); }
        .msg-time { font-size: 10px; opacity: 0.7; margin-top: 5px; text-align: right; display: block; }
        .msg-sender-name { font-size: 11px; font-weight: 700; color: #94a3b8; margin-bottom: 4px; display: block; }
    </style>
    `;

    document.body.insertAdjacentHTML('beforeend', chatHtml);

    // Initial message
    addMessage("Welcome to PharmaWave! How can we help you today?", false, "Support Agent");

    // UI Logic
    const btn = document.getElementById('pw-chat-btn');
    const windowEl = document.getElementById('pw-chat-window');
    const closeBtn = document.getElementById('pw-chat-close');
    const badge = document.getElementById('pw-chat-badge');
    const input = document.getElementById('pw-chat-input');
    const sendBtn = document.getElementById('pw-chat-send');
    let unreadCount = 0;

    btn.addEventListener('click', () => {
        windowEl.style.display = windowEl.style.display === 'none' ? 'flex' : 'none';
        if (windowEl.style.display === 'flex') {
            unreadCount = 0;
            updateBadge();
            input.focus();
            scrollToBottom();
        }
    });

    closeBtn.addEventListener('click', () => { windowEl.style.display = 'none'; });

    // Socket Logic
    let currentUser = null;
    let localKey = 'pharmaUser';

    try {
        const stored = localStorage.getItem(localKey);
        if (stored) currentUser = JSON.parse(stored);
    } catch (e) { }

    // Load socket.io script dynamically if not present
    if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = `${API_BASE}/socket.io/socket.io.js`; // Pointing to local node server socket
        script.onload = initSocketConnection;
        document.head.appendChild(script);
    } else {
        initSocketConnection();
    }

    let socket;
    function initSocketConnection() {
        if (!currentUser) return; // Must be logged in

        socket = io(API_BASE);

        socket.on("connect", () => {
            console.log("Chat connected!");
            // Join specific room
            socket.emit("join", { userId: currentUser.userId || currentUser.id, role: currentUser.role });
        });

        socket.on("receiveMessage", (data) => {
            // Determine if the message should trigger unread
            if (data.senderId !== (currentUser.userId || currentUser.id)) {
                addMessage(data.message, false, data.senderName || "User");
                if (windowEl.style.display === 'none') {
                    unreadCount++;
                    updateBadge();
                }
            }
        });

        socket.on("messageDelivered", (data) => {
            // Optional: show a checkmark or update status
        });
    }

    function addMessage(text, isSent, senderName = "Support") {
        if (!text.trim()) return;
        const msgArea = document.getElementById('pw-chat-messages');
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let html = '';
        if (isSent) {
            html = `
                <div class="msg-bubble msg-sent">
                    ${text}
                    <span class="msg-time">${time}</span>
                </div>
            `;
        } else {
            html = `
                <div class="msg-bubble msg-recv">
                    <span class="msg-sender-name">${senderName}</span>
                    ${text}
                    <span class="msg-time" style="color: #94a3b8;">${time}</span>
                </div>
            `;
        }

        msgArea.insertAdjacentHTML('beforeend', html);
        scrollToBottom();
    }

    function sendMessage() {
        const text = input.value.trim();
        if (!text || !socket || !currentUser) return;

        // Determine receiver depending on role context
        // If normal user -> send to 'admin' role
        // If admin -> send to user context based on active view (mock default support for now)
        let targetRole = currentUser.role === 'admin' ? 'user' : 'admin';

        socket.emit("sendMessage", {
            senderId: currentUser.userId || currentUser.id,
            senderName: currentUser.username,
            role: targetRole,
            message: text,
            timestamp: new Date()
        });

        addMessage(text, true);
        input.value = '';
    }

    function updateBadge() {
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }

    function scrollToBottom() {
        const msgArea = document.getElementById('pw-chat-messages');
        msgArea.scrollTop = msgArea.scrollHeight;
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}
