// types.ts
export type MessageContentType = 'text' | 'file' | 'image' | 'video' | 'audio';
export type SignalingType = 'offer' | 'answer' | 'ice-candidate';

export interface FileMetadata {
    name: string;
    size: number;
    type: string;
    lastModified?: number;
}

export interface MessageContent {
    type: MessageContentType;
    text?: string;
    file?: FileMetadata;
}

// Interface for WebRTC signaling data
export interface SignalingContent {
    type: SignalingType;
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

// New interface for reply metadata
export interface ReplyMetadata {
    messageId: string;
    fromId: string;
    content: MessageContent | SignalingContent | string;
    timestamp: string;
}

export interface Message {
    id: string;
    fromId: string;
    toId: string;
    content: MessageContent | SignalingContent | string;
    timestamp: string;
    delivered: boolean;
    readStatus: boolean;
    status: 'sent' | 'delivered' | 'read';
    type?: SignalingType; // For backward compatibility with stored messages
    replyTo?: ReplyMetadata; // New field for reply information
}