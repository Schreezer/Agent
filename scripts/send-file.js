#!/usr/bin/env node

/**
 * File sending script for Claude Code
 * Usage: node scripts/send-file.js <file_path> [message]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

// Get bot token from environment
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN not found in environment variables');
    process.exit(1);
}

// Read chat context from parent directory (where Claude Code runs)
const contextFile = path.join(__dirname, '..', '..', '.claude-context.json');
let chatId;

try {
    if (!fs.existsSync(contextFile)) {
        console.error('❌ No active Claude Code session found. This script can only be used from within Claude Code.');
        process.exit(1);
    }
    
    const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    chatId = context.chatId;
    
    if (!chatId) {
        console.error('❌ No chat ID found in Claude Code context');
        process.exit(1);
    }
} catch (error) {
    console.error('❌ Error reading Claude Code context:', error.message);
    process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(`📤 Claude Code File Sender

Usage: node scripts/send-file.js <file_path> [message]

Examples:
  node scripts/send-file.js output.txt
  node scripts/send-file.js data.json "Here's the processed data"
  node scripts/send-file.js ./reports/analysis.pdf "Analysis complete!"

Note: This script can only be used from within an active Claude Code session.`);
    process.exit(0);
}

const filePath = args[0];
const message = args[1] || '';

// Resolve file path
const absolutePath = path.resolve(filePath);

// Check if file exists
if (!fs.existsSync(absolutePath)) {
    console.error(`❌ File not found: ${absolutePath}`);
    process.exit(1);
}

// Get file stats
const stats = fs.statSync(absolutePath);
if (!stats.isFile()) {
    console.error(`❌ Path is not a file: ${absolutePath}`);
    process.exit(1);
}

// Check file size (Telegram limit is 50MB)
const maxSize = 50 * 1024 * 1024; // 50MB
if (stats.size > maxSize) {
    console.error(`❌ File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (max 50MB)`);
    process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(botToken);

async function sendFile() {
    try {
        console.log(`📤 Sending file: ${path.basename(absolutePath)} (${(stats.size / 1024).toFixed(1)}KB)`);
        
        const options = {};
        if (message) {
            options.caption = message;
        }
        
        await bot.sendDocument(chatId, absolutePath, options);
        
        console.log('✅ File sent successfully!');
        
    } catch (error) {
        console.error('❌ Error sending file:', error.message);
        process.exit(1);
    }
}

// Send the file
sendFile();