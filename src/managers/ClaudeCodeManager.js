const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

/**
 * Manages Claude Code CLI interactions
 * Handles authentication, agent lifecycle, and communication
 */
class ClaudeCodeManager extends EventEmitter {
    constructor(aiService = null) {
        super();
        this.claudeProcess = null;
        this.isAuthenticated = false;
        this.activeAgents = new Map();
        this.authData = null;
        this.aiService = aiService; // For intelligent output filtering
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
     * Initialize Claude Code CLI
     * @param {string} chatId - Telegram chat ID for auth notifications
     */
    async initializeClaude(chatId) {
        // First, check if Claude is already authenticated
        const isAuth = await this.checkAuthentication();
        if (isAuth) {
            this.isAuthenticated = true;
            return;
        }
        
        // If not authenticated, we need to run interactive mode to get auth URL
        return new Promise((resolve, reject) => {
            const args = [];
            
            this.claudeProcess = spawn('claude', args, {
                env: { ...process.env },
                cwd: process.cwd()
            });
            
            let output = '';
            let authUrlDetected = false;
            
            this.claudeProcess.stdout.on('data', (data) => {
                output += data.toString();
                
                // Detect authentication URL
                const authUrlMatch = output.match(/https:\/\/auth\.anthropic\.com[^\s]+/);
                if (authUrlMatch && !authUrlDetected) {
                    authUrlDetected = true;
                    this.emit('auth-required', {
                        chatId,
                        url: authUrlMatch[0]
                    });
                    // Kill the process since we got the URL
                    this.claudeProcess.kill();
                    resolve();
                }
            });
            
            this.claudeProcess.stderr.on('data', (data) => {
                const error = data.toString();
                logger.error('Claude stderr:', error);
                
                // Check for auth-related errors
                if (error.includes('authentication') || error.includes('login')) {
                    // Try to extract URL from error
                    const urlMatch = error.match(/https:\/\/auth\.anthropic\.com[^\s]+/);
                    if (urlMatch && !authUrlDetected) {
                        authUrlDetected = true;
                        this.emit('auth-required', {
                            chatId,
                            url: urlMatch[0]
                        });
                        this.claudeProcess.kill();
                        resolve();
                    }
                }
            });
            
            this.claudeProcess.on('error', (error) => {
                logger.error('Claude process error:', error);
                reject(error);
            });
            
            // Timeout for initialization
            setTimeout(() => {
                if (!authUrlDetected) {
                    this.claudeProcess.kill();
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
            lastSentBuffer: '' // Track what we last sent to avoid duplicates
        };
        
        this.activeAgents.set(taskId, agent);
        
        logger.info(`Creating interactive Claude agent ${taskId} for task: ${task}`);
        
        // Use PTY for full interactive Claude Code support
        logger.info(`Creating interactive Claude Code session for agent ${taskId} using PTY`);
        
        this.createInteractiveSession(agent, task);
        return agent;
    }
    
    /**
     * Create interactive Claude Code session using PTY
     */
    async createInteractiveSession(agent, task) {
        try {
            const args = ['--dangerously-skip-permissions'];
            
            logger.info(`Starting PTY session: claude ${args.join(' ')}`);
            
            // Create pseudo-terminal
            try {
                agent.ptyProcess = pty.spawn('claude', args, {
                    name: 'xterm-color',
                    cols: 120,
                    rows: 30,
                    cwd: process.cwd(),
                    env: { ...process.env }
                });
            } catch (error) {
                logger.error(`Failed to spawn PTY for agent ${agent.id}:`, error);
                this.activeAgents.delete(agent.id);
                this.emit('agent-error', { taskId: agent.id, error });
                return;
            }
        
        logger.info(`PTY session created for agent ${agent.id}, PID: ${agent.ptyProcess.pid}`);
        
        // Handle output with intelligent filtering
        agent.ptyProcess.onData((data) => {
            try {
                const output = data.toString();
                agent.fullOutput += output;
                agent.outputBuffer += output;
                
                // Update last lines for monitoring
                const lines = agent.fullOutput.split('\n');
                agent.lastLines = lines.slice(-10).filter(line => line.trim());
                
                // Check for ⏺ symbol in new output
                const hasSymbol = output.includes('⏺');
                if (hasSymbol) {
                    logger.info(`Agent ${agent.id} ⏺ SYMBOL DETECTED in new output!`);
                }
                
                logger.debug(`Agent ${agent.id} PTY output (${output.length} chars):`, output.slice(0, 200));
                logger.debug(`Agent ${agent.id} buffer size: ${agent.outputBuffer.length}, last lines count: ${agent.lastLines.length}`);
                
                // Start/restart timer for intelligent output checking
                this.scheduleOutputCheck(agent);
                
            } catch (error) {
                logger.error(`Error processing PTY output for agent ${agent.id}:`, error);
            }
        });
        
        // Handle exit
        agent.ptyProcess.onExit(({ exitCode, signal }) => {
            try {
                logger.info(`PTY session for agent ${agent.id} exited with code: ${exitCode}, signal: ${signal}`);
                
                if (agent.monitorInterval) {
                    clearInterval(agent.monitorInterval);
                }
                
                if (agent.outputCheckTimer) {
                    clearInterval(agent.outputCheckTimer);
                    agent.outputCheckTimer = null;
                }
                
                // Send final output when agent exits
                this.checkAndSendOutput(agent, true);
                
                this.activeAgents.delete(agent.id);
                
                this.emit('agent-complete', { 
                    taskId: agent.id, 
                    code: exitCode, 
                    fullOutput: agent.fullOutput 
                });
            } catch (error) {
                logger.error(`Error handling PTY exit for agent ${agent.id}:`, error);
            }
        });
        
            // Wait for Claude to initialize, then send task
            setTimeout(() => {
                try {
                    if (agent.ptyProcess) {
                        logger.info(`Sending task to Claude agent ${agent.id}: "${task}"`);
                        // Send the task text first
                        agent.ptyProcess.write(task);
                        // Then send Enter key press (not as text)
                        setTimeout(() => {
                            agent.ptyProcess.write('\r');
                            logger.info(`Sent Enter key to execute task for agent ${agent.id}`);
                        }, 100);
                        
                        // Start monitoring
                        this.startMonitoring(agent);
                    } else {
                        logger.error(`PTY process for agent ${agent.id} died before sending task`);
                    }
                } catch (error) {
                    logger.error(`Error sending task to Claude agent ${agent.id}:`, error);
                    this.emit('agent-error', { taskId: agent.id, error });
                }
            }, 3000); // Give Claude time to show welcome screen
            
        } catch (error) {
            logger.error(`Error in createInteractiveSession for agent ${agent.id}:`, error);
            this.activeAgents.delete(agent.id);
            this.emit('agent-error', { taskId: agent.id, error });
        }
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
        if (!agent || !agent.ptyProcess) {
            throw new Error('Agent not found or PTY session inactive');
        }
        
        switch (command.toUpperCase()) {
            case 'ESCAPE':
                agent.ptyProcess.write('\x1b'); // ESC key
                logger.info(`Sent ESC key to agent ${agentId}`);
                break;
            case 'ENTER':
                agent.ptyProcess.write('\r'); // Enter key (just \r)
                logger.info(`Sent ENTER key to agent ${agentId}`);
                break;
            case 'EXIT':
                agent.ptyProcess.write('\\exit\r\n'); // Exit command
                logger.info(`Sent EXIT command to agent ${agentId}`);
                break;
            case 'UP':
                agent.ptyProcess.write('\x1b[A'); // Up arrow
                logger.info(`Sent UP arrow to agent ${agentId}`);
                break;
            case 'DOWN':
                agent.ptyProcess.write('\x1b[B'); // Down arrow
                logger.info(`Sent DOWN arrow to agent ${agentId}`);
                break;
            case 'LEFT':
                agent.ptyProcess.write('\x1b[D'); // Left arrow
                logger.info(`Sent LEFT arrow to agent ${agentId}`);
                break;
            case 'RIGHT':
                agent.ptyProcess.write('\x1b[C'); // Right arrow
                logger.info(`Sent RIGHT arrow to agent ${agentId}`);
                break;
            default:
                // Send text input (follow-up questions, choices, filenames, etc.)
                // Use same pattern as initial task - send text first, then Enter
                agent.ptyProcess.write(command);
                
                // Update last user message for AI filtering context
                agent.lastUserMessage = command;
                
                // Add to conversation history
                agent.conversationHistory.push({
                    type: 'user',
                    content: command,
                    timestamp: Date.now()
                });
                
                setTimeout(() => {
                    agent.ptyProcess.write('\r');
                    logger.info(`Sent follow-up text and Enter to agent ${agentId}: "${command}"`);
                    
                    // Force an immediate output check after user input
                    setTimeout(() => {
                        this.checkAndSendOutput(agent);
                    }, 3000); // Check 3 seconds after user input
                }, 100);
        }
    }
    
    /**
     * Extract content after ⏺ symbol from text
     */
    extractContentAfterSymbol(text) {
        const symbolMatch = text.match(/⏺(.*)$/ms);
        return symbolMatch ? symbolMatch[1].trim() : '';
    }
    
    /**
     * Check if Claude Code is still processing
     */
    isClaudeProcessing(text) {
        // Multiple checks for processing state
        
        // 1. Check for "esc to interrupt" in various formats
        const hasEscToInterrupt = /esc\s+to\s+interrupt/i.test(text);
        
        // 2. Check for active processing indicators like "Exploring..." with timer
        const hasActiveTimer = /[✻⏺]\s*\w+…\s*\(\d+s\s*·/i.test(text);
        
        // 3. Check for "Waiting..." or "Running..." status
        const hasActiveStatus = /⎿\s*(Waiting|Running|Processing|Exploring)\.{2,}/i.test(text);
        
        const isProcessing = hasEscToInterrupt || hasActiveTimer || hasActiveStatus;
        
        if (isProcessing) {
            logger.debug(`Claude still processing - ESC:${hasEscToInterrupt}, Timer:${hasActiveTimer}, Status:${hasActiveStatus}`);
        }
        
        return isProcessing;
    }
    
    /**
     * Normalize buffer content for comparison by removing processing animations
     */
    normalizeBufferContent(buffer) {
        if (!buffer) return '';
        
        // Remove processing indicators that change during animations:
        // 1. ⏺ symbols with surrounding content that may appear/disappear
        // 2. Processing timers like "(5s ·" or "(12s ·"
        // 3. "esc to interrupt" prompts
        // 4. Cursor/animation artifacts
        
        let normalized = buffer
            // Remove ⏺ symbol lines entirely (they're just processing indicators)
            .replace(/^.*⏺.*$/gm, '')
            // Remove "esc to interrupt" lines
            .replace(/^.*esc\s+to\s+interrupt.*$/gmi, '')
            // Remove processing timer patterns like "(5s ·" 
            .replace(/\(\d+s\s*·[^)]*\)/g, '')
            // Remove other processing artifacts like ✻ and ⎿
            .replace(/[✻⎿]\s*/g, '')
            // Remove ANSI escape sequences that might be in terminal output
            .replace(/\x1b\[[0-9;]*m/g, '')
            // Remove cursor position sequences
            .replace(/\x1b\[[0-9;]*[HfABCD]/g, '')
            // Normalize whitespace (multiple spaces/tabs/newlines to single space)
            .replace(/\s+/g, ' ')
            .trim();
            
        return normalized;
    }

    /**
     * Detect if Claude Code has finished processing
     */
    detectNewCommandOutput(agent) {
        const isProcessing = this.isClaudeProcessing(agent.outputBuffer);
        
        logger.info(`Agent ${agent.id} processing check:`);
        logger.info(`Has 'esc to interrupt': ${isProcessing}`);
        logger.info(`Buffer size: ${agent.outputBuffer.length}`);
        logger.info(`Last sent size: ${agent.lastSentBuffer ? agent.lastSentBuffer.length : 0}`);
        
        // Debug: Show a sample of the buffer to see what we're checking
        if (agent.outputBuffer.length > 0) {
            const bufferSample = agent.outputBuffer.substring(agent.outputBuffer.length - 500);
            logger.debug(`Buffer tail (last 500 chars): ${bufferSample}`);
        }
        
        // Send output when:
        // 1. Claude is NOT processing (no "esc to interrupt")
        // 2. We have substantial output (> 1000 chars)
        // 3. Normalized content is meaningfully different from last sent
        if (!isProcessing && agent.outputBuffer.length > 1000) {
            // Normalize both current and last sent content to ignore animation changes
            const currentNormalized = this.normalizeBufferContent(agent.outputBuffer);
            const lastSentNormalized = this.normalizeBufferContent(agent.lastSentBuffer || '');
            
            // Check if meaningful content has changed (not just ⏺ symbol animations)
            const contentLengthDiff = Math.abs(currentNormalized.length - lastSentNormalized.length);
            const hasNewMeaningfulContent = currentNormalized !== lastSentNormalized && contentLengthDiff > 50;
            
            if (hasNewMeaningfulContent) {
                logger.info(`Agent ${agent.id} READY TO SEND - Claude is done with NEW meaningful content`);
                logger.debug(`Normalized content length diff: ${contentLengthDiff} chars`);
                
                return { 
                    hasNewOutput: true, 
                    reason: `Claude finished processing with new content (${contentLengthDiff} new chars)`
                };
            } else {
                logger.info(`Agent ${agent.id} Same meaningful content - ignoring ⏺ symbol animation changes`);
                logger.debug(`Normalized lengths: current=${currentNormalized.length}, last=${lastSentNormalized.length}, diff=${contentLengthDiff}`);
            }
        } else if (isProcessing) {
            logger.info(`Agent ${agent.id} Claude still processing - 'esc to interrupt' present`);
        } else if (agent.outputBuffer.length <= 1000) {
            logger.info(`Agent ${agent.id} Buffer too small (${agent.outputBuffer.length} chars) - waiting for more`);
        }
        
        return { 
            hasNewOutput: false, 
            reason: isProcessing ? `Still processing` : `Waiting for more output` 
        };
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
            
            // TEMP: Skip AI filtering - just use simple detection
            logger.info(`TEMP: Skipping AI filter - sending based on simple detection`);
            
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
            if (agent.ptyProcess) {
                agent.ptyProcess.kill();
            }
            this.activeAgents.delete(agentId);
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
            if (agent.ptyProcess) {
                agent.ptyProcess.kill();
            }
            logger.info(`Killed agent ${agentId}`);
        }
        this.activeAgents.clear();
    }
}

module.exports = ClaudeCodeManager;