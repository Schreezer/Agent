# OpenRouter + Claude Code Telegram Bot

An intelligent Telegram bot that combines OpenRouter's AI capabilities with Claude Code CLI for advanced task execution and code management.

## Features

- **Dual AI System**: OpenRouter for analysis and Claude Code for direct execution
- **Intelligent Task Routing**: Automatically determines when to use Claude Code
- **Authentication Flow**: Seamless Claude Code setup and authentication
- **Session Management**: Handles multiple concurrent sessions
- **Smart Question Routing**: AI decides whether to forward questions to user or handle internally
- **Modular Architecture**: Clean, maintainable codebase following best practices

## Architecture

```
openrouter-claude-bot/
├── src/
│   ├── managers/
│   │   ├── ClaudeCodeManager.js    # Claude CLI integration
│   │   └── SessionManager.js       # Session state management
│   ├── handlers/
│   │   ├── MessageHandler.js       # Telegram message processing
│   │   └── CallbackHandler.js      # Inline keyboard handling
│   ├── services/
│   │   └── AIService.js           # OpenRouter AI interactions
│   ├── utils/
│   │   └── logger.js              # Winston logging setup
│   └── OpenRouterClaudeBot.js     # Main bot orchestrator
├── config/
│   └── config.js                  # Configuration management
├── index.js                       # Entry point
└── package.json
```

## Installation

1. **Clone and Setup**:
   ```bash
   cd openrouter-claude-bot
   npm install
   ```

2. **Install Claude Code CLI**:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

3. **Environment Configuration**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Create Logs Directory**:
   ```bash
   mkdir logs
   ```

## Configuration

### Required Environment Variables

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `OPENROUTER_API_KEY`: Your OpenRouter API key

### Optional Environment Variables

- `TELEGRAM_AUTHORIZED_CHATS`: Comma-separated chat IDs (leave empty for public access)
- `MAIN_MODEL`: OpenRouter model for main tasks (default: anthropic/claude-3-sonnet)
- `DETECTION_MODEL`: Model for question detection (default: google/gemini-2.5-flash-preview-05-20)

## Usage

1. **Start the Bot**:
   ```bash
   npm start
   ```

2. **Development Mode**:
   ```bash
   npm run dev
   ```

3. **Telegram Commands**:
   - `/start` - Welcome message and help
   - `/claude <task>` - Direct Claude Code execution
   - `/status` - Bot and session status
   - `/cancel` - Cancel active tasks

## How It Works

1. **User sends task** → OpenRouter analyzes the request
2. **If coding task detected** → Suggests Claude Code delegation
3. **On first Claude use** → Authentication flow initiated
4. **Claude Code executes** → Questions routed intelligently
5. **Results delivered** → Back to user via Telegram

## Key Classes

### ClaudeCodeManager
- Manages Claude CLI processes
- Handles authentication flow
- Processes agent output and questions

### SessionManager
- Tracks OpenRouter and Claude sessions
- Manages session state and lifecycle
- Provides session statistics

### AIService
- OpenRouter API interactions
- Question and completion detection
- Decision making for question routing

### MessageHandler
- Processes all Telegram messages
- Handles commands and user responses
- Manages task execution flow

## Logging

Logs are written to both console and file (`logs/openrouter-claude-bot.log`). Log level can be configured via `LOG_LEVEL` environment variable.

## Error Handling

- Graceful shutdown on SIGINT/SIGTERM
- Automatic cleanup of Claude processes
- Comprehensive error logging
- User-friendly error messages

## Security

- Optional chat authorization
- Environment variable validation
- Secure credential handling
- Process sandboxing for Claude Code

## Contributing

1. Follow the existing modular architecture
2. Add proper error handling and logging
3. Update documentation for new features
4. Test with various Telegram scenarios

## License

MIT License - see LICENSE file for details.