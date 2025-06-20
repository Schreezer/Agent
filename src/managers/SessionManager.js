const logger = require('../utils/logger');
const FileManager = require('../utils/fileManager');

/**
 * Manages Claude Code sessions and file uploads
 */
class SessionManager {
    constructor() {
        this.claudeAgentSessions = new Map();
        this.fileManager = new FileManager();
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
            lastActivity: Date.now(),
            conversationHistory: [] // Track full conversation for LLM cleaning
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
            claudeAgents: this.claudeAgentSessions.size,
            total: this.claudeAgentSessions.size
        };
    }
    
    /**
     * Check if chat has any active sessions
     * @param {string} chatId - Telegram chat ID
     */
    hasActiveSession(chatId) {
        const hasClaudeAgent = Array.from(this.claudeAgentSessions.values())
            .some(session => session.chatId.toString() === chatId.toString());
        
        return { hasClaudeAgent, hasAny: hasClaudeAgent };
    }
    
    /**
     * Clear all sessions for a chat
     * @param {string} chatId - Telegram chat ID
     */
    clearAllSessionsForChat(chatId) {
        
        const claudeAgentIds = Array.from(this.claudeAgentSessions.entries())
            .filter(([, session]) => session.chatId.toString() === chatId.toString())
            .map(([agentId]) => agentId);
        
        claudeAgentIds.forEach(agentId => this.deleteClaudeAgentSession(agentId));
        
        logger.info(`Cleared all sessions for chat ${chatId}`, {
            claudeAgentsDeleted: claudeAgentIds.length
        });
        
        return {
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
            claudeAgents: {
                total: this.claudeAgentSessions.size,
                waitingForUserResponse: 0
            }
        };
        
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
    
    /**
     * File management methods
     */
    
    /**
     * Add uploaded file to chat
     */
    async addUploadedFile(chatId, fileInfo) {
        try {
            const savedFile = await this.fileManager.saveFile(chatId, fileInfo.filename, fileInfo.buffer);
            logger.info(`File ${fileInfo.filename} added for chat ${chatId}`);
            return savedFile;
        } catch (error) {
            logger.error(`Failed to add file for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get uploaded files for chat
     */
    async getUploadedFiles(chatId) {
        try {
            return await this.fileManager.listFiles(chatId);
        } catch (error) {
            logger.error(`Failed to get files for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Delete specific file for chat
     */
    async deleteFile(chatId, filename) {
        try {
            return await this.fileManager.deleteFile(chatId, filename);
        } catch (error) {
            logger.error(`Failed to delete file ${filename} for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Delete all files for chat
     */
    async deleteAllFiles(chatId) {
        try {
            return await this.fileManager.deleteAllFiles(chatId);
        } catch (error) {
            logger.error(`Failed to delete all files for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get storage usage for chat
     */
    async getChatStorageUsage(chatId) {
        try {
            return await this.fileManager.getChatStorageUsage(chatId);
        } catch (error) {
            logger.error(`Failed to get storage usage for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get file manager instance
     */
    getFileManager() {
        return this.fileManager;
    }

    /**
     * Add message to conversation history for LLM cleaning context
     * @param {string} chatId - Telegram chat ID
     * @param {string} type - 'user' or 'claude'
     * @param {string} content - Message content
     */
    addToConversationHistory(chatId, type, content) {
        // Find the most recent Claude agent session for this chat
        const agents = this.getAllClaudeAgentSessionsForChat(chatId);
        if (agents.length > 0) {
            const latestAgent = agents[agents.length - 1];
            const session = this.getClaudeAgentSession(latestAgent.agentId);
            if (session) {
                session.conversationHistory.push({
                    type,
                    content,
                    timestamp: Date.now()
                });
                
                // Limit history to last 20 messages to avoid memory bloat
                if (session.conversationHistory.length > 20) {
                    session.conversationHistory = session.conversationHistory.slice(-20);
                }
                
                logger.debug(`Added ${type} message to conversation history for chat ${chatId}`);
            }
        }
    }

    /**
     * Get conversation history for a chat (from most recent session)
     * @param {string} chatId - Telegram chat ID
     * @returns {Array} Conversation history
     */
    getConversationHistory(chatId) {
        const agents = this.getAllClaudeAgentSessionsForChat(chatId);
        if (agents.length > 0) {
            const latestAgent = agents[agents.length - 1];
            const session = this.getClaudeAgentSession(latestAgent.agentId);
            return session ? session.conversationHistory : [];
        }
        return [];
    }

    /**
     * Clear conversation history for a chat (called on /new)
     * @param {string} chatId - Telegram chat ID
     */
    clearConversationHistory(chatId) {
        const agents = this.getAllClaudeAgentSessionsForChat(chatId);
        for (const agent of agents) {
            const session = this.getClaudeAgentSession(agent.agentId);
            if (session) {
                session.conversationHistory = [];
            }
        }
        logger.info(`Cleared conversation history for chat ${chatId}`);
    }
}

module.exports = SessionManager;