// Extend the existing FileSystemHandle interface
interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
}

// Define the FileSystemFileHandle interface
interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

// Define the interface for FileSystemWritableFileStream
interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | BufferSource | Blob): Promise<void>;
    seek(position: number): Promise<void>;
    truncate(size: number): Promise<void>;
}

// Define the complete FileSystemDirectoryHandle interface
interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory';
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    keys(): AsyncIterableIterator<string>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

// Update the Window interface to include showDirectoryPicker
declare global {
    interface Window {
        showDirectoryPicker(options?: {
            mode?: 'read' | 'readwrite';
            startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
        }): Promise<FileSystemDirectoryHandle>;
    }
}

export type {
    FileSystemHandle,
    FileSystemFileHandle,
    FileSystemDirectoryHandle,
    FileSystemWritableFileStream
};