/**
 * Configuration module for OpenRouter Claude Bot
 */
class Config {
    constructor() {
        this.validateEnvironment();
        
        // Telegram configuration
        this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        this.authorizedUsers = process.env.TELEGRAM_AUTHORIZED_CHATS?.split(',').filter(id => id.trim()) || [];
        
        // OpenRouter configuration
        this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
        this.mainModel = process.env.MAIN_MODEL || 'google/gemini-2.5-flash-preview-05-20';
        this.detectionModel = process.env.DETECTION_MODEL || 'google/gemini-2.5-flash-preview-05-20';
        
        // API configuration
        this.siteUrl = process.env.SITE_URL || 'https://github.com/telegram-claude-bot';
        this.siteName = process.env.SITE_NAME || 'Telegram Claude Bot';
        
        // Bot behavior configuration
        this.maxTokens = parseInt(process.env.MAX_TOKENS) || 4000;
        this.temperature = parseFloat(process.env.TEMPERATURE) || 0.2;
        this.detectionMaxTokens = parseInt(process.env.DETECTION_MAX_TOKENS) || 10;
        
        // Timeouts and limits
        this.claudeInitTimeout = parseInt(process.env.CLAUDE_INIT_TIMEOUT) || 30000;
        this.messageChunkDelay = parseInt(process.env.MESSAGE_CHUNK_DELAY) || 500;
        this.maxMessageLength = parseInt(process.env.MAX_MESSAGE_LENGTH) || 4096;
        
        // Logging
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logFile = process.env.LOG_FILE || 'logs/openrouter-claude-bot.log';
    }
    
    /**
     * Validate required environment variables
     */
    validateEnvironment() {
        const required = ['TELEGRAM_BOT_TOKEN', 'OPENROUTER_API_KEY'];
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
            openRouter: {
                apiKey: this.openRouterApiKey,
                mainModel: this.mainModel,
                detectionModel: this.detectionModel,
                siteUrl: this.siteUrl,
                siteName: this.siteName
            },
            behavior: {
                maxTokens: this.maxTokens,
                temperature: this.temperature,
                detectionMaxTokens: this.detectionMaxTokens
            },
            timeouts: {
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
            mainModel: this.mainModel,
            detectionModel: this.detectionModel,
            authorizedUsers: this.authorizedUsers.length,
            allowAll: this.authorizedUsers.length === 0
        };
    }
}

module.exports = Config;