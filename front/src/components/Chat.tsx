// Updated Chat.tsx - Now with better group message handling
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { useWebSocket } from './WebSocketManager';
import { useWebRTC } from './WebRTCManager';
import {
    addMessageAsync,
    setMessageRead,
    initializeMessagesAsync
} from '../store/messageSlice';
import { Message, MessageContent, MessageContentType, ReplyMetadata } from '../types/types';
import { FilePreview } from './FilePreview';
import { getFileData } from '../store/fileStorage';
import { ContactSwitcher } from './ContactSwitcher';
import {
    addGroupMessage,
    markGroupMessageAsRead,
    markAllGroupMessagesAsRead,
    resetGroupUnreadCount,
    fetchGroupMessagesAsync,
    setCurrentGroup
} from '../store/groupSlice';
import {GroupInfo} from "./GroupInfo";
import { useAppSelector as useGroupSelector } from '../hooks/redux';
import { GroupChatManager } from './GroupChatManager';


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
    const [isFileTransferring, setIsFileTransferring] = useState(false);
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
    const [fileUrlCache, setFileUrlCache] = useState<Map<string, string>>(new Map());
    const [showContactSwitcher, setShowContactSwitcher] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const { ws, messageProcessor } = useWebSocket();
    const { sendFile, isConnected: isPeerConnected, createConnection, getFileUrl } = useWebRTC();
    const isGroupChat = connectedToUser?.startsWith('GROUP_');

    const isUserOnline = connectedToUser ? users[connectedToUser]?.online : false;

    const groups = useGroupSelector(state => state.groups.groups);
    const groupMessages = useGroupSelector(state => state.groups.groupMessages);
    const [showGroupManager, setShowGroupManager] = useState(false);

    const conversationMessages = messages.filter(msg => {
        if (!msg.content ||
            msg.content === 'delivered' ||
            msg.content === 'read' ||
            msg.content === 'status_update') {
            return false;
        }

        // For group chats
        if (isGroupChat) {
            // Show messages where toId is the group
            return msg.toId === connectedToUser;
        }

        // For direct messages (existing logic)
        return (msg.fromId === currentUserId && msg.toId === connectedToUser) ||
            (msg.fromId === connectedToUser && msg.toId === currentUserId);
    });

    // Set current group when viewing a group chat
    useEffect(() => {
        if (isGroupChat && connectedToUser) {
            dispatch(setCurrentGroup(connectedToUser));
            // Reset unread count when viewing the group
            dispatch(resetGroupUnreadCount(connectedToUser));
            // Fetch group messages if not already loaded
            if (!groupMessages[connectedToUser]) {
                dispatch(fetchGroupMessagesAsync(connectedToUser));
            }
        } else {
            dispatch(setCurrentGroup(null));
        }
    }, [isGroupChat, connectedToUser, dispatch]);

    // Mark group messages as read when viewing them
    useEffect(() => {
        if (isGroupChat && connectedToUser && currentUserId) {
            const groupMsgs = groupMessages[connectedToUser] || [];
            groupMsgs.forEach(msg => {
                if (!msg.readBy.includes(currentUserId) && msg.fromId !== currentUserId) {
                    dispatch(markGroupMessageAsRead({
                        groupId: connectedToUser,
                        messageId: msg.id,
                        userId: currentUserId
                    }));
                }
            });

            // Mark all as read
            dispatch(markAllGroupMessagesAsRead({
                groupId: connectedToUser,
                userId: currentUserId
            }));
        }
    }, [isGroupChat, connectedToUser, currentUserId, groupMessages, dispatch]);

    // Load file URLs for messages when component mounts or messages change
    useEffect(() => {
        const loadFileUrls = async () => {
            for (const message of conversationMessages) {
                const content = message.content as MessageContent | string;
                if (typeof content === 'object' && content && 'file' in content) {
                    // Check if we already have the URL from WebRTC
                    let url = getFileUrl(message.id);

                    // If not, try to load from persistent storage
                    if (!url && !fileUrlCache.has(message.id)) {
                        const fileData = await getFileData(message.id);
                        if (fileData) {
                            setFileUrlCache(prev => new Map(prev).set(message.id, fileData.url));
                        }
                    }
                }
            }
        };

        loadFileUrls();
    }, [conversationMessages, getFileUrl]);

    // Load messages on mount
    useEffect(() => {
        const loadMessages = async () => {
            if (!currentUserId || !connectedToUser) return;

            setIsLoading(true);
            try {
                if (isGroupChat) {
                    // For group chats, fetch group messages
                    await dispatch(fetchGroupMessagesAsync(connectedToUser)).unwrap();
                } else {
                    // For direct messages
                    await dispatch(initializeMessagesAsync({
                        userId1: currentUserId,
                        userId2: connectedToUser
                    })).unwrap();
                }
            } catch (error) {
                setError('Failed to load messages');
            } finally {
                setIsLoading(false);
            }
        };

        loadMessages();
    }, [currentUserId, connectedToUser, isGroupChat, dispatch]);

    // Handle read receipts for direct messages
    useEffect(() => {
        if (isGroupChat) return; // Skip for group chats

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
    }, [conversationMessages, currentUserId, messageProcessor, isGroupChat, dispatch]);

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

    const handleReply = (message: Message) => {
        setReplyingTo(message);
    };

    const cancelReply = () => {
        setReplyingTo(null);
    };

    const scrollToMessage = (messageId: string) => {
        const messageElement = messageRefs.current.get(messageId);
        if (messageElement) {
            messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedMessageId(messageId);
            setTimeout(() => setHighlightedMessageId(null), 1500);
        }
    };

    const getReplyPreviewText = (message: Message): string => {
        const content = message.content;
        if (typeof content === 'string') {
            return content;
        }
        if (content && typeof content === 'object' && 'type' in content) {
            const msgContent = content as MessageContent;
            if (msgContent.text) return msgContent.text;
            if (msgContent.file) return msgContent.file.name;
        }
        return 'Message';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if ((!messageText.trim() && !selectedFile) || !connectedToUser) {
            return;
        }

        setError(null);

        try {
            if (selectedFile) {
                // Handle file transfer via WebRTC
                await handleFileTransfer();
            } else {
                // Handle regular text message
                await handleTextMessage();
            }

            // Clear reply after sending
            setReplyingTo(null);
        } catch (error) {
            console.error('Error in handleSubmit:', error);
            setError(error instanceof Error ? error.message : 'Failed to send message');
        }
    };

    const handleTextMessage = async () => {
        if (!messageProcessor || !currentUserId || !connectedToUser) {
            throw new Error('Missing required components for text message');
        }

        const content = messageText.trim();
        const message: Message = {
            id: crypto.randomUUID(),
            fromId: currentUserId,
            toId: connectedToUser,
            content,
            timestamp: new Date().toISOString(),
            delivered: false,
            readStatus: false,
            status: 'sent',
            replyTo: replyingTo ? {
                messageId: replyingTo.id,
                fromId: replyingTo.fromId,
                content: replyingTo.content,
                timestamp: replyingTo.timestamp
            } : undefined
        };

        await messageProcessor.sendMessage(message);
        setMessageText('');
    };

    const handleFileTransfer = async () => {
        if (!selectedFile || !currentUserId || !connectedToUser) {
            throw new Error('Missing required components for file transfer');
        }

        setIsFileTransferring(true);

        try {
            // First, create/ensure WebRTC connection
            if (!isPeerConnected(connectedToUser)) {
                console.log('Creating WebRTC connection for file transfer...');
                const connected = await createConnection(connectedToUser);
                if (!connected) {
                    throw new Error('Failed to establish WebRTC connection for file transfer');
                }
            }

            // Send file via WebRTC and get the message ID
            console.log('Sending file via WebRTC...');
            const messageId = await sendFile(connectedToUser, selectedFile);

            // Create a chat message to represent the file transfer
            const fileType: MessageContentType =
                selectedFile.type.startsWith('image/') ? 'image' :
                    selectedFile.type.startsWith('video/') ? 'video' :
                        selectedFile.type.startsWith('audio/') ? 'audio' : 'file';

            const content: MessageContent = {
                type: fileType,
                file: {
                    name: selectedFile.name,
                    size: selectedFile.size,
                    type: selectedFile.type,
                    lastModified: selectedFile.lastModified
                }
            };

            // Send a regular chat message to represent the file with the same ID
            if (messageProcessor) {
                const fileMessage: Message = {
                    id: messageId, // Use the same ID returned from sendFile
                    fromId: currentUserId,
                    toId: connectedToUser,
                    content,
                    timestamp: new Date().toISOString(),
                    delivered: false,
                    readStatus: false,
                    status: 'sent',
                    replyTo: replyingTo ? {
                        messageId: replyingTo.id,
                        fromId: replyingTo.fromId,
                        content: replyingTo.content,
                        timestamp: replyingTo.timestamp
                    } : undefined
                };

                await messageProcessor.sendMessage(fileMessage);
            }

            // Clear the selected file
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';

            console.log('File transfer completed successfully');
        } catch (error) {
            console.error('File transfer failed:', error);
            throw new Error(`File transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsFileTransferring(false);
        }
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const renderReplyContext = (replyTo: ReplyMetadata) => {
        const content = replyTo.content;
        let displayText = '';
        let isFile = false;
        let fileIcon = '📎';

        if (typeof content === 'string') {
            displayText = content;
        } else if (content && typeof content === 'object' && 'type' in content) {
            const msgContent = content as MessageContent;
            isFile = true;

            if (msgContent.type === 'image') fileIcon = '📷';
            else if (msgContent.type === 'video') fileIcon = '🎥';
            else if (msgContent.type === 'audio') fileIcon = '🎵';

            displayText = msgContent.file?.name || 'File';
        }

        return (
            <div
                className="reply-context"
                onClick={() => scrollToMessage(replyTo.messageId)}
            >
                <div className="reply-context-header">
                    {replyTo.fromId === currentUserId ? 'You' : replyTo.fromId}
                </div>
                <div className="reply-context-content">
                    {isFile ? (
                        <div className="reply-context-file">
                            <span className="reply-context-file-icon">{fileIcon}</span>
                            <span>{displayText}</span>
                        </div>
                    ) : (
                        displayText
                    )}
                </div>
            </div>
        );
    };

    const renderMessageContent = (message: Message) => {
        const content = message.content as MessageContent | string;

        const messageContentElement = () => {
            if (typeof content === 'string') {
                return <span>{content}</span>;
            }

            if (content.type === 'file' || content.type === 'image' || content.type === 'video' || content.type === 'audio') {
                const file = content.file;
                if (!file) return <span>Invalid file</span>;

                // Check if we have the file URL from WebRTC (for both sent and received files)
                const fileUrl = getFileUrl(message.id) || fileUrlCache.get(message.id);

                if (fileUrl) {
                    // We have the actual file - show preview
                    const isIncoming = message.fromId !== currentUserId;
                    return (
                        <div>
                            <FilePreview
                                file={{
                                    url: fileUrl,
                                    name: file.name,
                                    type: file.type,
                                    size: file.size
                                }}
                                isIncoming={isIncoming}
                            />
                            {isIncoming && (
                                <div className="file-auto-download-notice">
                                    ✓ Auto-downloaded to your downloads folder
                                </div>
                            )}
                        </div>
                    );
                } else {
                    // File data not available yet (still transferring or loading)
                    const formatSize = (bytes: number) => {
                        if (bytes < 1024) return bytes + ' B';
                        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
                    };

                    const icon = content.type === 'image' ? '📷' :
                        content.type === 'video' ? '🎥' :
                            content.type === 'audio' ? '🎵' : '📄';

                    return (
                        <div className="file-preview">
                            <span className="file-icon">{icon}</span>
                            <div className="file-info">
                                <div className="file-name">{file.name}</div>
                                <div className="file-size">
                                    {message.fromId === currentUserId ? 'Sending...' : 'Receiving...'}
                                </div>
                            </div>
                        </div>
                    );
                }
            }

            return <span>Unsupported message type</span>;
        };

        return (
            <>
                {message.replyTo && renderReplyContext(message.replyTo)}
                {messageContentElement()}
            </>
        );
    };

    return (
        <>
            <div className="chat-container">
                <div className="chat-header">
                    <div className="chat-header-left">
                        <button
                            onClick={() => setShowContactSwitcher(!showContactSwitcher)}
                            className="btn btn-icon contact-switcher-toggle"
                            title="Show contacts"
                        >
                            <span className="contact-switcher-icon">💬</span>
                        </button>
                        <div className="chat-user-info">
                    <span>
                        {isGroupChat ? 'Group: ' : 'Chat with: '}
                        <strong>{isGroupChat && connectedToUser ? groups[connectedToUser]?.name : connectedToUser}</strong>
                    </span>
                            {!isGroupChat && (
                                <div className="status">
                                    <span className={`status-dot status-${isUserOnline ? 'online' : 'offline'}`}></span>
                                    <span>{isUserOnline ? 'Online' : 'Offline'}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="status">
                        <span className={`status-dot status-${isConnected ? 'online' : 'offline'}`}></span>
                        <span>Connection</span>
                        {connectedToUser && !isGroupChat && isPeerConnected(connectedToUser) && (
                            <div className="status ml-2">
                                <span className="status-dot status-online"></span>
                                <span>WebRTC</span>
                            </div>
                        )}
                    </div>
                </div>

                {isGroupChat && connectedToUser && (
                    <GroupInfo
                        groupId={connectedToUser}
                        onManageClick={() => setShowGroupManager(true)}
                    />
                )}

                <ContactSwitcher
                    isOpen={showContactSwitcher}
                    onClose={() => setShowContactSwitcher(false)}
                />

                <div className="chat-messages">
                    {isLoading ? (
                        <div className="empty-state">
                            <div className="spinner"></div>
                            <p>Loading messages...</p>
                        </div>
                    ) : conversationMessages.length === 0 ? (
                        <div className="empty-state">
                            <p className="text-muted">No messages yet. Start a conversation!</p>
                        </div>
                    ) : (
                        conversationMessages.map(message => (
                            <div
                                key={message.id}
                                ref={el => {
                                    if (el) messageRefs.current.set(message.id, el);
                                }}
                                className={`message ${
                                    message.fromId === currentUserId ? 'message-outgoing' : ''
                                } ${highlightedMessageId === message.id ? 'reply-highlighted' : ''}`}
                                style={{ position: 'relative' }}
                            >
                                {message.fromId === 'system' ? (
                                    <div className="message-system">
                                        <div className="message-system-content">
                                            {typeof message.content === 'string' ? message.content : 'System message'}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {isGroupChat && message.fromId !== currentUserId && (
                                            <div className="message-group-header message-group-header-incoming">
                                                {message.fromId}
                                            </div>
                                        )}
                                        <div className="message-actions">
                                            <button
                                                className="reply-button"
                                                onClick={() => handleReply(message)}
                                                title="Reply"
                                            >
                                                <span>↩️</span>
                                                <span>Reply</span>
                                            </button>
                                        </div>
                                        <div className={`message-bubble ${
                                            message.fromId === currentUserId
                                                ? 'message-bubble-outgoing'
                                                : 'message-bubble-incoming'
                                        }`}>
                                            {renderMessageContent(message)}
                                        </div>
                                        <div className="message-meta">
                                            <span>{formatTime(message.timestamp)}</span>
                                            {message.fromId === currentUserId && !isGroupChat && (
                                                <span className="message-status">
                                                {message.status === 'read' ? '✓✓✓' :
                                                    message.status === 'delivered' ? '✓✓' : '✓'}
                                            </span>
                                            )}
                                        </div>
                                    </>
                                )}
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

                    {isFileTransferring && (
                        <div className="alert alert-success mb-md">
                            <span>📤</span>
                            <span>Transferring file via WebRTC...</span>
                        </div>
                    )}

                    {replyingTo && (
                        <div className="reply-input-bar">
                            <div className="reply-input-content">
                                <span>↩️</span>
                                <span className="reply-input-user">
                                {replyingTo.fromId === currentUserId ? 'You' : replyingTo.fromId}:
                            </span>
                                <span className="reply-input-text">
                                {getReplyPreviewText(replyingTo)}
                            </span>
                            </div>
                            <button
                                onClick={cancelReply}
                                className="reply-cancel-button"
                                title="Cancel reply"
                            >
                                ✕
                            </button>
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
                            disabled={isFileTransferring || (isGroupChat && !isConnected)}
                        />
                        {!isGroupChat && (
                            <label htmlFor="file-input" className="btn btn-icon">
                                📎
                            </label>
                        )}

                        <input
                            type="text"
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            placeholder={isConnected ? "Type a message..." : "Connecting..."}
                            className="input"
                            disabled={!isConnected || isFileTransferring}
                        />

                        <button
                            type="submit"
                            disabled={!isConnected || (!messageText.trim() && !selectedFile) || isFileTransferring}
                            className="btn btn-primary"
                        >
                            {isFileTransferring ? 'Sending...' : 'Send'}
                        </button>
                    </form>
                </div>
            </div>
            {showGroupManager && (
                <GroupChatManager
                    isOpen={showGroupManager}
                    onClose={() => setShowGroupManager(false)}
                />
            )}
        </>
    );
};