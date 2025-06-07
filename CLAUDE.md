# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Telegram bot that provides direct access to Claude Code capabilities through chat interface. The bot uses PTY (pseudo-terminal) sessions to provide full interactive Claude Code functionality while handling the complexities of mobile chat UX.

## Key Development Commands

```bash
npm start          # Start bot in production mode
npm run dev        # Development mode with auto-restart (nodemon)
npm install        # Install dependencies
pm2 logs <process> --no-stream  # Check PM2 logs (IMPORTANT: always use --no-stream to avoid hanging)
```

## Architecture Overview

### Core Flow
```
Telegram User → MessageHandler → ClaudeCodeManager (PTY) → Claude CLI
                                        ↓
User ← OutputCleanerService ← SessionManager ← Claude Output
```

### Key Components

**OpenRouterClaudeBot.js** - Main orchestrator that initializes all managers and handlers
**MessageHandler.js** - Routes Telegram messages directly to Claude Code (bypasses OpenRouter)
**ClaudeCodeManager.js** - Orchestrates Claude CLI interactions using modular utility components
**SessionManager.js** - Enforces single session per chat, tracks conversation history, manages file uploads
**OutputCleanerService.js** - Uses LLM to intelligently filter and format Claude Code output for mobile chat

### Utility Components (Refactored Architecture)

**ClaudeAuthenticator** - Handles Claude Code CLI authentication and auth data management
**PTYSessionHandler** - Manages PTY process creation, lifecycle, and communication
**OutputDetector** - Detects Claude Code processing state and output completion patterns

## Session Management

- **Context Preservation** - Sessions persist even when Claude Code exits, maintaining conversation history
- **Automatic Restart** - Completed sessions automatically restart when user sends new messages
- **One session per chat** - New Claude sessions automatically terminate existing ones (configurable)
- **PTY-based** - Full terminal emulation supporting Claude Code's interactive features
- **File integration** - Uploaded files are saved to `./telegram-uploads/chat_<id>/` and made available to Claude

## Environment Configuration

Required:
- `TELEGRAM_BOT_TOKEN` - From @BotFather
- `OPENROUTER_API_KEY` - For output cleaning (optional but recommended)

Optional:
- `TELEGRAM_AUTHORIZED_CHATS` - Comma-separated chat IDs for access control
- `CLAUDE_INIT_TIMEOUT` - Claude initialization timeout (default: 30s)

## Output Processing Pipeline

The bot uses sophisticated output filtering:
1. **Buffer Management** - Collects Claude output in chunks
2. **Smart Detection** - Identifies when Claude is waiting vs. still processing
3. **LLM Cleaning** - Filters noise, combines related outputs, formats for mobile
4. **Telegram Delivery** - Handles message chunking and formatting

## Deployment Notes

### Prerequisites
- Claude Code CLI must be installed globally: `npm install -g @anthropic-ai/claude-code`
- Claude Code must be authenticated (bot handles auth flow via Telegram)
- Node.js 14+ required

### PM2 Management
When checking logs, ALWAYS use `--no-stream` flag:
```bash
pm2 logs openrouter-claude-bot --no-stream --lines 20
```

Without `--no-stream`, the command will hang indefinitely.

### File Structure
- `/src/handlers/` - Message and callback processing
- `/src/managers/` - Session and Claude Code management  
- `/src/services/` - Output cleaning and utility services
- `/src/utils/` - Modular utility classes (ClaudeAuthenticator, PTYSessionHandler, OutputDetector)
- `/telegram-uploads/` - User uploaded files (auto-created per chat)
- `/logs/` - Application logs (auto-created)

## User Commands

- `/new` - Start fresh conversation (clears session and history)
- `/status` - Bot and session status
- `/files` - List uploaded files
- `/delete <filename>` - Delete specific file
- `/cleanup` - Delete all files with confirmation
- `/restart` - Restart Claude Code agent
- `/interrupt` - Send ESC key to interrupt processing
- `/cancel` - Cancel active sessions

## Technical Implementation Details

### PTY Integration
Uses `node-pty` for full terminal emulation, supporting:
- Interactive prompts and questions
- ANSI codes and escape sequences
- Terminal control characters
- Real-time output streaming

### Error Handling
- Graceful shutdown with cleanup of all Claude processes
- Automatic session recovery with context preservation
- Comprehensive error logging with Winston
- Modular error handling in separate utility components

### Performance
- Intelligent output buffering to reduce API calls
- Debounced output checking using ⏺ symbol detection
- Message chunking for long outputs
- Conversation history tracking for context-aware cleaning
- Modular architecture reduces main manager complexity from 945 to ~350 lines

### Recent Architectural Improvements (v2.0)

**Context Preservation Fix:**
- Fixed logic mismatch between SessionManager and ClaudeCodeManager
- Sessions now persist when Claude Code exits, maintaining conversation history
- Automatic session restart with preserved context when user sends new messages

**Modular Refactoring:**
- Extracted ClaudeAuthenticator (authentication logic)
- Extracted PTYSessionHandler (PTY process management)  
- Extracted OutputDetector (processing state detection)
- Main ClaudeCodeManager now orchestrates utility components
- Improved maintainability and testability

**Termination Pattern Analysis:**
- Identified and documented all automatic termination triggers
- No time-based session limits (sessions run indefinitely)
- No token/usage auto-termination
- Context preserved even on Claude Code natural exits