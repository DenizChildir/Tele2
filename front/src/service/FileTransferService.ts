// FileTransferService.ts
const CHUNK_SIZE = 16384; // 16KB chunks

export interface FileTransferMetadata {
    id: string;
    name: string;
    type: string;
    size: number;
    totalChunks: number;
}

interface FileTransferProgress {
    metadata: FileTransferMetadata;
    receivedChunks: Set<number>;
    chunks: ArrayBuffer[];
    onProgress?: (progress: number) => void;
}

export class FileTransferService {
    private activeTransfers = new Map<string, FileTransferProgress>();

    async prepareFileTransfer(file: File): Promise<FileTransferMetadata> {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        return {
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type,
            size: file.size,
            totalChunks
        };
    }

    async* getFileChunks(file: File, metadata: FileTransferMetadata) {
        const reader = new FileReader();
        let offset = 0;
        let chunkIndex = 0;

        while (offset < file.size) {
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(chunk);
            });

            yield {
                transferId: metadata.id,
                chunkIndex,
                totalChunks: metadata.totalChunks,
                data: buffer
            };

            offset += CHUNK_SIZE;
            chunkIndex++;
        }
    }

    initializeReceiver(
        metadata: FileTransferMetadata,
        onProgress?: (progress: number) => void
    ) {
        this.activeTransfers.set(metadata.id, {
            metadata,
            receivedChunks: new Set(),
            chunks: new Array(metadata.totalChunks),
            onProgress
        });
    }

    processChunk(transferId: string, chunkIndex: number, chunkData: ArrayBuffer): number {
        const transfer = this.activeTransfers.get(transferId);
        if (!transfer) return 0;

        transfer.chunks[chunkIndex] = chunkData;
        transfer.receivedChunks.add(chunkIndex);

        const progress = (transfer.receivedChunks.size / transfer.metadata.totalChunks) * 100;
        transfer.onProgress?.(progress);

        return progress;
    }

    isTransferComplete(transferId: string): boolean {
        const transfer = this.activeTransfers.get(transferId);
        if (!transfer) return false;

        return transfer.receivedChunks.size === transfer.metadata.totalChunks;
    }

    async assembleFile(transferId: string): Promise<File | null> {
        const transfer = this.activeTransfers.get(transferId);
        if (!transfer || !this.isTransferComplete(transferId)) {
            return null;
        }

        const blob = new Blob(transfer.chunks, { type: transfer.metadata.type });
        const file = new File([blob], transfer.metadata.name, {
            type: transfer.metadata.type,
            lastModified: Date.now()
        });

        // Clean up the transfer data
        this.activeTransfers.delete(transferId);

        return file;
    }

    cancelTransfer(transferId: string) {
        this.activeTransfers.delete(transferId);
    }
}