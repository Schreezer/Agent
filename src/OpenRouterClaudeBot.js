require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const Config = require('../config/config');
const SessionManager = require('./managers/SessionManager');
const ClaudeCodeManager = require('./managers/ClaudeCodeManager');
const MessageHandler = require('./handlers/MessageHandler');
const CallbackHandler = require('./handlers/CallbackHandler');
const OutputCleanerService = require('./services/OutputCleanerService');
const logger = require('./utils/logger');

/**
 * Main bot class providing direct Claude Code access via Telegram
 */
class OpenRouterClaudeBot {
    constructor() {
        this.config = new Config();
        this.validateEnvironment();
        
        // Initialize Telegram bot
        this.bot = new TelegramBot(this.config.telegramBotToken, {
            polling: true
        });
        
        // Initialize managers and services
        this.sessionManager = new SessionManager();
        this.claudeCodeManager = new ClaudeCodeManager();
        this.outputCleanerService = new OutputCleanerService(this.config);
        
        // Initialize handlers
        this.messageHandler = new MessageHandler(
            this.bot,
            this.sessionManager,
            this.claudeCodeManager,
            this.config,
            this.outputCleanerService
        );
        
        this.callbackHandler = new CallbackHandler(
            this.bot,
            this.sessionManager,
            this.messageHandler
        );
        
        this.setupEventHandlers();
        this.setupClaudeCodeHandlers();
        
        logger.info('Claude Code Telegram Bot initialized', this.config.getSummary());
    }
    
    /**
     * Validate environment
     */
    validateEnvironment() {
        // Config constructor already validates required vars
        logger.info('Environment validation passed');
    }
    
    /**
     * Setup Telegram event handlers
     */
    setupEventHandlers() {
        this.bot.on('message', async (msg) => {
            try {
                await this.messageHandler.handleMessage(msg);
            } catch (error) {
                logger.error('Error handling message:', error);
                await this.messageHandler.sendError(msg.chat.id, error.message);
            }
        });
        
        this.bot.on('callback_query', async (query) => {
            try {
                await this.callbackHandler.handleCallbackQuery(query);
            } catch (error) {
                logger.error('Error handling callback:', error);
            }
        });
        
        this.bot.on('error', (error) => {
            logger.error('Telegram bot error:', error);
        });
    }
    
    /**
     * Setup Claude Code event handlers
     */
    setupClaudeCodeHandlers() {
        this.claudeCodeManager.on('auth-required', async ({ chatId, url }) => {
            await this.bot.sendMessage(chatId,
                '🔐 *Claude Code Authentication Required*\n\n' +
                '1. Click the link below to authenticate:\n' +
                `${url}\n\n` +
                '2. Complete the authentication in your browser\n' +
                '3. Send me the authentication code you receive\n\n' +
                '_Your session is waiting for authentication..._',
                { parse_mode: 'Markdown' }
            );
            
            // Update session to wait for auth
            const session = this.sessionManager.getOpenRouterSession(chatId);
            if (session) {
                this.sessionManager.updateOpenRouterSession(chatId, { waitingForAuth: true });
            }
        });
        
        this.claudeCodeManager.on('agent-message', ({ agentId, content }) => {
            const session = this.sessionManager.getClaudeAgentSession(agentId);
            if (session) {
                session.messages.push({ role: 'claude', content });
            }
        });
        
        this.claudeCodeManager.on('agent-question', async ({ agentId, chatId, question }) => {
            try {
                const session = this.sessionManager.getClaudeAgentSession(agentId);
                if (!session) return;
                
                // Always forward Claude Code questions to user (no AI intermediary)
                this.sessionManager.updateClaudeAgentSession(agentId, { 
                    waitingForUserResponse: true,
                    lastQuestion: question
                });
                
                await this.bot.sendMessage(chatId,
                    `💬 *Claude Code needs your input:*\n\n${question}`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            force_reply: true,
                            input_field_placeholder: "Your response..."
                        }
                    }
                );
            } catch (error) {
                logger.error('Error handling agent question:', error);
            }
        });
        
        this.claudeCodeManager.on('agent-output', async ({ agentId, chatId, text }) => {
            try {
                // Get conversation history for context
                const conversationHistory = this.sessionManager.getConversationHistory(chatId);
                
                // Add this Claude output to conversation history
                this.sessionManager.addToConversationHistory(chatId, 'claude', text);
                
                // Clean output using LLM with conversation context
                await this.messageHandler.sendLongMessageWithCleaning(chatId, text, conversationHistory);
                
            } catch (error) {
                logger.error('Error sending agent output to user:', error);
            }
        });
        
        this.claudeCodeManager.on('agent-complete', async ({ taskId, code, fullOutput }) => {
            const session = this.sessionManager.getClaudeAgentSession(taskId);
            if (session) {
                const duration = Math.round((Date.now() - session.startTime) / 1000);
                await this.bot.sendMessage(session.chatId,
                    `✅ Claude Code task completed (exit code: ${code}, ${duration}s)\\n\\n` +
                    `💬 Send another message to continue with Claude Code!`,
                    { parse_mode: 'Markdown' }
                );
                // Keep session alive for follow-up interactions - user can use /new or /cancel to end
            }
        });
        
        this.claudeCodeManager.on('agent-error', async ({ taskId, error }) => {
            const session = this.sessionManager.getClaudeAgentSession(taskId);
            if (session) {
                await this.bot.sendMessage(session.chatId,
                    `❌ Claude Code encountered an error:\\n\\n${error.message}`,
                    { parse_mode: 'Markdown' }
                );
                this.sessionManager.deleteClaudeAgentSession(taskId);
            }
        });
    }
    
    /**
     * Start the bot
     */
    start() {
        logger.info('🚀 Claude Code Telegram Bot started!', {
            architecture: 'Direct Claude Code routing (OpenRouter bypassed)',
            authorizedUsers: this.config.authorizedUsers.length,
            claudeAuthenticated: this.claudeCodeManager.isAuthenticated
        });
    }
    
    /**
     * Stop the bot gracefully
     */
    async stop() {
        logger.info('Stopping Claude Code Telegram Bot...');
        
        // Kill all active Claude agents
        await this.claudeCodeManager.killAllAgents();
        
        // Stop Telegram bot
        await this.bot.stopPolling();
        
        logger.info('Bot stopped successfully');
    }
}

module.exports = OpenRouterClaudeBot;