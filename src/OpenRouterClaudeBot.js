require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const Config = require('../config/config');
const SessionManager = require('./managers/SessionManager');
const ClaudeCodeManager = require('./managers/ClaudeCodeManager');
const AIService = require('./services/AIService');
const MessageHandler = require('./handlers/MessageHandler');
const CallbackHandler = require('./handlers/CallbackHandler');
const logger = require('./utils/logger');

/**
 * Main bot class orchestrating OpenRouter and Claude Code
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
        this.aiService = new AIService(this.config);
        this.claudeCodeManager = new ClaudeCodeManager(this.aiService);
        
        // Initialize handlers
        this.messageHandler = new MessageHandler(
            this.bot,
            this.sessionManager,
            this.claudeCodeManager,
            this.aiService,
            this.config
        );
        
        this.callbackHandler = new CallbackHandler(
            this.bot,
            this.sessionManager,
            this.messageHandler
        );
        
        this.setupEventHandlers();
        this.setupClaudeCodeHandlers();
        
        logger.info('OpenRouter Claude Bot initialized', this.config.getSummary());
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
                
                // Analyze if we should forward to user or handle internally
                const shouldForward = await this.aiService.shouldForwardToUser(question, session);
                
                if (shouldForward) {
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
                } else {
                    // Let OpenRouter handle it
                    const response = await this.aiService.generateResponseForClaude(question, session);
                    await this.claudeCodeManager.sendToAgent(agentId, response);
                }
            } catch (error) {
                logger.error('Error handling agent question:', error);
            }
        });
        
        this.claudeCodeManager.on('agent-complete', async ({ taskId, code }) => {
            const session = this.sessionManager.getClaudeAgentSession(taskId);
            if (session) {
                await this.bot.sendMessage(session.chatId,
                    `✅ Claude Code agent completed task\n\n` +
                    `Exit code: ${code}\n` +
                    `Duration: ${Math.round((Date.now() - session.startTime) / 1000)}s`,
                    { parse_mode: 'Markdown' }
                );
                this.sessionManager.deleteClaudeAgentSession(taskId);
            }
        });
        
        this.claudeCodeManager.on('agent-output', async ({ chatId, text }) => {
            try {
                // Send Claude Code output directly to user
                await this.messageHandler.sendLongMessage(chatId, text);
            } catch (error) {
                logger.error('Error sending agent output to user:', error);
            }
        });
        
        this.claudeCodeManager.on('agent-error', async ({ taskId, error }) => {
            const session = this.sessionManager.getClaudeAgentSession(taskId);
            if (session) {
                await this.bot.sendMessage(session.chatId,
                    `❌ Claude Code agent encountered an error:\\n\\n${error.message}`,
                    { parse_mode: 'Markdown' }
                );
                this.sessionManager.deleteClaudeAgentSession(taskId);
            }
        });
        
        this.claudeCodeManager.on('agent-intervention-needed', async ({ agentId, chatId, lastLines, agent }) => {
            logger.info(`Intervention needed for agent ${agentId}`);
            
            // Use detection model to confirm intervention is needed
            const needsIntervention = await this.aiService.detectClaudeInterventionNeeded(lastLines);
            
            if (needsIntervention) {
                // Use main model to generate appropriate command
                const command = await this.aiService.generateInterventionCommand(lastLines, agent.task);
                
                logger.info(`Sending intervention command '${command}' to agent ${agentId}`);
                await this.claudeCodeManager.sendCommand(agentId, command);
                
                // Notify user
                await this.bot.sendMessage(chatId,
                    `🤖 Claude Code needed intervention. Sent command: \`${command}\``,
                    { parse_mode: 'Markdown' }
                );
            }
        });
        
        this.claudeCodeManager.on('agent-complete', async ({ taskId, code, fullOutput }) => {
            const session = this.sessionManager.getClaudeAgentSession(taskId);
            if (session) {
                // Use main model to process and summarize the output
                const summary = await this.aiService.processClaudeOutput(fullOutput, session.task);
                
                await this.bot.sendMessage(session.chatId,
                    `✅ Claude Code completed!\\n\\n${summary}`,
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
        logger.info('🚀 OpenRouter Claude Bot started!', {
            mainModel: this.config.mainModel,
            detectionModel: this.config.detectionModel,
            authorizedUsers: this.config.authorizedUsers.length,
            claudeAuthenticated: this.claudeCodeManager.isAuthenticated
        });
    }
    
    /**
     * Stop the bot gracefully
     */
    async stop() {
        logger.info('Stopping OpenRouter Claude Bot...');
        
        // Kill all active Claude agents
        await this.claudeCodeManager.killAllAgents();
        
        // Stop Telegram bot
        await this.bot.stopPolling();
        
        logger.info('Bot stopped successfully');
    }
}

module.exports = OpenRouterClaudeBot;