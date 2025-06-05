const logger = require('../utils/logger');

/**
 * Handles Telegram callback queries (inline keyboard interactions)
 */
class CallbackHandler {
    constructor(bot, sessionManager, messageHandler) {
        this.bot = bot;
        this.sessionManager = sessionManager;
        this.messageHandler = messageHandler;
    }
    
    /**
     * Handle callback query
     */
    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const action = query.data;
        
        try {
            await this.bot.answerCallbackQuery(query.id);
            await this.bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: query.message.message_id }
            );
            
            const session = this.sessionManager.getOpenRouterSession(chatId);
            
            switch (action) {
                case 'continue':
                    if (session) {
                        await this.messageHandler.executeTask(chatId, 'Continue with the task', session);
                    }
                    break;
                    
                case 'complete':
                    if (session) {
                        await this.bot.sendMessage(chatId, '✅ Task marked complete');
                        this.sessionManager.deleteOpenRouterSession(chatId);
                    }
                    break;
                    
                case 'cancel':
                    if (session) {
                        await this.bot.sendMessage(chatId, '❌ Task cancelled');
                        this.sessionManager.deleteOpenRouterSession(chatId);
                    }
                    break;
                    
                case 'continue_normal':
                    if (session) {
                        await this.messageHandler.executeTask(chatId, 'Continue without Claude Code', session);
                    }
                    break;
                    
                case 'cleanup_confirm':
                    await this.handleCleanupConfirm(chatId);
                    break;
                    
                case 'cleanup_cancel':
                    await this.bot.sendMessage(chatId, '❌ File cleanup cancelled');
                    break;
                    
                default:
                    if (action.startsWith('claude_')) {
                        // Extract chatId from callback data
                        const targetChatId = action.substring('claude_'.length);
                        if (targetChatId === chatId.toString()) {
                            // Get the task from session
                            const sessionData = this.sessionManager.getOpenRouterSession(chatId);
                            if (sessionData && sessionData.suggestedTask) {
                                await this.messageHandler.startClaudeAgent(chatId, sessionData.suggestedTask);
                                this.sessionManager.deleteOpenRouterSession(chatId);
                            } else {
                                await this.bot.sendMessage(chatId, '❌ Task not found in session');
                            }
                        }
                    }
                    break;
            }
        } catch (error) {
            logger.error('Error handling callback query:', error);
            await this.bot.sendMessage(chatId, '❌ Error processing your request');
        }
    }
    
    /**
     * Handle cleanup confirmation
     */
    async handleCleanupConfirm(chatId) {
        try {
            const result = await this.sessionManager.deleteAllFiles(chatId);
            const fileManager = this.sessionManager.getFileManager();
            
            if (result.deletedCount > 0) {
                await this.bot.sendMessage(chatId,
                    `✅ *Files cleaned up successfully!*\\n\\n` +
                    `🗑️ Deleted: ${result.deletedCount} files\\n` +
                    `💾 Freed: ${fileManager.formatFileSize(result.totalSize)}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await this.bot.sendMessage(chatId, '📁 No files were found to delete');
            }
        } catch (error) {
            logger.error('Error during cleanup:', error);
            await this.bot.sendMessage(chatId, '❌ Failed to cleanup files');
        }
    }
}

module.exports = CallbackHandler;