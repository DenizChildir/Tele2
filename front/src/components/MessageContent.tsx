import React from 'react';
import { MessageContent, SignalingContent, MessageContentType, FileMetadata } from '../types/types';
import styles from '../styles/modules/MessageContent.module.css';

interface MessageContentProps {
    content: MessageContent | SignalingContent | string;
}

interface FilePreviewProps {
    file: FileMetadata;
    type: MessageContentType;
}

const FilePreview: React.FC<FilePreviewProps> = ({ file, type }) => {
    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const getIconText = () => {
        switch (type) {
            case 'image':
                return '📷';
            case 'video':
                return '🎥';
            default:
                return '📄';
        }
    };

    return (
        <div className={styles.filePreview}>
            <span className={styles.iconText}>{getIconText()}</span>
            <div className={styles.fileInfo}>
                <span className={styles.fileName}>
                    {file.name}
                </span>
                <span className={styles.fileSize}>
                    {formatFileSize(file.size)}
                </span>
            </div>
        </div>
    );
};

const isSignalingContent = (content: any): content is SignalingContent => {
    return content &&
        typeof content === 'object' &&
        'type' in content &&
        ['offer', 'answer', 'ice-candidate'].includes(content.type);
};

const isMessageContent = (content: any): content is MessageContent => {
    return content &&
        typeof content === 'object' &&
        'type' in content &&
        ['text', 'file', 'image', 'video'].includes(content.type);
};

export const MessageContentDisplay: React.FC<MessageContentProps> = ({ content }) => {
    console.log('Rendering message content:', content);

    if (typeof content === 'string') {
        return <span className={styles.messageContent}>{content}</span>;
    }

    if (isSignalingContent(content)) {
        console.log('Skipping render of WebRTC signaling message:', content);
        return null;
    }

    if (isMessageContent(content)) {
        switch (content.type) {
            case 'text':
                return <span className={styles.messageContent}>{content.text}</span>;

            case 'file':
            case 'image':
            case 'video':
                if (content.file) {
                    return <FilePreview file={content.file} type={content.type} />;
                }
                return <span className={styles.messageContent}>Invalid file message</span>;

            default:
                console.warn('Unknown message content type:', content);
                return <span className={styles.messageContent}>Unsupported message type</span>;
        }
    }

    console.warn('Unhandled message content format:', content);
    return <span className={styles.messageContent}>Invalid message format</span>;
};