const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const ClaudeAuthenticator = require('../utils/ClaudeAuthenticator');
const PTYSessionHandler = require('../utils/PTYSessionHandler');
const OutputDetector = require('../utils/OutputDetector');

/**
 * Manages Claude Code CLI interactions
 * Handles authentication, agent lifecycle, and communication
 */
class ClaudeCodeManager extends EventEmitter {
    constructor() {
        super();
        this.activeAgents = new Map();
        
        // Initialize utility components
        this.authenticator = new ClaudeAuthenticator();
        this.outputDetector = new OutputDetector();
        this.ptyHandler = new PTYSessionHandler(this.outputDetector);
        
        // Set up event handling
        this.setupEventHandlers();
    }
    
    /**
     * Set up event handlers for utility components
     */
    setupEventHandlers() {
        // Handle output check scheduling
        this.on('schedule-output-check', (agent) => {
            this.scheduleOutputCheck(agent);
        });
        
        // Handle output checking and sending
        this.on('check-and-send-output', (agent, forceSend = false) => {
            this.checkAndSendOutput(agent, forceSend);
        });
    }
    
    /**
     * Initialize Claude Code CLI
     * @param {string} chatId - Telegram chat ID for auth notifications
     */
    async initializeClaude(chatId) {
        return await this.authenticator.initializeClaude(chatId, this);
    }
    
    /**
     * Check if Claude is authenticated
     */
    async checkAuthentication() {
        return await this.authenticator.checkAuthentication();
    }
    
    /**
     * Get authentication status
     */
    getAuthStatus() {
        return this.authenticator.getAuthStatus();
    }
    
    /**
     * Create a new Claude agent for a task
     * @param {string} chatId - Telegram chat ID
     * @param {string} taskId - Unique task identifier
     * @param {string} task - Task description
     */
    async createAgent(chatId, taskId, task) {
        // Enforce single session per chat - kill any existing agents for this chat
        const existingAgents = Array.from(this.activeAgents.entries())
            .filter(([agentId, agent]) => agent.chatId === chatId);
        
        for (const [agentId] of existingAgents) {
            logger.info(`Killing existing agent ${agentId} for chat ${chatId} to enforce single session`);
            await this.killAgent(agentId);
        }
        const agent = {
            id: taskId,
            chatId,
            task,
            ptyProcess: null,
            status: 'initializing', // 'initializing', 'active', 'completed', 'error'
            fullOutput: '',
            lastLines: [],
            expectingResponse: false,
            monitorInterval: null,
            startTime: Date.now(),
            // For intelligent output filtering
            outputBuffer: '',
            lastSentOutput: '',
            outputCheckTimer: null,
            lastUserMessage: task, // Track most recent user input
            isCheckingOutput: false, // Prevent duplicate AI checks
            conversationHistory: [{
                type: 'user',
                content: task,
                timestamp: Date.now()
            }], // Track full conversation flow
            // Output tracking
            lastSentBuffer: '', // Track what we last sent to avoid duplicates
            // Exit tracking
            exitCode: null,
            exitSignal: null,
            completedAt: null
        };
        
        this.activeAgents.set(taskId, agent);
        
        logger.info(`Creating interactive Claude agent ${taskId} for task: ${task}`);
        
        // Ensure CLAUDE.md exists before initializing Claude Code
        this.ensureClaudeMdExists();
        
        // Store chat context for file sending scripts
        this.storeChatContext(chatId, taskId);
        
        // Use PTY for full interactive Claude Code support
        logger.info(`Creating interactive Claude Code session for agent ${taskId} using PTY`);
        
        await this.ptyHandler.createSession(agent, task, this);
        return agent;
    }
    
    
    /**
     * OLD INTERACTIVE METHOD - DISABLED due to raw mode issues
     */
    createInteractiveAgent_DISABLED() {
        // Set up event handlers
        agent.process.stdout.on('data', (data) => {
            const output = data.toString();
            agent.fullOutput += output;
            
            // Update last lines for monitoring
            const lines = agent.fullOutput.split('\\n');
            agent.lastLines = lines.slice(-10).filter(line => line.trim());
            
            logger.debug(`Agent ${agent.id} stdout:`, output.slice(0, 200));
            
            this.emit('agent-output', {
                agentId: agent.id,
                chatId: agent.chatId,
                text: output
            });
        });
        
        agent.process.stderr.on('data', (data) => {
            logger.error(`Agent ${taskId} stderr:`, data.toString());
        });
        
        agent.process.on('close', (code) => {
            if (agent.monitorInterval) {
                clearInterval(agent.monitorInterval);
            }
            logger.info(`Agent ${taskId} exited with code ${code}`);
            this.activeAgents.delete(taskId);
            this.emit('agent-complete', { taskId, code, fullOutput: agent.fullOutput });
        });
        
        agent.process.on('error', (error) => {
            if (agent.monitorInterval) {
                clearInterval(agent.monitorInterval);
            }
            logger.error(`Agent ${taskId} process error:`, error);
            this.activeAgents.delete(taskId);
            this.emit('agent-error', { taskId, error });
        });
        
        // Send initial task prompt
        setTimeout(() => {
            if (agent.process && !agent.process.killed) {
                agent.process.stdin.write(task + '\\n');
                logger.info(`Sent initial prompt to Claude agent ${taskId}: "${task}"`);
                
                // Start monitoring every minute
                this.startMonitoring(agent);
            } else {
                logger.error(`Agent ${taskId} process died before sending initial prompt`);
            }
        }, 2000);
        
        return agent;
    }
    
