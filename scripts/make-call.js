#!/usr/bin/env node

/**
 * Voice call script for Claude Code using CallMeBot API
 * Usage: node scripts/make-call.js <message> [options]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Read chat context from parent directory (where Claude Code runs)
const contextFile = path.join(__dirname, '..', '..', '.claude-context.json');
const configFile = path.join(__dirname, '..', '.env');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(`📞 Claude Code Voice Call System

Usage: node scripts/make-call.js <message> [options]

Arguments:
  message          Text message to speak (max 256 characters)

Options:
  --lang=<code>    Voice language (default: en-US-Standard-A)
                   Examples: en-GB-Standard-B, en-AU-Standard-A, fr-FR-Standard-A
  --repeat=<num>   Number of times to repeat (default: 1)
  --mp3=<url>      Play MP3 file instead of text-to-speech

Examples:
  scripts/make-call "Task completed successfully"
  scripts/make-call "Urgent: Check the logs" --lang=en-GB-Standard-B --repeat=2
  scripts/make-call --mp3="https://example.com/alert.mp3"

Setup Required:
1. Set TELEGRAM_USERNAME in .env file (your Telegram @username)
2. Authorize CallMeBot: https://api2.callmebot.com/txt/login.php
   OR send /start to @CallMeBot_txtbot on Telegram

Note: This script can only be used from within Claude Code sessions.`);
    process.exit(0);
}

// Parse arguments
let message = '';
let lang = 'en-US-Standard-A';
let repeat = 1;
let mp3Url = null;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--lang=')) {
        lang = arg.split('=')[1];
    } else if (arg.startsWith('--repeat=')) {
        repeat = parseInt(arg.split('=')[1]) || 1;
    } else if (arg.startsWith('--mp3=')) {
        mp3Url = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
        message = arg;
    }
}

// Validate inputs
if (!mp3Url && !message) {
    console.error('❌ Error: Message is required unless using --mp3 option');
    process.exit(1);
}

if (message && message.length > 256) {
    console.error('❌ Error: Message too long (max 256 characters)');
    process.exit(1);
}

// Check if Claude Code session is active
if (!fs.existsSync(contextFile)) {
    console.error('❌ No active Claude Code session found. This script can only be used from within Claude Code.');
    process.exit(1);
}

// Get Telegram username from environment
let telegramUsername = process.env.TELEGRAM_USERNAME;

if (!telegramUsername) {
    console.error(`❌ TELEGRAM_USERNAME not configured.

Setup Steps:
1. Add to .env file: TELEGRAM_USERNAME=@yourusername
2. Authorize CallMeBot: https://api2.callmebot.com/txt/login.php
   OR send /start to @CallMeBot_txtbot on Telegram
3. Test: scripts/make-call "Test message"`);
    process.exit(1);
}

// Ensure username starts with @
if (!telegramUsername.startsWith('@')) {
    telegramUsername = '@' + telegramUsername;
}

async function makeCall() {
    try {
        // Build API URL
        const baseUrl = 'http://api.callmebot.com/start.php';
        const params = new URLSearchParams();
        params.append('user', telegramUsername);
        
        if (mp3Url) {
            params.append('file', mp3Url);
            console.log(`📞 Making call to ${telegramUsername} with MP3: ${mp3Url}`);
        } else {
            params.append('text', message);
            params.append('lang', lang);
            if (repeat > 1) {
                params.append('rpt', repeat.toString());
            }
            console.log(`📞 Making call to ${telegramUsername}: "${message}" (${lang}, ${repeat}x)`);
        }
        
        const callUrl = `${baseUrl}?${params.toString()}`;
        
        // Make the API call
        const response = await makeHttpRequest(callUrl);
        
        if (response.includes('success') || response.includes('OK') || response.trim() === '') {
            console.log('✅ Call initiated successfully!');
            if (mp3Url) {
                console.log(`🎵 Playing MP3: ${mp3Url}`);
            } else {
                console.log(`💬 Speaking: "${message}"`);
            }
        } else {
            console.log('⚠️  Call request sent, response:', response.trim() || 'No response');
        }
        
    } catch (error) {
        console.error('❌ Error making call:', error.message);
        
        if (error.message.includes('ENOTFOUND') || error.message.includes('timeout')) {
            console.error(`
Possible issues:
1. Internet connection problem
2. CallMeBot service unavailable
3. Username not authorized - visit: https://api2.callmebot.com/txt/login.php`);
        }
        
        process.exit(1);
    }
}

function makeHttpRequest(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        
        const request = client.get(url, (response) => {
            let data = '';
            
            response.on('data', (chunk) => {
                data += chunk;
            });
            
            response.on('end', () => {
                resolve(data);
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Make the call
makeCall();