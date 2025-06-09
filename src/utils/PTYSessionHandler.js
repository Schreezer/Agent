const pty = require('node-pty');
const path = require('path');
const logger = require('./logger');

/**
 * Utility class for managing PTY sessions with Claude Code CLI
 */
class PTYSessionHandler {
    constructor(outputDetector) {
        this.outputDetector = outputDetector;
    }

    /**
     * Create interactive Claude Code session using PTY
     */
    async createSession(agent, task, eventEmitter) {
        try {
            const args = ['--dangerously-skip-permissions'];
            
            logger.info(`Starting PTY session: claude ${args.join(' ')}`);
            
            // Create pseudo-terminal
            try {
                agent.ptyProcess = pty.spawn('claude', args, {
                    name: 'xterm-color',
                    cols: 120,
                    rows: 30,
                    cwd: path.join(process.cwd(), '..'), // Boot in parent directory
                    env: { ...process.env }
                });
            } catch (error) {
                logger.error(`Failed to spawn PTY for agent ${agent.id}:`, error);
                eventEmitter.emit('agent-error', { taskId: agent.id, error });
                return;
            }
        
            logger.info(`PTY session created for agent ${agent.id}, PID: ${agent.ptyProcess.pid}`);
            agent.status = 'active';
            
            // Handle output with intelligent filtering
            agent.ptyProcess.onData((data) => {
                this.handleOutput(agent, data, eventEmitter);
            });
            
            // Handle exit
            agent.ptyProcess.onExit(({ exitCode, signal }) => {
                this.handleExit(agent, exitCode, signal, eventEmitter);
            });
            
            // Wait for Claude to initialize, then send task
            setTimeout(() => {
                this.sendInitialTask(agent, task);
            }, 3000); // Give Claude time to show welcome screen
            
        } catch (error) {
            logger.error(`Error in createSession for agent ${agent.id}:`, error);
            eventEmitter.emit('agent-error', { taskId: agent.id, error });
        }
    }

    /**
     * Handle PTY output data
     */
    handleOutput(agent, data, eventEmitter) {
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
            
            // Emit output check event
            eventEmitter.emit('schedule-output-check', agent);
            
        } catch (error) {
            logger.error(`Error processing PTY output for agent ${agent.id}:`, error);
        }
    }

    /**
     * Handle PTY process exit
     */
    handleExit(agent, exitCode, signal, eventEmitter) {
        try {
            logger.info(`PTY session for agent ${agent.id} exited with code: ${exitCode}, signal: ${signal}`);
            
            if (agent.monitorInterval) {
                clearInterval(agent.monitorInterval);
            }
            
            if (agent.outputCheckTimer) {
                clearInterval(agent.outputCheckTimer);
                agent.outputCheckTimer = null;
            }
            
            // Mark agent as completed but keep it for context preservation
            agent.ptyProcess = null;
            agent.status = 'completed';
            agent.exitCode = exitCode;
            agent.exitSignal = signal;
            agent.completedAt = Date.now();
            
            // Emit final output check and completion event
            eventEmitter.emit('check-and-send-output', agent, true);
            eventEmitter.emit('agent-complete', { 
                taskId: agent.id, 
                code: exitCode, 
                fullOutput: agent.fullOutput 
            });
        } catch (error) {
            logger.error(`Error handling PTY exit for agent ${agent.id}:`, error);
        }
    }

    /**
     * Send initial task to Claude Code
     */
    sendInitialTask(agent, task) {
        try {
            if (agent.ptyProcess && agent.status === 'active') {
                logger.info(`Sending task to Claude agent ${agent.id}: "${task}"`);
                // Send the task text first
                agent.ptyProcess.write(task);
                // Then send Enter key press (not as text)
                setTimeout(() => {
                    agent.ptyProcess.write('\r');
                    logger.info(`Sent Enter key to execute task for agent ${agent.id}`);
                }, 100);
            } else {
                logger.error(`PTY process for agent ${agent.id} died before sending task`);
            }
        } catch (error) {
            logger.error(`Error sending task to Claude agent ${agent.id}:`, error);
        }
    }

    /**
     * Send command to PTY session
     */
    sendCommand(agent, command) {
        if (!agent.ptyProcess || agent.status !== 'active') {
            throw new Error('PTY session inactive');
        }

        switch (command.toUpperCase()) {
            case 'ESCAPE':
                agent.ptyProcess.write('\x1b'); // ESC key
                logger.info(`Sent ESC key to agent ${agent.id}`);
                break;
            case 'ENTER':
                agent.ptyProcess.write('\r'); // Enter key (just \r)
                logger.info(`Sent ENTER key to agent ${agent.id}`);
                break;
            case 'EXIT':
                agent.ptyProcess.write('\\exit\r\n'); // Exit command
                logger.info(`Sent EXIT command to agent ${agent.id}`);
                break;
            case 'UP':
                agent.ptyProcess.write('\x1b[A'); // Up arrow
                logger.info(`Sent UP arrow to agent ${agent.id}`);
                break;
            case 'DOWN':
                agent.ptyProcess.write('\x1b[B'); // Down arrow
                logger.info(`Sent DOWN arrow to agent ${agent.id}`);
                break;
            case 'LEFT':
                agent.ptyProcess.write('\x1b[D'); // Left arrow
                logger.info(`Sent LEFT arrow to agent ${agent.id}`);
                break;
            case 'RIGHT':
                agent.ptyProcess.write('\x1b[C'); // Right arrow
                logger.info(`Sent RIGHT arrow to agent ${agent.id}`);
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
                    logger.info(`Sent follow-up text and Enter to agent ${agent.id}: "${command}"`);
                }, 100);
        }
    }

    /**
     * Kill PTY process
     */
    killProcess(agent) {
        if (agent.ptyProcess) {
            agent.ptyProcess.kill();
            agent.ptyProcess = null;
            agent.status = 'terminated';
        }
    }
}

module.exports = PTYSessionHandler;