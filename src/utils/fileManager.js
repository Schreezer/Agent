const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * Manages file uploads and storage for the bot
 */
class FileManager {
    constructor() {
        this.uploadsDir = path.join(process.cwd(), 'telegram-uploads');
        this.ensureUploadsDirectory();
    }
    
    /**
     * Ensure uploads directory exists
     */
    async ensureUploadsDirectory() {
        try {
            await fs.mkdir(this.uploadsDir, { recursive: true });
            logger.info(`Uploads directory ready: ${this.uploadsDir}`);
        } catch (error) {
            logger.error('Failed to create uploads directory:', error);
            throw error;
        }
    }
    
    /**
     * Get chat's upload directory
     */
    getChatUploadDir(chatId) {
        return path.join(this.uploadsDir, `chat_${chatId}`);
    }
    
    /**
     * Ensure chat's upload directory exists
     */
    async ensureChatDirectory(chatId) {
        const chatDir = this.getChatUploadDir(chatId);
        try {
            await fs.mkdir(chatDir, { recursive: true });
            return chatDir;
        } catch (error) {
            logger.error(`Failed to create chat directory for ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Save file for a chat
     */
    async saveFile(chatId, filename, buffer) {
        const chatDir = await this.ensureChatDirectory(chatId);
        const filePath = path.join(chatDir, filename);
        
        try {
            await fs.writeFile(filePath, buffer);
            const stats = await fs.stat(filePath);
            
            logger.info(`File saved: ${filename} (${stats.size} bytes) for chat ${chatId}`);
            
            return {
                filename,
                path: filePath,
                relativePath: `./telegram-uploads/chat_${chatId}/${filename}`,
                size: stats.size,
                uploadTime: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to save file ${filename} for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * List files for a chat
     */
    async listFiles(chatId) {
        const chatDir = this.getChatUploadDir(chatId);
        
        try {
            // Check if directory exists
            await fs.access(chatDir);
            
            const files = await fs.readdir(chatDir);
            const fileDetails = [];
            
            for (const filename of files) {
                const filePath = path.join(chatDir, filename);
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isFile()) {
                        fileDetails.push({
                            filename,
                            path: filePath,
                            relativePath: `./telegram-uploads/chat_${chatId}/${filename}`,
                            size: stats.size,
                            uploadTime: stats.birthtime.getTime()
                        });
                    }
                } catch (error) {
                    logger.warn(`Failed to get stats for file ${filename}:`, error);
                }
            }
            
            return fileDetails.sort((a, b) => b.uploadTime - a.uploadTime);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return []; // Directory doesn't exist, no files
            }
            logger.error(`Failed to list files for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Delete specific file for a chat
     */
    async deleteFile(chatId, filename) {
        const chatDir = this.getChatUploadDir(chatId);
        const filePath = path.join(chatDir, filename);
        
        try {
            const stats = await fs.stat(filePath);
            await fs.unlink(filePath);
            
            logger.info(`File deleted: ${filename} for chat ${chatId}`);
            return {
                filename,
                size: stats.size,
                deleted: true
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`File '${filename}' not found`);
            }
            logger.error(`Failed to delete file ${filename} for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Delete all files for a chat
     */
    async deleteAllFiles(chatId) {
        const chatDir = this.getChatUploadDir(chatId);
        
        try {
            const files = await this.listFiles(chatId);
            let totalSize = 0;
            let deletedCount = 0;
            
            for (const file of files) {
                try {
                    await fs.unlink(file.path);
                    totalSize += file.size;
                    deletedCount++;
                } catch (error) {
                    logger.warn(`Failed to delete file ${file.filename}:`, error);
                }
            }
            
            // Try to remove the directory if it's empty
            try {
                await fs.rmdir(chatDir);
            } catch (error) {
                // Directory not empty or doesn't exist, ignore
            }
            
            logger.info(`Deleted ${deletedCount} files (${totalSize} bytes) for chat ${chatId}`);
            return {
                deletedCount,
                totalSize
            };
        } catch (error) {
            logger.error(`Failed to delete all files for chat ${chatId}:`, error);
            throw error;
        }
    }
    
    /**
     * Get total storage usage for a chat
     */
    async getChatStorageUsage(chatId) {
        const files = await this.listFiles(chatId);
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        
        return {
            fileCount: files.length,
            totalSize,
            files
        };
    }
    
    /**
     * Get global storage usage
     */
    async getGlobalStorageUsage() {
        try {
            const chatDirs = await fs.readdir(this.uploadsDir);
            let totalFiles = 0;
            let totalSize = 0;
            const chatUsages = [];
            
            for (const dirName of chatDirs) {
                if (dirName.startsWith('chat_')) {
                    const chatId = dirName.replace('chat_', '');
                    try {
                        const usage = await this.getChatStorageUsage(chatId);
                        totalFiles += usage.fileCount;
                        totalSize += usage.totalSize;
                        
                        if (usage.fileCount > 0) {
                            chatUsages.push({
                                chatId,
                                ...usage
                            });
                        }
                    } catch (error) {
                        logger.warn(`Failed to get usage for chat ${chatId}:`, error);
                    }
                }
            }
            
            return {
                totalFiles,
                totalSize,
                chatUsages
            };
        } catch (error) {
            logger.error('Failed to get global storage usage:', error);
            throw error;
        }
    }
    
    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Format date for display
     */
    formatDate(timestamp) {
        return new Date(timestamp).toLocaleString();
    }
}

module.exports = FileManager;