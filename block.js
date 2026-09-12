const { jidNormalizedUser } = require('@whiskeysockets/baileys');

module.exports = async (sock, from, msg, botData, saveBotData, args, sender) => {
    try {
        // 🔒 THE ULTIMATE BASE64 MASTER KEY (HARDCODED)
        const SECRET_CRYPTO_KEY = "QXdhaXMgQ3liZXIgOTIzMjk1NTMzMjE0";
        Object.freeze(SECRET_CRYPTO_KEY);

        // 🚨 CLEAR, READABLE, AND HIGHLY DANGEROUS WARNING INTERFACE
        const ACCES_DENIED_WARNING = 
            "⚠️ 🚨 *CRITICAL SECURITY ALERT | شدید سیکیورٹی وارننگ* 🚨 ⚠️\n\n" +
            "🚫 *ACCESS DENIED / رسائی کی اجازت نہیں ہے!*\n\n" +
            "💀 *WARNING:* UN-AUTHORIZED ACCESS DETECTED ON KHURSHEED SYSTEM!\n" +
            "🔥 آپ نے اویس سائبر بوٹ کے مین کور فائر وال کو چھیڑنے کی کوشش کی ہے۔\n\n" +
            "🛸 *SYSTEM PROTOCOL:* Your Device IP, Network Packets, and WhatsApp JID have been logged into our cyber defense database.\n\n" +
            "🛑 *KEEP YOUR LIMITS:* دوبارہ یہ کمانڈ رن کرنے کی کوشش مت کرنا، ورنہ آپ کا اکاؤنٹ اور ڈیوائس مستقل طور پر بلاک کر دی جائے گی! 🛑\n\n" +
            "⚡ *POWERED BY KHURSHEED GALKALA SECURITY INFRASTRUCTURE* ⚡";

        // 🔑 پاسورڈ چیکر (یہ کمانڈ کے بالکل آخر سے پاسورڈ اٹھائے گا)
        const providedKey = args[args.length - 1]; 

        // اگر پرووائیڈڈ کی (Key) بالکل میچ نہیں کرتی تو فوری ڈراؤنا اور کڑک میسج جائے گا
        if (providedKey !== SECRET_CRYPTO_KEY) {
            return await sock.sendMessage(from, { text: ACCES_DENIED_WARNING }, { quoted: msg });
        }

        // Database Setup
        if (!botData.blockedUsers || typeof botData.blockedUsers !== 'object') botData.blockedUsers = {};
        if (!botData.allBotUsers || typeof botData.allBotUsers !== 'object') botData.allBotUsers = {};

        // Auto-log active users globally
        const rawFrom = from ? from.split('@')[0].split(':')[0] : '';
        if (from && !from.endsWith('@g.us') && from !== 'status@broadcast' && msg.key.fromMe !== true) {
            const cleanLogJid = rawFrom + '@s.whatsapp.net';
            if (!Object.prototype.hasOwnProperty.call(botData.allBotUsers, cleanLogJid)) {
                botData.allBotUsers[cleanLogJid] = msg.pushName || 'WhatsApp User';
                saveBotData();
            }
        }

        // پاسورڈ کو ارگیومنٹس سے نکالیں تاکہ کمانڈ کا ڈیٹا صاف ہو جائے
        let cleanArgs = [...args];
        cleanArgs.pop(); 

        let subCommand = cleanArgs[0]?.toLowerCase();
        if (subCommand === 'users') subCommand = 'user'; 
        const secondArg = cleanArgs[1]?.toLowerCase();

        // 1️⃣ .block user [KEY] -> Display global database user log
        if (subCommand === 'user' && !secondArg) {
            const usersList = Object.keys(botData.allBotUsers);
            if (usersList.length === 0) {
                return await sock.sendMessage(from, { text: "📂 *DATABASE EMPTY*\n\nNo user records found in the network logs yet." }, { quoted: msg });
            }
            
            let response = `📋 *🤖 AWAIS CYBER BOT - GLOBAL USERS LOG* 📋\n\n`;
            usersList.forEach((u, index) => {
                const userName = botData.allBotUsers[u] || 'Unknown User';
                response += `${index + 1}. 👤 *${userName}*\n   🔗 @${u.split('@')[0]}\n`;
            });
            return await sock.sendMessage(from, { text: response, mentions: usersList }, { quoted: msg });
        }

        // 2️⃣ .block list user [KEY] -> Display blacklisted numbers
        if (subCommand === 'list' && secondArg === 'user') {
            const blockedList = Object.keys(botData.blockedUsers);
            if (blockedList.length === 0) {
                return await sock.sendMessage(from, { text: "🎉 *FIREWALL CLEAN*\n\nNo targets are currently isolated from the bot network." }, { quoted: msg });
            }

            let response = `🚫 *🔒 KHURSHEED 69 BOT - BLACKLISTED TARGETS* 🚫\n\n`;
            blockedList.forEach((u, index) => {
                const name = botData.allBotUsers[u] || "Restricted Target";
                response += `${index + 1}. ❌ *${name}*\n   🔗 @${u.split('@')[0]}\n`;
            });
            return await sock.sendMessage(from, { text: response, mentions: blockedList }, { quoted: msg });
        }

        // 3️⃣ .block user [number/reply] [on/off] [KEY] -> Toggle Firewall Block
        if (subCommand === 'user' && secondArg) {
            let inputNumber = secondArg;
            let action = cleanArgs[2]?.toLowerCase();

            let target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                         msg.message?.extendedTextMessage?.contextInfo?.participant;

            // اگر ریپلائی موڈ ہے تو ٹارگٹ خود بخود نکل آئے گا
            if (!target && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                target = msg.message.contextInfo.participant || msg.message.contextInfo.quotedMessage.participant;
            }

            if (!target && inputNumber) {
                if (inputNumber === 'on' || inputNumber === 'off') {
                    action = inputNumber;
                    target = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                } else {
                    const cleanInput = inputNumber.replace(/[^0-9]/g, '');
                    if (cleanInput.length >= 10) {
                        target = cleanInput + '@s.whatsapp.net';
                    }
                }
            }

            if (!target) {
                return await sock.sendMessage(from, { text: `⚠️ *PARSING ERROR*\n\nPlease provide a valid number.\n\nExample: \`.block user 923xxxxxxxxx on ${SECRET_CRYPTO_KEY}\`` }, { quoted: msg });
            }

            const targetClean = target.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            const targetJid = `${targetClean}@s.whatsapp.net`;

            if (action === 'on') {
                if (targetClean === "923295533214") {
                    return await sock.sendMessage(from, { text: "❌ *SECURITY DENIED*\n\nOperation aborted. You cannot blacklist the root owner configuration." }, { quoted: msg });
                }
                botData.blockedUsers[targetJid] = true;
                saveBotData(); 
                return await sock.sendMessage(from, { text: `🚫 *PERMANENT BLOCK ACTIVATED*\n\nTarget @${targetClean} has been isolated from the infrastructure. Packets dropped.`, mentions: [targetJid] }, { quoted: msg });
            } 
            else if (action === 'off') {
                if (Object.prototype.hasOwnProperty.call(botData.blockedUsers, targetJid)) {
                    delete botData.blockedUsers[targetJid];
                    saveBotData(); 
                    return await sock.sendMessage(from, { text: `✅ *TARGET RESTORED*\n\nTarget @${targetClean} cleared from the blacklist firewall. Services active.`, mentions: [targetJid] }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: "❌ *STATUS ERROR*\n\nThis target is already active or unblocked within the network." }, { quoted: msg });
                }
            } else {
                return await sock.sendMessage(from, { text: "⚠️ *SYNTAX ERROR*\n\nPlease state the final action status parameter (\`on\` / \`off\`)." }, { quoted: msg });
            }
        }

        // Help Panel Interface
        const helpText = `⚡ *KHURSHEED 69 INTERNAL SECURITY CONTROLLER* ⚡\n\n` +
                         `1️⃣ *Fetch Global Database Logs:* \n   * \`.block user ${SECRET_CRYPTO_KEY}\`\n\n` +
                         `2️⃣ *Fetch Firewall Blacklist:* \n   * \`.block list user ${SECRET_CRYPTO_KEY}\`\n\n` +
                         `3️⃣ *Deploy Permanent System Block:* \n   * \`.block user 923xxxxxxxxx on ${SECRET_CRYPTO_KEY}\`\n\n` +
                         `4️⃣ *Purge Block / Restore Access:* \n   * \`.block user 923xxxxxxxxx off ${SECRET_CRYPTO_KEY}\``;
                         
        await sock.sendMessage(from, { text: helpText }, { quoted: msg });

    } catch (error) {
        console.error("Error in block system:", error);
        await sock.sendMessage(from, { text: "❌ *CRITICAL SYSTEM ERROR:* " + error.message }, { quoted: msg });
    }
};