    /**
     * Process agent output and emit appropriate events
     * @private
     */
    processAgentOutput(agent) {
        const lines = agent.buffer.split('\n');
        agent.buffer = lines.pop() || '';
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            // Since we're not using JSON output, treat everything as plain text
            this.emit('agent-output', {
                agentId: agent.id,
                chatId: agent.chatId,
                text: line
            });
            
            // Check if Claude is asking a question
            if (this.isQuestionContent(line)) {
                agent.expectingResponse = true;
                agent.questionQueue.push(line);
                this.emit('agent-question', {
                    agentId: agent.id,
                    chatId: agent.chatId,
                    question: line
                });
            }
        }
    }
    
    /**
     * Detect if content contains a question
     * @private
     */
    isQuestionContent(content) {
        return content.includes('?') ||
               /please (provide|specify|confirm|choose)/i.test(content) ||
               /would you like/i.test(content) ||
               /do you want/i.test(content) ||
               /which|what|when|where|how|should/i.test(content);
    }
    
    /**
     * Send response to agent via PTY
     */
    async sendToAgent(agentId, response) {
        const agent = this.activeAgents.get(agentId);
        if (!agent || !agent.ptyProcess) {
            throw new Error('Agent not found or PTY session inactive');
        }
        
        // Send response text, then Enter key
        agent.ptyProcess.write(response);
        setTimeout(() => {
            agent.ptyProcess.write('\r');
        }, 50);
        
        agent.expectingResponse = false;
        logger.info(`Sent response to agent ${agentId}: "${response}"`);
    }
    
    /**
     * Start monitoring Claude session every minute
     */
    startMonitoring(agent) {
        agent.monitorInterval = setInterval(async () => {
            await this.monitorAgent(agent);
        }, 60000); // Every 1 minute
        
        logger.info(`Started monitoring for agent ${agent.id}`);
    }
    
    /**
     * Monitor agent and decide if intervention is needed
     */
    async monitorAgent(agent) {
        if (!agent.ptyProcess) {
            logger.debug(`Agent ${agent.id} PTY process not found during monitoring`);
            return;
        }
        
        const lastTenLines = agent.lastLines.join('\n');
        logger.info(`Monitoring agent ${agent.id}. Output length: ${agent.fullOutput.length}, Last lines: ${agent.lastLines.length}`);
        
        if (agent.lastLines.length === 0) {
            logger.warn(`Agent ${agent.id} has no output yet after ${Math.round((Date.now() - agent.startTime) / 1000)}s`);
            return;
        }
        
        logger.debug(`Agent ${agent.id} last 10 lines:`, lastTenLines);
        
        // Ask detection model if intervention is needed
        const needsIntervention = await this.detectInterventionNeeded(lastTenLines);
        
        if (needsIntervention) {
            logger.info(`Intervention needed for agent ${agent.id}`);
            this.emit('agent-intervention-needed', {
                agentId: agent.id,
                chatId: agent.chatId,
                lastLines: lastTenLines,
                agent: agent
            });
        } else {
            logger.debug(`Agent ${agent.id} monitoring: no intervention needed`);
        }
    }
    
    /**
     * Use basic pattern detection to determine if intervention might be needed
     * Real detection is done by AIService in the main bot
     */
    async detectInterventionNeeded(output) {
        const patterns = [
            /waiting.*input/i,
            /press.*enter/i,
            /press.*escape/i,
            /continue.*\?/i,
            /yes.*no/i,
            /\[y\/n\]/i,
            /choice/i,
            /select/i,
            /confirm/i,
            /proceed/i,
            /enter.*name/i,
            /enter.*path/i,
            /choose.*option/i,
            /pick.*from/i,
            /type.*response/i,
            /provide.*input/i,
            /\d+\)/i, // numbered options like "1) Option A"
            /\[[^\]]*\]/i, // bracketed options like [1-3]
            />\s*$/m, // prompt ending with >
            /:\s*$/m  // prompt ending with :
        ];
        
        return patterns.some(pattern => pattern.test(output));
    }
    
    /**
     * Send command to interactive Claude session via PTY
     */
    async sendCommand(agentId, command) {
        const agent = this.activeAgents.get(agentId);
        if (!agent) {
            throw new Error('Agent not found');
        }
        
        // If agent is completed, restart it with the new command
        if (agent.status === 'completed' || !agent.ptyProcess) {
            logger.info(`Agent ${agentId} was completed, restarting with new command: "${command}"`);
            agent.status = 'initializing';
            agent.exitCode = null;
            agent.exitSignal = null;
            agent.completedAt = null;
            
            // Create new PTY session with the command
            await this.ptyHandler.createSession(agent, command, this);
            return;
        }
        
        // Use PTYSessionHandler for command sending
        this.ptyHandler.sendCommand(agent, command);
        
        // Force an immediate output check after user input for text commands
        if (!['ESCAPE', 'ENTER', 'EXIT', 'UP', 'DOWN', 'LEFT', 'RIGHT'].includes(command.toUpperCase())) {
            setTimeout(() => {
                this.checkAndSendOutput(agent);
            }, 3000); // Check 3 seconds after user input
        }
    }
    
    /**
     * Detect if Claude Code has finished processing and has new output to send
     */
    detectNewCommandOutput(agent) {
        return this.outputDetector.detectNewCommandOutput(agent);
    }
    
    /**
     * Schedule intelligent output check with debouncing
     */
    scheduleOutputCheck(agent) {
        // Only schedule if not already scheduled
        if (!agent.outputCheckTimer) {
            // Schedule check every 10 seconds to save LLM credits
            agent.outputCheckTimer = setInterval(() => {
                logger.info(`Running scheduled output check for agent ${agent.id}`);
                this.checkAndSendOutput(agent);
            }, 5000); // Check every 5 seconds - less frequent since we're smarter now
            
            logger.info(`Started output check interval for agent ${agent.id}`);
        } else {
            logger.debug(`Output check already scheduled for agent ${agent.id}`);
        }
    }
    
    /**
     * Check if output should be sent using AI filtering
     */
    async checkAndSendOutput(agent, forceSend = false) {
        // Prevent duplicate checks
        if (agent.isCheckingOutput && !forceSend) {
            logger.debug(`Already checking output for agent ${agent.id}, skipping`);
            return;
        }
        
        try {
            agent.isCheckingOutput = true;
            const currentLastLines = agent.lastLines.join('\n');
            
            // DEBUG: Show current buffer and output content (reduced)
            logger.debug(`Agent ${agent.id} check: Buffer=${agent.outputBuffer.length} chars, Lines=${agent.lastLines.length}`);
            
            // Skip if no new meaningful output
            if (!forceSend && currentLastLines === agent.lastSentOutput) {
                logger.debug(`Agent ${agent.id} - Same output as last sent, skipping`);
                agent.isCheckingOutput = false;
                return;
            }
            
            // Skip if no meaningful output at all
            if (!forceSend && (!currentLastLines || currentLastLines.trim().length === 0)) {
                logger.debug(`Agent ${agent.id} - No meaningful output yet`);
                agent.isCheckingOutput = false;
                return;
            }
            
            // Smart ⏺ symbol detection - only process when content after symbol changes
            const detection = this.detectNewCommandOutput(agent);
            
            logger.info(`Agent ${agent.id} detection result: ${detection.hasNewOutput ? 'SEND' : 'SKIP'} - ${detection.reason}`);
            
            // Comment out temporary fallback - ⏺ detection should work now
            /*
            if (agent.outputBuffer.length > 1000) {
                logger.info(`Agent ${agent.id} TEMP: Sending output due to large buffer (${agent.outputBuffer.length} chars) - bypassing ⏺ detection`);
                
                agent.conversationHistory.push({
                    type: 'claude',
                    content: agent.outputBuffer,
                    timestamp: Date.now()
                });
                
                this.emit('agent-output', {
                    agentId: agent.id,
                    chatId: agent.chatId,
                    text: agent.outputBuffer
                });
                
                agent.outputBuffer = '';
                agent.lastSentOutput = currentLastLines;
                agent.isCheckingOutput = false;
                return;
            }
            */
            
            if (!detection.hasNewOutput) {
                logger.debug(`Agent ${agent.id}: ${detection.reason}`);
                agent.isCheckingOutput = false;
                return;
            }
            
            logger.info(`Agent ${agent.id}: ${detection.reason}`);
            
            // Send output for processing (will be cleaned by OutputCleanerService)
            logger.info(`Sending output for LLM cleaning: ${agent.outputBuffer.length} chars`);
            
            agent.conversationHistory.push({
                type: 'claude',
                content: agent.outputBuffer,
                timestamp: Date.now()
            });
            
            this.emit('agent-output', {
                agentId: agent.id,
                chatId: agent.chatId,
                text: agent.outputBuffer
            });
            
            // Clear buffer and update last sent output
            agent.lastSentBuffer = agent.outputBuffer; // Set to current buffer before clearing
            agent.outputBuffer = '';
            agent.lastSentOutput = currentLastLines;
            agent.isCheckingOutput = false;
            return;
            
            /* DISABLED AI FILTERING
            // If no AI service, send output directly
            if (!this.aiService) {
                agent.conversationHistory.push({
                    type: 'claude',
                    content: agent.outputBuffer,
                    timestamp: Date.now()
                });
                
                this.emit('agent-output', {
                    agentId: agent.id,
                    chatId: agent.chatId,
                    text: agent.outputBuffer
                });
                
                agent.outputBuffer = '';
                agent.lastSentOutput = currentLastLines;
                agent.isCheckingOutput = false;
                return;
            }
            
            logger.info(`Checking output for agent ${agent.id} (${agent.outputBuffer.length} chars buffered)`);
            
            // Use AI to decide if output should be sent (with full conversation context)
            const shouldSend = forceSend || await this.aiService.shouldSendClaudeOutput(
                currentLastLines, 
                agent.conversationHistory
            );
            
            if (shouldSend) {
                logger.info(`AI approved sending output for agent ${agent.id}`);
                
                // Add to conversation history before sending
                agent.conversationHistory.push({
                    type: 'claude',
                    content: agent.outputBuffer,
                    timestamp: Date.now()
                });
                
                this.emit('agent-output', {
                    agentId: agent.id,
                    chatId: agent.chatId,
                    text: agent.outputBuffer
                });
                
                // Clear buffer and update last sent output
                agent.outputBuffer = '';
                agent.lastSentOutput = currentLastLines;
                agent.lastSentBuffer = ''; // Reset this too since buffer was cleared
            } else {
                logger.info(`AI filtered output for agent ${agent.id} - not ready to send. Last lines: ${currentLastLines.substring(0, 200)}`);
            }
            */
            
        } catch (error) {
            logger.error(`Error in output filtering for agent ${agent.id}:`, error);
            // Fallback: send the output anyway
            agent.conversationHistory.push({
                type: 'claude',
                content: agent.outputBuffer,
                timestamp: Date.now()
            });
            
            this.emit('agent-output', {
                agentId: agent.id,
                chatId: agent.chatId,
                text: agent.outputBuffer
            });
            agent.outputBuffer = '';
        } finally {
            agent.isCheckingOutput = false;
        }
    }
    
    /**
     * Kill specific agent
     */
    async killAgent(agentId) {
        const agent = this.activeAgents.get(agentId);
        if (agent) {
            if (agent.monitorInterval) {
                clearInterval(agent.monitorInterval);
            }
            if (agent.outputCheckTimer) {
                clearInterval(agent.outputCheckTimer);
                agent.outputCheckTimer = null;
            }
            // Use PTYSessionHandler to kill the process
            this.ptyHandler.killProcess(agent);
            this.activeAgents.delete(agentId);
            
            // Clear chat context if this was the last agent
            if (this.activeAgents.size === 0) {
                this.clearChatContext();
            }
            
            logger.info(`Killed agent ${agentId}`);
        }
    }
    
    /**
     * Kill all active agents
     */
    async killAllAgents() {
        for (const [agentId, agent] of this.activeAgents) {
            if (agent.monitorInterval) {
                clearInterval(agent.monitorInterval);
            }
            if (agent.outputCheckTimer) {
                clearInterval(agent.outputCheckTimer);
                agent.outputCheckTimer = null;
            }
            // Use PTYSessionHandler to kill the process
            this.ptyHandler.killProcess(agent);
            logger.info(`Killed agent ${agentId}`);
        }
        this.activeAgents.clear();
        
        // Clear chat context since all agents are killed
        this.clearChatContext();
    }
    
    /**
     * Store chat context for file sending scripts
     */
    storeChatContext(chatId, agentId) {
        const contextPath = path.join(__dirname, '..', '..', '.claude-context.json');
        const context = {
            chatId,
            agentId,
            timestamp: Date.now(),
            projectDir: path.join(__dirname, '..', '..')
        };
        
        try {
            fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
            logger.debug(`Stored chat context for agent ${agentId}, chat ${chatId}`);
        } catch (error) {
            logger.error('Error storing chat context:', error);
        }
    }
    
    /**
     * Clear chat context
     */
    clearChatContext() {
        const contextPath = path.join(__dirname, '..', '..', '.claude-context.json');
        try {
            if (fs.existsSync(contextPath)) {
                fs.unlinkSync(contextPath);
                logger.debug('Cleared chat context');
            }
        } catch (error) {
            logger.error('Error clearing chat context:', error);
        }
    }
    
    /**
     * Ensure CLAUDE.md has file sharing instructions
     */
    ensureClaudeMdExists() {
        const claudeMdPath = path.join(__dirname, '..', '..', 'CLAUDE.md');
        
        try {
            let existingContent = '';
            if (fs.existsSync(claudeMdPath)) {
                existingContent = fs.readFileSync(claudeMdPath, 'utf8');
                
                // Check if file sharing instructions already exist
                if (existingContent.includes('📤 Sending Files to User') || existingContent.includes('scripts/send-file')) {
                    logger.debug('CLAUDE.md already contains file sharing instructions');
                    return;
                }
            }
            
            const fileInstructions = `

## 📤 Sending Files to User

You can send any file to the Telegram user using the provided script:

\`\`\`bash
# Send a file
scripts/send-file path/to/your/file.txt

# Send a file with a message
scripts/send-file data.json "Here's the processed data!"

# Send from any subdirectory
./scripts/send-file reports/analysis.pdf "Analysis complete"
\`\`\`

**Examples:**
\`\`\`bash
# Send a log file
scripts/send-file logs/debug.log "Debug information"

# Send generated output
scripts/send-file output.csv "CSV export ready"

# Send images or documents
scripts/send-file screenshot.png "Current state"
scripts/send-file report.pdf
\`\`\`

**Notes:**
- The script automatically detects the current Telegram chat
- Maximum file size: 50MB (Telegram limit)
- Supports all file types
- Only works during an active Claude Code session

## 📥 Accessing User-Uploaded Files

Users can upload files through Telegram, and they are automatically saved to:

\`\`\`bash
telegram-uploads/chat_<chat_id>/
\`\`\`

**File Structure:**
\`\`\`
telegram-uploads/
└── chat_123456789/
    ├── document.pdf
    ├── image.jpg
    ├── data.json
    └── archive.zip
\`\`\`

**Accessing Files in Code:**
\`\`\`bash
# List uploaded files
ls telegram-uploads/chat_*/

# Use uploaded files directly
cat telegram-uploads/chat_*/document.txt
python process.py telegram-uploads/chat_*/data.csv
\`\`\`

**File Information:**
- Files are organized by chat ID
- Original filenames are preserved
- File metadata (size, upload time) is tracked
- Users can manage their files via bot commands (\`/files\`, \`/delete\`, \`/cleanup\`)

## 💡 File Sharing Tips

1. **File Paths**: Use relative paths from the project root
2. **Large Files**: For files >50MB, consider splitting or compressing
3. **Organization**: Create subdirectories for organized output
4. **User Files**: Always check \`telegram-uploads/\` for user-provided data

This integration enables seamless file sharing between Claude Code and Telegram users!
`;
            
            if (existingContent) {
                // Append to existing content
                const updatedContent = existingContent + fileInstructions;
                fs.writeFileSync(claudeMdPath, updatedContent);
                logger.info('Added file sharing instructions to existing CLAUDE.md');
            } else {
                // Create new file with basic header + file instructions
                const newContent = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Telegram bot that provides direct access to Claude Code capabilities through chat interface.
${fileInstructions}`;
                fs.writeFileSync(claudeMdPath, newContent);
                logger.info('Created CLAUDE.md with file sharing instructions');
            }
        } catch (error) {
            logger.error('Error updating CLAUDE.md:', error);
        }
    }
}

module.exports = ClaudeCodeManager;