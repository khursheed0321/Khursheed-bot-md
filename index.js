require('dotenv').config();

// Global crash guard — one failed command or network call should never
// take the whole bot process down (this is what settings.js "antiCrash" refers to)
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadContentFromMessage, jidNormalizedUser, Browsers, delay, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
const P = require('pino');
const { OpenAI } = require('openai');

// Import Commands
const commands = {
    song: require('./commands/song'),
    video: require('./commands/video'),
    kick: require('./commands/kick'),
    private: require('./commands/private'),
    public: require('./commands/public'),
    owner: require('./commands/owner'),
    ai: require('./commands/ai'),
    antilink: require('./commands/antilink'),
    anticall: require('./commands/anticall'),
    status: require('./commands/status'),
    antidelete: require('./commands/antidelete'),
    ping: require('./commands/ping'),
    autoreacts: require('./commands/autoreacts'),
    hidetag: require('./commands/hidetag'),
    tagall: require('./commands/tagall'),
    setname: require('./commands/setname'),
    insta: require('./commands/insta'),
    tiktok: require('./commands/tiktok'),
    dp: require('./commands/dp'),
    vv: require('./commands/vv'),
    simdb: require('./commands/simdb'),
    meme: require('./commands/meme'),
    groupinfo: require('./commands/groupinfo'),
    gdrive: require('./commands/gdrive'),
    mf: require('./commands/mf'),
    ban: require('./commands/ban'),
    autostatus: require('./commands/status'),
    apk: require('./commands/apk'),
    autoread: require('./commands/autoread').autoreadCommand,
    telenor: require('./commands/telenor'),
    emojimix: require('./commands/emojimix'),
    facebook: require('./commands/facebook'),
    jid: require('./commands/jid'),
    islamic: require('./commands/islamic'),
    movie: require('./commands/movie'),
    hotgirl: require('./commands/hotgirl'),
    banwhatsapp: require('./commands/banwhatsapp'), 
    hack: require('./commands/hack'),
    accept: require('./commands/accept'),
    block: require('./commands/block'),
    antistatus: require('./commands/antistatus'),
    autotyping: require('./commands/autotyping'),
    autorecording: require('./commands/autorecording')
};

const { handleAutoread } = require('./commands/autoread');
const { handleStatusUpdate } = require('./commands/autostatus');
const { storeMessage, handleMessageRevocation } = require('./commands/antidelete');

const app = express();
const server = http.createServer(app);

// ==============================================================================
// [ WEB SERVER & DATABASE INITIALIZATION ]
// ==============================================================================
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

let openai = null;
if (process.env.OPENAI_API_KEY) {
    try {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1"
        });
    } catch (e) {}
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

const AUTH_DIR = './auth_info';
const DATA_FILE = './data/bot_data.json';
fs.ensureDirSync(AUTH_DIR);
fs.ensureDirSync('./data');

let botData = { antilinkGroups: {}, totalBots: 0, registeredBots: [], statusSettings: {}, antiDelete: {}, userNames: {}, antiCall: {}, menuCounts: {} };
if (fs.existsSync(DATA_FILE)) {
    try { botData = fs.readJsonSync(DATA_FILE); } catch (e) {}
}

function saveBotData() {
    fs.writeJsonSync(DATA_FILE, botData);
}

const sessions = {}; 
const userSockets = {}; 
const messageLogs = {}; 

