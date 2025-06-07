const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * Utility class for managing Claude Code CLI authentication
 */
class ClaudeAuthenticator {
    constructor() {
        this.isAuthenticated = false;
        this.authData = null;
        this.configPath = path.join(
            process.env.HOME || process.env.USERPROFILE, 
            '.claude-code-auth.json'
        );
        
        this.loadAuthData();
    }
    
    /**
     * Load saved authentication data
     */
    async loadAuthData() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            this.authData = JSON.parse(data);
            this.isAuthenticated = true;
            logger.info('Claude Code auth data loaded');
        } catch (error) {
            logger.info('No Claude Code auth data found');
        }
    }
    
    /**
     * Save authentication data
     */
    async saveAuthData(data) {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(data, null, 2));
            this.authData = data;
            this.isAuthenticated = true;
            logger.info('Claude Code auth data saved');
        } catch (error) {
            logger.error('Failed to save auth data:', error);
            throw error;
        }
    }
    
    /**
     * Initialize Claude Code CLI and handle authentication
     * @param {string} chatId - Telegram chat ID for auth notifications
     * @param {EventEmitter} eventEmitter - Event emitter for auth events
     */
    async initializeClaude(chatId, eventEmitter) {
        // First, check if Claude is already authenticated
        const isAuth = await this.checkAuthentication();
        if (isAuth) {
            this.isAuthenticated = true;
            return;
        }
        
        // If not authenticated, we need to run interactive mode to get auth URL
        return new Promise((resolve, reject) => {
            const args = [];
            
            const claudeProcess = spawn('claude', args, {
                env: { ...process.env },
                cwd: process.cwd()
            });
            
            let output = '';
            let authUrlDetected = false;
            
            claudeProcess.stdout.on('data', (data) => {
                output += data.toString();
                
                // Detect authentication URL
                const authUrlMatch = output.match(/https:\/\/auth\.anthropic\.com[^\s]+/);
                if (authUrlMatch && !authUrlDetected) {
                    authUrlDetected = true;
                    eventEmitter.emit('auth-required', {
                        chatId,
                        url: authUrlMatch[0]
                    });
                    // Kill the process since we got the URL
                    claudeProcess.kill();
                    resolve();
                }
            });
            
            claudeProcess.stderr.on('data', (data) => {
                const error = data.toString();
                logger.error('Claude stderr:', error);
                
                // Check for auth-related errors
                if (error.includes('authentication') || error.includes('login')) {
                    // Try to extract URL from error
                    const urlMatch = error.match(/https:\/\/auth\.anthropic\.com[^\s]+/);
                    if (urlMatch && !authUrlDetected) {
                        authUrlDetected = true;
                        eventEmitter.emit('auth-required', {
                            chatId,
                            url: urlMatch[0]
                        });
                        claudeProcess.kill();
                        resolve();
                    }
                }
            });
            
            claudeProcess.on('error', (error) => {
                logger.error('Claude process error:', error);
                reject(error);
            });
            
            // Timeout for initialization
            setTimeout(() => {
                if (!authUrlDetected) {
                    claudeProcess.kill();
                    reject(new Error('Claude initialization timeout - no auth URL found'));
                }
            }, 10000);
        });
    }
    
    /**
     * Check if Claude is authenticated
     */
    async checkAuthentication() {
        return new Promise((resolve) => {
            const checkProcess = spawn('claude', ['-p', 'echo test', '--dangerously-skip-permissions'], {
                env: { ...process.env },
                cwd: process.cwd()
            });
            
            let hasError = false;
            
            checkProcess.stdout.on('data', (data) => {
                // If we get any output, it's likely authenticated
                resolve(true);
            });
            
            checkProcess.stderr.on('data', (data) => {
                hasError = true;
                const error = data.toString();
                if (error.includes('auth') || error.includes('login')) {
                    resolve(false);
                }
            });
            
            checkProcess.on('close', (code) => {
                if (code === 0 && !hasError) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
            
            // Quick timeout
            setTimeout(() => {
                checkProcess.kill();
                resolve(false);
            }, 3000);
        });
    }

    /**
     * Get authentication status
     */
    getAuthStatus() {
        return {
            isAuthenticated: this.isAuthenticated,
            authData: this.authData
        };
    }
}

module.exports = ClaudeAuthenticator;