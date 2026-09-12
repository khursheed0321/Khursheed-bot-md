module.exports = {

    // ==============================
    // 🤖 KHURSHEED MD BOT CONFIG
    // ==============================

    botName: "⚡ KHURSHEED MD BOT",
    version: "1.0.0",

    ownerName: "👑 KHURSHEED GALKALA",
    ownerNumber: process.env.OWNER_NUMBER || "923044380237",

    // Bot Status
    prefix: ".",
    mode: "private",
    timezone: "Asia/Karachi",

    // API KEYS
    giphyApiKey: process.env.GIPHY_API_KEY || "dc6zaTOxFJmzC",

    // Channel
    channel: {
        name: "BALOCH OFFICIAL",
        url: "https://whatsapp.com/channel/0029VbCSdr5JuyA8YJaPGV1o"
    },

    // Features Default
    features: {

        autoReact: true,
        autoRead: false,
        autoTyping: true,
        autoRecording: true,

        antiCall: true,
        antiDelete: true,
        antiLink: true,

        autoStatus: false,
        aiReply: false
    },


    // Messages
    messages: {

        online:
        `
╭━━━〔 ⚡ KHURSHEED MD BOT 〕━━━╮

✅ System Online
🚀 Multi Device Active
🛡️ Security Enabled

Powered By Khursheed Galkala
╰━━━━━━━━━━━━━━━━╯
        `,


        pair:
        `
🔐 Pairing System Started

⚡ Secure Connection
🤖 KHURSHEED MD Bot
        `,


        error:
        "❌ System Error Occurred"
    },


    // Security
    security: {

        sessionBackup: true,
        maxMessagesCache: 3000,
        reconnect: true,
        antiCrash: true
    },


    // Owner Commands
    ownerCommands: [
        "public",
        "private",
        "broadcast",
        "restart",
        "eval"
    ]

};