const logger = require('../utils/logger');
const https = require('https');
const http = require('http');

/**
 * Handles all incoming Telegram messages
 */
class MessageHandler {
    constructor(bot, sessionManager, claudeCodeManager, config, outputCleanerService = null) {
        this.bot = bot;
        this.sessionManager = sessionManager;
        this.claudeCodeManager = claudeCodeManager;
        this.config = config;
        this.authorizedUsers = config.authorizedUsers;
        this.outputCleanerService = outputCleanerService;
    }
    
    /**
     * Main message handler
     */
    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;
        
        try {
            if (!this.isAuthorized(chatId)) {
                await this.bot.sendMessage(chatId, '❌ Unauthorized access');
                return;
            }
            
            // Handle file uploads
            if (msg.document || msg.photo || msg.audio || msg.video || msg.voice || msg.sticker) {
                await this.handleFileUpload(msg);
                return;
            }
            
            // Note: Authentication and OpenRouter response handling removed (direct Claude Code mode)
            
            // Handle Claude agent response
            const claudeSession = this.sessionManager.getClaudeAgentSessionByChat(chatId);
            if (claudeSession && claudeSession.waitingForUserResponse) {
                this.sessionManager.updateClaudeAgentSession(claudeSession.agentId, {
                    waitingForUserResponse: false
                });
                
                // Add user response to conversation history
                this.sessionManager.addToConversationHistory(chatId, 'user', text);
                
                // Send user's response directly to Claude Code (no AI interpretation needed)
                await this.claudeCodeManager.sendCommand(claudeSession.agentId, text);
                return;
            }
            
            // Handle commands
            if (text?.startsWith('/')) {
                await this.handleCommand(msg);
                return;
            }
            
            // Check if there's an active Claude Code session for follow-up
            const activeClaudeAgents = this.sessionManager.getAllClaudeAgentSessionsForChat(chatId);
            if (activeClaudeAgents.length > 0 && text && text.trim().length > 0) {
                // Send user message as follow-up to the most recent Claude Code session
                const latestAgent = activeClaudeAgents[activeClaudeAgents.length - 1];
                
                await this.bot.sendMessage(chatId,
                    `🔄 Sending follow-up to Claude Code session: \`${latestAgent.agentId}\``,
                    { parse_mode: 'Markdown' }
                );
                
                // Add follow-up message to conversation history
                this.sessionManager.addToConversationHistory(chatId, 'user', text);
                
                // Send the user's message directly to Claude Code
                await this.claudeCodeManager.sendCommand(latestAgent.agentId, text);
                return;
            }
            
            // Route all text messages directly to Claude Code (bypassing OpenRouter)
            if (text && text.trim().length > 0) {
                // Add user message to conversation history
                this.sessionManager.addToConversationHistory(chatId, 'user', text);
                await this.startClaudeAgent(chatId, text);
            }
        } catch (error) {
            logger.error('Error handling message:', error);
            await this.sendError(chatId, error.message);
        }
    }
    
    /**
     * Handle bot commands
     */
    async handleCommand(msg) {
        const chatId = msg.chat.id;
        const command = msg.text.split(' ')[0].toLowerCase();
        
        switch (command) {
            case '/start':
                await this.handleStartCommand(chatId);
                break;
                
            case '/help':
                await this.handleHelpCommand(chatId);
                break;
                
            case '/cancel':
                await this.handleCancelCommand(chatId);
                break;
                
            case '/status':
                await this.handleStatusCommand(chatId);
                break;
                
            case '/claude':
                await this.handleClaudeCommand(msg);
                break;
                
            case '/new':
                await this.handleNewCommand(chatId);
                break;
                
            case '/restart':
                await this.handleRestartCommand(chatId);
                break;
                
            case '/interrupt':
                await this.handleInterruptCommand(chatId);
                break;
                
            case '/sessions':
                await this.handleSessionsCommand(chatId);
                break;
                
            case '/files':
                await this.handleFilesCommand(chatId);
                break;
                
            case '/delete':
                await this.handleDeleteCommand(msg);
                break;
                
            case '/cleanup':
                await this.handleCleanupCommand(chatId);
                break;
                
            default:
                await this.bot.sendMessage(chatId, '❓ Unknown command. Use /help to see all available commands.');
        }
    }
    
    /**
     * Handle /start command
     */
    async handleStartCommand(chatId) {
        await this.bot.sendMessage(chatId,
            '🤖 *Claude Code Telegram Bot*\\n\\n' +
            'Direct access to Claude Code with all its powerful capabilities!\\n\\n' +
            '**How it works:**\\n' +
            '• Send any task or question in natural language\\n' +
            '• Everything goes directly to Claude Code\\n' +
            '• Claude Code has access to files, web, system commands, and more\\n' +
            '• No permission prompts - seamless execution\\n\\n' +
            '**Commands:**\\n' +
            '• `/claude <task>` - Direct Claude Code access (same as regular messages)\\n' +
            '• `/status` - Check bot status\\n' +
            '• `/files` - List uploaded files\\n' +
            '• `/delete <filename>` - Delete specific file\\n' +
            '• `/cleanup` - Delete all files\\n' +
            '• `/new` - Start fresh conversation\\n' +
            '• `/cancel` - Cancel current task\\n\\n' +
            '**Examples:**\\n' +
            '• "Hi, how are you?" - Claude Code handles conversations\\n' +
            '• "Fix the bugs in my code" - Technical tasks\\n' +
            '• "What\'s the weather like?" - Web searches and real-time data',
            { parse_mode: 'Markdown' }
        );
    }
    
    /**
     * Handle /cancel command
     */
    async handleCancelCommand(chatId) {
        const cleared = this.sessionManager.clearAllSessionsForChat(chatId);
        
        if (cleared.claudeAgentsDeleted > 0) {
            await this.bot.sendMessage(chatId, 
                `❌ Cancelled ${cleared.claudeAgentsDeleted} Claude Code session(s)`
            );
        } else {
            await this.bot.sendMessage(chatId, 'No active Claude Code sessions to cancel');
        }
    }
    
    /**
     * Handle /status command
     */
    async handleStatusCommand(chatId) {
        const sessionStatus = this.sessionManager.hasActiveSession(chatId);
        const globalStats = this.sessionManager.getSessionStats();
        
        await this.bot.sendMessage(chatId,
            `📊 *Bot Status*\\n\\n` +
            `**Your Sessions:**\\n` +
            `• Claude Code: ${sessionStatus.hasClaudeAgent ? '🟢 Active' : '⚪ None'}\\n\\n` +
            `**Global Stats:**\\n` +
            `• Total Claude Sessions: ${globalStats.claudeAgents.total}\\n` +
            `• Claude Auth: ${this.claudeCodeManager.isAuthenticated ? '✅' : '❌'}\\n\\n` +
            `**Architecture:**\\n` +
            `• Direct Claude Code routing (OpenRouter bypassed)\\n` +
            `• All messages → Claude Code\\n` +
            `• Simplified, faster responses`,
            { parse_mode: 'Markdown' }
        );
    }
    
    /**
     * Handle /claude command
     */
    async handleClaudeCommand(msg) {
        const chatId = msg.chat.id;
        const args = msg.text.split(' ').slice(1).join(' ');
        
        if (!args) {
            await this.bot.sendMessage(chatId,
                '💡 *Claude Code Command*\\n\\n' +
                'Usage: `/claude <task>`\\n\\n' +
                '**Note:** This command does the same as sending a regular message.\\n' +
                'All messages now go directly to Claude Code!\\n\\n' +
                'Example: `/claude fix the type errors in auth module`\\n' +
                'Same as: `fix the type errors in auth module`',
                { parse_mode: 'Markdown' }
            );
        } else {
            await this.startClaudeAgent(chatId, args);
        }
    }
    
    /**
     * Handle /new command - start fresh conversation
     */
    async handleNewCommand(chatId) {
        // Clear conversation history for LLM cleaning context
        this.sessionManager.clearConversationHistory(chatId);
        
        // Clear all active sessions for this chat
        const cleared = this.sessionManager.clearAllSessionsForChat(chatId);
        
        // Kill any active Claude agents
        const claudeAgents = this.sessionManager.getAllClaudeAgentSessionsForChat(chatId);
        for (const agent of claudeAgents) {
            await this.claudeCodeManager.killAgent(agent.agentId);
        }
        
        let statusMessage = '🔄 *New conversation started!*\\n\\n';
        
        if (cleared.claudeAgentsDeleted > 0) {
            statusMessage += '**Cleared:**\\n';
            statusMessage += `• ${cleared.claudeAgentsDeleted} Claude Code session(s)\\n\\n`;
        }
        
        statusMessage += '**Ready for new tasks!**\\n' +
                        'Send any message and Claude Code will handle it directly.';
        
        await this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    }
    
    /**
     * Handle /help command
     */
    async handleHelpCommand(chatId) {
        await this.bot.sendMessage(chatId,
            '📚 *Claude Code Telegram Bot - Help*\\n\\n' +
            '**Basic Commands:**\\n' +
            '• `/start` - Welcome message and bot overview\\n' +
            '• `/help` - Show this help message\\n' +
            '• `/status` - Check bot and session status\\n\\n' +
            '**Claude Code Commands:**\\n' +
            '• `/claude <task>` - Direct Claude Code access (same as regular messages)\\n' +
            '• `/new` - Start fresh conversation (clears all sessions)\\n' +
            '• `/cancel` - Cancel active Claude Code sessions\\n' +
            '• `/restart` - Restart current Claude Code agent\\n' +
            '• `/interrupt` - Send ESC key to Claude Code (interrupt processing)\\n' +
            '• `/sessions` - List all active Claude Code sessions\\n\\n' +
            '**File Management:**\\n' +
            '• `/files` - List uploaded files with sizes and paths\\n' +
            '• `/delete <filename>` - Delete specific uploaded file\\n' +
            '• `/cleanup` - Delete all uploaded files (with confirmation)\\n\\n' +
            '**Usage:**\\n' +
            '• Send any message directly to Claude Code\\n' +
            '• Upload files by sending documents, photos, etc.\\n' +
            '• Use `/restart` if Claude Code gets stuck\\n' +
            '• Use `/interrupt` to stop long-running operations',
            { parse_mode: 'Markdown' }
        );
    }
    
    /**
     * Handle /restart command
     */
    async handleRestartCommand(chatId) {
        const claudeAgents = this.sessionManager.getAllClaudeAgentSessionsForChat(chatId);
        
        if (claudeAgents.length === 0) {
            await this.bot.sendMessage(chatId, '❌ No active Claude Code sessions to restart');
            return;
        }
        
        // Kill all active Claude agents for this chat
        for (const agent of claudeAgents) {
            await this.claudeCodeManager.killAgent(agent.agentId);
        }
        
        // Clear sessions
        this.sessionManager.clearAllSessionsForChat(chatId);
        
        await this.bot.sendMessage(chatId,
            `🔄 *Claude Code Agent Restarted*\\n\\n` +
            `Killed ${claudeAgents.length} active session(s)\\n\\n` +
            `💬 Send a new message to start a fresh Claude Code session!`,
            { parse_mode: 'Markdown' }
        );
    }
    
    /**
     * Handle /interrupt command
     */
    async handleInterruptCommand(chatId) {
        const claudeAgents = this.sessionManager.getAllClaudeAgentSessionsForChat(chatId);
        
        if (claudeAgents.length === 0) {
            await this.bot.sendMessage(chatId, '❌ No active Claude Code sessions to interrupt');
            return;
        }
        
        // Send ESC key to all active agents
        let interrupted = 0;
        for (const agent of claudeAgents) {
            try {
                await this.claudeCodeManager.sendCommand(agent.agentId, 'ESCAPE');
                interrupted++;
            } catch (error) {
                logger.error(`Failed to interrupt agent ${agent.agentId}:`, error);
            }
        }
        
        await this.bot.sendMessage(chatId,
            `⏹️ *Interrupt Signal Sent*\\n\\n` +
            `Sent ESC key to ${interrupted}/${claudeAgents.length} Claude Code session(s)\\n\\n` +
            `This should stop any running operations.`,
            { parse_mode: 'Markdown' }
        );
    }
    
    /**
     * Handle /sessions command
     */
    async handleSessionsCommand(chatId) {
        const claudeAgents = this.sessionManager.getAllClaudeAgentSessionsForChat(chatId);
        
        if (claudeAgents.length === 0) {
            await this.bot.sendMessage(chatId,
                '📋 *No Active Sessions*\\n\\n' +
                'Send any message to start a new Claude Code session!',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        let message = `📋 *Active Claude Code Sessions (${claudeAgents.length})*\\n\\n`;
        
        claudeAgents.forEach((agent, index) => {
            const duration = Math.round((Date.now() - agent.startTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
            
            message += `**${index + 1}\\. Session ${agent.agentId.split('_').pop()}**\\n`;
            message += `   ⏱️ Duration: ${durationStr}\\n`;
            message += `   📝 Task: ${agent.task.substring(0, 50)}${agent.task.length > 50 ? '...' : ''}\\n`;
            message += `   🔄 Status: ${agent.waitingForUserResponse ? 'Waiting for input' : 'Active'}\\n\\n`;
        });
        
        message += '_Use `/restart` to restart all sessions or `/cancel` to cancel them._';
        
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
    
    /**
     * Start Claude Code agent
     */
    async startClaudeAgent(chatId, task) {
        try {
            // Skip authentication check - Claude is already authenticated on this machine
            logger.info('Starting Claude agent directly without auth check');
            
            const taskId = `claude_${chatId}_${Date.now()}`;
            this.sessionManager.createClaudeAgentSession(taskId, chatId, task);
            
            // Initialize conversation history with the user's task
            this.sessionManager.addToConversationHistory(chatId, 'user', task);
            
            // Get uploaded files for context
            const uploadedFiles = await this.sessionManager.getUploadedFiles(chatId);
            let enhancedTask = task;
            
            if (uploadedFiles.length > 0) {
                enhancedTask += '\n\nUploaded files available:\n';
                uploadedFiles.forEach(file => {
                    enhancedTask += `- ${file.filename} (${this.sessionManager.getFileManager().formatFileSize(file.size)}) at ${file.relativePath}\n`;
                });
                enhancedTask += '\nYou can access these files directly using their paths.';
            }
            
            // Optional: Show brief status only if files are available
            if (uploadedFiles.length > 0) {
                await this.bot.sendMessage(chatId,
                    `📁 ${uploadedFiles.length} uploaded file(s) available for Claude Code`,
                    { parse_mode: 'Markdown' }
                );
            }
            
            // Pass enhanced task with file context to Claude Code
            await this.claudeCodeManager.createAgent(chatId, taskId, enhancedTask);
            
        } catch (error) {
            logger.error('Failed to start Claude agent:', error);
            await this.bot.sendMessage(chatId,
                `❌ Failed to start Claude Code agent.\n\nError: ${error.message}\n\nPlease try again or check if Claude CLI is properly installed.`
            );
        }
    }
    
    /**
     * Send long message with LLM cleaning (split if needed)
     */
    async sendLongMessageWithCleaning(chatId, text, conversationHistory = []) {
        try {
            let finalText = text;
            
            // Use LLM cleaning if service is available and enabled
            if (this.outputCleanerService && this.outputCleanerService.isEnabled()) {
                finalText = await this.outputCleanerService.cleanOutput(text, conversationHistory, chatId);
                
                // If LLM returns empty string, skip sending (it was deemed noise)
                if (!finalText || finalText.trim().length === 0) {
                    logger.info(`LLM filtered out output for chat ${chatId} - deemed noise/unnecessary`);
                    return;
                }
            } else {
                // Fallback to basic cleaning if LLM service not available
                finalText = this.cleanClaudeCodeOutput(text);
                if (!finalText || finalText.trim().length === 0) {
                    return;
                }
            }
            
            // Send the cleaned text
            await this.sendLongMessage(chatId, finalText);
            
        } catch (error) {
            logger.error('Error in LLM cleaning, falling back to basic cleaning:', error);
            // Fallback to basic cleaning
            const fallbackText = this.cleanClaudeCodeOutput(text);
            if (fallbackText && fallbackText.trim().length > 0) {
                await this.sendLongMessage(chatId, fallbackText);
            }
        }
    }

    /**
     * Send long message (split if needed)
     */
    async sendLongMessage(chatId, text) {
        const maxLength = 4096;
        
        // Clean Claude Code output for Telegram
        const cleanText = this.cleanClaudeCodeOutput(text);
        
        // Don't send if cleaned text is empty (filtered out as noise)
        if (!cleanText || cleanText.trim().length === 0) {
            return;
        }
        
        if (cleanText.length <= maxLength) {
            await this.bot.sendMessage(chatId, cleanText);
            return;
        }
        
        const chunks = [];
        let currentChunk = '';
        
        const lines = cleanText.split('\n');
        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > maxLength) {
                chunks.push(currentChunk);
                currentChunk = line;
            } else {
                currentChunk += (currentChunk ? '\n' : '') + line;
            }
        }
        
        if (currentChunk) chunks.push(currentChunk);
        
        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].trim().length > 0) { // Only send non-empty chunks
                await this.bot.sendMessage(chatId, chunks[i]);
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
    }
    
    /**
     * Clean Claude Code output for Telegram
     */
    cleanClaudeCodeOutput(text) {
        if (!text) return '';
        
        // Remove ANSI escape codes (comprehensive)
        let cleaned = text.replace(/\x1b\[[0-9;]*[mGKH]/g, '');
        cleaned = cleaned.replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
        
        // Remove other control characters except newlines and tabs
        cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        // Remove box drawing characters and special symbols
        cleaned = cleaned.replace(/[╭╮╯╰│─┌┐└┘├┤┬┴┼▶◀▲▼]/g, '');
        
        // Remove cursor positioning and other escape sequences
        cleaned = cleaned.replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
        cleaned = cleaned.replace(/\[(\d+[A-Z]|\?[0-9]+[a-z])/g, '');
        
        // Selectively escape only truly problematic Telegram markdown characters
        // Keep dashes, hashes, and other formatting characters for readability
        cleaned = cleaned.replace(/[_*`[\]()~]/g, function(match) {
            return '\\' + match;
        });
        
        // Remove excessive whitespace
        cleaned = cleaned.replace(/[ \t]+/g, ' ');
        cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n');
        
        // Filter out noise lines
        const lines = cleaned.split('\n');
        const meaningfulLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.length > 0 && 
                   !trimmed.match(/^[\s\-_=*#.]+$/) && // Skip decoration lines
                   !trimmed.match(/^\?/) && // Skip help prompts
                   !trimmed.match(/^[\s>]*$/) && // Skip empty prompts
                   !trimmed.includes('shortcuts') &&
                   !trimmed.includes('Bypassing Permissions') &&
                   !trimmed.includes('Loading') &&
                   !trimmed.match(/^Welcome to Claude/) &&
                   !trimmed.match(/^✻ Welcome to Claude Code/) && // Skip welcome screen
                   !trimmed.includes('/help for help') && // Skip help instructions
                   !trimmed.includes('/status for your current setup') && // Skip setup instructions
                   !trimmed.match(/^cwd: \//) && // Skip current working directory
                   !trimmed.match(/^>\s*Try "/) && // Skip suggestion prompts like "> Try 'refactor...'"
                   !trimmed.match(/^>\s+/) && // Skip user input echo lines that start with "> "
                   !trimmed.match(/^✢.*Accomplishing.*/) && // Skip progress indicators
                   !trimmed.match(/^\\\(.*·.*tokens.*\\\)/) && // Skip token counters
                   !trimmed.match(/^\\>$/) && // Skip lone prompt symbols
                   !trimmed.match(/^esc to interrupt/) && // Skip interrupt hints
                   !trimmed.includes('↑ 0 tokens') &&
                   !trimmed.includes('Accomplishing') &&
                   !trimmed.includes('tokens ·') &&
                   !trimmed.match(/^\d+s ·/) && // Skip time indicators like "3s ·"
                   !trimmed.match(/^[\\>]+\s*$/) && // Skip escaped prompts
                   !trimmed.includes('limit reached') && // Skip model limit messages
                   !trimmed.includes('now using') && // Skip model switching messages
                   !trimmed.match(/Sonnet \d+ ◯/) && // Skip model status indicators
                   !trimmed.match(/Opus \d+ limit/) && // Skip specific limit messages
                   !trimmed.match(/Claude.*limit.*reached/); // Skip Claude limit messages
        });
        
        // Remove duplicates and very similar lines
        const uniqueLines = [];
        const seenLines = new Set();
        
        for (const line of meaningfulLines) {
            const normalized = line.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            if (!seenLines.has(normalized) && normalized.length > 3) {
                seenLines.add(normalized);
                uniqueLines.push(line);
            }
        }
        
        cleaned = uniqueLines.join('\n').trim();
        
        // Final safety checks - don't send if it's just noise
        if (cleaned.length === 0 || 
            cleaned.includes('processing your request') ||
            cleaned.match(/^(Claude|Sonnet|Opus).*limit.*reached/i) ||
            cleaned.match(/^now using/i)) {
            return ''; // Return empty to suppress sending
        }
        
        if (cleaned.length > 3000) {
            cleaned = cleaned.substring(0, 2900) + '\n\n... (output truncated)';
        }
        
        return cleaned;
    }
    
    /**
     * Send error message
     */
    async sendError(chatId, message) {
        await this.bot.sendMessage(chatId, `❌ Error: ${message}`);
    }
    
    /**
     * Check if user is authorized
     */
    isAuthorized(chatId) {
        if (this.authorizedUsers.length === 0) return true;
        return this.authorizedUsers.includes(chatId.toString());
    }
    
    /**
     * Handle file uploads (documents, photos, etc.)
     */
    async handleFileUpload(msg) {
        const chatId = msg.chat.id;
        
        try {
            let fileInfo = null;
            
            // Determine file type and get file info
            if (msg.document) {
                fileInfo = {
                    file_id: msg.document.file_id,
                    filename: msg.document.file_name || 'document',
                    size: msg.document.file_size,
                    type: 'document'
                };
            } else if (msg.photo) {
                // Use the largest photo size
                const photo = msg.photo[msg.photo.length - 1];
                fileInfo = {
                    file_id: photo.file_id,
                    filename: `photo_${Date.now()}.jpg`,
                    size: photo.file_size || 0,
                    type: 'photo'
                };
            } else if (msg.audio) {
                fileInfo = {
                    file_id: msg.audio.file_id,
                    filename: msg.audio.file_name || `audio_${Date.now()}.mp3`,
                    size: msg.audio.file_size,
                    type: 'audio'
                };
            } else if (msg.video) {
                fileInfo = {
                    file_id: msg.video.file_id,
                    filename: msg.video.file_name || `video_${Date.now()}.mp4`,
                    size: msg.video.file_size,
                    type: 'video'
                };
            } else if (msg.voice) {
                fileInfo = {
                    file_id: msg.voice.file_id,
                    filename: `voice_${Date.now()}.ogg`,
                    size: msg.voice.file_size,
                    type: 'voice'
                };
            } else if (msg.sticker) {
                fileInfo = {
                    file_id: msg.sticker.file_id,
                    filename: `sticker_${Date.now()}.webp`,
                    size: msg.sticker.file_size || 0,
                    type: 'sticker'
                };
            }
            
            if (!fileInfo) {
                await this.bot.sendMessage(chatId, '❌ Unsupported file type');
                return;
            }
            
            // Download file from Telegram
            const processingMsg = await this.bot.sendMessage(chatId, 
                `📥 Downloading ${fileInfo.filename}...`
            );
            
            const fileBuffer = await this.downloadTelegramFile(fileInfo.file_id);
            
            // Save file
            const savedFile = await this.sessionManager.addUploadedFile(chatId, {
                filename: fileInfo.filename,
                buffer: fileBuffer
            });
            
            // Delete processing message
            try {
                await this.bot.deleteMessage(chatId, processingMsg.message_id);
            } catch (e) {
                // Ignore deletion errors
            }
            
            await this.bot.sendMessage(chatId,
                `✅ *File uploaded successfully!*\\n\\n` +
                `📁 **${savedFile.filename}**\\n` +
                `📊 Size: ${this.sessionManager.getFileManager().formatFileSize(savedFile.size)}\\n` +
                `📍 Path: \`${savedFile.relativePath}\`\\n\\n` +
                `_File is now available for Claude Code tasks!_`,
                { parse_mode: 'Markdown' }
            );
            
        } catch (error) {
            logger.error('Error handling file upload:', error);
            await this.bot.sendMessage(chatId, 
                `❌ Failed to upload file: ${error.message}`
            );
        }
    }
    
    /**
     * Download file from Telegram
     */
    async downloadTelegramFile(fileId) {
        try {
            const file = await this.bot.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${this.config.telegramBotToken}/${file.file_path}`;
            
            return new Promise((resolve, reject) => {
                const client = fileUrl.startsWith('https:') ? https : http;
                
                client.get(fileUrl, (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                        return;
                    }
                    
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => resolve(Buffer.concat(chunks)));
                    response.on('error', reject);
                }).on('error', reject);
            });
        } catch (error) {
            logger.error('Error downloading file from Telegram:', error);
            throw error;
        }
    }
    
    /**
     * Handle /files command
     */
    async handleFilesCommand(chatId) {
        try {
            const files = await this.sessionManager.getUploadedFiles(chatId);
            const fileManager = this.sessionManager.getFileManager();
            
            if (files.length === 0) {
                await this.bot.sendMessage(chatId,
                    '📁 *No files uploaded*\\n\\n' +
                    'Upload files by sending documents, photos, audio, or videos to this chat.',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            const totalSize = files.reduce((sum, file) => sum + file.size, 0);
            
            let message = `📁 *Uploaded Files (${files.length})*\\n` +
                         `💾 Total size: ${fileManager.formatFileSize(totalSize)}\\n\\n`;
            
            files.forEach((file, index) => {
                message += `${index + 1}\\. **${file.filename}**\\n`;
                message += `   📊 ${fileManager.formatFileSize(file.size)}\\n`;
                message += `   📅 ${fileManager.formatDate(file.uploadTime)}\\n`;
                message += `   📍 \`${file.relativePath}\`\\n\\n`;
            });
            
            message += '_Use `/delete <filename>` to remove a specific file_\\n';
            message += '_Use `/cleanup` to remove all files_';
            
            await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            
        } catch (error) {
            logger.error('Error handling /files command:', error);
            await this.bot.sendMessage(chatId, '❌ Failed to list files');
        }
    }
    
    /**
     * Handle /delete command
     */
    async handleDeleteCommand(msg) {
        const chatId = msg.chat.id;
        const args = msg.text.split(' ').slice(1).join(' ');
        
        if (!args) {
            await this.bot.sendMessage(chatId,
                '💡 *Delete File*\\n\\n' +
                'Usage: `/delete <filename>`\\n\\n' +
                'Example: `/delete document.pdf`\\n\\n' +
                'Use `/files` to see available files.',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        try {
            const deletedFile = await this.sessionManager.deleteFile(chatId, args);
            const fileManager = this.sessionManager.getFileManager();
            
            await this.bot.sendMessage(chatId,
                `✅ *File deleted successfully!*\\n\\n` +
                `📁 **${deletedFile.filename}**\\n` +
                `💾 Freed: ${fileManager.formatFileSize(deletedFile.size)}`,
                { parse_mode: 'Markdown' }
            );
            
        } catch (error) {
            logger.error('Error deleting file:', error);
            await this.bot.sendMessage(chatId, `❌ ${error.message}`);
        }
    }
    
    /**
     * Handle /cleanup command
     */
    async handleCleanupCommand(chatId) {
        try {
            const files = await this.sessionManager.getUploadedFiles(chatId);
            
            if (files.length === 0) {
                await this.bot.sendMessage(chatId, '📁 No files to clean up');
                return;
            }
            
            const fileManager = this.sessionManager.getFileManager();
            const totalSize = files.reduce((sum, file) => sum + file.size, 0);
            
            await this.bot.sendMessage(chatId,
                `⚠️ *Confirm file cleanup*\\n\\n` +
                `This will delete **${files.length} files** (${fileManager.formatFileSize(totalSize)})\\n\\n` +
                `Are you sure?`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ Yes, delete all', callback_data: 'cleanup_confirm' },
                            { text: '❌ Cancel', callback_data: 'cleanup_cancel' }
                        ]]
                    }
                }
            );
            
        } catch (error) {
            logger.error('Error handling /cleanup command:', error);
            await this.bot.sendMessage(chatId, '❌ Failed to prepare cleanup');
        }
    }
}

module.exports = MessageHandler;