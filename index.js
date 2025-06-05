#!/usr/bin/env node

/**
 * OpenRouter + Claude Code Telegram Bot
 * Entry point with graceful shutdown handling
 */

const OpenRouterClaudeBot = require('./src/OpenRouterClaudeBot');
const logger = require('./src/utils/logger');

// Start the bot
if (require.main === module) {
    let bot;
    
    try {
        bot = new OpenRouterClaudeBot();
        bot.start();
        
        // Graceful shutdown handlers
        const shutdown = async (signal) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            
            try {
                if (bot) {
                    await bot.stop();
                }
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', error);
                process.exit(1);
            }
        };
        
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            process.exit(1);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection:', {
                reason: reason?.message || reason,
                stack: reason?.stack,
                promise: promise.toString()
            });
            // Don't exit on unhandled rejections in production, just log them
            // process.exit(1);
        });
        
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}

module.exports = OpenRouterClaudeBot;