const logger = require('../utils/logger');
const https = require('https');
const http = require('http');

/**
 * Handles all incoming Telegram messages
 */
class MessageHandler {
    constructor(bot, sessionManager, claudeCodeManager, aiService, config) {
        this.bot = bot;
        this.sessionManager = sessionManager;
        this.claudeCodeManager = claudeCodeManager;
        this.aiService = aiService;
        this.config = config;
        this.authorizedUsers = config.authorizedUsers;
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
            
            // Handle authentication code
            const session = this.sessionManager.getOpenRouterSession(chatId);
            if (session && session.waitingForAuth) {
                await this.handleAuthCode(chatId, text);
                return;
            }
            
            // Handle OpenRouter response
            if (session && session.waitingForResponse) {
                await this.handleUserResponse(chatId, text, session);
                return;
            }
            
            // Handle Claude agent response
            const claudeSession = this.sessionManager.getClaudeAgentSessionByChat(chatId);
            if (claudeSession && claudeSession.waitingForUserResponse) {
                this.sessionManager.updateClaudeAgentSession(claudeSession.agentId, {
                    waitingForUserResponse: false
                });
                
                // Process user response through main model to determine terminal command
                const lastQuestion = claudeSession.lastQuestion || 'User input needed';
                const terminalCommand = await this.aiService.processUserResponseToTerminalCommand(
                    text, 
                    lastQuestion, 
                    claudeSession.task
                );
                
                await this.bot.sendMessage(chatId,
                    `🤖 Interpreting your response as: \`${terminalCommand}\``,
                    { parse_mode: 'Markdown' }
                );
                
                await this.claudeCodeManager.sendCommand(claudeSession.agentId, terminalCommand);
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
                
                // Send the user's message directly to Claude Code
                await this.claudeCodeManager.sendCommand(latestAgent.agentId, text);
                return;
            }
            
            // Route all text messages directly to Claude Code (bypassing OpenRouter)
            if (text && text.trim().length > 0) {
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
                await this.bot.sendMessage(chatId, '❓ Unknown command');
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
     * Handle authentication code
     */
    async handleAuthCode(chatId, code) {
        const session = this.sessionManager.getOpenRouterSession(chatId);
        if (!session || !session.waitingForAuth) return;
        
        this.sessionManager.updateOpenRouterSession(chatId, { waitingForAuth: false });
        
        try {
            await this.claudeCodeManager.saveAuthData({
                authCode: code,
                timestamp: Date.now()
            });
            
            await this.bot.sendMessage(chatId,
                '✅ Authentication successful! Claude Code is now ready to use.\\n\\n' +
                'You can:\\n' +
                '• Continue with your task\\n' +
                '• Use `/claude <task>` for direct Claude Code access',
                { parse_mode: 'Markdown' }
            );
            
            // Continue with pending task
            if (session.pendingClaudeTask) {
                await this.startClaudeAgent(chatId, session.pendingClaudeTask);
                this.sessionManager.updateOpenRouterSession(chatId, { pendingClaudeTask: null });
            }
        } catch (error) {
            logger.error('Auth code handling error:', error);
            await this.bot.sendMessage(chatId, '❌ Authentication failed. Please try again.');
        }
    }
    
    /**
     * Start new OpenRouter task
     */
    async startNewTask(chatId, task) {
        const session = this.sessionManager.createOpenRouterSession(chatId, task);
        
        const processingMsg = await this.bot.sendMessage(chatId,
            '🔄 Processing your request with OpenRouter...'
        );
        
        try {
            await this.executeTask(chatId, task, session, processingMsg.message_id);
        } catch (error) {
            logger.error('Task execution error:', error);
            this.sessionManager.deleteOpenRouterSession(chatId);
            await this.sendError(chatId, 'Failed to execute task');
        }
    }
    
    /**
     * Execute OpenRouter task
     */
    async executeTask(chatId, userInput, session, processingMsgId = null) {
        try {
            const response = await this.aiService.processTask(userInput, session);
            
            if (processingMsgId) {
                try {
                    await this.bot.deleteMessage(chatId, processingMsgId);
                } catch (e) {
                    // Ignore deletion errors
                }
            }
            
            // Check if AI suggests using Claude Code - auto-execute without permission
            if (this.aiService.detectClaudeCodeSuggestion(response)) {
                // Clean up the session and start Claude Code directly
                this.sessionManager.deleteOpenRouterSession(chatId);
                
                await this.bot.sendMessage(chatId,
                    `🔧 *Using Claude Code for this task*\\n\\n` +
                    `Claude Code can provide real-time data, file access, and system commands for better results.`,
                    { parse_mode: 'Markdown' }
                );
                
                // Start Claude Code directly with the original task
                await this.startClaudeAgent(chatId, session.task);
                return;
            }
            
            // Check if AI is asking for input
            const needsInput = await this.aiService.detectQuestion(response, session);
            
            if (needsInput) {
                this.sessionManager.updateOpenRouterSession(chatId, { waitingForResponse: true });
                
                await this.bot.sendMessage(chatId,
                    `${response}\\n\\n` +
                    `💬 *Please provide your response:*`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            force_reply: true,
                            input_field_placeholder: "Type your response..."
                        }
                    }
                );
            } else {
                // Check if task is complete
                const isComplete = await this.aiService.detectCompletion(response);
                
                if (isComplete) {
                    await this.sendLongMessage(chatId, response);
                    await this.bot.sendMessage(chatId,
                        '✅ Task completed!\\n\\n' +
                        `📊 Stats:\\n` +
                        `• Interactions: ${session.interactions}\\n` +
                        `• Detection Checks: ${session.detectionChecks}\\n` +
                        `• Duration: ${Math.round((Date.now() - session.startTime) / 1000)}s`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: { remove_keyboard: true }
                        }
                    );
                    this.sessionManager.deleteOpenRouterSession(chatId);
                } else {
                    // Progress update
                    await this.sendLongMessage(chatId, response);
                    
                    await this.bot.sendMessage(chatId,
                        'What would you like to do next?',
                        {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '▶️ Continue', callback_data: 'continue' },
                                    { text: '✅ Complete', callback_data: 'complete' },
                                    { text: '❌ Cancel', callback_data: 'cancel' }
                                ]]
                            }
                        }
                    );
                }
            }
        } catch (error) {
            logger.error('Task execution error:', error);
            throw error;
        }
    }
    
    /**
     * Handle user response
     */
    async handleUserResponse(chatId, response, session) {
        this.sessionManager.updateOpenRouterSession(chatId, { waitingForResponse: false });
        
        const processingMsg = await this.bot.sendMessage(chatId,
            '🤔 Processing your response...',
            { reply_markup: { remove_keyboard: true } }
        );
        
        await this.executeTask(chatId, response, session, processingMsg.message_id);
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
            
            await this.bot.sendMessage(chatId,
                `🔧 *Using Claude Code for this task*\\n\\n` +
                `📋 Task: ${task}\\n` +
                `🤖 Agent ID: \`${taskId}\`\\n` +
                (uploadedFiles.length > 0 ? `📁 Files available: ${uploadedFiles.length}\\n` : '') +
                `\\n_Claude Code has access to real-time data, file system, web APIs, and system commands..._`,
                { parse_mode: 'Markdown' }
            );
            
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