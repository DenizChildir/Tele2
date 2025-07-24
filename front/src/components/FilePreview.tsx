// FilePreview.tsx
import React, { useState, useEffect } from 'react';

interface FilePreviewProps {
    file: File | { url: string; name: string; type: string; size: number };
    isIncoming: boolean;
}

export const FilePreview: React.FC<FilePreviewProps> = ({ file, isIncoming }) => {
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (file instanceof File) {
            // Create object URL for File objects
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            setIsLoading(false);

            // Cleanup
            return () => URL.revokeObjectURL(url);
        } else if ('url' in file) {
            // Use provided URL
            setPreviewUrl(file.url);
            setIsLoading(false);
        }
    }, [file]);

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const handleDownload = () => {
        const a = document.createElement('a');
        a.href = previewUrl;
        a.download = file.name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const getFileIcon = (type: string) => {
        if (type.startsWith('image/')) return '🖼️';
        if (type.startsWith('video/')) return '🎥';
        if (type.startsWith('audio/')) return '🎵';
        if (type.includes('pdf')) return '📄';
        if (type.includes('zip') || type.includes('rar')) return '📦';
        if (type.includes('doc') || type.includes('docx')) return '📝';
        if (type.includes('xls') || type.includes('xlsx')) return '📊';
        return '📎';
    };

    if (isLoading) {
        return (
            <div className="file-preview-container">
                <div className="file-preview-loading">
                    <div className="spinner"></div>
                    <span>Loading preview...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="file-preview-container">
                <div className="file-preview-error">
                    <span>⚠️ {error}</span>
                </div>
            </div>
        );
    }

    // Image preview
    if (file.type.startsWith('image/')) {
        return (
            <div className="file-preview-container">
                <div className="file-preview-image">
                    <img
                        src={previewUrl}
                        alt={file.name}
                        onError={() => setError('Failed to load image')}
                        onClick={() => window.open(previewUrl, '_blank')}
                        title="Click to view full size"
                    />
                </div>
                <div className="file-preview-info">
                    <span className="file-preview-name">{file.name}</span>
                    <span className="file-preview-size">{formatFileSize(file.size)}</span>
                </div>
            </div>
        );
    }

    // Video preview
    if (file.type.startsWith('video/')) {
        return (
            <div className="file-preview-container">
                <div className="file-preview-video">
                    <video
                        controls
                        preload="metadata"
                        onError={() => setError('Failed to load video')}
                    >
                        <source src={previewUrl} type={file.type} />
                        Your browser does not support video playback.
                    </video>
                </div>
                <div className="file-preview-info">
                    <span className="file-preview-name">{file.name}</span>
                    <span className="file-preview-size">{formatFileSize(file.size)}</span>
                </div>
            </div>
        );
    }

    // Audio preview
    if (file.type.startsWith('audio/')) {
        return (
            <div className="file-preview-container">
                <div className="file-preview-audio">
                    <div className="audio-icon">🎵</div>
                    <audio
                        controls
                        preload="metadata"
                        onError={() => setError('Failed to load audio')}
                    >
                        <source src={previewUrl} type={file.type} />
                        Your browser does not support audio playback.
                    </audio>
                </div>
                <div className="file-preview-info">
                    <span className="file-preview-name">{file.name}</span>
                    <span className="file-preview-size">{formatFileSize(file.size)}</span>
                </div>
            </div>
        );
    }

    // Generic file preview (no preview available)
    return (
        <div className="file-preview-container">
            <div className="file-preview-generic">
                <div className="file-icon">{getFileIcon(file.type)}</div>
                <div className="file-details">
                    <span className="file-preview-name">{file.name}</span>
                    <span className="file-preview-size">{formatFileSize(file.size)}</span>
                </div>
            </div>
        </div>
    );
};