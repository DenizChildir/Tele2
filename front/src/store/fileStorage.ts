// fileStorage.ts
import { Message } from "../types/types";
import type { FileSystemDirectoryHandle } from '../types/fileSystemTypes';
import {config} from "../config";
import {Group, GroupMessage} from "../types/GroupTypes";

export interface StoredUser {
    id: string;
    lastActive: string;
}

interface RecentContact {
    userId: string;
    lastInteraction: string;
}

interface StorageStructure {
    messages: { [key: string]: Message[] };
    users: StoredUser[];
    recentContacts: { [userId: string]: RecentContact[] };
}

class FileSystemStorage {


    async saveGroup(group: Group): Promise<void> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        try {
            const groupsDir = await this.getOrCreateDirectory('groups');
            const filename = `group_${group.id}.json`;

            const fileHandle = await groupsDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(group, null, 2));
            await writable.close();

            console.log(`[FileStorage] Saved group: ${group.id}`);
        } catch (error) {
            console.error('[FileStorage] Error saving group:', error);
            throw error;
        }
    }

    async getGroups(userId: string): Promise<Group[]> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        try {
            const groupsDir = await this.getOrCreateDirectory('groups');
            const groups: Group[] = [];

            for await (const entry of groupsDir.values()) {
                if (entry.kind === 'file' && entry.name.startsWith('group_') && entry.name.endsWith('.json')) {
                    try {
                        const fileHandle = await groupsDir.getFileHandle(entry.name);
                        const file = await fileHandle.getFile();
                        const content = await file.text();
                        const group = JSON.parse(content);
                        groups.push(group);
                    } catch (error) {
                        console.error(`[FileStorage] Error loading group ${entry.name}:`, error);
                    }
                }
            }

            console.log(`[FileStorage] Loaded ${groups.length} groups for user ${userId}`);
            return groups;
        } catch (error) {
            console.error('[FileStorage] Error loading groups:', error);
            return [];
        }
    }

    async saveGroupMessage(message: GroupMessage): Promise<void> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        try {
            const messagesDir = await this.getOrCreateDirectory('groups/messages');
            const filename = `group_${message.groupId}_messages.json`;

            let messages: GroupMessage[] = [];
            try {
                const fileHandle = await messagesDir.getFileHandle(filename);
                const file = await fileHandle.getFile();
                const content = await file.text();
                messages = JSON.parse(content);
            } catch {
                // File doesn't exist yet
            }

            // Check if message already exists
            if (!messages.some(msg => msg.id === message.id)) {
                messages.push(message);

                // Sort by timestamp
                messages.sort((a, b) =>
                    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                );

                const fileHandle = await messagesDir.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(messages, null, 2));
                await writable.close();

                console.log(`[FileStorage] Saved group message ${message.id} to ${filename}`);
            }
        } catch (error) {
            console.error('[FileStorage] Error saving group message:', error);
            throw error;
        }
    }

    async getGroupMessages(groupId: string): Promise<GroupMessage[]> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        try {
            const messagesDir = await this.getOrCreateDirectory('groups/messages');
            const filename = `group_${groupId}_messages.json`;

            try {
                const fileHandle = await messagesDir.getFileHandle(filename);
                const file = await fileHandle.getFile();
                const content = await file.text();
                const messages = JSON.parse(content);

                console.log(`[FileStorage] Loaded ${messages.length} messages for group ${groupId}`);
                return messages;
            } catch {
                console.log(`[FileStorage] No messages found for group ${groupId}`);
                return [];
            }
        } catch (error) {
            console.error('[FileStorage] Error loading group messages:', error);
            return [];
        }
    }

    async deleteGroupData(groupId: string, userId: string): Promise<void> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        try {
            const groupsDir = await this.getOrCreateDirectory('groups');
            const messagesDir = await this.getOrCreateDirectory('groups/messages');

            // Remove group file
            try {
                await groupsDir.removeEntry(`group_${groupId}.json`);
                console.log(`[FileStorage] Deleted group file for ${groupId}`);
            } catch (error) {
                console.log('[FileStorage] Group file not found');
            }

            // Remove messages file
            try {
                await messagesDir.removeEntry(`group_${groupId}_messages.json`);
                console.log(`[FileStorage] Deleted group messages for ${groupId}`);
            } catch (error) {
                console.log('[FileStorage] Group messages file not found');
            }

            console.log(`[FileStorage] Deleted all group data for ${groupId}`);
        } catch (error) {
            console.error('[FileStorage] Error deleting group data:', error);
            throw error;
        }
    }




    private baseDirectory: FileSystemDirectoryHandle | null = null;
    private cachedData: StorageStructure = {
        messages: {},
        users: [],
        recentContacts: {}
    };
    private fileCache: Map<string, string> = new Map(); // Cache for blob URLs

    async initialize(): Promise<void> {
        if (this.baseDirectory) return;

        try {
            // Request permission to access files
            const dirHandle = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'documents'
            });

            this.baseDirectory = dirHandle;
            await this.ensureDirectoryStructure();
            await this.loadCachedData();
        } catch (error) {
            console.error('Error initializing file system:', error);
            throw new Error('Failed to initialize file system storage');
        }
    }

    private createMessageKey(fromId: string, toId: string): string {
        // Sort IDs to ensure consistent filename regardless of sender/receiver order
        const ids = [fromId, toId].sort();
        return `msg_${ids[0]}_to_${ids[1]}`;
    }

    private parseMessageKey(filename: string): { fromId: string, toId: string } | null {
        const match = filename.match(/^msg_(.+)_to_(.+)\.json$/);
        if (!match) return null;
        return {
            fromId: match[1],
            toId: match[2]
        };
    }

    private async ensureDirectoryStructure() {
        if (!this.baseDirectory) return;

        try {
            // Create necessary subdirectories
            await this.getOrCreateDirectory('messages');
            await this.getOrCreateDirectory('users');
            await this.getOrCreateDirectory('contacts');
            await this.getOrCreateDirectory('files'); // New directory for file storage
        } catch (error) {
            console.error('Error creating directory structure:', error);
        }
    }

    private async getOrCreateDirectory(name: string): Promise<FileSystemDirectoryHandle> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');
        return await this.baseDirectory.getDirectoryHandle(name, { create: true });
    }

    // New method to save file data
    async saveFileData(messageId: string, file: File): Promise<void> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        try {
            const filesDir = await this.getOrCreateDirectory('files');

            // Create a unique filename using messageId and original filename
            const fileExt = file.name.split('.').pop() || 'bin';
            const storedFileName = `${messageId}.${fileExt}`;

            // Save the actual file
            const fileHandle = await filesDir.getFileHandle(storedFileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(file);
            await writable.close();

            // Also save metadata
            const metadataFileName = `${messageId}.meta.json`;
            const metadata = {
                originalName: file.name,
                type: file.type,
                size: file.size,
                lastModified: file.lastModified,
                storedFileName: storedFileName
            };

            const metaHandle = await filesDir.getFileHandle(metadataFileName, { create: true });
            const metaWritable = await metaHandle.createWritable();
            await metaWritable.write(JSON.stringify(metadata, null, 2));
            await metaWritable.close();

            console.log(`Saved file data for message ${messageId}: ${file.name}`);
        } catch (error) {
            console.error('Error saving file data:', error);
            throw error;
        }
    }

    // New method to retrieve file data
    async getFileData(messageId: string): Promise<{ file: File; url: string } | null> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');

        // Check cache first
        if (this.fileCache.has(messageId)) {
            return {
                file: null as any, // We don't keep the file object in cache
                url: this.fileCache.get(messageId)!
            };
        }

        try {
            const filesDir = await this.getOrCreateDirectory('files');

            // First get metadata
            const metadataFileName = `${messageId}.meta.json`;
            const metaHandle = await filesDir.getFileHandle(metadataFileName);
            const metaFile = await metaHandle.getFile();
            const metadataText = await metaFile.text();
            const metadata = JSON.parse(metadataText);

            // Then get the actual file
            const fileHandle = await filesDir.getFileHandle(metadata.storedFileName);
            const file = await fileHandle.getFile();

            // Create a new File object with the original name
            const restoredFile = new File([file], metadata.originalName, {
                type: metadata.type,
                lastModified: metadata.lastModified
            });

            // Create blob URL and cache it
            const url = URL.createObjectURL(restoredFile);
            this.fileCache.set(messageId, url);

            return {
                file: restoredFile,
                url
            };
        } catch (error) {
            console.log(`No stored file found for message ${messageId}`);
            return null;
        }
    }

    // Clean up blob URLs when they're no longer needed
    cleanupFileCache() {
        this.fileCache.forEach(url => URL.revokeObjectURL(url));
        this.fileCache.clear();
    }

    private async loadCachedData() {
        if (!this.baseDirectory) return;

        try {
            // Load users data
            const usersFile = await this.readFile('users/users.json');
            if (usersFile) {
                this.cachedData.users = JSON.parse(usersFile);
            }

            // Load recent contacts
            const contactsFile = await this.readFile('contacts/contacts.json');
            if (contactsFile) {
                this.cachedData.recentContacts = JSON.parse(contactsFile);
            }

            // Load messages
            const messagesDir = await this.getOrCreateDirectory('messages');
            for await (const entry of messagesDir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    const conversationId = entry.name.replace('.json', '');
                    const messagesContent = await this.readFile(`messages/${entry.name}`);
                    if (messagesContent) {
                        this.cachedData.messages[conversationId] = JSON.parse(messagesContent);
                    }
                }
            }
        } catch (error) {
            console.error('Error loading cached data:', error);
        }
    }

    private async readFile(path: string): Promise<string | null> {
        if (!this.baseDirectory) return null;

        try {
            const pathParts = path.split('/');
            const fileName = pathParts.pop()!;
            let currentDir = this.baseDirectory;

            // Navigate to the correct directory
            for (const part of pathParts) {
                currentDir = await currentDir.getDirectoryHandle(part);
            }

            const fileHandle = await currentDir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (error) {
            return null;
        }
    }

    private async writeFile(path: string, content: string): Promise<void> {
        if (!this.baseDirectory) return;

        try {
            const pathParts = path.split('/');
            const fileName = pathParts.pop()!;
            let currentDir = this.baseDirectory;

            // Navigate to the correct directory
            for (const part of pathParts) {
                currentDir = await currentDir.getDirectoryHandle(part, { create: true });
            }

            const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        } catch (error) {
            console.error('Error writing file:', error);
        }
    }

    async saveMessage(message: Message): Promise<void> {
        if (message.content === 'delivered') return;

        try {
            const messagesDir = await this.getOrCreateDirectory('messages');
            const key = this.createMessageKey(message.fromId, message.toId);
            const filename = `${key}.json`;

            // Initialize or load existing messages
            let existingMessages: Message[] = [];
            try {
                const existingFile = await messagesDir.getFileHandle(filename);
                const file = await existingFile.getFile();
                const content = await file.text();
                existingMessages = JSON.parse(content);
            } catch (error) {
                console.log(`Creating new message file: ${filename}`);
            }

            // Check if message already exists
            const messageExists = existingMessages.some(msg => msg.id === message.id);
            if (!messageExists) {
                const messageWithTimestamp = {
                    ...message,
                    savedAt: new Date().toISOString()
                };

                // Add new message to array
                existingMessages.push(messageWithTimestamp);

                // Save to cache
                const cacheKey = `${message.fromId}:${message.toId}`;
                this.cachedData.messages[cacheKey] = existingMessages;

                // Write to file
                const fileHandle = await messagesDir.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(existingMessages, null, 2));
                await writable.close();

                console.log(`Saved message to ${filename}:`, messageWithTimestamp);
            }
        } catch (error) {
            console.error('Error saving message:', error);
            throw new Error('Failed to save message');
        }
    }

    async getMessages(userId1: string, userId2: string): Promise<Message[]> {
        try {
            const messagesDir = await this.getOrCreateDirectory('messages');
            const filename = `${this.createMessageKey(userId1, userId2)}.json`;

            try {
                const fileHandle = await messagesDir.getFileHandle(filename);
                const file = await fileHandle.getFile();
                const content = await file.text();
                const messages = JSON.parse(content);

                // Cache the messages
                const cacheKey = `${userId1}:${userId2}`;
                this.cachedData.messages[cacheKey] = messages;

                return messages;
            } catch (error) {
                // If file doesn't exist, return empty array
                return [];
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            return [];
        }
    }

    async saveUser(userId: string): Promise<void> {
        const existingUser = this.cachedData.users.find(u => u.id === userId);

        if (!existingUser) {
            this.cachedData.users.push({
                id: userId,
                lastActive: new Date().toISOString()
            });
        } else {
            existingUser.lastActive = new Date().toISOString();
        }

        await this.writeFile('users/users.json', JSON.stringify(this.cachedData.users));
    }

    async deleteUserData(userId: string): Promise<void> {
        // Remove user from users list
        this.cachedData.users = this.cachedData.users.filter(user => user.id !== userId);
        await this.writeFile('users/users.json', JSON.stringify(this.cachedData.users));

        // Get all message files for this user
        const messagesDir = await this.getOrCreateDirectory('messages');
        const filesDir = await this.getOrCreateDirectory('files');

        try {
            // Collect message IDs that belong to this user
            const userMessageIds = new Set<string>();

            // List all files in messages directory
            for await (const entry of messagesDir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    // Check if file name contains the userId
                    if (entry.name.includes(`msg_${userId}_to_`) ||
                        entry.name.includes(`_to_${userId}.json`)) {
                        try {
                            // Load messages to get their IDs for file cleanup
                            const fileHandle = await messagesDir.getFileHandle(entry.name);
                            const file = await fileHandle.getFile();
                            const content = await file.text();
                            const messages: Message[] = JSON.parse(content);
                            messages.forEach(msg => userMessageIds.add(msg.id));

                            await messagesDir.removeEntry(entry.name);
                            console.log(`Successfully deleted file: ${entry.name}`);
                        } catch (error) {
                            console.error(`Error deleting file ${entry.name}:`, error);
                        }
                    }
                }
            }

            // Delete associated files
            for await (const entry of filesDir.values()) {
                if (entry.kind === 'file') {
                    // Check if this file belongs to any of the user's messages
                    const messageId = entry.name.split('.')[0];
                    if (userMessageIds.has(messageId)) {
                        try {
                            await filesDir.removeEntry(entry.name);
                            console.log(`Deleted file data: ${entry.name}`);
                        } catch (error) {
                            console.error(`Error deleting file data ${entry.name}:`, error);
                        }
                    }
                }
            }

            // Clear from cache
            for (const key in this.cachedData.messages) {
                if (key.includes(userId)) {
                    delete this.cachedData.messages[key];
                }
            }

            // Clear from recent contacts
            delete this.cachedData.recentContacts[userId];
            await this.writeFile(
                'contacts/contacts.json',
                JSON.stringify(this.cachedData.recentContacts)
            );

            // Clear file cache for this user
            this.cleanupFileCache();

        } catch (error) {
            console.error('Error deleting user data:', error);
            throw new Error('Failed to delete user data');
        }
    }

    async deleteContactHistory(userId: string, contactId: string): Promise<void> {
        // First, delete from the backend
        try {
            const response = await fetch(`${config.apiUrl}/api/messages/${userId}/${contactId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                throw new Error('Failed to delete messages from server');
            }
        } catch (error) {
            console.error('Error deleting messages from server:', error);
            throw error;
        }

        // Then proceed with local cleanup
        const messageKey = this.createMessageKey(userId, contactId);
        const filename = `${messageKey}.json`;

        // Get message IDs before deleting
        const messageIds = new Set<string>();
        try {
            const messagesDir = await this.getOrCreateDirectory('messages');
            const fileHandle = await messagesDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const content = await file.text();
            const messages: Message[] = JSON.parse(content);
            messages.forEach(msg => messageIds.add(msg.id));
        } catch (error) {
            console.log('No messages file found to get IDs from');
        }

        // Remove from cache
        const cacheKey1 = `${userId}:${contactId}`;
        const cacheKey2 = `${contactId}:${userId}`;
        delete this.cachedData.messages[cacheKey1];
        delete this.cachedData.messages[cacheKey2];

        // Delete local files
        const messagesDir = await this.getOrCreateDirectory('messages');
        const filesDir = await this.getOrCreateDirectory('files');

        try {
            await messagesDir.removeEntry(filename);

            // Try to delete the reverse direction file as well
            const filename2 = `${this.createMessageKey(contactId, userId)}.json`;
            try {
                await messagesDir.removeEntry(filename2);
            } catch (error) {
                // Ignore error if reverse file doesn't exist
            }

            // Delete associated file data
            for await (const entry of filesDir.values()) {
                if (entry.kind === 'file') {
                    const messageId = entry.name.split('.')[0];
                    if (messageIds.has(messageId)) {
                        try {
                            await filesDir.removeEntry(entry.name);
                            console.log(`Deleted file data: ${entry.name}`);
                        } catch (error) {
                            console.error(`Error deleting file data ${entry.name}:`, error);
                        }
                    }
                }
            }

            // Update recent contacts
            if (this.cachedData.recentContacts[userId]) {
                this.cachedData.recentContacts[userId] =
                    this.cachedData.recentContacts[userId].filter(
                        contact => contact.userId !== contactId
                    );
                await this.writeFile(
                    'contacts/contacts.json',
                    JSON.stringify(this.cachedData.recentContacts)
                );
            }
        } catch (error) {
            console.error('Error deleting contact history:', error);
            throw error;
        }
    }

    async deleteAllUserData(): Promise<void> {
        if (!this.baseDirectory) return;

        try {
            // Clear cached data
            this.cachedData = {
                messages: {},
                users: [],
                recentContacts: {}
            };

            // Clean up blob URLs
            this.cleanupFileCache();

            // Delete all files in each directory
            for (const dir of ['messages', 'users', 'contacts', 'files']) {
                const dirHandle = await this.getOrCreateDirectory(dir);
                for await (const entry of dirHandle.values()) {
                    await dirHandle.removeEntry(entry.name);
                }
            }
        } catch (error) {
            console.error('Error deleting all user data:', error);
        }
    }

    getRecentUsers(): StoredUser[] {
        return this.cachedData.users
            .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime())
            .slice(0, 5);
    }

    async saveRecentContact(currentUserId: string, contactId: string): Promise<void> {
        if (!this.cachedData.recentContacts[currentUserId]) {
            this.cachedData.recentContacts[currentUserId] = [];
        }

        this.cachedData.recentContacts[currentUserId] = this.cachedData.recentContacts[currentUserId]
            .filter(contact => contact.userId !== contactId);

        this.cachedData.recentContacts[currentUserId].unshift({
            userId: contactId,
            lastInteraction: new Date().toISOString()
        });

        this.cachedData.recentContacts[currentUserId] =
            this.cachedData.recentContacts[currentUserId].slice(0, 5);

        await this.writeFile(
            'contacts/contacts.json',
            JSON.stringify(this.cachedData.recentContacts)
        );
    }

    getRecentContacts(userId: string): RecentContact[] {
        return this.cachedData.recentContacts[userId] || [];
    }

    async getAllMessages(userId: string): Promise<Message[]> {
        try {
            const messagesDir = await this.getOrCreateDirectory('messages');
            let allMessages: Message[] = [];

            // List all files in messages directory
            for await (const entry of messagesDir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    // Check if file involves the current user
                    const messageKey = this.parseMessageKey(entry.name);
                    if (messageKey && (messageKey.fromId === userId || messageKey.toId === userId)) {
                        const fileHandle = await messagesDir.getFileHandle(entry.name);
                        const file = await fileHandle.getFile();
                        const content = await file.text();
                        const messages: Message[] = JSON.parse(content);
                        allMessages = allMessages.concat(messages);
                    }
                }
            }

            // Sort messages by timestamp
            return allMessages.sort((a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
        } catch (error) {
            console.error('Error loading all messages:', error);
            return [];
        }
    }
}

// Create a singleton instance
const fileStorage = new FileSystemStorage();

export type { RecentContact};

// Export wrapper functions that handle initialization
export const initializeStorage = () => fileStorage.initialize();

export const saveMessage = async (message: Message) => {
    await fileStorage.initialize();
    return fileStorage.saveMessage(message);
};

export const getMessages = async (userId1: string, userId2: string) => {
    await fileStorage.initialize();
    return fileStorage.getMessages(userId1, userId2);
};

export const saveUser = async (userId: string) => {
    await fileStorage.initialize();
    return fileStorage.saveUser(userId);
};

export const getRecentUsers = async () => {
    await fileStorage.initialize();
    return fileStorage.getRecentUsers();
};

export const deleteUserData = async (userId: string) => {
    await fileStorage.initialize();
    return fileStorage.deleteUserData(userId);
};

export const deleteContactHistory = async (userId: string, contactId: string) => {
    await fileStorage.initialize();
    return fileStorage.deleteContactHistory(userId, contactId);
};

export const deleteAllUserData = async () => {
    await fileStorage.initialize();
    return fileStorage.deleteAllUserData();
};

export const saveRecentContact = async (currentUserId: string, contactId: string) => {
    await fileStorage.initialize();
    return fileStorage.saveRecentContact(currentUserId, contactId);
};

export const getRecentContacts = async (userId: string) => {
    await fileStorage.initialize();
    return fileStorage.getRecentContacts(userId);
};

// New file storage functions
export const saveFileData = async (messageId: string, file: File) => {
    await fileStorage.initialize();
    return fileStorage.saveFileData(messageId, file);
};

export const getFileData = async (messageId: string) => {
    await fileStorage.initialize();
    return fileStorage.getFileData(messageId);
};

export const cleanupFileCache = () => {
    fileStorage.cleanupFileCache();
};

// Keep the generateShortId function as is
export const generateShortId = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const timestamp = Date.now().toString(36);

    for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `${result}-${timestamp}`;
};

export const getAllMessages = async (userId: string) => {
    await fileStorage.initialize();
    return fileStorage.getAllMessages(userId);
};

// Add these wrapper functions at the end of fileStorage.ts:


export const saveGroup = async (group: Group) => {
    await fileStorage.initialize();
    return fileStorage.saveGroup(group);
};

export const getGroups = async (userId: string) => {
    await fileStorage.initialize();
    return fileStorage.getGroups(userId);
};

export const getGroupMessages = async (groupId: string) => {
    await fileStorage.initialize();
    return fileStorage.getGroupMessages(groupId);
};

export const deleteGroupData = async (groupId: string, userId: string) => {
    await fileStorage.initialize();
    return fileStorage.deleteGroupData(groupId, userId);
};



export const saveGroupMessage = async (message: GroupMessage) => {
    await fileStorage.initialize();
    // Convert to regular message format for storage
    const regularMessage: Message = {
        id: message.id,
        fromId: message.fromId,
        toId: message.groupId,
        content: message.content,
        timestamp: message.timestamp,
        delivered: message.delivered,
        readStatus: message.readBy.includes(message.fromId),
        status: message.status,
        replyTo: message.replyTo
    };
    return fileStorage.saveMessage(regularMessage);
};



