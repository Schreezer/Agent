const logger = require('./logger');

/**
 * Utility class for detecting Claude Code processing state and output changes
 */
class OutputDetector {
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
     * Detect if Claude Code has finished processing and has new output to send
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
}

module.exports = OutputDetector;