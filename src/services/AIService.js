const OpenAI = require('openai');
const logger = require('../utils/logger');

/**
 * AI service for OpenRouter interactions and decision making
 */
class AIService {
    constructor(config) {
        this.config = config;
        this.openai = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: config.openRouterApiKey,
            defaultHeaders: {
                'HTTP-Referer': config.siteUrl || 'https://github.com/telegram-claude-bot',
                'X-Title': config.siteName || 'Telegram Claude Bot',
            },
        });
        
        this.questionDetectorPrompt = `Analyze this AI assistant output and determine if it's asking for user input.

Respond with ONLY \"YES\" or \"NO\".

YES if:
- The assistant is asking a question that needs an answer
- The assistant is requesting clarification or more information  
- The assistant is presenting options for the user to choose from
- The assistant is asking for confirmation before proceeding
- The assistant needs user input to continue the task

NO if:
- The assistant is providing information or status updates
- The assistant has completed the task
- The assistant is explaining what it's doing
- The assistant is thinking out loud but not asking for input

Output to analyze:`;
    }
    
    /**
     * Process a task with OpenRouter
     */
    async processTask(userInput, session) {
        try {
            const messages = [...session.messages];
            
            if (messages.length === 0) {
                messages.push({
                    role: 'system',
                    content: `You are an AI assistant with extensive capabilities for helping with various tasks.

IMPORTANT INTERACTION RULES:
1. When you need user input, ask clear, specific questions
2. Present options in a numbered format when applicable  
3. Wait for user responses before proceeding
4. Never make assumptions - always ask when uncertain
5. Use markdown formatting for clarity

TECHNICAL RULES:
- Never run blocking commands (npm start, tail -f, etc.)
- Use bounded alternatives (pm2 start, tail -n 100, etc.)
- Execute tasks step by step
- Provide clear status updates

CLAUDE CODE CAPABILITIES:
Claude Code is a powerful CLI tool that can handle almost ANY task including:

FILE OPERATIONS:
- Read, write, edit, create, delete files and directories
- Search through codebases and file contents
- Navigate and understand project structures
- Handle any file format (code, configs, docs, data files)

CODING & DEVELOPMENT:
- Write, debug, and refactor code in any language
- Run tests, fix test failures, and write new tests
- Set up development environments and dependencies
- Review code and suggest improvements
- Handle git operations (commits, branches, merges)

SYSTEM OPERATIONS:
- Execute shell commands and scripts
- Install packages and manage dependencies
- Start/stop services and processes
- Monitor logs and system status
- Configure environments and settings

WEB & API CAPABILITIES:
- Make HTTP requests to APIs
- Parse and process web data
- Interact with web services and databases
- Handle authentication and API keys
- Fetch data from URLs and web services

DATA PROCESSING:
- Parse, transform, and analyze data files
- Work with databases (SQL, NoSQL)
- Process CSV, JSON, XML, and other formats
- Generate reports and visualizations

AUTOMATION:
- Create scripts and automation workflows
- Set up CI/CD pipelines
- Configure deployments and infrastructure
- Handle complex multi-step processes

AGENT DELEGATION RULES:
⚠️ CRITICAL: Use Claude Code for ALMOST EVERYTHING except extremely trivial questions!

IMPORTANT: When you suggest Claude Code, it will be executed AUTOMATICALLY without asking the user for permission. The user wants this to be seamless.

ALWAYS delegate to Claude Code for:
- ANY data fetching (time, weather, news, prices, etc.)
- File operations (read, write, search, edit)
- Code tasks (debugging, writing, testing, analyzing)
- System operations (commands, installations, configurations)
- Web requests and API calls
- Data processing and analysis
- Research and information gathering
- Automation and scripting
- Mathematical calculations requiring precision
- Any task requiring real-time information
- Complex reasoning that benefits from tools

ONLY handle directly (without Claude Code):
- Basic conversational greetings ("hello", "how are you")
- Simple explanations of concepts you already know
- Trivial definitions that don't require lookup

WHEN IN DOUBT: Always suggest Claude Code! It has access to:
- Real-time web data
- File system
- System commands
- APIs and databases
- Mathematical tools
- And much more!

NOTE: User requests will be passed directly to Claude Code exactly as the user wrote them, maintaining their original intent and style.

When asking questions, format them clearly and end with a question mark.`
                });
            }
            
            messages.push({
                role: 'user',
                content: userInput
            });
            
            const response = await this.openai.chat.completions.create({
                model: this.config.mainModel,
                messages: messages,
                max_tokens: 4000,
                temperature: 0.2
            });
            
            const aiResponse = response.choices[0].message.content;
            
            // Update session
            session.messages = messages;
            session.messages.push({
                role: 'assistant',
                content: aiResponse
            });
            session.interactions++;
            
            return aiResponse;
            
        } catch (error) {
            logger.error('OpenRouter API error:', error);
            throw new Error('Failed to process task with OpenRouter');
        }
    }
    
    /**
     * Detect if response contains a question
     */
    async detectQuestion(text, session) {
        try {
            session.detectionChecks++;
            
            const response = await this.openai.chat.completions.create({
                model: this.config.detectionModel,
                messages: [{
                    role: 'user',
                    content: this.questionDetectorPrompt + '\\n\\n' + text
                }],
                max_tokens: 10,
                temperature: 0
            });
            
            const decision = response.choices[0].message.content.trim().toUpperCase();
            
            logger.debug('Question detection', {
                model: this.config.detectionModel,
                decision,
                textLength: text.length
            });
            
            return decision === 'YES';
            
        } catch (error) {
            logger.error('Question detection error:', error);
            // Fallback to pattern matching
            return this.detectQuestionFallback(text);
        }
    }
    
    /**
     * Detect if response indicates task completion
     */
    async detectCompletion(text) {
        try {
            const prompt = `Is this AI output indicating task completion? Answer only YES or NO.

YES if: task complete, finished, done, successful
NO if: task ongoing, needs more steps, partial progress

Output:`;
            
            const response = await this.openai.chat.completions.create({
                model: this.config.detectionModel,
                messages: [{
                    role: 'user',
                    content: prompt + '\\n\\n' + text
                }],
                max_tokens: 10,
                temperature: 0
            });
            
            return response.choices[0].message.content.trim().toUpperCase() === 'YES';
            
        } catch (error) {
            logger.error('Completion detection error:', error);
            return false;
        }
    }
    
    /**
     * Detect if response suggests using Claude Code (VERY AGGRESSIVE)
     */
    detectClaudeCodeSuggestion(text) {
        // First check for explicit Claude Code mentions
        if (/claude code|using claude code|delegate.*claude/i.test(text)) {
            return true;
        }
        
        // Exclude only basic greetings and trivial responses
        const trivialPatterns = [
            /^(hi|hello|hey|good morning|good afternoon|good evening)[\s\W]*$/i,
            /^(how are you|what's up|nice to meet you)[\s\W]*$/i,
            /^(thank you|thanks|you're welcome|no problem)[\s\W]*$/i,
            /^(yes|no|ok|okay|sure)[\s\W]*$/i
        ];
        
        // If it's trivial, don't suggest Claude Code
        if (trivialPatterns.some(pattern => pattern.test(text.trim()))) {
            return false;
        }
        
        // For everything else, aggressively suggest Claude Code
        const actionPatterns = [
            // Data and information requests
            /time|date|weather|temperature|news|price|stock|rate|exchange/i,
            /current|latest|recent|today|now|update/i,
            /find|search|look.*up|get.*information|tell.*me.*about/i,
            /what.*is|what.*are|how.*much|how.*many|where.*is/i,
            
            // File and system operations
            /file|folder|directory|path|document|text|code|script/i,
            /read|write|edit|create|delete|save|open|close/i,
            /install|setup|configure|run|execute|command|terminal/i,
            
            // Development and technical tasks
            /bug|error|debug|test|build|deploy|git|repository/i,
            /function|method|class|variable|database|api|server/i,
            /analyze|process|calculate|compute|generate|convert/i,
            
            // Research and web tasks
            /research|investigate|compare|review|summarize/i,
            /website|url|download|upload|request|response/i,
            
            // Problem-solving words
            /help.*with|can.*you|would.*you|please|need.*to/i,
            /solve|fix|resolve|complete|finish|make|build/i
        ];
        
        // If any action pattern matches, suggest Claude Code
        return actionPatterns.some(pattern => pattern.test(text));
    }
    
    /**
     * Determine if Claude question should be forwarded to user
     */
    async shouldForwardToUser(question, session) {
        const prompt = `Analyze this question from Claude Code and determine if it requires user input.

Question: "${question}"

Task context: "${session.task}"

Return "FORWARD" if:
- The question is about user preferences or requirements
- It asks for specific business logic decisions
- It needs clarification about the intended functionality
- It asks for credentials or sensitive information
- It's asking for custom/personal data that only the user knows
- It's about subjective choices that affect the final outcome

Return "HANDLE" if:
- It's a technical question you can answer
- It's asking for confirmation on obvious technical choices
- It's a simple yes/no about proceeding with a standard approach
- Permission/security prompts (auto-accept to proceed)
- Configuration choices with sensible defaults
- Standard setup or installation choices
- Error recovery options (choose to continue)

ALWAYS HANDLE: Permission prompts, continue/proceed confirmations, standard config choices

Respond with only "FORWARD" or "HANDLE".`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.detectionModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 10,
                temperature: 0
            });
            
            const decision = response.choices[0].message.content.trim().toUpperCase();
            return decision === 'FORWARD';
            
        } catch (error) {
            logger.error('Decision error:', error);
            // Default to forwarding to user for safety
            return true;
        }
    }
    
    /**
     * Generate response for Claude Code agent
     */
    async generateResponseForClaude(question, session) {
        const prompt = `You are helping a Claude Code agent complete a task. The agent has asked a question that can be answered without user input.

Original task: "${session.task}"
Agent's question: "${question}"

Provide a helpful, concise response that allows the agent to continue with the task. Be decisive and specific.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.mainModel,
                messages: [
                    { role: 'system', content: 'You are a helpful technical assistant providing guidance to another AI agent.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.3
            });
            
            return response.choices[0].message.content;
            
        } catch (error) {
            logger.error('Failed to generate response for Claude:', error);
            return 'Proceed with the standard approach.';
        }
    }
    
    /**
     * Fallback question detection using patterns
     * @private
     */
    detectQuestionFallback(text) {
        return text.includes('?') ||
               /please (provide|specify|tell|confirm)/i.test(text) ||
               /what|which|when|where|who|why|how|should/i.test(text);
    }
    
    /**
     * Determine if Claude Code needs intervention based on output
     */
    async detectClaudeInterventionNeeded(output) {
        const prompt = `Analyze this Claude Code terminal output and determine if it needs user intervention.

Output: "${output}"

Return "YES" if:
- Waiting for user input (press enter, y/n, choice, etc.)
- Asking for confirmation or decision
- Showing interactive prompts
- Needs ESC key press or other input

Return "NO" if:
- Still processing normally
- Showing progress or output
- Completed successfully

Respond with only "YES" or "NO".`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.detectionModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 10,
                temperature: 0
            });
            
            const decision = response.choices[0].message.content.trim().toUpperCase();
            return decision === 'YES';
            
        } catch (error) {
            logger.error('Intervention detection error:', error);
            return false;
        }
    }
    
    /**
     * Generate appropriate intervention command for Claude Code
     */
    async generateInterventionCommand(output, task) {
        const prompt = `Claude Code is showing this output and needs intervention. Analyze what's needed and provide the appropriate response.

Output: "${output}"
Original task: "${task}"

AUTO-HANDLE THESE PROMPTS:
1. Permission/Security prompts - Always accept to proceed with task
2. Continue/Proceed prompts - Always continue unless task is complete
3. Yes/No confirmations for standard operations - Choose based on task intent
4. Common configuration choices - Pick sensible defaults

INTERVENTION TYPES:
1. ENTER - Continue/confirm (press Enter key)
2. ESCAPE - Exit current operation (press Escape key)  
3. EXIT - Close Claude completely (send \\exit command)
4. Text input - Type specific text (e.g., file names, paths, options)
5. Multiple choice - Select from options (e.g., "1", "2", "y", "n", "yes", "no")
6. Configuration - Enter settings or parameters

SPECIFIC EXAMPLES:
- Permission warnings (like Claude Code bypass mode) → "2" (Yes, I accept)
- "Continue? [y/n]" → "y" 
- "Select option (1-3):" → choose based on task context
- "Enter file name:" → provide appropriate filename for task
- "Press Enter to continue" → "ENTER"
- Setup/config prompts → choose defaults that enable task completion
- Error recovery prompts → choose option that continues the task

CRITICAL: Always choose the option that allows the task to proceed successfully. Don't ask user unless absolutely necessary for task-specific decisions.

Analyze the output and respond with ONLY:
- "ENTER" for pressing Enter key
- "ESCAPE" for pressing Escape key  
- "EXIT" for closing Claude
- The exact text/choice to type (no quotes, just the raw text)

Be decisive and always choose to proceed with the task.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.mainModel,
                messages: [
                    { role: 'system', content: 'You are an expert at controlling interactive terminal sessions. Analyze prompts and provide precise responses.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 100,
                temperature: 0.1
            });
            
            return response.choices[0].message.content.trim();
            
        } catch (error) {
            logger.error('Failed to generate intervention command:', error);
            return 'ENTER';
        }
    }
    
    /**
     * Craft an optimized prompt for Claude Code based on user request
     */
    async craftClaudePrompt(userTask) {
        const prompt = `Convert this user request into simple, natural language for Claude Code CLI.

User request: "${userTask}"

Convert to simple, conversational language that Claude Code can understand easily. Keep it natural and direct, as if talking to a helpful assistant.

Guidelines:
1. Use simple, everyday language
2. Be conversational and direct
3. Don't over-explain or add technical jargon
4. Keep the core intent clear
5. Make it sound like a natural request

Examples:
User: "check btc price" → "What's the current Bitcoin price?"
User: "get weather data for NYC" → "What's the weather like in New York City?"
User: "analyze this log file" → "Can you look at this log file and tell me what's happening?"
User: "deploy to production" → "Please deploy this to production"

Convert this request to simple language:`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.mainModel,
                messages: [
                    { role: 'system', content: 'Convert user requests to simple, natural language for Claude Code. Be conversational and direct. Always respond with the converted text.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 100,
                temperature: 0.1
            });
            
            const optimizedPrompt = response.choices[0].message.content.trim();
            logger.info(`Optimized prompt: "${optimizedPrompt}"`);
            
            // Fallback if prompt is empty
            if (!optimizedPrompt || optimizedPrompt.length < 5) {
                logger.warn('Optimized prompt was empty or too short, using original task');
                return userTask;
            }
            
            return optimizedPrompt;
            
        } catch (error) {
            logger.error('Failed to craft Claude prompt:', error);
            return userTask; // Fallback to original task
        }
    }
    
    /**
     * Process and summarize Claude Code output for user
     */
    async processClaudeOutput(fullOutput, originalTask) {
        const prompt = `Process this Claude Code output and provide a clean summary for the user.

Original task: "${originalTask}"
Claude Code output: "${fullOutput}"

Provide a concise, user-friendly summary that:
- Shows the key results/findings
- Explains what was accomplished
- Highlights any important information
- Removes technical noise and verbose logs

Keep it under 200 words and focus on what the user actually needs to know.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.mainModel,
                messages: [
                    { role: 'system', content: 'You are summarizing Claude Code output for end users. Be clear and concise.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 300,
                temperature: 0.3
            });
            
            return response.choices[0].message.content;
            
        } catch (error) {
            logger.error('Failed to process Claude output:', error);
            return fullOutput; // Fallback to raw output
        }
    }
    
    /**
     * Convert user response into terminal command for Claude Code
     */
    async processUserResponseToTerminalCommand(userResponse, claudeQuestion, originalTask) {
        const prompt = `A user has responded to a Claude Code question. Convert their response into the appropriate terminal command.

Claude Code Question: "${claudeQuestion}"
User Response: "${userResponse}"
Original Task: "${originalTask}"

CONVERSION RULES:
1. If user says yes/accept/proceed/continue → "2" or "y" or "ENTER" (depending on the prompt format)
2. If user says no/deny/exit/stop → "1" or "n" or "ESCAPE"
3. If user provides specific text/numbers → use their exact input
4. If user gives general instruction → interpret based on Claude's question format

EXAMPLES:
- Claude asks "1. No, exit  2. Yes, I accept" + User says "yes" → "2"
- Claude asks "Continue? [y/n]" + User says "yes" → "y"
- Claude asks "Enter filename:" + User says "data.txt" → "data.txt"
- Claude asks "Select option (1-3):" + User says "first one" → "1"
- Claude asks "Press Enter to continue" + User says "ok" → "ENTER"

CRITICAL: Analyze the Claude question format and map the user's intent to the exact command needed.

Respond with ONLY:
- "ENTER" for pressing Enter key
- "ESCAPE" for pressing Escape key
- "EXIT" for closing Claude
- The exact text/number to type (no quotes)

Be precise and match the expected format from Claude's question.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.mainModel,
                messages: [
                    { role: 'system', content: 'You are converting user responses into precise terminal commands. Be exact and match the expected format.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 50,
                temperature: 0.1
            });
            
            const command = response.choices[0].message.content.trim();
            logger.info(`Converted user response "${userResponse}" to terminal command "${command}"`);
            return command;
            
        } catch (error) {
            logger.error('Failed to process user response:', error);
            return userResponse; // Fallback to raw user input
        }
    }
    
    /**
     * Decide whether Claude Code output should be sent to user
     * Only sends when task is complete OR user input is required
     */
    async shouldSendClaudeOutput(outputLines, conversationHistory = []) {
        // Build conversation context (limit to last 10 exchanges to avoid token limits)
        let conversationContext = 'Conversation History:\n';
        const recentHistory = conversationHistory.slice(-10);
        recentHistory.forEach((msg, index) => {
            const type = msg.type === 'user' ? 'USER' : 'CLAUDE (sent to user)';
            // Truncate long messages
            const content = msg.content.length > 200 
                ? msg.content.substring(0, 197) + '...' 
                : msg.content;
            conversationContext += `${index + 1}. [${type}]: ${content}\n`;
        });
        
        const prompt = `Analyze these last lines from Claude Code and decide if they should be sent to the user.

${conversationContext}

Current Claude Code Output (last 10 lines - NOT YET SENT):
"${outputLines}"

IMPORTANT: Check if this output has ALREADY been sent to the user by comparing with the conversation history above.

ONLY respond "YES" if:
- This is NEW output that hasn't been sent before
- Task appears complete with final results/answer to user's question
- User input is clearly needed (questions, prompts, choices)
- Important error message requiring user attention
- Meaningful NEW results or data relevant to the user's current request
- Direct answer to what the user most recently asked for

RESPOND "NO" if:
- This output was already sent (appears in conversation history)
- Still processing or working on the task
- Progress indicators or status updates
- Partial intermediate output unrelated to final answer
- System messages or noise
- Loading or initialization messages
- Output that doesn't relate to the user's most recent request

Based on the conversation flow, decide if this NEW output should be sent now.

Respond with ONLY "YES" or "NO" - do NOT modify or explain the output.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.config.detectionModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 5,
                temperature: 0
            });
            
            const decision = response.choices[0].message.content.trim().toUpperCase();
            logger.info(`Output send decision: ${decision} | History items: ${conversationHistory.length} | Output preview: ${outputLines.substring(0, 100)}...`);
            return decision === 'YES';
            
        } catch (error) {
            logger.error('Output decision error:', error);
            logger.error('Error details:', error.message);
            // More permissive fallback for debugging
            logger.info('Fallback: sending output due to AI error');
            return true;
        }
    }
}

module.exports = AIService;