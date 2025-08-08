// Updated WebSocketManager.tsx
import React, { useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import {
    setWebSocketConnected,
    setUserOnlineStatus,
    removeFromQueue
} from '../store/messageSlice';
import { MessageProcessor } from '../service/messageProcessor';
import {Message, MessageContent} from '../types/types';
import { config } from "../config";
import {
    addGroupMessage,
    addGroupNotification,
    fetchUserGroupsAsync,
    addGroupToUser,
    incrementGroupUnreadCount
} from "../store/groupSlice";

interface WebSocketContextType {
    ws: WebSocket | null;
    messageProcessor: MessageProcessor | null;
}

export const WebSocketContext = createContext<WebSocketContextType>({
    ws: null,
    messageProcessor: null
});

interface WebSocketManagerProps {
    children: React.ReactNode;
}

export const WebSocketManager: React.FC<WebSocketManagerProps> = ({ children }) => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const pendingMessages = useAppSelector(state => state.messages.messageQueue.pending);
    const wsRef = useRef<WebSocket | null>(null);
    const messageProcessorRef = useRef<MessageProcessor | null>(null);
    const MAX_RETRIES = 3;
    const retryCountRef = useRef(0);
    const reconnectTimeoutRef = useRef<TimeoutHandle>();

    // Process pending messages
    const processPendingMessages = useCallback(() => {
        if (!messageProcessorRef.current || !pendingMessages.length) return;

        for (const message of pendingMessages) {
            try {
                messageProcessorRef.current.sendMessage(message);
                dispatch(removeFromQueue(message.id));
            } catch (error) {
                console.error('Error processing pending message:', error);
            }
        }
    }, [dispatch, pendingMessages]);

    const connectWebSocket = useCallback(() => {
        if (!currentUserId) return;
        if (retryCountRef.current >= MAX_RETRIES) {
            console.error('Failed to connect after maximum retries');
            return;
        }

        console.log('Attempting WebSocket connection...');
        const ws = new WebSocket(`${config.wsUrl}/ws/${currentUserId}`);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket connected successfully');
            dispatch(setWebSocketConnected(true));
            retryCountRef.current = 0;

            // Initialize message processor
            messageProcessorRef.current = new MessageProcessor(
                wsRef,
                dispatch,
                currentUserId
            );

            // Fetch user's groups after connection
            dispatch(fetchUserGroupsAsync(currentUserId));

            processPendingMessages();
        };

        ws.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('[WebSocket] Received message:', data);

                // Handle different message types based on messageType field
                if (data.messageType) {
                    switch (data.messageType) {
                        case 'group_notification':
                            console.log('[WebSocket] Group notification:', data);

                            const notification = data.data;
                            dispatch(addGroupNotification(notification));

                            // If user was added to a group, add the group to their list
                            if (notification.type === 'member_added' && notification.metadata) {
                                const metadata = notification.metadata;

                                // Check if this notification is about the current user being added
                                if (metadata.userId === currentUserId ||
                                    notification.message?.includes(currentUserId)) {

                                    console.log('[WebSocket] User added to group, adding to list...');

                                    // Create a basic group object from the notification
                                    const newGroup = {
                                        id: notification.groupId,
                                        name: metadata.groupName || `Group ${notification.groupId}`,
                                        description: '',
                                        createdBy: metadata.addedBy || '',
                                        createdAt: new Date().toISOString(),
                                        memberCount: 0,
                                        lastActivity: new Date().toISOString(),
                                        lastMessage: 'You were added to this group'
                                    };

                                    // Add the group to the user's group list
                                    dispatch(addGroupToUser(newGroup));

                                    // Refresh groups to get full details
                                    dispatch(fetchUserGroupsAsync(currentUserId));
                                }
                            }
                            return;

                        case 'webrtc_signaling':
                            console.log('[WebSocket] WebRTC signaling message');
                            return;

                        default:
                            console.log('[WebSocket] Unknown message type:', data.messageType);
                    }
                }

                // Regular message handling
                const message = data as Message;

                // Handle status updates
                if (message.content === 'status_update') {
                    console.log('[WebSocket] Status update:', message);
                    dispatch(setUserOnlineStatus({
                        userId: message.fromId,
                        online: (message as any).status === 'online'
                    }));
                    return;
                }

                // Check if it's a group message
                if (message.toId?.startsWith('GROUP_')) {
                    console.log('[WebSocket] Received group message:', message);

                    // Convert content to ensure it's compatible with GroupMessage type
                    let groupContent: string | MessageContent = '';

                    if (typeof message.content === 'string') {
                        groupContent = message.content;
                    } else if (message.content && typeof message.content === 'object') {
                        if ('type' in message.content &&
                            ['text', 'file', 'image', 'video', 'audio'].includes(message.content.type as string)) {
                            groupContent = message.content as MessageContent;
                        } else {
                            groupContent = JSON.stringify(message.content);
                        }
                    }

                    // Add to group messages
                    dispatch(addGroupMessage({
                        id: message.id,
                        groupId: message.toId,
                        fromId: message.fromId,
                        content: groupContent,
                        timestamp: message.timestamp,
                        delivered: message.delivered || false,
                        readBy: message.readStatus ? [currentUserId] : [],
                        status: message.status || 'delivered',
                        replyTo: message.replyTo
                    }));

                    // Increment unread count if message is from another user
                    if (message.fromId !== currentUserId) {
                        dispatch(incrementGroupUnreadCount(message.toId));
                    }

                    // Also add to regular messages for unified message view
                    await messageProcessorRef.current?.processIncomingMessage(message);
                } else {
                    // Handle regular direct messages
                    console.log('[WebSocket] Received direct message:', message);
                    await messageProcessorRef.current?.processIncomingMessage(message);
                }
            } catch (error) {
                console.error('[WebSocket] Error processing message:', error);
            }
        };

        ws.onclose = (event) => {
            dispatch(setWebSocketConnected(false));
            console.log('WebSocket disconnected with code:', event.code);

            if (event.wasClean) {
                console.log('Clean websocket close');
                return;
            }

            // Attempt reconnection with exponential backoff
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
            reconnectTimeoutRef.current = setTimeout(() => {
                retryCountRef.current++;
                console.log(`Attempting reconnection ${retryCountRef.current}/${MAX_RETRIES}`);
                connectWebSocket();
            }, delay);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }, [currentUserId, dispatch, processPendingMessages]);

    useEffect(() => {
        if (currentUserId) {
            connectWebSocket();
        }

        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close(1000, 'Component unmounting');
            }
            if (messageProcessorRef.current) {
                messageProcessorRef.current.clearDeliveryTimeouts();
            }
        };
    }, [currentUserId, connectWebSocket]);

    return (
        <WebSocketContext.Provider value={{
            ws: wsRef.current,
            messageProcessor: messageProcessorRef.current
        }}>
            <div data-testid="websocket-manager">
                {children}
            </div>
        </WebSocketContext.Provider>
    );
};

export const useWebSocket = () => useContext(WebSocketContext);