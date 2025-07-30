// Updated WebRTCManager.tsx - Now stores files persistently
import React, { createContext, useContext, useRef, useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { useWebSocket } from './WebSocketManager';
import { FileTransferService, FileTransferMetadata } from '../service/FileTransferService';
import { addMessageAsync } from '../store/messageSlice';
import { Message, MessageContent } from '../types/types';
import { saveFileData, getFileData } from '../store/fileStorage';

interface SignalingMessage {
    messageType: 'webrtc_signaling';
    type: 'offer' | 'answer' | 'ice-candidate';
    fromId: string;
    toId: string;
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

interface FileTransferState {
    transferId: string;
    progress: number;
    status: 'pending' | 'transferring' | 'completed' | 'error';
}

interface ReceivedFile {
    file: File;
    url: string;
    timestamp: string;
}

interface WebRTCContextType {
    createConnection: (peerId: string) => Promise<boolean>;
    closeConnection: (peerId: string) => void;
    sendFile: (peerId: string, file: File) => Promise<string>;
    isConnected: (peerId: string) => boolean;
    transfers: Map<string, FileTransferState>;
    receivedFiles: Map<string, ReceivedFile>;
    getFileUrl: (messageId: string) => string | undefined;
}

interface PeerConnectionData {
    connection: RTCPeerConnection;
    dataChannel: RTCDataChannel | null;
    pendingCandidates: RTCIceCandidateInit[];
    isSettingRemoteDescription: boolean;
    hasRemoteDescription: boolean;
}

const WebRTCContext = createContext<WebRTCContextType>({
    createConnection: async () => false,
    closeConnection: () => {},
    sendFile: async () => '',
    isConnected: () => false,
    transfers: new Map(),
    receivedFiles: new Map(),
    getFileUrl: () => undefined
});

export const useWebRTC = () => {
    const context = useContext(WebRTCContext);
    if (!context) {
        throw new Error('useWebRTC must be used within WebRTCManager');
    }
    return context;
};

export const WebRTCManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { ws } = useWebSocket();
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const peerConnections = useRef<Map<string, PeerConnectionData>>(new Map());
    const fileTransferService = useRef(new FileTransferService());
    const [transfers, setTransfers] = useState<Map<string, FileTransferState>>(new Map());
    const [receivedFiles, setReceivedFiles] = useState<Map<string, ReceivedFile>>(new Map());

    // ICE server configuration - optimized for local testing
    const configuration: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    };

    // Load persisted file URLs on mount
    useEffect(() => {
        const loadPersistedFiles = async () => {
            // This will be called when the component mounts to check for any persisted files
            // The actual loading happens in the Chat component when it needs specific files
            console.log('[WebRTC] WebRTCManager initialized, file persistence ready');
        };

        loadPersistedFiles();
    }, []);

    useEffect(() => {
        if (!ws) return;

        const handleWebSocketMessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.messageType === 'webrtc_signaling') {
                    handleSignalingMessage(data);
                }
            } catch (error) {
                console.error('[WebRTC] Error processing message:', error);
            }
        };

        ws.addEventListener('message', handleWebSocketMessage);

        return () => {
            ws.removeEventListener('message', handleWebSocketMessage);
            // Cleanup all connections and object URLs
            receivedFiles.forEach(({ url }) => URL.revokeObjectURL(url));
            peerConnections.current.forEach((_, peerId) => {
                closeConnection(peerId);
            });
        };
    }, [ws, currentUserId]);

    const sendSignalingMessage = (message: Omit<SignalingMessage, 'messageType'>) => {
        if (ws?.readyState === WebSocket.OPEN) {
            const signaling: SignalingMessage = {
                messageType: 'webrtc_signaling',
                ...message
            };
            console.log('[WebRTC] Sending signaling message:', signaling);
            ws.send(JSON.stringify(signaling));
        }
    };

    const createPeerConnection = (peerId: string, isInitiator: boolean): PeerConnectionData => {
        console.log(`[WebRTC] Creating peer connection for ${peerId}, initiator: ${isInitiator}`);

        const peerConnection = new RTCPeerConnection(configuration);

        const peerData: PeerConnectionData = {
            connection: peerConnection,
            dataChannel: null,
            pendingCandidates: [],
            isSettingRemoteDescription: false,
            hasRemoteDescription: false
        };

        // Set up event handlers
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && currentUserId) {
                console.log('[WebRTC] Sending ICE candidate');
                sendSignalingMessage({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    fromId: currentUserId,
                    toId: peerId
                });
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state: ${peerConnection.connectionState} for ${peerId}`);
            if (peerConnection.connectionState === 'connected') {
                console.log(`[WebRTC] Peer connection established with ${peerId}`);
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] ICE connection state: ${peerConnection.iceConnectionState} for ${peerId}`);
            if (peerConnection.iceConnectionState === 'connected') {
                console.log(`[WebRTC] ICE connection established with ${peerId}`);
            } else if (peerConnection.iceConnectionState === 'failed') {
                console.log(`[WebRTC] ICE connection failed with ${peerId}, attempting restart`);
                restartIce(peerId);
            }
        };

        // Set up data channel
        if (isInitiator) {
            console.log(`[WebRTC] Creating data channel as initiator for ${peerId}`);
            peerData.dataChannel = peerConnection.createDataChannel('fileTransfer', {
                ordered: true,
                maxRetransmits: 3
            });
            setupDataChannel(peerData.dataChannel, peerId);
        } else {
            console.log(`[WebRTC] Waiting for data channel from ${peerId}`);
            peerConnection.ondatachannel = (event) => {
                console.log(`[WebRTC] Received data channel from ${peerId}`);
                peerData.dataChannel = event.channel;
                setupDataChannel(peerData.dataChannel, peerId);
            };
        }

        peerConnections.current.set(peerId, peerData);
        return peerData;
    };

    const setupDataChannel = (dataChannel: RTCDataChannel, peerId: string) => {
        let receivedChunks: Blob[] = [];
        let currentFileInfo: { name: string, type: string, size: number, transferId: string, messageId: string } | null = null;

        dataChannel.binaryType = 'arraybuffer';

        dataChannel.onopen = () => {
            console.log(`[WebRTC] Data channel opened for ${peerId}`);
        };

        dataChannel.onclose = () => {
            console.log(`[WebRTC] Data channel closed for ${peerId}`);
        };

        dataChannel.onerror = (error) => {
            console.error(`[WebRTC] Data channel error for ${peerId}:`, error);
        };

        dataChannel.onmessage = async (event) => {
            try {
                if (typeof event.data === 'string') {
                    const message = JSON.parse(event.data);
                    switch (message.type) {
                        case 'file-start':
                            currentFileInfo = {
                                name: message.name,
                                type: message.fileType,
                                size: message.size,
                                transferId: message.transferId,
                                messageId: message.messageId
                            };
                            receivedChunks = [];
                            updateTransferState(message.transferId || 'unknown', {
                                status: 'transferring',
                                progress: 0
                            });
                            console.log(`[WebRTC] Starting to receive file: ${currentFileInfo.name}`);
                            break;
                        case 'file-end':
                            if (currentFileInfo && receivedChunks.length > 0) {
                                console.log(`[WebRTC] Assembling received file: ${currentFileInfo.name}`);
                                const file = new File(receivedChunks, currentFileInfo.name, {
                                    type: currentFileInfo.type
                                });

                                // Create object URL for the file preview
                                const url = URL.createObjectURL(file);

                                // Store the received file with its message ID for preview
                                setReceivedFiles(prev => {
                                    const newFiles = new Map(prev);
                                    newFiles.set(currentFileInfo!.messageId, {
                                        file,
                                        url,
                                        timestamp: new Date().toISOString()
                                    });
                                    return newFiles;
                                });

                                // Save file to persistent storage
                                try {
                                    await saveFileData(currentFileInfo.messageId, file);
                                    console.log(`[WebRTC] File saved to persistent storage: ${currentFileInfo.messageId}`);
                                } catch (error) {
                                    console.error('[WebRTC] Error saving file to persistent storage:', error);
                                }

                                console.log(`[WebRTC] File stored with ID: ${currentFileInfo.messageId}`);

                                // AUTO-DOWNLOAD THE FILE
                                const downloadUrl = URL.createObjectURL(file);
                                const a = document.createElement('a');
                                a.href = downloadUrl;
                                a.download = file.name;
                                a.style.display = 'none';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(downloadUrl);

                                console.log(`[WebRTC] File auto-downloaded: ${file.name}`);

                                // Create a message for the received file
                                if (currentUserId) {
                                    const fileType = currentFileInfo.type.startsWith('image/') ? 'image' :
                                        currentFileInfo.type.startsWith('video/') ? 'video' :
                                            currentFileInfo.type.startsWith('audio/') ? 'audio' : 'file';

                                    const content: MessageContent = {
                                        type: fileType,
                                        file: {
                                            name: file.name,
                                            size: file.size,
                                            type: file.type,
                                            lastModified: file.lastModified
                                        }
                                    };

                                    const fileMessage: Message = {
                                        id: currentFileInfo.messageId,
                                        fromId: peerId,
                                        toId: currentUserId,
                                        content,
                                        timestamp: new Date().toISOString(),
                                        delivered: true,
                                        readStatus: false,
                                        status: 'delivered'
                                    };

                                    await dispatch(addMessageAsync(fileMessage));
                                }

                                updateTransferState(message.transferId || 'unknown', {
                                    status: 'completed',
                                    progress: 100
                                });
                                receivedChunks = [];
                                currentFileInfo = null;
                            }
                            break;
                    }
                } else {
                    // Binary data chunk
                    if (currentFileInfo) {
                        receivedChunks.push(new Blob([event.data]));
                        const receivedSize = receivedChunks.reduce((size, chunk) => size + chunk.size, 0);
                        const progress = (receivedSize / currentFileInfo.size) * 100;
                        updateTransferState('current', { progress });

                        if (receivedSize % (1024 * 100) === 0) { // Log every 100KB
                            console.log(`[WebRTC] Received ${Math.round(receivedSize/1024)}KB of ${Math.round(currentFileInfo.size/1024)}KB`);
                        }
                    }
                }
            } catch (error) {
                console.error('[WebRTC] Error handling data channel message:', error);
            }
        };
    };

    const restartIce = async (peerId: string) => {
        const peerData = peerConnections.current.get(peerId);
        if (!peerData || !currentUserId) return;

        try {
            const offer = await peerData.connection.createOffer({ iceRestart: true });
            await peerData.connection.setLocalDescription(offer);
            sendSignalingMessage({
                type: 'offer',
                offer,
                fromId: currentUserId,
                toId: peerId
            });
        } catch (error) {
            console.error('[WebRTC] Error restarting ICE:', error);
        }
    };

    const handleSignalingMessage = async (data: SignalingMessage) => {
        if (!currentUserId || data.toId !== currentUserId) return;

        const peerId = data.fromId;
        let peerData = peerConnections.current.get(peerId);

        try {
            switch (data.type) {
                case 'offer':
                    console.log(`[WebRTC] Handling offer from ${peerId}`);
                    if (!peerData) {
                        peerData = createPeerConnection(peerId, false);
                    }

                    peerData.isSettingRemoteDescription = true;
                    await peerData.connection.setRemoteDescription(new RTCSessionDescription(data.offer!));
                    peerData.hasRemoteDescription = true;
                    peerData.isSettingRemoteDescription = false;

                    // Process pending candidates
                    while (peerData.pendingCandidates.length > 0) {
                        const candidate = peerData.pendingCandidates.shift()!;
                        await peerData.connection.addIceCandidate(new RTCIceCandidate(candidate));
                    }

                    const answer = await peerData.connection.createAnswer();
                    await peerData.connection.setLocalDescription(answer);

                    sendSignalingMessage({
                        type: 'answer',
                        answer,
                        fromId: currentUserId,
                        toId: peerId
                    });
                    break;

                case 'answer':
                    console.log(`[WebRTC] Handling answer from ${peerId}`);
                    if (peerData && peerData.connection.signalingState === 'have-local-offer') {
                        peerData.isSettingRemoteDescription = true;
                        await peerData.connection.setRemoteDescription(new RTCSessionDescription(data.answer!));
                        peerData.hasRemoteDescription = true;
                        peerData.isSettingRemoteDescription = false;

                        // Process pending candidates
                        while (peerData.pendingCandidates.length > 0) {
                            const candidate = peerData.pendingCandidates.shift()!;
                            await peerData.connection.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                    }
                    break;

                case 'ice-candidate':
                    console.log(`[WebRTC] Handling ICE candidate from ${peerId}`);
                    if (peerData) {
                        const candidate = new RTCIceCandidate(data.candidate!);

                        if (peerData.isSettingRemoteDescription || !peerData.hasRemoteDescription) {
                            peerData.pendingCandidates.push(data.candidate!);
                        } else if (peerData.connection.remoteDescription) {
                            await peerData.connection.addIceCandidate(candidate);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('[WebRTC] Error handling signaling message:', error);
        }
    };

    const createConnection = async (peerId: string): Promise<boolean> => {
        if (!currentUserId || !ws || ws.readyState !== WebSocket.OPEN) {
            console.error('[WebRTC] Cannot create connection - missing requirements');
            return false;
        }

        if (peerId === currentUserId) {
            console.error('[WebRTC] Cannot connect to self');
            return false;
        }

        try {
            console.log(`[WebRTC] Creating connection to ${peerId}`);
            const peerData = createPeerConnection(peerId, true);

            const offer = await peerData.connection.createOffer();
            await peerData.connection.setLocalDescription(offer);

            sendSignalingMessage({
                type: 'offer',
                offer,
                fromId: currentUserId,
                toId: peerId
            });

            // Wait for connection to be established
            return new Promise((resolve) => {
                let isResolved = false;

                const resolveOnce = (value: boolean) => {
                    if (!isResolved) {
                        isResolved = true;
                        resolve(value);
                    }
                };

                // Check multiple connection states
                const checkConnection = setInterval(() => {
                    console.log(`[WebRTC] Connection state: ${peerData.connection.connectionState}, ICE: ${peerData.connection.iceConnectionState}, DataChannel: ${peerData.dataChannel?.readyState}`);

                    if (peerData.dataChannel?.readyState === 'open') {
                        console.log('[WebRTC] Data channel is open - connection successful');
                        clearInterval(checkConnection);
                        resolveOnce(true);
                    } else if (peerData.connection.connectionState === 'connected' &&
                        peerData.connection.iceConnectionState === 'connected') {
                        // Sometimes data channel takes a moment to open after connection
                        setTimeout(() => {
                            if (peerData.dataChannel?.readyState === 'open') {
                                console.log('[WebRTC] Data channel opened after connection');
                                clearInterval(checkConnection);
                                resolveOnce(true);
                            }
                        }, 1000);
                    } else if (peerData.connection.connectionState === 'failed' ||
                        peerData.connection.iceConnectionState === 'failed') {
                        console.log('[WebRTC] Connection failed');
                        clearInterval(checkConnection);
                        resolveOnce(false);
                    }
                }, 500);

                // More generous timeout for single machine testing
                setTimeout(() => {
                    console.log('[WebRTC] Connection attempt timed out');
                    clearInterval(checkConnection);
                    resolveOnce(false);
                }, 60000); // 60 seconds for single machine testing
            });
        } catch (error) {
            console.error('[WebRTC] Error creating connection:', error);
            return false;
        }
    };

    const closeConnection = (peerId: string) => {
        const peerData = peerConnections.current.get(peerId);
        if (peerData) {
            if (peerData.dataChannel) {
                peerData.dataChannel.close();
            }
            peerData.connection.close();
            peerConnections.current.delete(peerId);
        }
    };

    const isConnected = (peerId: string): boolean => {
        const peerData = peerConnections.current.get(peerId);
        return peerData?.dataChannel?.readyState === 'open';
    };

    const sendFile = async (peerId: string, file: File) => {
        let peerData = peerConnections.current.get(peerId);

        if (!peerData?.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.log('[WebRTC] No open data channel, creating connection');
            const connected = await createConnection(peerId);
            if (!connected) {
                throw new Error('Failed to establish connection');
            }
            peerData = peerConnections.current.get(peerId);
        }

        if (!peerData?.dataChannel || peerData.dataChannel.readyState !== 'open') {
            throw new Error('Data channel not available');
        }

        try {
            const transferId = crypto.randomUUID();
            const messageId = crypto.randomUUID();
            updateTransferState(transferId, { status: 'transferring', progress: 0 });

            // Store the sent file for preview
            const url = URL.createObjectURL(file);
            setReceivedFiles(prev => {
                const newFiles = new Map(prev);
                newFiles.set(messageId, {
                    file,
                    url,
                    timestamp: new Date().toISOString()
                });
                return newFiles;
            });

            // Save the sent file to persistent storage as well
            try {
                await saveFileData(messageId, file);
                console.log(`[WebRTC] Sent file saved to persistent storage: ${messageId}`);
            } catch (error) {
                console.error('[WebRTC] Error saving sent file to persistent storage:', error);
            }

            // Send file start message with message ID
            peerData.dataChannel.send(JSON.stringify({
                type: 'file-start',
                name: file.name,
                fileType: file.type,
                size: file.size,
                transferId,
                messageId
            }));

            // Send file in chunks
            const chunkSize = 16384; // 16KB
            let offset = 0;
            const reader = new FileReader();

            const readChunk = (start: number): Promise<void> => {
                return new Promise((resolve, reject) => {
                    const chunk = file.slice(start, start + chunkSize);
                    reader.onload = (e) => {
                        if (e.target?.result && peerData?.dataChannel?.readyState === 'open') {
                            peerData.dataChannel.send(e.target.result as ArrayBuffer);
                            const progress = Math.min(((start + chunkSize) / file.size) * 100, 100);
                            updateTransferState(transferId, { progress });
                            resolve();
                        } else {
                            reject(new Error('Data channel closed during transfer'));
                        }
                    };
                    reader.onerror = () => reject(reader.error);
                    reader.readAsArrayBuffer(chunk);
                });
            };

            while (offset < file.size) {
                await readChunk(offset);
                offset += chunkSize;

                // Small delay to prevent overwhelming the channel
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Send file end message
            peerData.dataChannel.send(JSON.stringify({
                type: 'file-end',
                transferId,
                messageId
            }));

            updateTransferState(transferId, { status: 'completed', progress: 100 });
            console.log('[WebRTC] File transfer completed');

            // Return the message ID so the chat can use it
            return messageId;
        } catch (error) {
            console.error('[WebRTC] Error sending file:', error);
            throw error;
        }
    };

    const updateTransferState = (transferId: string, update: Partial<FileTransferState>) => {
        setTransfers(prev => {
            const newTransfers = new Map(prev);
            const currentState = prev.get(transferId) || {
                transferId,
                progress: 0,
                status: 'pending' as const
            };
            newTransfers.set(transferId, { ...currentState, ...update });
            return newTransfers;
        });
    };

    const getFileUrl = (messageId: string): string | undefined => {
        const receivedFile = receivedFiles.get(messageId);
        return receivedFile?.url;
    };

    const contextValue = {
        createConnection,
        closeConnection,
        sendFile,
        isConnected,
        transfers,
        receivedFiles,
        getFileUrl
    };

    return (
        <WebRTCContext.Provider value={contextValue}>
            {children}
        </WebRTCContext.Provider>
    );
};