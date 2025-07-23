import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { useWebSocket } from './WebSocketManager';
import { useWebRTC } from './WebRTCManager';
import {
    addMessageAsync,
    setMessageRead,
    initializeMessagesAsync
} from '../store/messageSlice';
import { Message, MessageContent, MessageContentType } from '../types/types';

export const Chat: React.FC = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const messages = useAppSelector(state => state.messages.messages);
    const isConnected = useAppSelector(state => state.messages.isWebSocketConnected);
    const users = useAppSelector(state => state.messages.users);

    const [messageText, setMessageText] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { ws, messageProcessor } = useWebSocket();
    const { sendFile, isConnected: isPeerConnected } = useWebRTC();

    const isUserOnline = connectedToUser ? users[connectedToUser]?.online : false;

    // Filter messages for current conversation
    const conversationMessages = messages.filter(msg => {
        if (!msg.content ||
            msg.content === 'delivered' ||
            msg.content === 'read' ||
            msg.content === 'status_update') {
            return false;
        }

        // Check if content is a signaling message
        if (typeof msg.content === 'object' &&
            'type' in msg.content &&
            ['offer', 'answer', 'ice-candidate'].includes((msg.content as any).type)) {
            return false;
        }

        return (msg.fromId === currentUserId && msg.toId === connectedToUser) ||
            (msg.fromId === connectedToUser && msg.toId === currentUserId);
    });

    // Load messages on mount
    useEffect(() => {
        const loadMessages = async () => {
            if (!currentUserId || !connectedToUser) return;

            setIsLoading(true);
            try {
                await dispatch(initializeMessagesAsync({
                    userId1: currentUserId,
                    userId2: connectedToUser
                })).unwrap();
            } catch (error) {
                setError('Failed to load messages');
            } finally {
                setIsLoading(false);
            }
        };

        loadMessages();
    }, [currentUserId, connectedToUser, dispatch]);

    // Handle read receipts
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && messageProcessor) {
                const unreadMessages = conversationMessages.filter(
                    msg => msg.fromId === connectedToUser && !msg.readStatus
                );

                unreadMessages.forEach(msg => {
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

                    messageProcessor.sendMessage(readReceipt);
                    dispatch(setMessageRead(msg.id));
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        handleVisibility();

        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [conversationMessages, currentUserId, messageProcessor, dispatch]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [conversationMessages]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedFile(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if ((!messageText.trim() && !selectedFile) || !connectedToUser || !messageProcessor) {
            return;
        }

        try {
            let content: MessageContent | string;

            if (selectedFile) {
                if (!isPeerConnected(connectedToUser)) {
                    throw new Error('Peer connection required for file transfer');
                }

                await sendFile(connectedToUser, selectedFile);

                const fileType: MessageContentType =
                    selectedFile.type.startsWith('image/') ? 'image' :
                        selectedFile.type.startsWith('video/') ? 'video' : 'file';

                content = {
                    type: fileType,
                    file: {
                        name: selectedFile.name,
                        size: selectedFile.size,
                        type: selectedFile.type,
                        lastModified: selectedFile.lastModified
                    }
                };

                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
            } else {
                content = messageText.trim();
            }

            const message: Message = {
                id: crypto.randomUUID(),
                fromId: currentUserId!,
                toId: connectedToUser,
                content,
                timestamp: new Date().toISOString(),
                delivered: false,
                readStatus: false,
                status: 'sent'
            };

            await messageProcessor.sendMessage(message);
            setMessageText('');
            setError(null);
        } catch (error) {
            setError('Failed to send message');
        }
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const renderMessageContent = (content: MessageContent | string) => {
        if (typeof content === 'string') {
            return <span>{content}</span>;
        }

        if (content.type === 'file' || content.type === 'image' || content.type === 'video') {
            const file = content.file;
            if (!file) return <span>Invalid file</span>;

            const formatSize = (bytes: number) => {
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            };

            const icon = content.type === 'image' ? '📷' :
                content.type === 'video' ? '🎥' : '📄';

            return (
                <div className="file-preview">
                    <span className="file-icon">{icon}</span>
                    <div className="file-info">
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatSize(file.size)}</div>
                    </div>
                </div>
            );
        }

        return <span>Unsupported message type</span>;
    };

    return (
        <div className="chat-container">
            <div className="chat-header">
                <div className="chat-user-info">
                    <span>Chat with: <strong>{connectedToUser}</strong></span>
                    <div className="status">
                        <span className={`status-dot status-${isUserOnline ? 'online' : 'offline'}`}></span>
                        <span>{isUserOnline ? 'Online' : 'Offline'}</span>
                    </div>
                </div>
                <div className="status">
                    <span className={`status-dot status-${isConnected ? 'online' : 'offline'}`}></span>
                    <span>Connection</span>
                </div>
            </div>

            <div className="chat-messages">
                {isLoading ? (
                    <div className="text-center text-muted">
                        <div className="spinner"></div>
                        <p className="mt-sm">Loading messages...</p>
                    </div>
                ) : conversationMessages.length === 0 ? (
                    <div className="text-center text-muted">
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                ) : (
                    conversationMessages.map(message => (
                        <div
                            key={message.id}
                            className={`message ${
                                message.fromId === currentUserId ? 'message-outgoing' : ''
                            }`}
                        >
                            <div className={`message-bubble ${
                                message.fromId === currentUserId
                                    ? 'message-bubble-outgoing'
                                    : 'message-bubble-incoming'
                            }`}>
                                {renderMessageContent(message.content as MessageContent | string)}
                            </div>
                            <div className="message-meta">
                                <span>{formatTime(message.timestamp)}</span>
                                {message.fromId === currentUserId && (
                                    <span className="message-status">
                    {message.status === 'read' ? '✓✓✓' :
                        message.status === 'delivered' ? '✓✓' : '✓'}
                  </span>
                                )}
                            </div>
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
                {error && (
                    <div className="alert alert-error mb-md">
                        <span>⚠️</span>
                        <span>{error}</span>
                    </div>
                )}

                {selectedFile && (
                    <div className="file-preview mb-sm">
                        <span className="file-icon">📎</span>
                        <div className="file-info">
                            <div className="file-name">{selectedFile.name}</div>
                            <div className="file-size">
                                {(selectedFile.size / 1024).toFixed(1)} KB
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                setSelectedFile(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                            className="btn btn-icon"
                        >
                            ✕
                        </button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="chat-input-form">
                    <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-input"
                    />
                    <label htmlFor="file-input" className="btn btn-icon">
                        📎
                    </label>

                    <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder={isConnected ? "Type a message..." : "Connecting..."}
                        className="input"
                        disabled={!isConnected}
                    />

                    <button
                        type="submit"
                        disabled={!isConnected || (!messageText.trim() && !selectedFile)}
                        className="btn btn-primary"
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
};