# Deployment Guide

## Quick Start

1. **Install Dependencies**:
   ```bash
   cd openrouter-claude-bot
   npm install
   ```

2. **Install Claude Code CLI**:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

3. **Setup Environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials:
   # - TELEGRAM_BOT_TOKEN
   # - OPENROUTER_API_KEY
   # - TELEGRAM_AUTHORIZED_CHATS (optional)
   ```

4. **Run the Bot**:
   ```bash
   npm start
   ```

## Environment Variables

### Required
- `TELEGRAM_BOT_TOKEN`: Get from @BotFather on Telegram
- `OPENROUTER_API_KEY`: Get from OpenRouter.ai

### Optional
- `TELEGRAM_AUTHORIZED_CHATS`: Comma-separated chat IDs for access control
- `MAIN_MODEL`: OpenRouter model (default: anthropic/claude-3-sonnet)
- `DETECTION_MODEL`: Model for question detection (default: google/gemini-2.5-flash-preview-05-20)

## First Time Setup

1. Start the bot and send any message
2. On first Claude Code usage, you'll get an authentication URL
3. Complete authentication in browser
4. Send the auth code back to the bot
5. Claude Code is now ready!

## Features

- **Dual AI System**: OpenRouter analysis + Claude Code execution
- **Smart Routing**: AI decides when to use Claude Code
- **Session Management**: Handle multiple concurrent tasks
- **Question Intelligence**: Auto-forward complex questions to user

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Telegram      │◄──►│  OpenRouter      │◄──►│   Claude Code   │
│   User          │    │  Bot             │    │   CLI           │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │  Session &       │
                       │  State Mgmt      │
                       └──────────────────┘
```

## Troubleshooting

### Bot not responding
- Check TELEGRAM_BOT_TOKEN
- Verify authorized chat IDs
- Check logs/openrouter-claude-bot.log

### Claude Code authentication issues
- Delete ~/.claude-code-auth.json
- Restart bot for fresh auth flow

### OpenRouter API errors
- Verify OPENROUTER_API_KEY
- Check API credits/limits
- Try different model

## Production Deployment

### Using PM2
```bash
npm install -g pm2
pm2 start index.js --name "openrouter-claude-bot"
pm2 save
pm2 startup
```

### Using Docker
```bash
# Build image
docker build -t openrouter-claude-bot .

# Run container
docker run -d --name bot \
  --env-file .env \
  -v $(pwd)/logs:/app/logs \
  openrouter-claude-bot
```

### Environment Security
- Use secrets management for production
- Rotate API keys regularly
- Monitor usage and costs
- Set up log rotation

## Monitoring

Check logs:
```bash
tail -f logs/openrouter-claude-bot.log
```

Check PM2 status:
```bash
pm2 status
pm2 logs openrouter-claude-bot
```

## Updates

To update the bot:
```bash
git pull
npm install
pm2 restart openrouter-claude-bot
```