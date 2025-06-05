const logger = require('../utils/logger');

/**
 * Manages all bot sessions (OpenRouter and Claude Code)
 */
class SessionManager {
    constructor() {
        this.openRouterSessions = new Map();
        this.claudeAgentSessions = new Map();
    }
    
    /**
     * Create a new OpenRouter session
     */
    createOpenRouterSession(chatId, task) {
        const session = {
            task,
            messages: [],
            waitingForResponse: false,
            waitingForAuth: false,
            pendingClaudeTask: null,
            startTime: Date.now(),
            interactions: 0,
            detectionChecks: 0
        };
        
        this.openRouterSessions.set(chatId, session);
        logger.info(`Created OpenRouter session for chat ${chatId}`);
        return session;
    }
    
    /**
     * Get OpenRouter session
     */
    getOpenRouterSession(chatId) {
        return this.openRouterSessions.get(chatId);
    }
    
    /**
     * Update OpenRouter session
     */
    updateOpenRouterSession(chatId, updates) {
        const session = this.openRouterSessions.get(chatId);
        if (session) {
            Object.assign(session, updates);
        }
        return session;
    }
    
    /**
     * Delete OpenRouter session
     */
    deleteOpenRouterSession(chatId) {
        const deleted = this.openRouterSessions.delete(chatId);
        if (deleted) {
            logger.info(`Deleted OpenRouter session for chat ${chatId}`);
        }
        return deleted;
    }
    
    /**
     * Create a new Claude agent session
     * @param {string} agentId - Unique agent identifier
     * @param {string} chatId - Telegram chat ID
     * @param {string} task - Task description
     */
    createClaudeAgentSession(agentId, chatId, task) {
        const session = {
            chatId,
            task,
            startTime: Date.now(),
            messages: [],
            waitingForUserResponse: false,
            lastActivity: Date.now()
        };
        
        this.claudeAgentSessions.set(agentId, session);
        logger.info(`Created Claude agent session ${agentId} for chat ${chatId}`);
        return session;
    }
    
    /**
     * Get Claude agent session
     */
    getClaudeAgentSession(agentId) {
        return this.claudeAgentSessions.get(agentId);
    }
    
    /**
     * Get Claude agent session by chat ID
     * @param {string} chatId - Telegram chat ID
     * @param {boolean} onlyWaiting - Only return sessions waiting for user response
     */
    getClaudeAgentSessionByChat(chatId, onlyWaiting = true) {
        for (const [agentId, session] of this.claudeAgentSessions) {
            if (session.chatId === chatId) {
                if (!onlyWaiting || session.waitingForUserResponse) {
                    return { agentId, session };
                }
            }
        }
        return null;
    }
    
    /**
     * Update Claude agent session
     * @param {string} agentId - Agent identifier
     * @param {object} updates - Properties to update
     */
    updateClaudeAgentSession(agentId, updates) {
        const session = this.claudeAgentSessions.get(agentId);
        if (session) {
            Object.assign(session, { 
                ...updates, 
                lastActivity: Date.now() 
            });
            logger.debug(`Updated Claude agent session ${agentId}`, updates);
        }
        return session;
    }
    
    /**
     * Delete Claude agent session
     */
    deleteClaudeAgentSession(agentId) {
        const session = this.claudeAgentSessions.get(agentId);
        const deleted = this.claudeAgentSessions.delete(agentId);
        if (deleted && session) {
            logger.info(`Deleted Claude agent session ${agentId} for chat ${session.chatId}`);
        }
        return deleted;
    }
    
    /**
     * Get all active sessions count
     */
    getActiveSessionsCount() {
        return {
            openRouter: this.openRouterSessions.size,
            claudeAgents: this.claudeAgentSessions.size,
            total: this.openRouterSessions.size + this.claudeAgentSessions.size
        };
    }
    
    /**
     * Check if chat has any active sessions
     * @param {string} chatId - Telegram chat ID
     */
    hasActiveSession(chatId) {
        const hasOpenRouter = this.openRouterSessions.has(chatId);
        const hasClaudeAgent = Array.from(this.claudeAgentSessions.values())
            .some(session => session.chatId.toString() === chatId.toString());
        
        return { hasOpenRouter, hasClaudeAgent, hasAny: hasOpenRouter || hasClaudeAgent };
    }
    
    /**
     * Clear all sessions for a chat
     * @param {string} chatId - Telegram chat ID
     */
    clearAllSessionsForChat(chatId) {
        const openRouterDeleted = this.deleteOpenRouterSession(chatId);
        
        const claudeAgentIds = Array.from(this.claudeAgentSessions.entries())
            .filter(([, session]) => session.chatId.toString() === chatId.toString())
            .map(([agentId]) => agentId);
        
        claudeAgentIds.forEach(agentId => this.deleteClaudeAgentSession(agentId));
        
        logger.info(`Cleared all sessions for chat ${chatId}`, {
            openRouterDeleted,
            claudeAgentsDeleted: claudeAgentIds.length
        });
        
        return {
            openRouterDeleted,
            claudeAgentsDeleted: claudeAgentIds.length
        };
    }
    
    /**
     * Get all Claude agent sessions for a specific chat
     * @param {string} chatId - Telegram chat ID
     * @returns {Array} Array of Claude agent sessions
     */
    getAllClaudeAgentSessionsForChat(chatId) {
        return Array.from(this.claudeAgentSessions.entries())
            .filter(([, session]) => session.chatId.toString() === chatId.toString())
            .map(([agentId, session]) => ({ agentId, ...session }));
    }
    
    /**
     * Get session statistics
     */
    getSessionStats() {
        const stats = {
            openRouter: {
                total: this.openRouterSessions.size,
                waitingForResponse: 0,
                waitingForAuth: 0
            },
            claudeAgents: {
                total: this.claudeAgentSessions.size,
                waitingForUserResponse: 0
            }
        };
        
        // Count OpenRouter session states
        for (const session of this.openRouterSessions.values()) {
            if (session.waitingForResponse) stats.openRouter.waitingForResponse++;
            if (session.waitingForAuth) stats.openRouter.waitingForAuth++;
        }
        
        // Count Claude agent session states
        for (const session of this.claudeAgentSessions.values()) {
            if (session.waitingForUserResponse) stats.claudeAgents.waitingForUserResponse++;
        }
        
        return stats;
    }
    
    /**
     * Clean up stale sessions (older than 1 hour)
     */
    cleanupStaleSessions() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        let cleaned = 0;
        
        // Clean OpenRouter sessions
        for (const [chatId, session] of this.openRouterSessions) {
            if (session.startTime < oneHourAgo) {
                this.openRouterSessions.delete(chatId);
                cleaned++;
            }
        }
        
        // Clean Claude agent sessions
        for (const [agentId, session] of this.claudeAgentSessions) {
            const lastActivity = session.lastActivity || session.startTime;
            if (lastActivity < oneHourAgo) {
                this.claudeAgentSessions.delete(agentId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} stale sessions`);
        }
        
        return cleaned;
    }
    
    /**
     * Get all active Claude agents for a chat
     * @param {string} chatId - Telegram chat ID
     */
    getAllClaudeAgentsForChat(chatId) {
        const agents = [];
        for (const [agentId, session] of this.claudeAgentSessions) {
            if (session.chatId.toString() === chatId.toString()) {
                agents.push({ agentId, session });
            }
        }
        return agents;
    }
}

module.exports = SessionManager;