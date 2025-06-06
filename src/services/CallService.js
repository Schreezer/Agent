const axios = require('axios');
const logger = require('../utils/logger');

/**
 * CallMeBot integration for emergency voice calls
 */
class CallService {
    constructor() {
        this.baseUrl = 'http://api.callmebot.com/start.php';
        this.maxTextLength = 256;
        this.defaultLanguage = 'en';
    }

    /**
     * Make an emergency voice call via CallMeBot
     * @param {string} username - Telegram username (without @)
     * @param {string} message - Message to speak (max 256 chars)
     * @param {string} language - Language code (default: 'en')
     * @returns {Promise<boolean>} Success status
     */
    async makeCall(username, message, language = this.defaultLanguage) {
        try {
            // Truncate message if too long
            const truncatedMessage = message.length > this.maxTextLength 
                ? message.substring(0, this.maxTextLength - 3) + '...'
                : message;

            const params = {
                user: username,
                text: truncatedMessage,
                lang: language
            };

            logger.info(`Initiating voice call to @${username}`, {
                messageLength: truncatedMessage.length,
                language
            });

            const response = await axios.get(this.baseUrl, { 
                params,
                timeout: 10000 // 10 second timeout
            });

            if (response.status === 200) {
                logger.info(`Voice call initiated successfully to @${username}`);
                return true;
            } else {
                logger.error(`CallMeBot API returned status ${response.status}`, response.data);
                return false;
            }

        } catch (error) {
            logger.error(`Failed to make voice call to @${username}:`, error.message);
            return false;
        }
    }

    /**
     * Make an emergency call for critical Claude Code issues
     * @param {string} username - Telegram username
     * @param {string} issue - Description of the critical issue
     */
    async makeEmergencyCall(username, issue) {
        const emergencyMessage = `EMERGENCY: Claude Code needs immediate attention. Issue: ${issue}. Please check Telegram immediately.`;
        return await this.makeCall(username, emergencyMessage);
    }

    /**
     * Make a reminder call
     * @param {string} username - Telegram username
     * @param {string} reminder - Reminder message
     */
    async makeReminderCall(username, reminder) {
        const reminderMessage = `REMINDER from Claude Code: ${reminder}`;
        return await this.makeCall(username, reminderMessage);
    }

    /**
     * Make a completion notification call
     * @param {string} username - Telegram username
     * @param {string} task - Completed task description
     */
    async makeCompletionCall(username, task) {
        const completionMessage = `TASK COMPLETE: Claude Code finished: ${task}. Check Telegram for results.`;
        return await this.makeCall(username, completionMessage);
    }

    /**
     * Get authorization instructions for CallMeBot
     * @returns {string} Authorization instructions
     */
    getAuthorizationInstructions() {
        return `📞 *Voice Call Setup (CallMeBot)*\n\n` +
               `To enable emergency voice calls:\n\n` +
               `1. Message @CallMeBot_txtbot on Telegram\n` +
               `2. Send any message to authorize\n` +
               `3. Your username will be enabled for calls\n\n` +
               `*Note:* This is a free service with a 30-second call limit.\n` +
               `Perfect for urgent notifications when your Telegram is silent!`;
    }

    /**
     * Validate username format
     * @param {string} username - Username to validate
     * @returns {boolean} Is valid
     */
    isValidUsername(username) {
        // Remove @ if present and check format
        const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
        return /^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername);
    }

    /**
     * Clean username (remove @ if present)
     * @param {string} username - Username to clean
     * @returns {string} Clean username
     */
    cleanUsername(username) {
        return username.startsWith('@') ? username.slice(1) : username;
    }
}

module.exports = CallService;