const logger = require('../utils/logger');
const fetch = require('node-fetch');

/**
 * Service for cleaning Claude Code output using LLM before sending to Telegram users
 */
class OutputCleanerService {
    constructor(config) {
        this.config = config;
        this.apiKey = config.openRouterApiKey;
        this.cleaningModel = config.detectionModel || 'google/gemini-2.5-flash-preview-05-20';
    }

    /**
     * Clean output using LLM with conversation context
     * @param {string} rawOutput - Raw Claude Code output
     * @param {Array} conversationHistory - Full conversation history since /new
     * @param {string} chatId - Telegram chat ID for context
     */
    async cleanOutput(rawOutput, conversationHistory = [], chatId) {
        try {
            if (!rawOutput || rawOutput.trim().length === 0) {
                return '';
            }

            // Build context from conversation history
            const contextMessages = this.buildContextMessages(conversationHistory);
            
            const prompt = this.buildCleaningPrompt(rawOutput, contextMessages);
            
            logger.debug(`Cleaning output for chat ${chatId} using ${this.cleaningModel}`);
            
            const response = await this.callLLM(prompt);
            
            // Extract cleaned content from LLM response
            const cleanedOutput = this.extractCleanedContent(response);
            
            logger.info(`Output cleaned for chat ${chatId}: ${rawOutput.length} chars -> ${cleanedOutput.length} chars`);
            
            return cleanedOutput;
            
        } catch (error) {
            logger.error('Error cleaning output with LLM:', error);
            // Fallback to raw output if LLM fails
            return rawOutput;
        }
    }

    /**
     * Build context messages from conversation history
     */
    buildContextMessages(conversationHistory) {
        if (!conversationHistory || conversationHistory.length === 0) {
            return 'No conversation history available.';
        }

        const messages = [];
        const maxHistoryItems = 10; // Limit to last 10 exchanges to avoid token limits
        
        const recentHistory = conversationHistory.slice(-maxHistoryItems);
        
        for (const item of recentHistory) {
            const timestamp = new Date(item.timestamp).toISOString();
            if (item.type === 'user') {
                messages.push(`[${timestamp}] User: ${item.content}`);
            } else if (item.type === 'claude') {
                messages.push(`[${timestamp}] Claude: ${item.content.substring(0, 500)}${item.content.length > 500 ? '...' : ''}`);
            }
        }

        return messages.join('\n');
    }

    /**
     * Build prompt for LLM to clean the output
     */
    buildCleaningPrompt(rawOutput, contextMessages) {
        return `You are an intelligent message filter for a Telegram bot that connects users to Claude Code. Your job is to clean and format Claude Code output before sending it to the user.

CONVERSATION CONTEXT (recent exchanges):
${contextMessages}

RAW CLAUDE CODE OUTPUT TO CLEAN:
${rawOutput}

INSTRUCTIONS:
1. **Clean the output**: Remove all unnecessary  noise, ANSI codes, progress indicators, animations, duplicate lines, and system messages
2. **Keep what matters**: Preserve actual responses, results, code, file contents, error messages, and meaningful user interactions
3. **Format for Telegram**: Use proper markdown formatting, keep it readable on mobile
4. **Context awareness**: Consider the conversation flow - if this looks like a continuation, acknowledgment, or final result
5. **Intelligently summarize**: If the output is mostly noise with little useful info, provide a brief status update instead
6. **Be concise**: Telegram users prefer clear, focused messages over verbose output

RESPONSE FORMAT:
If the output contains useful information, return the cleaned version.
If the output is mostly noise/processing indicators, return a brief status like "Claude is working on your request..." or "Processing..." or return empty string to skip.
If this appears to be a completion or result, make it clear and well-formatted.

CLEANED OUTPUT:`;
    }

    /**
     * Call OpenRouter LLM API for cleaning
     */
    async callLLM(prompt) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'X-Title': 'Claude Code Telegram Bot - Output Cleaner'
            },
            body: JSON.stringify({
                model: this.cleaningModel,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.choices || data.choices.length === 0) {
            throw new Error('No response from LLM');
        }

        return data.choices[0].message.content;
    }

    /**
     * Extract cleaned content from LLM response
     */
    extractCleanedContent(llmResponse) {
        if (!llmResponse) {
            return '';
        }

        // Remove any surrounding quotes or markdown code blocks
        let cleaned = llmResponse.trim();
        
        // Remove markdown code block wrapping if present
        if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
            cleaned = cleaned.slice(3, -3).trim();
        }
        
        // Remove quotes if the entire response is quoted
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
            (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
            cleaned = cleaned.slice(1, -1).trim();
        }

        // If the LLM returned something like "No useful content" or similar, return empty
        const skipPhrases = [
            'no useful',
            'mostly noise',
            'no meaningful',
            'only processing',
            'skip this',
            'nothing important'
        ];
        
        const lowerCleaned = cleaned.toLowerCase();
        if (skipPhrases.some(phrase => lowerCleaned.includes(phrase))) {
            return '';
        }

        return cleaned;
    }

    /**
     * Check if LLM cleaning is enabled and properly configured
     */
    isEnabled() {
        return this.apiKey && this.cleaningModel;
    }
}

module.exports = OutputCleanerService;