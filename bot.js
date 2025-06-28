const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [123456789]; // Replace with actual admin IDs

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// In-memory storage for warnings (resets on bot restart)
const userWarnings = new Map();
const mutedUsers = new Map();

// Spam detection patterns
const SPAM_PATTERNS = {
    promotionalLinks: /@\w+|t\.me\/|telegram\.me\//i,
    repeatedEmojis: /(.)\1{5,}/,
    allCaps: /^[A-Z\s!@#$%^&*()_+=\-[\]{}|;':",./<>?]{10,}$/,
    suspiciousDomains: /\b(bit\.ly|tinyurl|t\.co|short\.link|free\..*)\b/i,
    flooding: /(.{1,3})\1{10,}/ // Repeated characters/patterns
};

// Welcome message
const WELCOME_MESSAGE = `
🎉 Welcome to our group!

📋 **Group Rules:**
• No spam or promotional content
• No repeated emojis or flooding
• Keep discussions respectful
• No external links without permission
• No ALL CAPS messages

⚠️ **Warning System:** 3 warnings = automatic ban
🛡️ Enjoy your stay and follow the rules!
`;

// Utility functions
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

function addWarning(userId, username) {
    const current = userWarnings.get(userId) || 0;
    const newCount = current + 1;
    userWarnings.set(userId, newCount);
    return newCount;
}

function getWarnings(userId) {
    return userWarnings.get(userId) || 0;
}

function muteUser(userId, minutes) {
    const unmuteTime = Date.now() + (minutes * 60 * 1000);
    mutedUsers.set(userId, unmuteTime);
}

function isUserMuted(userId) {
    const unmuteTime = mutedUsers.get(userId);
    if (!unmuteTime) return false;
    
    if (Date.now() > unmuteTime) {
        mutedUsers.delete(userId);
        return false;
    }
    return true;
}

// Message analysis
function analyzeMessage(text) {
    if (!text) return { isSpam: false, reason: '' };
    
    if (SPAM_PATTERNS.promotionalLinks.test(text)) {
        return { isSpam: true, reason: 'promotional links' };
    }
    
    if (SPAM_PATTERNS.repeatedEmojis.test(text)) {
        return { isSpam: true, reason: 'repeated emojis' };
    }
    
    if (SPAM_PATTERNS.allCaps.test(text)) {
        return { isSpam: true, reason: 'excessive caps' };
    }
    
    if (SPAM_PATTERNS.suspiciousDomains.test(text)) {
        return { isSpam: true, reason: 'suspicious domains' };
    }
    
    if (SPAM_PATTERNS.flooding.test(text)) {
        return { isSpam: true, reason: 'flooding' };
    }
    
    return { isSpam: false, reason: '' };
}

// Event handlers

// Welcome new members
bot.on('new_chat_members', (ctx) => {
    const newMembers = ctx.message.new_chat_members;
    newMembers.forEach(member => {
        if (!member.is_bot) {
            ctx.reply(WELCOME_MESSAGE, { parse_mode: 'Markdown' });
        }
    });
});

// Check messages for spam
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    const text = ctx.message.text;
    
    // Skip if user is muted
    if (isUserMuted(userId)) {
        try {
            await ctx.deleteMessage();
            return;
        } catch (error) {
            console.log('Could not delete message from muted user');
        }
    }
    
    // Skip admin messages
    if (isAdmin(userId)) return;
    
    // Analyze message
    const analysis = analyzeMessage(text);
    
    if (analysis.isSpam) {
        try {
            // Delete the spam message
            await ctx.deleteMessage();
            
            // Add warning
            const warningCount = addWarning(userId, username);
            
            if (warningCount >= 3) {
                // Ban user after 3 warnings
                try {
                    await ctx.banChatMember(userId);
                    await ctx.reply(`🚫 @${username} has been banned for repeated violations.`);
                    userWarnings.delete(userId);
                } catch (error) {
                    await ctx.reply(`⚠️ Could not ban @${username}. Admin rights needed.`);
                }
            } else {
                // Send warning
                await ctx.reply(`🚫 Message removed due to ${analysis.reason}. This is warning ${warningCount}/3 for @${username}.`);
            }
        } catch (error) {
            console.log('Error processing spam message:', error);
        }
    }
});

