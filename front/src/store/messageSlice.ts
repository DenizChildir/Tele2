// messageSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { Message } from '../types/types';
import * as fileStorage from './fileStorage';

interface MessageState {
    messages: Message[];
    currentUserId: string | null;
    connectedToUser: string | null;
    users: { [key: string]: User };
    loading: boolean;
    error: string | null;
    isWebSocketConnected: boolean;
    messageQueue: {
        pending: Message[];    // Messages waiting to be sent
        failed: Message[];     // Messages that failed to send
        retrying: Message[];   // Messages being retried
    };
}

interface User {
    id: string;
    online: boolean;
}

const initialState: MessageState = {
    messages: [],
    currentUserId: null,
    connectedToUser: null,
    users: {},
    loading: false,
    error: null,
    isWebSocketConnected: false,
    messageQueue: {
        pending: [],
        failed: [],
        retrying: []
    }
};

// New thunk for handling message queuing
export const queueMessageAsync = createAsyncThunk(
    'messages/queueMessageAsync',
    async (message: Message) => {
        await fileStorage.saveMessage(message);
        return message;
    }
);

export const initializeAllMessagesAsync = createAsyncThunk(
    'messages/initializeAllMessagesAsync',
    async (userId: string) => {
        // Get all messages for the user
        const allMessages = await fileStorage.getAllMessages(userId);
        return allMessages;
    }
);

// Async thunks
export const setCurrentUserAsync = createAsyncThunk(
    'messages/setCurrentUserAsync',
    async (userId: string) => {
        await fileStorage.saveUser(userId);
        return userId;
    }
);

export const initializeMessagesAsync = createAsyncThunk(
    'messages/initializeMessagesAsync',
    async ({ userId1, userId2 }: { userId1: string, userId2: string }) => {
        const messages = await fileStorage.getMessages(userId1, userId2);
        return messages;
    }
);

export const addMessageAsync = createAsyncThunk(
    'messages/addMessageAsync',
    async (message: Message, { dispatch, getState }) => {
        const state = getState() as { messages: MessageState };
        const isConnected = state.messages.isWebSocketConnected;

        if (!isConnected) {
            // If not connected, queue the message
            await dispatch(queueMessageAsync(message));
            return { message, queued: true };
        }

        // If connected, send immediately
        await fileStorage.saveMessage(message);
        return { message, queued: false };
    }
);

// New thunk for retrying failed messages
export const retryFailedMessageAsync = createAsyncThunk(
    'messages/retryFailedMessageAsync',
    async (message: Message, { dispatch }) => {
        await dispatch(addMessageAsync(message));
        return message;
    }
);