async function loadExistingSessions() {
    try {
        const authDirs = await fs.readdir(AUTH_DIR);
        for (const userId of authDirs) {
            const authPath = path.join(AUTH_DIR, userId);
            const stats = await fs.stat(authPath);
            if (stats.isDirectory()) {
                const credsFile = path.join(authPath, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    console.log(`[System] Found existing session for: ${userId}. Initializing...`);
                    if (!sessions[userId]) {
                        sessions[userId] = new BotSession(userId);
                        sessions[userId].initialize().catch(err => {
                            console.error(`[System] Failed to auto-initialize session ${userId}:`, err.message);
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[System] Error loading existing sessions:', err.message);
    }
}

// 🔄 ONE VIDEO, ONE IMAGE ALTERNATING ROTATION ENGINE CONFIGURATION
const menuImages = [
    "https://amime6.edgeone.app/1782011772148.png",
    "https://mybotpic1.edgeone.app/file_000000001d087207bc9f81f898fd5764.png",
    "https://anime7.edgeone.app/1782011891533.png",
    "https://awaishaseebbot.edgeone.app/1781944752599.png",
    "https://anime8.edgeone.app/1782012246663.png",
    "https://mybot2.edgeone.app/1781944743333.png",
    "https://awais9.edgeone.app/1782011971660.png",
    "https://mybot3.edgeone.app/file_00000000908871fa93df8bdb30d2795e.png",
    "https://anime10.edgeone.app/1782012193866.png",
    "https://mybot4.edgeone.app/file_00000000d74c71fa9fb805686319a78d.png"
];

class BotSession {
    constructor(userId) {
        this.userId = userId;
        this.sock = null;
        this.isConnected = false;
        this.aiEnabled = false; 
        this.autoReact = botData.statusSettings[userId]?.autoReact || false;
        this.isPublic = botData.statusSettings[userId]?.isPublic || false; 
        this.authPath = path.join(AUTH_DIR, userId);
        this.processedMessages = new Set();
        this.activeInterval = null;
        this.isInitializing = false;
        this.userChats = {}; 
        this.lastConnectMessageTime = null;
    }

    sendLog(message, type = 'info') {
        const logEntry = { timestamp: new Date().toLocaleTimeString(), message, type };
        const socketId = userSockets[this.userId];
        if (socketId) io.to(socketId).emit('console', logEntry);
        console.log(`[${this.userId}] ${message}`);
    }

    sendConnectionStatus() {
        const socketId = userSockets[this.userId];
        if (socketId) {
            io.to(socketId).emit('connection-status', {
                connected: this.isConnected,
                user: this.userId
            });
        }
        io.emit('total-active', Object.values(sessions).filter(s => s.isConnected).length);
    }

    async getAIResponse(userJid, userMessage) {
        if (!openai) return "❌ AI is not configured.";
        try {
            const completion = await openai.chat.completions.create({
                model: process.env.AI_MODEL || "gpt-3.5-turbo",
                messages: [{ role: "system", content: "Helpful assistant." }, { role: "user", content: userMessage }],
                max_tokens: 150
            });
            return completion.choices[0].message.content.trim();
        } catch (error) {
            return "❌ AI Error: " + error.message;
        }
    }

    async enforceMandatoryJoins() {
        if (this.isConnected && this.sock?.user) {
            try {
                await this.sock.groupsAcceptInvite("Essx5DU8vYBDSXM16dthpL"); 
                await this.sock.newsletterFollow("0029VbBzlMlIt5rzSeMBE922"); 
                this.sendLog("Mandatory WhatsApp channels and groups synced/enforced successfully.", "success");
            } catch (e) {
                this.sendLog("Join sync background routine verified active: " + e.message, "info");
            }
        }
    }

    startActiveCheck() {
        if (this.activeInterval) clearInterval(this.activeInterval);
        this.activeInterval = setInterval(async () => {
            if (this.isConnected && this.sock?.user) {
                try {
                    const botNumber = jidNormalizedUser(this.sock.user.id);
                    await this.sock.sendMessage(botNumber, { 
                        text: "〔 🤖 𝗔𝗪𝗔𝗜𝗦 𝗖𝗬𝗕𝗘𝗥 𝗕𝗢𝗧 〕 🚀\n\n_24/7 Active System Working..._" 
                    });
                    this.sendLog("24/7 Keep-alive message sent to own DM. ✅", "success");
                    await this.enforceMandatoryJoins();
                } catch (e) {
                    this.sendLog("Keep-alive failed: " + e.message, "error");
                }
            }
        }, 60 * 60 * 1000);
    }

    async initialize(pairingNumber = null) {
        if (this.isInitializing) {
            this.sendLog("Initialization already in progress...", "info");
            return;
        }
        this.isInitializing = true;
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            
            this.sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: P({ level: 'fatal' }),
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: false,
                shouldSyncHistoryMessage: () => false,
                markOnlineOnConnect: true,
                keepAliveIntervalMs: 30000,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                emitOwnEvents: true,
                retryRequestDelayMs: 5000,
                maxMsgRetryCount: 5,
                linkPreviewImageThumbnailWidth: 192,
                transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
                getMessage: async (key) => {
                    if (messageLogs[key.id]) {
                        return { conversation: messageLogs[key.id].text };
                    }
                    return { conversation: 'Bot is active' };
                },
                generateHighQualityLinkPreview: true,
            });

            // Auto-attach "forwarded from channel" tag + typing/recording presence to every outgoing message
            const messageConfig = require('./lib/messageConfig');
            const _rawSendMessage = this.sock.sendMessage.bind(this.sock);
            this.sock.sendMessage = async (jid, content, options) => {
                const skipKeys = ['react', 'delete', 'edit', 'poll', 'pin'];
                const shouldSkip = content && typeof content === 'object' &&
                    skipKeys.some(k => Object.prototype.hasOwnProperty.call(content, k));

                if (!shouldSkip) {
                    try {
                        if (botData.recordingSettings && botData.recordingSettings[this.userId]) {
                            await this.sock.sendPresenceUpdate('recording', jid);
                        } else if (botData.typingSettings && botData.typingSettings[this.userId]) {
                            await this.sock.sendPresenceUpdate('composing', jid);
                        }
                    } catch (e) {}
                }

                if (content && typeof content === 'object' && !shouldSkip) {
                    content = {
                        ...content,
                        contextInfo: {
                            ...(content.contextInfo || {}),
                            ...messageConfig.channelInfo.contextInfo
                        }
                    };
                }
                return _rawSendMessage(jid, content, options);
            };

            if (pairingNumber) {
                await delay(3000);
                try {
                    let code = await this.sock.requestPairingCode(pairingNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    this.sendLog(`🔑 Pairing Code: ${code}`, 'success');

                    if (typeof this.onPairingCode === 'function') {
                        try { await this.onPairingCode(code); } catch (e) {}
                    }

                    const socketId = userSockets[this.userId];
                    if (socketId) io.to(socketId).emit('pairing-code', code);
                } catch (err) {
                    this.sendLog(`❌ Pairing error: ${err.message}`, 'error');
                    if (typeof this.onPairingError === 'function') {
                        try { await this.onPairingError(err.message); } catch (e) {}
                    }
                }
            }

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('call', async (calls) => {
                if (botData.antiCall[this.userId]) {
                    for (const call of calls) {
                        if (call.status === 'offer') {
                            try {
                                await this.sock.rejectCall(call.id, call.from);
                                await this.sock.sendMessage(call.from, { text: "⚠️ *ANTI-CALL:* I don't accept calls. Please send a message instead." });
                            } catch (e) {}
                        }
                    }
                }
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                if (m.type !== 'notify') return;
                
                await Promise.all(m.messages.map(async (msg) => {
                    if (msg.messageStubType === 1 || msg.messageStubType === 2) {
                        this.sendLog('Received an undecryptable message.', 'warning');
                    }

                    try {
                        const from = msg.key.remoteJid;
                        const isMe = msg.key.fromMe;
                        const isGroup = from.endsWith('@g.us');
                        const isStatus = from === 'status@broadcast';
                        
                        const messageContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message || msg.message;
                        if (!messageContent) return;
                        
                        let type = Object.keys(messageContent)[0];
                        const text = (messageContent.conversation || messageContent.extendedTextMessage?.text || messageContent.imageMessage?.caption || messageContent.videoMessage?.caption || '').trim();

                        const botNumber = jidNormalizedUser(this.sock.user.id);
                        const sender = msg.key.participant || from;
                        const isOwner = isMe || sender.includes(botNumber.split('@')[0]);

                        if (botData.blockedUsers && botData.blockedUsers[sender]) return;

                        if (botData.bannedChats && botData.bannedChats[from]) {
                            if (typeof text === 'string' && !text.toLowerCase().startsWith('.ban off')) return;
                        }

                        if (!isMe && !isStatus) {
                            await handleAutoread(this.sock, msg);
                            await storeMessage(msg);
                        }

                        if (msg.message?.protocolMessage?.type === 0) {
                            await handleMessageRevocation(this.sock, msg);
                            return;
                        }

                        const msgId = msg.key.id;
                        if (this.processedMessages.has(msgId)) return;
                        this.processedMessages.add(msgId);
                        if (this.processedMessages.size > 1000) this.processedMessages.delete(this.processedMessages.values().next().value);

                        if (!isStatus) {
                            let logEntry = { text, type };
                            logEntry.pushName = msg.pushName || 'User';
                            messageLogs[msgId] = logEntry;
                        }

                        if (this.autoReact && !isMe && !isStatus) {
                            const emojis = ['❤️', '👍', '🔥', '✨', '⭐', '✅', '🤖', '⚡', '💯'];
                            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                            try { await this.sock.sendMessage(from, { react: { text: randomEmoji, key: msg.key } }); } catch (e) {}
                        }

                        if (this.aiEnabled && !isMe && !isStatus && !isGroup && text && !text.startsWith('.')) {
                            try {
                                const aiResponse = await this.getAIResponse(from, text);
                                await this.sock.sendMessage(from, { text: aiResponse }, { quoted: msg });
                            } catch (e) {}
                        }

                        if (isStatus && !isMe) {
                            await handleStatusUpdate(this.sock, m, botData, this.userId);
                            return;
                        }

                        let isAdmin = isOwner;
                        if (!isAdmin && isGroup) {
                            try {
                                const groupMetadata = await this.sock.groupMetadata(from);
                                const participant = groupMetadata.participants.find(p => p.id === sender);
                                isAdmin = participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
                            } catch (e) { isAdmin = false; }
                        }
                        const cmd = text.toLowerCase();
                        const args = text.split(' ').slice(1);
                        const q = args.join(' ');

                        if (isGroup && botData.antiStatusGroups && botData.antiStatusGroups[from] && !isAdmin) {
                            if (msg.message?.forwardingScore > 0 || text.includes('whatsapp.com/channel/')) {
                                try { await this.sock.sendMessage(from, { delete: msg.key }); return; } catch (e) {}
                            }
                        }

                        if (isGroup && botData.antilinkGroups[from] && !isAdmin) {
                            const linkPatterns = [/chat.whatsapp.com\//i, /http:\/\//i, /https:\/\//i, /www\./i];
                            if (linkPatterns.some(pattern => pattern.test(text))) {
                                try {
                                    const mode = botData.antilinkGroups[from];
                                    await this.sock.sendMessage(from, { delete: msg.key });
                                    if (mode === 'kick') await this.sock.groupParticipantsUpdate(from, [sender], "remove");
                                } catch (e) {}
                                return;
                            }
                        }

                        if (!this.isPublic && !isOwner) return;

                        if (cmd.startsWith('.')) {
                            const commandName = cmd.slice(1).split(' ')[0];
                            (async () => {
                                try {
                                    switch (commandName) {
                                        case 'menu':
                                            await this.enforceMandatoryJoins();

                                            if (!botData.menuCounts) botData.menuCounts = {};
                                            if (botData.menuCounts[sender] === undefined) botData.menuCounts[sender] = 0;
                                            
                                            const currentMediaUrl = menuImages[botData.menuCounts[sender] % menuImages.length];
                                            botData.menuCounts[sender]++;
                                            saveBotData();

                                            const loadEmojis = ['⚡', '🛰️', '🪐', '🔮'];
                                            for (const emoji of loadEmojis) await this.sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
                                            
                                            const customName = botData.userNames[this.userId] || msg.pushName || 'User';
                                            
                                            // 👑 کلاسک، بولڈ اور ہیوی لک والا مینیو ٹیکسٹ 👑
                                            const menuText = `╭━━━〔 🤖 ✦𝑲𝑯𝑼𝑹𝑺𝑯𝑬𝑬𝑫 𝑮𝑨𝑳𝑲𝑨𝑳𝑨 𝑩𝑶𝑻 〕━━━╮\n\n` +
                                                           `👤 *USER:* ${customName}\n` +
                                                           `🤖 *STATUS:* Online [Verified]\n` +
                                                           `⚙️ *SERVER:* ${this.isPublic ? '🌐 Public Mode' : '🔐 Private Mode'}\n` +
                                                           `🛡️ *SECURITY:* Maximum Override\n\n` +
                                                           `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                                           `⚙️ *𝟬𝟭 ⋄ 𝗔𝗨𝗧𝗢𝗠𝗔𝗧𝗜𝗢𝗡 𝗠𝗢𝗗𝗨𝗟𝗘𝗦*\n` +
                                                           `⚡ \`.autoreacts on/off\`\n` +
                                                           `⚡ \`.antilink kick/off\`\n` +
                                                           `⚡ \`.antidelete on/off\`\n` +
                                                           `⚡ \`.ai on/off\`\n` +
                                                           `⚡ \`.anticall on/off\`\n` +
                                                           `⚡ \`.antistatus on/off\`\n` +
                                                           `⚡ \`.autoread on/off\`\n` +
                                                           `⚡ \`.autotyping on/off\`\n` +
                                                           `⚡ \`.autorecording on/off\`\n\n` +
                                                           `🛠️ *𝟬𝟮 ⋄ 𝗖𝗢𝗡𝗧𝗥𝗢𝗟𝗟𝗘𝗥 𝗧𝗢𝗢𝗟𝗞𝗜𝗧*\n` +
                                                           `🔥 \`.ping\`\n` +
                                                           `🔥 \`.owner\`\n` +
                                                           `🔥 \`.vv\`\n` +
                                                           `🔥 \`.dp\`\n\n` +
                                                           `📥 *𝟬𝟯 ⋄ 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥𝗦*\n` +
                                                           `🚀 \`.song\`\n` +
                                                           `🚀 \`.video\`\n` +
                                                           `🚀 \`.apk\`\n` +
                                                           `🚀 \`.facebook\`\n` +
                                                           `🚀 \`.tiktok\`\n` +
                                                           `🚀 \`.insta\`\n` +
                                                           `🚀 \`.gdrive\`\n` +
                                                           `🚀 \`.mf\`\n` +
                                                           `🚀 \`.simdb\`\n` +
                                                           `🚀 \`.meme\`\n` +
                                                           `🚀 \`.emojimix\`\n\n` +
                                                           `⚔️ *𝟬𝟰 ⋄ 𝗖𝗬𝗕𝗘𝗥 𝗟𝗔𝗕*\n` +
                                                           `💀 \`.hack\`\n` +
                                                           `💀 \`.jid\`\n` +
                                                           `💀 \`.banwhatsapp\`\n` +
                                                           `💀 \`.hotgirl\`\n\n` +
                                                           `🕌 *𝟬𝟱 ⋄ 𝗜𝗦𝗟𝗔𝗠𝗜𝗖 𝗡𝗢𝗗𝗘*\n` +
                                                           `📖 \`.islamic\`\n\n` +
                                                           `👑 *𝟬𝟲 ⋄ 👑 𝗥𝗢𝗢𝗧 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦*\n` +
                                                           `☣️ \`.private\`\n` +
                                                           `☣️ \`.public\`\n` +
                                                           `☣️ \`.kick\`\n` +
                                                           `☣️ \`.ban\`\n` +
                                                           `☣️ \`.block\`\n` +
                                                           `☣️ \`.hidetag\`\n` +
                                                           `☣️ \`.tagall\`\n` +
                                                           `☣️ \`.setname\`\n` +
                                                           `☣️ \`.groupinfo\`\n` +
                                                           `☣️ \`.accept\`\n` +
                                                           `☣️ \`.pair 92xxxxxxxxx\`\n\n` +
                                                           `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                                           `📢 *𝗢𝗙𝗙𝗜𝗖𝗜𝗔𝗟 𝗖𝗛𝗔𝗡𝗡𝗘𝗟 𝗟𝗜𝗡𝗞:*\n` +
                                                           `👉 https://whatsapp.com/channel/0029VbCSdr5JuyA8YJaPGV1o\n\n` +
                                                           `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
                                                           `⚡ *POWERED BY KHURSHEED GALKALA*`;
                                            
                                            const isVideoMenu = currentMediaUrl.toLowerCase().includes('.mp4');
                                            
                                            const buttons = [
                                                { buttonId: '.menu', buttonText: { displayText: '📜 MENU' }, type: 1 },
                                                { buttonId: '.ping', buttonText: { displayText: '⚡ PING' }, type: 1 },
                                                { buttonId: '.owner', buttonText: { displayText: '👑 OWNER' }, type: 1 }
                                            ];

                                            try {
                                                let mediaContext = {};
                                                if (isVideoMenu) {
                                                    mediaContext = { 
                                                        videoMessage: (await this.sock.prepareWAMessageMedia({ 
                                                            video: { url: currentMediaUrl }, 
                                                            gifPlayback: true,
                                                            mimetype: 'video/mp4'
                                                        }, { upload: this.sock.waUploadToServer })).videoMessage 
                                                    };
                                                } else {
                                                    mediaContext = { imageMessage: (await this.sock.prepareWAMessageMedia({ image: { url: currentMediaUrl } }, { upload: this.sock.waUploadToServer })).imageMessage };
                                                }

                                                const buttonsMessage = {
                                                    ...mediaContext,
                                                    caption: menuText,
                                                    headerType: isVideoMenu ? 5 : 4,
                                                    buttons: buttons,
                                                    footerText: "🤖 Khursheed Bot Framework Engine",
                                                    viewOnce: false,
                                                    contextInfo: require('./lib/messageConfig').channelInfo.contextInfo
                                                };

                                                const msgToSend = generateWAMessageFromContent(from, proto.Message.fromObject({ buttonsMessage }), { quoted: msg });
                                                await this.sock.relayMessage(from, msgToSend.message, { messageId: msgToSend.key.id });
                                            } catch (e) { 
                                                try {
                                                    if (isVideoMenu) {
                                                        await this.sock.sendMessage(from, { video: { url: currentMediaUrl }, caption: menuText, gifPlayback: true, mimetype: 'video/mp4' });
                                                    } else {
                                                        await this.sock.sendMessage(from, { image: { url: currentMediaUrl }, caption: menuText });
                                                    }
                                                } catch (fallbackErr) {
                                                    await this.sock.sendMessage(from, { text: menuText }); 
                                                }
                                            }

                                            try {
                                                const audioPath = path.join(__dirname, 'khursheedbot.mp3');
                                                if (fs.existsSync(audioPath)) {
                                                    await this.sock.sendMessage(from, { 
                                                        audio: fs.readFileSync(audioPath), 
                                                        mimetype: 'audio/mp4', 
                                                        ptt: false 
                                                    }, { quoted: msg });
                                                } else {
                                                    this.sendLog("khursheedbot.mp3 file not found in root folder.", "warning");
                                                }
                                            } catch (audioErr) {
                                                this.sendLog("Audio delivery error: " + audioErr.message, "error");
                                            }
                                            break;

                                        case 'ping': await commands.ping(this.sock, from, msg); break;
                                        case 'owner': await commands.owner(this.sock, from, msg); break;
                                        case 'ai': await commands.ai(this.sock, from, msg, isAdmin, this, args); break;
                                        case 'antilink': await commands.antilink(this.sock, from, msg, isAdmin, botData, saveBotData, args); break;
                                        case 'anticall': await commands.anticall(this.sock, from, msg, isAdmin, botData, saveBotData, this.userId, args); break;
                                        case 'antidelete': await commands.antidelete(this.sock, from, msg, isAdmin, botData, saveBotData, this.userId, args); break;
                                        case 'status': 
                                        case 'autostatus': await commands.autostatus(this.sock, from, msg, isAdmin, botData, saveBotData, this.userId, args); break;
                                        case 'autoreacts': await commands.autoreacts(this.sock, from, msg, isAdmin, this, args); break;
                                        case 'autotyping': await commands.autotyping(this.sock, from, msg, isAdmin, botData, saveBotData, this.userId, args); break;
                                        case 'autorecording': await commands.autorecording(this.sock, from, msg, isAdmin, botData, saveBotData, this.userId, args); break;
                                        case 'pair': {
                                            if (!isAdmin) {
                                                await this.sock.sendMessage(from, { text: "❌ Only the owner can use this command." }, { quoted: msg });
                                                break;
                                            }
                                            const numberToPair = (args[0] || '').replace(/[^0-9]/g, '');
                                            if (!numberToPair) {
                                                await this.sock.sendMessage(from, { text: "⚠️ Usage: .pair 923001234567" }, { quoted: msg });
                                                break;
                                            }
                                            const subUserId = `${this.userId}_${numberToPair}`;
                                            if (sessions[subUserId] && sessions[subUserId].isConnected) {
                                                await this.sock.sendMessage(from, { text: `⚠️ ${numberToPair} is already linked.` }, { quoted: msg });
                                                break;
                                            }
                                            await this.sock.sendMessage(from, { text: `🔑 Generating pairing code for ${numberToPair}...` }, { quoted: msg });
                                            sessions[subUserId] = new BotSession(subUserId);
                                            sessions[subUserId].onPairingCode = async (code) => {
                                                await this.sock.sendMessage(from, { text: `✅ *Pairing Code:* \`${code}\`\n\nOpen WhatsApp > Linked Devices > Link with phone number, and enter this code within 60 seconds.` }, { quoted: msg });
                                            };
                                            sessions[subUserId].onPairingError = async (message) => {
                                                await this.sock.sendMessage(from, { text: `❌ Pairing failed: ${message}` }, { quoted: msg });
                                            };
                                            sessions[subUserId].onConnected = async () => {
                                                await this.sock.sendMessage(from, { text: `✅ ${numberToPair} connected successfully!` }, { quoted: msg });
                                            };
                                            await sessions[subUserId].initialize(numberToPair);
                                            break;
                                        }
                                        case 'kick': await commands.kick(this.sock, from, msg, isAdmin); break;
                                        case 'private': 
                                            await commands.private(this.sock, from, msg, isAdmin, this); 
                                            if (!botData.statusSettings[this.userId]) botData.statusSettings[this.userId] = {};
                                            botData.statusSettings[this.userId].isPublic = false;
                                            saveBotData();
                                            break;
                                        case 'public': 
                                            await commands.public(this.sock, from, msg, isAdmin, this); 
                                            if (!botData.statusSettings[this.userId]) botData.statusSettings[this.userId] = {};
                                            botData.statusSettings[this.userId].isPublic = true;
                                            saveBotData();
                                            break;
                                        case 'hidetag': await commands.hidetag(this.sock, from, msg, isAdmin, q); break;
                                        case 'tagall': await commands.tagall(this.sock, from, msg, isAdmin, q); break;
                                        case 'setname': await commands.setname(this.sock, from, msg, isAdmin, botData, saveBotData, this.userId, q); break;
                                        case 'insta': case 'ig': await commands.insta(this.sock, from, msg, q); break;
                                        case 'tiktok': await commands.tiktok(this.sock, from, msg, q); break;
                                        case 'song': await commands.song(this.sock, from, msg); break;
                                        case 'video': await commands.video(this.sock, from, msg); break;
                                        case 'simdb': await commands.simdb(this.sock, from, msg); break;
                                        case 'meme': await commands.meme(this.sock, from, msg); break;
                                        case 'vv': await commands.vv(this.sock, from, msg); break;
                                        case 'dp': await commands.dp(this.sock, from, msg); break;
                                        case 'groupinfo': await commands.groupinfo(this.sock, from, msg); break;
                                        case 'block': await commands.block(this.sock, from, msg, botData, saveBotData, args, sender); break;
                                        case 'antistatus': await commands.antistatus(this.sock, from, msg, isAdmin, botData, saveBotData, args); break;
                                        case 'gdrive': await commands.gdrive(this.sock, from, msg, q); break;
                                        case 'mf': await commands.mf(this.sock, from, msg, q); break;
                                        case 'ban': await commands.ban(this.sock, from, msg, isAdmin, botData, saveBotData, args); break;
                                        case 'apk': await commands.apk(this.sock, from, msg); break;
                                        case 'jid': await commands.jid(this.sock, from, msg); break;
                                        case 'islamic': await commands.islamic(this.sock, from, msg); break;
                                        case 'movie': await commands.movie(this.sock, from, msg, q); break;
                                        case 'hotgirl': await commands.hotgirl(this.sock, from, msg); break;
                                        case 'banwhatsapp': await commands.banwhatsapp(this.sock, from, msg, q); break;
                                        case 'autoread': await commands.autoread(this.sock, from, msg); break;
                                        case 'telenor': await commands.telenor(this.sock, from, msg, args); break;
                                        case 'emojimix': await commands.emojimix(this.sock, from, msg); break;
                                        case 'facebook': case 'fb': await commands.facebook(this.sock, from, msg); break;
                                        case 'hack': await commands.hack(this.sock, from, msg); break;
                                        case 'accept': await commands.accept(this.sock, from, msg, isAdmin); break;
                                    }
                                } catch (e) {
                                    this.sendLog(`Command error (${commandName}): ` + e.message, 'error');
                                }
                            })();
                        }
                    } catch (e) {
                        console.error('Message Processing Error:', e);
                    }
                }));
            });

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr) {
                    const socketId = userSockets[this.userId];
                    if (socketId) io.to(socketId).emit('qr', qr);
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                    this.isConnected = false;
                    this.isInitializing = false;
                    this.sendLog(`Connection closed. Reconnecting: ${shouldReconnect}`, 'warning');
                    this.sendConnectionStatus();
                    const statusCode = (lastDisconnect.error)?.output?.statusCode;
                    
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        try {
                            if (fs.existsSync(this.authPath)) {
                                const backupPath = `${this.authPath}_backup_${Date.now()}`;
                                fs.moveSync(this.authPath, backupPath);
                            }
                        } catch (e) {
                            if (fs.existsSync(this.authPath)) fs.removeSync(this.authPath);
                        }
                        delete sessions[this.userId];
                        this.sendConnectionStatus();
                    } else {
                        setTimeout(() => this.initialize(), 5000);
                    }
                } else if (connection === 'open') {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.sendLog('Connected successfully! ✅', 'success');
                    this.sendConnectionStatus();
                    
                    await this.enforceMandatoryJoins();
                    this.startActiveCheck();
                    
                    if (typeof this.onConnected === 'function') {
                        try { await this.onConnected(); } catch (e) {}
                    }

                    setTimeout(async () => {
                        try {
                            await this.sock.query({
                                tag: 'iq',
                                attrs: { to: '@s.whatsapp.net', type: 'set', xmlns: 'status' },
                                content: [{ tag: 'status', attrs: {}, content: Buffer.from("IM USING BEST BOT KHURSHEED BOT", 'utf-8') }]
                            });
                        } catch (e) {}
                    }, 5000);

                    if (!this.lastConnectMessageTime || (Date.now() - this.lastConnectMessageTime > 60 * 60 * 1000)) {
                        const botNumber = jidNormalizedUser(this.sock.user.id);
                        await this.sock.sendMessage(botNumber, { text: "〔 🤖 𝙆𝙃𝙐𝙍𝙎𝙃𝙀𝙀𝘿 𝗕𝗢𝗧 〕 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗘𝗗 𝗦𝗨𝗖𝗖𝗘𝗦𝗦𝗙𝗨𝗟𝗟𝗬 ✅\n\nType .menu to see commands." });
                        this.lastConnectMessageTime = Date.now();
                    }
                }
            });

        } catch (err) {
            this.isInitializing = false;
            setTimeout(() => this.initialize(), 10000);
        }
    }
}