// Admin commands

// Temporary mute command
bot.command('tmute', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ Admin access required.');
    }
    
    if (!ctx.message.reply_to_message) {
        return ctx.reply('❌ Reply to a message to mute the user.');
    }
    
    const args = ctx.message.text.split(' ');
    const minutes = parseInt(args[1]);
    
    if (!minutes || minutes < 1 || minutes > 1440) {
        return ctx.reply('❌ Specify minutes (1-1440): /tmute 10');
    }
    
    const targetUserId = ctx.message.reply_to_message.from.id;
    const targetUsername = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name;
    
    muteUser(targetUserId, minutes);
    await ctx.reply(`⏳ @${targetUsername} muted for ${minutes} minutes.`);
});

// Ban command
bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ Admin access required.');
    }
    
    if (!ctx.message.reply_to_message) {
        return ctx.reply('❌ Reply to a message to ban the user.');
    }
    
    const targetUserId = ctx.message.reply_to_message.from.id;
    const targetUsername = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name;
    
    try {
        await ctx.banChatMember(targetUserId);
        await ctx.reply(`🚫 @${targetUsername} has been banned.`);
        userWarnings.delete(targetUserId);
    } catch (error) {
        await ctx.reply('❌ Could not ban user. Check bot permissions.');
    }
});

// Kick command
bot.command('kick', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ Admin access required.');
    }
    
    if (!ctx.message.reply_to_message) {
        return ctx.reply('❌ Reply to a message to kick the user.');
    }
    
    const targetUserId = ctx.message.reply_to_message.from.id;
    const targetUsername = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name;
    
    try {
        await ctx.banChatMember(targetUserId);
        await ctx.unbanChatMember(targetUserId);
        await ctx.reply(`👋 @${targetUsername} has been kicked.`);
    } catch (error) {
        await ctx.reply('❌ Could not kick user. Check bot permissions.');
    }
});

// Warn command
bot.command('warn', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ Admin access required.');
    }
    
    if (!ctx.message.reply_to_message) {
        return ctx.reply('❌ Reply to a message to warn the user.');
    }
    
    const targetUserId = ctx.message.reply_to_message.from.id;
    const targetUsername = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name;
    
    const warningCount = addWarning(targetUserId, targetUsername);
    
    if (warningCount >= 3) {
        try {
            await ctx.banChatMember(targetUserId);
            await ctx.reply(`🚫 @${targetUsername} has been banned for 3 warnings.`);
            userWarnings.delete(targetUserId);
        } catch (error) {
            await ctx.reply(`⚠️ @${targetUsername} reached 3 warnings but could not be banned.`);
        }
    } else {
        await ctx.reply(`⚠️ Warning issued to @${targetUsername}. Count: ${warningCount}/3`);
    }
});

// Check warnings command
bot.command('warnings', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ Admin access required.');
    }
    
    if (!ctx.message.reply_to_message) {
        return ctx.reply('❌ Reply to a message to check warnings.');
    }
    
    const targetUserId = ctx.message.reply_to_message.from.id;
    const targetUsername = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name;
    const warnings = getWarnings(targetUserId);
    
    await ctx.reply(`📊 @${targetUsername} has ${warnings}/3 warnings.`);
});

// Help command
bot.command('help', (ctx) => {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply('❌ Admin access required.');
    }
    
    const helpText = `
🤖 **ModSentinel Commands:**

👮‍♂️ **Admin Only:**
• /ban - Ban replied user
• /kick - Kick replied user  
• /tmute <minutes> - Temporarily mute user
• /warn - Issue warning to user
• /warnings - Check user's warning count

🛡️ **Auto-moderation:**
• Detects spam, links, flooding
• 3 warnings = automatic ban
• Welcomes new members
    `;
    
    ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Error handling
bot.catch((err, ctx) => {
    console.log('Bot error:', err);
});

// Start bot
console.log('🤖 ModSentinel AI starting...');
bot.launch();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('✅ ModSentinel AI is now active!');
