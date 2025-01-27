// fileStorage.ts
import { Message } from "../types/types";
import type { FileSystemDirectoryHandle } from '../types/fileSystemTypes';
import {config} from "../config";
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
    private baseDirectory: FileSystemDirectoryHandle | null = null;
    private cachedData: StorageStructure = {
        messages: {},
        users: [],
        recentContacts: {}
    };

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
        } catch (error) {
            console.error('Error creating directory structure:', error);
        }
    }

    private async getOrCreateDirectory(name: string): Promise<FileSystemDirectoryHandle> {
        if (!this.baseDirectory) throw new Error('Storage not initialized');
        return await this.baseDirectory.getDirectoryHandle(name, { create: true });
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

        try {
            // List all files in messages directory
            for await (const entry of messagesDir.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    // Check if file name contains the userId
                    if (entry.name.includes(`msg_${userId}_to_`) ||
                        entry.name.includes(`_to_${userId}.json`)) {
                        try {
                            await messagesDir.removeEntry(entry.name);
                            console.log(`Successfully deleted file: ${entry.name}`);
                        } catch (error) {
                            console.error(`Error deleting file ${entry.name}:`, error);
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

        // Remove from cache
        const cacheKey1 = `${userId}:${contactId}`;
        const cacheKey2 = `${contactId}:${userId}`;
        delete this.cachedData.messages[cacheKey1];
        delete this.cachedData.messages[cacheKey2];

        // Delete local files
        const messagesDir = await this.getOrCreateDirectory('messages');
        try {
            await messagesDir.removeEntry(filename);

            // Try to delete the reverse direction file as well
            const filename2 = `${this.createMessageKey(contactId, userId)}.json`;
            try {
                await messagesDir.removeEntry(filename2);
            } catch (error) {
                // Ignore error if reverse file doesn't exist
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

            // Delete all files in each directory
            for (const dir of ['messages', 'users', 'contacts']) {
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