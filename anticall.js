/**
 * 👑 KHURHSEED ULTRA-BOT - ANTI-CALL SHIELD MODULE
 * ⚡ Feature: Automated Structural Incoming Call Rejecter & Firewall
 */

async function anticallCommand(sock, from, msg, isAdmin, botData, saveBotData, userId, args) {
    if (!isAdmin) {
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
        return await sock.sendMessage(from, { text: "❌ *[SECURITY OVERRIDE]* Only the root owner can configure the firewall rules." }, { quoted: msg });
    }
    
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
        if (!botData.antiCall) botData.antiCall = {};
        botData.antiCall[userId] = true;
        saveBotData();
        
        await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } });
        await sock.sendMessage(from, { 
            text: `╭━━━〔 🛡️ *𝗙𝗜𝗥𝗘𝗪𝗔𝗟𝗟 𝗔𝗖𝗧𝗜𝗩𝗔𝗧𝗘𝗗* 〕━━━╮\n\n` +
                  `🤖 *𝗕𝗢𝗧:* Khursheed bot\n` +
                  `⚙️ *Module:* Anti-Call Shield V2\n` +
                  `⚡ *Status:* Operational [100% Active]\n\n` +
                  `💀 _All direct incoming audio/video calls will be auto-rejected by the network matrix layers._\n\n` +
                  `╰━━━━━━━━━━━━━━━━━━━━━━╯`
        }, { quoted: msg });
        
    } else if (action === 'off') {
        if (!botData.antiCall) botData.antiCall = {};
        botData.antiCall[userId] = false;
        saveBotData();
        
        await sock.sendMessage(from, { react: { text: '⚠️', key: msg.key } });
        await sock.sendMessage(from, { 
            text: `╭━━━〔 ⚠️ *𝗙𝗜𝗥𝗘𝗪𝗔𝗟𝗟 𝗗𝗘𝗔𝗖𝗧𝗜𝗩𝗔𝗧𝗘𝗗* 〕━━━╮\n\n` +
                  `🤖 *𝗕𝗢𝗧:* Khursheed bot\n` +
                  `⚙️ *Module:* Anti-Call Shield V2\n` +
                  `🚨 *Status:* Disabled [Standby Mode]\n\n` +
                  `⚠️ _Warning: The network firewall is down. Incoming calls will pass through unfiltered._\n\n` +
                  `╰━━━━━━━━━━━━━━━━━━━━━━╯`
        }, { quoted: msg });
        
    } else {
        await sock.sendMessage(from, { react: { text: '❓', key: msg.key } });
        await sock.sendMessage(from, { 
            text: `╭━━━〔 🛠️ *𝗦𝗛𝗜𝗘𝗟𝗗 𝗖𝗢𝗡𝗙𝗜𝗚* 〕━━━╮\n\n` +
                  `❌ *Invalid Sub-Command Syntax!*\n\n` +
                  `💡 *Correct Usage Modes:*\n` +
                  `👉 \`.anticall on\` - (Enable Auto-Rejection Shield)\n` +
                  `👉 \`.anticall off\` - (Disable Auto-Rejection Shield)\n\n` +
                  `╰━━━━━━━━━━━━━━━━━━━━━━╯`
        }, { quoted: msg });
    }
}

module.exports = anticallCommand;
