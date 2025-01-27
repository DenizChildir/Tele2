// messageProcessor.ts
import { Message } from '../types/types';
import { AppDispatch } from '../store/store';
import {
    addMessageAsync,
    setMessageDelivered,
    setMessageRead,
    queueMessageAsync,
    moveToFailedQueue
} from '../store/messageSlice';

export class MessageProcessor {
    private wsRef: React.MutableRefObject<WebSocket | null>;
    private dispatch: AppDispatch;
    private currentUserId: string;
    private processedMessageIds: Set<string>;
    private deliveryTimeouts: Map<string, TimeoutHandle>;
    private maxDeliveryAttempts: number;

    constructor(
        wsRef: React.MutableRefObject<WebSocket | null>,
        dispatch: AppDispatch,
        currentUserId: string
    ) {
        this.wsRef = wsRef;
        this.dispatch = dispatch;
        this.currentUserId = currentUserId;
        this.processedMessageIds = new Set();
        this.deliveryTimeouts = new Map();
        this.maxDeliveryAttempts = 3;
    }

    async processIncomingMessage(message: Message): Promise<void> {
        if (this.processedMessageIds.has(message.id)) {
            return;
        }

        try {
            switch (message.content) {
                case 'status_update':
                    await this.handleStatusUpdate(message);
                    break;
                case 'delivered':
                    await this.handleDeliveryConfirmation(message);
                    break;
                case 'read':
                    await this.handleReadReceipt(message);
                    break;
                default:
                    await this.handleRegularMessage(message);
            }

            this.processedMessageIds.add(message.id);
        } catch (error) {
            console.error('Error processing message:', error);
            throw error;
        }
    }

    async sendMessage(message: Message): Promise<void> {
        try {
            // First add to local state
            await this.dispatch(addMessageAsync(message)).unwrap();

            if (this.wsRef.current?.readyState === WebSocket.OPEN) {
                // Then send through WebSocket
                this.wsRef.current.send(JSON.stringify(message));
                this.setDeliveryTimeout(message);
            } else {
                // Queue if WebSocket is not available
                await this.dispatch(queueMessageAsync(message)).unwrap();
            }
        } catch (error) {
            console.error('Error sending message:', error);
            await this.dispatch(moveToFailedQueue(message.id));
            throw error;
        }
    }

    private setDeliveryTimeout(message: Message): void {
        // Clear any existing timeout for this message
        if (this.deliveryTimeouts.has(message.id)) {
            clearTimeout(this.deliveryTimeouts.get(message.id));
        }

        // Set new timeout
        const timeout = setTimeout(() => {
            this.handleDeliveryTimeout(message);
        }, 5000); // 5 seconds timeout

        this.deliveryTimeouts.set(message.id, timeout);
    }

    private async handleDeliveryTimeout(message: Message): Promise<void> {
        if (!message.delivered) {
            await this.dispatch(moveToFailedQueue(message.id));
        }
        this.deliveryTimeouts.delete(message.id);
    }

    private async handleStatusUpdate(message: Message): Promise<void> {
        // Status updates are handled by WebSocketManager
        return;
    }

    private async handleDeliveryConfirmation(message: Message): Promise<void> {
        const targetMessageId = message.id.startsWith('delivery_')
            ? message.id.replace('delivery_', '')
            : message.id;

        await this.dispatch(setMessageDelivered(targetMessageId));

        // Clear delivery timeout if exists
        if (this.deliveryTimeouts.has(targetMessageId)) {
            clearTimeout(this.deliveryTimeouts.get(targetMessageId));
            this.deliveryTimeouts.delete(targetMessageId);
        }
    }

    private async handleReadReceipt(message: Message): Promise<void> {
        // Extract the original message ID if it's a read receipt
        const targetMessageId = message.id.startsWith('read_')
            ? message.id.replace('read_', '')
            : message.id;

        await this.dispatch(setMessageRead(targetMessageId));

        // Clear delivery timeout if it exists
        if (this.deliveryTimeouts.has(targetMessageId)) {
            clearTimeout(this.deliveryTimeouts.get(targetMessageId));
            this.deliveryTimeouts.delete(targetMessageId);
        }
    }

    private async handleRegularMessage(message: Message): Promise<void> {
        await this.dispatch(addMessageAsync(message));

        // Send delivery confirmation if we're the recipient
        if (message.toId === this.currentUserId && this.wsRef.current) {
            const deliveryConfirmation: Message = {
                id: `delivery_${message.id}`,
                fromId: this.currentUserId,
                toId: message.fromId,
                content: 'delivered',
                timestamp: new Date().toISOString(),
                delivered: true,
                readStatus: false,
                status: 'sent'
            };

            this.wsRef.current.send(JSON.stringify(deliveryConfirmation));
        }
    }

    clearDeliveryTimeouts(): void {
        this.deliveryTimeouts.forEach(timeout => clearTimeout(timeout));
        this.deliveryTimeouts.clear();
    }
}