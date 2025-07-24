// Updated WebSocketManager.tsx
import React, { useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import {
    setWebSocketConnected,
    setUserOnlineStatus,
    removeFromQueue
} from '../store/messageSlice';
import { MessageProcessor } from '../service/messageProcessor';
import { Message } from '../types/types';
import { config } from "../config";

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

            processPendingMessages();
        };

        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);

            // Handle status updates
            if (message.content === 'status_update') {
                dispatch(setUserOnlineStatus({
                    userId: message.fromId,
                    online: message.status === 'online'
                }));
                return;
            }

            // Check if this is a WebRTC signaling message
            if (message.messageType === 'webrtc_signaling') {
                // WebRTC messages are handled by WebRTCManager via event listeners
                // Just pass them through - don't process as chat messages
                return;
            }

            // Handle regular chat messages
            try {
                await messageProcessorRef.current?.processIncomingMessage(message);
            } catch (error) {
                console.error('Error processing message:', error);
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