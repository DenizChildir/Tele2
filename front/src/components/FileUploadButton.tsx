// FileUploadButton.tsx
import React, { useRef } from 'react';
import { FileMetadata, MessageContentType } from '../types/types';

interface FileUploadButtonProps {
    onFileSelect: (file: File, type: MessageContentType) => void;
    disabled?: boolean;
}

export const FileUploadButton: React.FC<FileUploadButtonProps> = ({
                                                                      onFileSelect,
                                                                      disabled = false
                                                                  }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const determineMessageType = (file: File): MessageContentType => {
        if (file.type.startsWith('image/')) return 'image';
        if (file.type.startsWith('video/')) return 'video';
        return 'file';
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const contentType = determineMessageType(file);
        onFileSelect(file, contentType);

        // Reset input so the same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="flex items-center">
            <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                className="hidden"
                disabled={disabled}
                // Add accepted file types here if needed
                // accept="image/*,video/*,.pdf,.doc,.docx,.txt"
            />
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="p-2 text-gray-500 hover:text-gray-700 focus:outline-none disabled:opacity-50"
            >
                📎
            </button>
        </div>
    );
};