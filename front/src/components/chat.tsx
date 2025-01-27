// Chat.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { useWebSocket } from './WebSocketManager';
import {
    addMessageAsync,
    setMessageRead,
    initializeMessagesAsync
} from '../store/messageSlice';
import {FileMetadata, Message, MessageContent, MessageContentType, SignalingContent} from '../types/types';
import { MessageProcessor } from '../service/messageProcessor';
import styles from '../styles/modules/Chat.module.css';
import {MessageContentDisplay} from "./MessageContent";
import {FileUploadButton} from "./FileUploadButton";
import {useWebRTC} from "./WebRTCManager";

export const Chat = () => {
    const visibilityTimeoutRef = useRef<TimeoutHandle>();
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const messages = useAppSelector(state => state.messages.messages);
    const isConnected = useAppSelector(state => state.messages.isWebSocketConnected);
    const users = useAppSelector(state => state.messages.users);
    const [messageText, setMessageText] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { ws, messageProcessor } = useWebSocket();

    const isUserOnline = connectedToUser ? users[connectedToUser]?.online : false;

    console.log('[Chat-Init] Component initializing');
    const { createConnection, sendFile, isConnected: isPeerConnected, transfers } = useWebRTC();
    console.log('[Chat-WebRTC] WebRTC hooks retrieved', {
        hasCreateConnection: !!createConnection,
        hasSendFile: !!sendFile,
        hasIsPeerConnected: !!isPeerConnected,
        hasTransfers: !!transfers
    });

    // In Chat.tsx

    const handleFileSelect = async (file: File, type: MessageContentType) => {
        console.log('[Chat-File] File selection started', {
            fileName: file.name,
            fileType: type,
            fileSize: file.size,
            connectedToUser,
            isConnected,
            webRTCAvailable: {
                createConnection: !!createConnection,
                isPeerConnected: !!isPeerConnected
            }
        });

        if (!connectedToUser || !isConnected) return;

        setSelectedFile({ file, type });
        console.log('[Chat-File] File state updated');

        if (!isPeerConnected(connectedToUser)) {
            console.log('[Chat-File] Creating peer connection for file transfer', {
                connectedToUser,
                createConnectionAvailable: !!createConnection
            });

            createConnection(connectedToUser);
            console.log('[Chat-File] Waiting for connection to establish');

            await new Promise(resolve => setTimeout(resolve, 1000));

            if (!isPeerConnected(connectedToUser)) {
                console.error('[Chat-File] Failed to establish peer connection after timeout');
                throw new Error('Could not establish peer connection for file transfer');
            }
        } else {
            console.log('[Chat-File] Existing peer connection found');
        }
    };

    const [selectedFile, setSelectedFile] = useState<{
        file: File;
        type: MessageContentType;
    } | null>(null);

    const clearSelectedFile = () => {
        setSelectedFile(null);
    };

    const createFileMetadata = (file: File): FileMetadata => {
        return {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified
        };
    };

    // Filter and prepare messages for display
    const isSignalingContent = (content: any): content is SignalingContent => {
        return content &&
            typeof content === 'object' &&
            'type' in content &&
            ['offer', 'answer', 'ice-candidate'].includes(content.type);
    };

    const conversationMessages = messages
        .filter(msg => {
            // First, log the message for debugging
            console.log('Filtering message:', msg);

            // Filter out undefined content
            if (!msg.content) {
                console.log('Filtering out message with undefined content:', msg);
                return false;
            }

            // Filter out system messages
            if (msg.content === 'delivered' ||
                msg.content === 'read' ||
                msg.content === 'status_update') {
                console.log('Filtering out system message:', msg);
                return false;
            }

            // Filter out WebRTC signaling messages using type guard
            if (isSignalingContent(msg.content) ||
                (msg.type && ['offer', 'answer', 'ice-candidate'].includes(msg.type))) {
                console.log('Filtering out WebRTC message:', msg);
                return false;
            }

            // Only include messages between the current users
            const isValidConversation = (msg.fromId === currentUserId && msg.toId === connectedToUser) ||
                (msg.fromId === connectedToUser && msg.toId === currentUserId);

            if (!isValidConversation) {
                console.log('Filtering out message from different conversation:', msg);
                return false;
            }

            return true;
        })
        .map(msg => ({
            ...msg,
            status: msg.status || (msg.readStatus ? 'read' : (msg.delivered ? 'delivered' : 'sent'))
        }));
    // Handle message visibility and read status
    const handleVisibilityChange = useCallback(() => {
        console.log('Visibility change detected:', document.visibilityState);

        if (document.visibilityState === 'visible') {
            console.log('Chat became visible, checking for unread messages');

            // Log the current state of messages
            console.log('All conversation messages:', conversationMessages);

            const unreadMessages = conversationMessages
                .filter(msg => {
                    const isFromContact = msg.fromId === connectedToUser;
                    const isUnread = !msg.readStatus && msg.status !== 'read';
                    // Only check delivered status for outgoing messages
                    const isDeliverable = msg.fromId === currentUserId ? msg.delivered : true;

                    console.log('Message state:', JSON.stringify({
                        messageId: msg.id,
                        fromId: msg.fromId,
                        toId: msg.toId,
                        content: msg.content,
                        delivered: msg.delivered,
                        status: msg.status,
                        readStatus: msg.readStatus,
                        isFromContact,
                        isUnread,
                        isDeliverable,
                        willPass: isFromContact && isUnread && isDeliverable,
                        connectedUser: connectedToUser
                    }, null, 2));

                    return isFromContact && isUnread && isDeliverable;
                });

            console.log('Found unread messages:', unreadMessages.length);

            unreadMessages.forEach(msg => {
                if (ws && messageProcessor) {
                    console.log('Creating read receipt for message:', msg.id);

                    const readReceipt: Message = {
                        id: `read_${msg.id}`,
                        fromId: currentUserId!,
                        toId: msg.fromId,
                        content: 'read',
                        timestamp: new Date().toISOString(),
                        delivered: true,
                        readStatus: true,
                        status: 'read'
                    };

                    console.log('Sending read receipt:', readReceipt);
                    messageProcessor.sendMessage(readReceipt);
                    dispatch(setMessageRead(msg.id));
                } else {
                    console.warn('WebSocket or MessageProcessor not available:', {
                        wsAvailable: !!ws,
                        processorAvailable: !!messageProcessor
                    });
                }
            });
        }
    }, [dispatch, currentUserId, connectedToUser, conversationMessages, ws, messageProcessor]);

    // Initialize visibility change listener
    useEffect(() => {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [handleVisibilityChange]);

    // Handle visibility changes for read receipts
    useEffect(() => {
        if (document.visibilityState === 'visible') {
            handleVisibilityChange();
        }
    }, [handleVisibilityChange]);

    // Load initial messages
    useEffect(() => {
        const loadMessages = async () => {
            if (!currentUserId || !connectedToUser) return;

            setIsLoading(true);
            try {
                console.log('Loading messages for:', { currentUserId, connectedToUser });
                await dispatch(initializeMessagesAsync({
                    userId1: currentUserId,
                    userId2: connectedToUser
                })).unwrap();

                // Log loaded messages
                console.log('Messages loaded:', messages);
                console.log('Filtered conversation messages:', conversationMessages);
            } catch (error) {
                console.error('Error loading messages:', error);
                setError('Failed to load messages');
            } finally {
                setIsLoading(false);
            }
        };

        loadMessages();
    }, [currentUserId, connectedToUser, dispatch]);

    // Auto-scroll to bottom effect
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    // Format timestamp for display
    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Handle message submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        console.log('[Chat-Submit] Form submission started', {
            hasMessageText: !!messageText.trim(),
            hasSelectedFile: !!selectedFile,
            connectedToUser,
            isConnected,
            processorAvailable: !!messageProcessor,
            wsAvailable: !!ws
        });

        if ((!messageText.trim() && !selectedFile) || !connectedToUser || !isConnected || !messageProcessor || !ws) {
            console.error('[Chat-Error] Cannot submit - missing requirements');
            return;
        }

        try {
            let messageContent: MessageContent | string;

            if (selectedFile) {
                console.log('[Chat-Submit] Processing file submission', {
                    fileName: selectedFile.file.name,
                    fileType: selectedFile.type
                });

                if (!isPeerConnected(connectedToUser)) {
                    console.log('[Chat-Submit] No peer connection, attempting to establish...');
                    createConnection(connectedToUser);
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    if (!isPeerConnected(connectedToUser)) {
                        console.error('[Chat-Error] Failed to establish peer connection');
                        throw new Error('Could not establish peer connection for file transfer');
                    }
                }

                try {
                    console.log('[Chat-Submit] Starting file transfer');
                    await sendFile(connectedToUser, selectedFile.file);
                    messageContent = {
                        type: selectedFile.type,
                        file: createFileMetadata(selectedFile.file)
                    };
                    console.log('[Chat-Submit] File transfer initiated successfully');
                    clearSelectedFile();
                } catch (error) {
                    console.error('[Chat-Error] Error during file transfer:', error);
                    setError('Failed to send file. Please try again.');
                    return;
                }
            } else {
                messageContent = messageText.trim();
            }

            const message: Message = {
                id: crypto.randomUUID(),
                fromId: currentUserId!,
                toId: connectedToUser,
                content: messageContent,
                timestamp: new Date().toISOString(),
                delivered: false,
                readStatus: false,
                status: 'sent'
            };

            await messageProcessor.sendMessage(message);
            setMessageText('');
            setError(null);
        } catch (error) {
            console.error('[Chat-Error] Error in form submission:', error);
            setError('Failed to send message. Please try again.');
        }
    };

    // Inside Chat component
    return (
        <div className={styles.chatContainer}>
            <div className={styles.header}>
                <div className={styles.headerInfo}>
                    <div className={styles.userInfo}>
                        <span className={styles.userLabel}>Your ID:</span>
                        <span className={styles.userId}>{currentUserId}</span>
                        <span className={styles.connectionStatus}>
                            {isConnected ? (isUserOnline ? '🟢 Online' : '🟡 Away') : '🔴 Offline'}
                        </span>
                    </div>
                </div>
            </div>

            <div className={styles.messagesContainer}>
                {isLoading ? (
                    <div className={styles.loadingIndicator}>Loading messages...</div>
                ) : (
                    conversationMessages.map((message: Message) => (
                        <div
                            key={message.id}
                            className={`${styles.messageWrapper} ${
                                message.fromId === currentUserId ? styles.messageOutgoing : styles.messageIncoming
                            }`}
                        >
                            <div className={`${styles.messageBubble} ${
                                message.fromId === currentUserId ?
                                    styles.messageBubbleOutgoing :
                                    styles.messageBubbleIncoming
                            }`}>
                                <MessageContentDisplay content={message.content} />
                                <div className={styles.messageTime}>
                                    {formatTime(message.timestamp)}
                                    {message.fromId === currentUserId && (
                                        <span className={styles.messageStatus} title={message.status}>
                                            {(() => {
                                                switch (message.status) {
                                                    case 'read': return '✓✓✓';
                                                    case 'delivered': return '✓✓';
                                                    case 'sent':
                                                    default: return '✓';
                                                }
                                            })()}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className={styles.inputForm}>
                {error && <div className={styles.errorMessage}>{error}</div>}
                {selectedFile && (
                    <div className={styles.filePreview}>
                        <MessageContentDisplay
                            content={{
                                type: selectedFile.type,
                                file: createFileMetadata(selectedFile.file)
                            }}
                        />
                        <button
                            type="button"
                            onClick={clearSelectedFile}
                            className={styles.clearFileButton}
                        >
                            ❌
                        </button>
                    </div>
                )}
                <div className={styles.inputContainer}>
                    <FileUploadButton
                        onFileSelect={handleFileSelect}
                        disabled={!isConnected}
                    />
                    <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder={isConnected ? "Type your message..." : "Connecting..."}
                        className={styles.messageInput}
                        disabled={!isConnected}
                    />
                    <button
                        type="submit"
                        disabled={!isConnected || (!messageText.trim() && !selectedFile)}
                        className={styles.sendButton}
                    >
                        Send
                    </button>
                </div>
            </form>
        </div>
    );
};