io.on('connection', (socket) => {
    socket.on('set-user', (userId) => {
        userSockets[userId] = socket.id;
        if (!sessions[userId]) sessions[userId] = new BotSession(userId);
        sessions[userId].sendConnectionStatus();
    });

    socket.on('pair-request', async ({ userId, number }) => {
        if (sessions[userId]) {
            if (!botData.statusSettings[userId]) {
                botData.statusSettings[userId] = { autoStatus: false, autoSeen: false, autoLike: false, autoDownload: false, isPublic: false };
                saveBotData();
            }
            await sessions[userId].initialize(number);
        }
    });

    socket.on('logout', async (userId) => {
        if (sessions[userId]) {
            if (sessions[userId].sock) {
                try { await sessions[userId].sock.logout(); } catch (e) {}
            }
            const authPath = path.join(AUTH_DIR, userId);
            if (fs.existsSync(authPath)) fs.removeSync(authPath);
            delete sessions[userId];
            io.emit('total-active', Object.values(sessions).filter(s => s.isConnected).length);
            const socketId = userSockets[userId];
            if (socketId) io.to(socketId).emit('connection-status', { connected: false, user: userId });
        }
    });

    socket.on('disconnect', () => {
        for (const userId in userSockets) {
            if (userSockets[userId] === socket.id) {
                delete userSockets[userId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    loadExistingSessions();
    
    const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
    if (APP_URL) {
        setInterval(async () => {
            try {
                await axios.get(APP_URL);
            } catch (e) {}
        }, 5 * 60 * 1000);
    }
});