const messageSlice = createSlice({
    name: 'messages',
    initialState,
    reducers: {
        setWebSocketConnected(state, action: PayloadAction<boolean>) {
            state.isWebSocketConnected = action.payload;
        },
        setConnectedUser(state, action: PayloadAction<string | null>) {
            state.connectedToUser = action.payload;
            state.messages = [];
        },
        setUserOnlineStatus(state, action: PayloadAction<{ userId: string; online: boolean }>) {
            if (!state.users[action.payload.userId]) {
                state.users[action.payload.userId] = {
                    id: action.payload.userId,
                    online: false
                };
            }
            state.users[action.payload.userId].online = action.payload.online;
        },
        setMessageDelivered(state, action: PayloadAction<string>) {
            const message = state.messages.find(m => m.id === action.payload);
            if (message) {
                message.delivered = true;
                message.status = 'delivered';
            }
            // Also check and update queued messages
            const queuedMessage = state.messageQueue.pending.find(m => m.id === action.payload);
            if (queuedMessage) {
                state.messageQueue.pending = state.messageQueue.pending.filter(m => m.id !== action.payload);
            }
        },
        setMessageRead(state, action: PayloadAction<string>) {
            const message = state.messages.find(m => m.id === action.payload);
            if (message) {
                message.readStatus = true;
                message.status = 'read';
                message.delivered = true;  // Ensure delivered is also set when read
            }
            // Also check and update queued messages
            const queuedMessage = state.messageQueue.pending.find(m => m.id === action.payload);
            if (queuedMessage) {
                queuedMessage.readStatus = true;
                queuedMessage.status = 'read';
                queuedMessage.delivered = true;
            }
        },
        clearChat(state) {
            state.messages = [];
            state.connectedToUser = null;
            state.currentUserId = null;
            state.users = {};
            state.messageQueue = {
                pending: [],
                failed: [],
                retrying: []
            };
        },
        moveToFailedQueue(state, action: PayloadAction<string>) {
            const pendingMessage = state.messageQueue.pending.find(m => m.id === action.payload);
            if (pendingMessage) {
                state.messageQueue.pending = state.messageQueue.pending.filter(m => m.id !== action.payload);
                state.messageQueue.failed.push(pendingMessage);
            }
        },
        removeFromQueue(state, action: PayloadAction<string>) {
            state.messageQueue.pending = state.messageQueue.pending.filter(m => m.id !== action.payload);
            state.messageQueue.failed = state.messageQueue.failed.filter(m => m.id !== action.payload);
            state.messageQueue.retrying = state.messageQueue.retrying.filter(m => m.id !== action.payload);
        },
        clearError(state) {
            state.error = null;
        }
    },
    extraReducers: (builder) => {
        builder.addCase(queueMessageAsync.fulfilled, (state, action) => {
            state.messageQueue.pending.push(action.payload);
        });

        // Handle addMessageAsync
        builder.addCase(addMessageAsync.fulfilled, (state, action) => {
            const { message, queued } = action.payload;
            if (!queued && message.content !== 'delivered') {
                const existingMessageIndex = state.messages.findIndex(msg => msg.id === message.id);
                if (existingMessageIndex === -1) {
                    state.messages.push({
                        ...message,
                        status: message.status || 'sent'
                    });
                }
            }
        });

        // Handle retryFailedMessageAsync
        builder.addCase(retryFailedMessageAsync.pending, (state, action) => {
            const messageId = action.meta.arg.id;
            state.messageQueue.failed = state.messageQueue.failed.filter(m => m.id !== messageId);
            state.messageQueue.retrying.push(action.meta.arg);
        });
        builder.addCase(retryFailedMessageAsync.fulfilled, (state, action) => {
            state.messageQueue.retrying = state.messageQueue.retrying.filter(m => m.id !== action.payload.id);
        });



        // Handle setCurrentUserAsync
        builder.addCase(setCurrentUserAsync.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(setCurrentUserAsync.fulfilled, (state, action) => {
            state.currentUserId = action.payload;
            state.loading = false;
        });
        builder.addCase(setCurrentUserAsync.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message || 'Failed to set user';
        });

        // Handle initializeMessagesAsync
        builder.addCase(initializeMessagesAsync.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(initializeMessagesAsync.fulfilled, (state, action) => {
            state.messages = action.payload;
            state.loading = false;
        });
        builder.addCase(initializeMessagesAsync.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message || 'Failed to load messages';
        });

        // Handle addMessageAsync
        builder.addCase(addMessageAsync.pending, (state) => {
            state.error = null;
        });
        builder.addCase(addMessageAsync.rejected, (state, action) => {
            state.error = action.error.message || 'Failed to save message';
        });
        builder.addCase(initializeAllMessagesAsync.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(initializeAllMessagesAsync.fulfilled, (state, action) => {
            state.messages = action.payload;
            state.loading = false;
        });
        builder.addCase(initializeAllMessagesAsync.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message || 'Failed to load messages';
        });
    }
});

export const {
    setConnectedUser,
    setUserOnlineStatus,
    setMessageDelivered,
    setMessageRead,
    clearChat,
    clearError,
    setWebSocketConnected,
    moveToFailedQueue,
    removeFromQueue
} = messageSlice.actions;

export default messageSlice.reducer;