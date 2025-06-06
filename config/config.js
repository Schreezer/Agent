/**
 * Configuration module for Claude Code Telegram Bot
 */
class Config {
    constructor() {
        this.validateEnvironment();
        
        // Telegram configuration
        this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        this.authorizedUsers = process.env.TELEGRAM_AUTHORIZED_CHATS?.split(',').filter(id => id.trim()) || [];
        
        // Claude Code configuration
        this.claudeInitTimeout = parseInt(process.env.CLAUDE_INIT_TIMEOUT) || 30000;
        this.messageChunkDelay = parseInt(process.env.MESSAGE_CHUNK_DELAY) || 500;
        this.maxMessageLength = parseInt(process.env.MAX_MESSAGE_LENGTH) || 4096;
        
        // Logging
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logFile = process.env.LOG_FILE || 'logs/claude-code-bot.log';
    }
    
    /**
     * Validate required environment variables
     */
    validateEnvironment() {
        const required = ['TELEGRAM_BOT_TOKEN'];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }
    
    /**
     * Get all configuration as object
     */
    toObject() {
        return {
            telegram: {
                botToken: this.telegramBotToken,
                authorizedUsers: this.authorizedUsers
            },
            claudeCode: {
                claudeInitTimeout: this.claudeInitTimeout,
                messageChunkDelay: this.messageChunkDelay,
                maxMessageLength: this.maxMessageLength
            },
            logging: {
                logLevel: this.logLevel,
                logFile: this.logFile
            }
        };
    }
    
    /**
     * Get configuration summary for logging
     */
    getSummary() {
        return {
            authorizedUsers: this.authorizedUsers.length,
            allowAll: this.authorizedUsers.length === 0
        };
    }
}

module.exports = Config;