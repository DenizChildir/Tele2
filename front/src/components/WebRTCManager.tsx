// WebRTCManager.tsx
import React, { createContext, useContext, useRef, useEffect, useState } from 'react';
import { useAppSelector } from '../hooks/redux';
import { useWebSocket } from './WebSocketManager';
import { FileTransferService, FileTransferMetadata } from '../service/FileTransferService';
import {MessageContent} from "../types/types";

interface SignalingMessage {
    messageType: 'webrtc_signaling';  // Discriminator field
    type: 'offer' | 'answer' | 'ice-candidate';
    fromId: string;
    toId: string;
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

interface ChatMessage {
    messageType: 'chat';  // Discriminator field
    id: string;
    fromId: string;
    toId: string;
    content: MessageContent | string;
    timestamp: string;
    delivered: boolean;
    readStatus: boolean;
    status: 'sent' | 'delivered' | 'read';
}

interface FileTransferState {
    transferId: string;
    progress: number;
    status: 'pending' | 'transferring' | 'completed' | 'error';
}

interface WebRTCContextType {
    createConnection: (peerId: string) => void;
    closeConnection: (peerId: string) => void;
    sendFile: (peerId: string, file: File) => Promise<void>;
    isConnected: (peerId: string) => boolean;
    transfers: Map<string, FileTransferState>;
}

interface PeerConnectionState {
    promise: Promise<boolean>;
    resolve: (value: boolean) => void;
    reject: (reason?: any) => void;
}

interface RTCPeerData {
    connection: RTCPeerConnection;
    dataChannel: RTCDataChannel | null;
    isInitiator: boolean;
    pendingCandidates: RTCIceCandidateInit[]; // Add this for queuing candidates
}
function isSignalingMessage(message: any): message is SignalingMessage {
    return message && message.messageType === 'webrtc_signaling';
}

const WebRTCContext = createContext<WebRTCContextType>({
    createConnection: () => {},
    closeConnection: () => {},
    sendFile: async () => {},
    isConnected: () => false,
    transfers: new Map()
});

export const useWebRTC = () => {
    const context = useContext(WebRTCContext);
    console.log('[WebRTC-Context] useWebRTC hook called', {
        contextAvailable: !!context,
        hasCreateConnection: !!context?.createConnection,
        hasIsConnected: !!context?.isConnected,
        hasSendFile: !!context?.sendFile
    });

    if (!context) {
        console.error('[WebRTC-Context] WebRTC context is undefined - component might be outside WebRTCManager');
        throw new Error('useWebRTC must be used within WebRTCManager');
    }

    return context;
};

interface RTCPeerData {
    connection: RTCPeerConnection;
    dataChannel: RTCDataChannel | null;
    isInitiator: boolean;
}

const logIceCandidates = (candidate: RTCIceCandidateInit | null) => {
    if (!candidate) return;

    const { candidate: candStr, sdpMLineIndex, sdpMid } = candidate;
    console.log('[WebRTC] ICE Candidate:', {
        candidate: candStr,
        sdpMLineIndex,
        sdpMid,
        parsed: candStr ? parseCandidateSDP(candStr) : null
    });
};

const parseCandidateSDP = (candidateString: string) => {
    const parts = candidateString.split(' ');
    return {
        foundation: parts[0],
        component: parts[1],
        protocol: parts[2],
        priority: parts[3],
        ip: parts[4],
        port: parts[5],
        type: parts[7]
    };
};

export const WebRTCManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    console.log('[WebRTC-Init] WebRTCManager component mounting');
    const { ws } = useWebSocket();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const peerConnections = useRef<Map<string, RTCPeerData>>(new Map());
    const fileTransferService = useRef(new FileTransferService());
    const [transfers, setTransfers] = useState<Map<string, FileTransferState>>(new Map());
    const connectionStates = useRef<Map<string, PeerConnectionState>>(new Map());

    useEffect(() => {
        console.log('[WebRTC-Init] WebRTCManager mounted', {
            wsAvailable: !!ws,
            currentUserId,
            existingConnections: peerConnections.current.size
        });

        return () => {
            console.log('[WebRTC-Cleanup] WebRTCManager unmounting');
        };
    }, []);
    // Add initialization logging
    useEffect(() => {
        console.log('[WebRTC-Init] WebRTCManager effect running', {
            wsAvailable: !!ws,
            currentUserId,
            existingConnections: peerConnections.current.size
        });
    }, [ws, currentUserId]);

    useEffect(() => {
        console.log('[WebRTC-WebSocket] WebSocket state change', {
            wsAvailable: !!ws,
            wsState: ws?.readyState
        });
    }, [ws]);


    useEffect(() => {
        const handleWebSocketMessage = (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            if (['offer', 'answer', 'ice-candidate'].includes(data.type)) {
                handleSignalingMessage(data);
            }
        };

        if (ws) {
            ws.addEventListener('message', handleWebSocketMessage);
        }

        return () => {
            if (ws) {
                ws.removeEventListener('message', handleWebSocketMessage);
            }
            // Close all connections when component unmounts
            peerConnections.current.forEach((_, peerId) => {
                closeConnection(peerId);
            });
        };
    }, [ws, currentUserId]);

    const handleWebSocketMessage = (event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            console.log('[WebRTC] Received message:', data);

            // Only handle signaling messages
            if (isSignalingMessage(data)) {
                console.log('[WebRTC] Processing signaling message:', data);
                handleSignalingMessage(data);
            }
        } catch (error) {
            console.error('[WebRTC] Error processing message:', error);
        }
    };
    const sendSignalingMessage = (message: Omit<SignalingMessage, 'messageType'>) => {
        if (ws?.readyState === WebSocket.OPEN) {
            const signaling: SignalingMessage = {
                messageType: 'webrtc_signaling',
                ...message
            };
            console.log('[WebRTC] Sending signaling message:', signaling);
            ws.send(JSON.stringify(signaling));
        } else {
            console.error('[WebRTC] WebSocket not ready for sending');
        }
    };

    // ICE server configuration
    const configuration: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all' as RTCIceTransportPolicy,
        bundlePolicy: 'max-bundle' as RTCBundlePolicy,
        rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
    };

    const waitForConnection = (peerId: string, timeout = 20000): Promise<boolean> => {
        console.log('[WebRTC-Flow] waitForConnection started for peer:', peerId);

        if (connectionStates.current.has(peerId)) {
            console.log('[WebRTC-Flow] Existing connection attempt found for peer:', peerId);
            return connectionStates.current.get(peerId)!.promise;
        }

        let timeoutId: NodeJS.Timeout;

        const promise = new Promise<boolean>((resolve, reject) => {
            console.log('[WebRTC-Flow] Creating new connection promise for peer:', peerId);

            timeoutId = setTimeout(() => {
                console.error('[WebRTC-Error] Connection attempt timed out for peer:', peerId);
                reject(new Error('Connection timeout'));
                connectionStates.current.delete(peerId);
            }, timeout);

            const state: PeerConnectionState = {
                promise,
                resolve: (value: boolean) => {
                    console.log('[WebRTC-Flow] Connection promise resolved:', value);
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (reason?: any) => {
                    console.error('[WebRTC-Error] Connection promise rejected:', reason);
                    clearTimeout(timeoutId);
                    reject(reason);
                }
            };

            connectionStates.current.set(peerId, state);
        });

        return promise;
    };

    const createPeerConnection = (peerId: string, isInitiator: boolean): RTCPeerConnection => {
        if (!currentUserId) {
            throw new Error('Cannot create peer connection without user ID');
        }
        const userId: string = currentUserId;

        console.log(`[WebRTC] Creating peer connection. Initiator: ${isInitiator}, Peer: ${peerId}`);
        const peerConnection = new RTCPeerConnection(configuration);

        // Add connection state logging
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] ICE Connection state changed to: ${peerConnection.iceConnectionState} for peer: ${peerId}`);
        };

        peerConnection.onicegatheringstatechange = () => {
            console.log(`[WebRTC] ICE Gathering state changed to: ${peerConnection.iceGatheringState} for peer: ${peerId}`);
        };

        peerConnection.onsignalingstatechange = () => {
            console.log(`[WebRTC] Signaling state changed to: ${peerConnection.signalingState} for peer: ${peerId}`);
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state changed to: ${peerConnection.connectionState} for peer: ${peerId}`);
            if (peerConnection.connectionState === 'failed') {
                const state = connectionStates.current.get(peerId);
                if (state) {
                    state.reject(new Error('Connection failed'));
                    connectionStates.current.delete(peerId);
                }
                // Try reconnecting
                console.log(`[WebRTC] Attempting to reconnect to peer: ${peerId}`);
                retryConnection(peerId, isInitiator);
            }
        };

        let dataChannel: RTCDataChannel | null = null;

        if (isInitiator) {
            console.log(`[WebRTC] Creating data channel as initiator for peer: ${peerId}`);
            dataChannel = peerConnection.createDataChannel('fileTransfer', {
                ordered: true,
                maxRetransmits: 3
            });
            setupDataChannel(dataChannel, peerId);
        }

        peerConnection.ondatachannel = (event) => {
            console.log(`[WebRTC] Received data channel from peer: ${peerId}`);
            dataChannel = event.channel;
            setupDataChannel(dataChannel, peerId);
        };

        peerConnection.onicecandidate = (event) => {
            logIceCandidates(event.candidate);
            if (event.candidate) {
                console.log(`[WebRTC] Local ICE candidate generated for peer: ${peerId}`);
                sendSignalingMessage({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    fromId: userId,
                    toId: peerId
                });
            }
        };

        // Store the connection with pending candidates array
        peerConnections.current.set(peerId, {
            connection: peerConnection,
            dataChannel,
            isInitiator,
            pendingCandidates: [] // Initialize empty queue
        });

        return peerConnection;
    };

    const retryConnection = async (peerId: string, isInitiator: boolean) => {
        console.log(`[WebRTC] Retrying connection to peer: ${peerId}`);
        // Close existing connection
        closeConnection(peerId);

        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try to establish a new connection
        try {
            await createConnection(peerId);
        } catch (error) {
            console.error(`[WebRTC] Retry connection failed:`, error);
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

    const setupDataChannel = (dataChannel: RTCDataChannel, peerId: string) => {
        dataChannel.binaryType = 'arraybuffer';

        dataChannel.onopen = () => {
            console.log(`[WebRTC] Data channel opened for peer: ${peerId}`);
            const state = connectionStates.current.get(peerId);
            if (state) {
                state.resolve(true);
                connectionStates.current.delete(peerId);
            }
        };

        dataChannel.onclose = () => {
            console.log(`[WebRTC] Data channel closed for peer: ${peerId}`);
        };

        dataChannel.onerror = (error) => {
            console.error(`[WebRTC] Data channel error for peer: ${peerId}:`, error);
            const state = connectionStates.current.get(peerId);
            if (state) {
                state.reject(error);
                connectionStates.current.delete(peerId);
            }
        };

        dataChannel.onmessage = async (event) => {
            try {
                if (event.data instanceof ArrayBuffer) {
                    // Handle chunk data
                    const view = new DataView(event.data);
                    const transferId = view.getUint32(0);
                    const chunkIndex = view.getUint32(4);
                    const chunkData = event.data.slice(8);

                    const progress = fileTransferService.current.processChunk(
                        transferId.toString(),
                        chunkIndex,
                        chunkData
                    );

                    updateTransferState(transferId.toString(), { progress });

                    if (fileTransferService.current.isTransferComplete(transferId.toString())) {
                        const file = await fileTransferService.current.assembleFile(transferId.toString());
                        if (file) {
                            updateTransferState(transferId.toString(), {
                                status: 'completed',
                                progress: 100
                            });
                        }
                    }
                } else {
                    // Handle control messages
                    const message = JSON.parse(event.data);
                    if (message.type === 'file-metadata') {
                        fileTransferService.current.initializeReceiver(
                            message.metadata,
                            (progress) => updateTransferState(message.metadata.id, { progress })
                        );
                        updateTransferState(message.metadata.id, { status: 'transferring' });
                    }
                }
            } catch (error) {
                console.error('Error processing received data:', error);
            }
        };

        dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
        };
    };

    const handleSignalingMessage = async (data: any) => {
        if (!currentUserId || data.toId !== currentUserId) return;

        const peerId = data.fromId;
        let peerData = peerConnections.current.get(peerId);

        try {
            switch (data.type) {
                case 'offer':
                    console.log(`[WebRTC] Processing offer from peer: ${peerId}`);
                    if (!peerData) {
                        const peerConnection = createPeerConnection(peerId, false);
                        peerData = peerConnections.current.get(peerId)!;
                    }
                    await peerData.connection.setRemoteDescription(new RTCSessionDescription(data.offer));

                    // Process any pending ICE candidates
                    console.log(`[WebRTC] Processing ${peerData.pendingCandidates.length} pending candidates`);
                    for (const candidate of peerData.pendingCandidates) {
                        await peerData.connection.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                    peerData.pendingCandidates = []; // Clear the queue

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
                    console.log(`[WebRTC] Processing answer from peer: ${peerId}`);
                    if (peerData) {
                        await peerData.connection.setRemoteDescription(new RTCSessionDescription(data.answer));

                        // Process any pending ICE candidates
                        console.log(`[WebRTC] Processing ${peerData.pendingCandidates.length} pending candidates`);
                        for (const candidate of peerData.pendingCandidates) {
                            await peerData.connection.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                        peerData.pendingCandidates = []; // Clear the queue
                    }
                    break;

                case 'ice-candidate':
                    console.log(`[WebRTC] Received ICE candidate from peer: ${peerId}`);
                    if (peerData) {
                        try {
                            // Check if we can add the candidate immediately
                            if (peerData.connection.remoteDescription) {
                                await peerData.connection.addIceCandidate(new RTCIceCandidate(data.candidate));
                                console.log(`[WebRTC] Added ICE candidate immediately`);
                            } else {
                                // Queue the candidate for later
                                console.log(`[WebRTC] Queueing ICE candidate for later`);
                                peerData.pendingCandidates.push(data.candidate);
                            }
                        } catch (error) {
                            console.error('[WebRTC] Error handling ICE candidate:', error);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('[WebRTC] Error in signaling message handler:', error);
        }
    };



    // WebRTCManager.tsx
    const createConnection = async (peerId: string): Promise<boolean> => {
        console.log('[WebRTC-Connection] Creating connection', {
            peerId,
            currentUserId,
            wsAvailable: !!ws,
            wsState: ws?.readyState
        });

        if (!currentUserId) {
            console.error('[WebRTC-Error] No currentUserId available');
            return false;
        }

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('[WebRTC-Error] WebSocket not available or not open', {
                wsAvailable: !!ws,
                wsState: ws?.readyState
            });
            return false;
        }

        try {
            if (peerConnections.current.has(peerId)) {
                console.log('[WebRTC-Connection] Existing connection found, checking state');
                const existingConnection = peerConnections.current.get(peerId);
                console.log('[WebRTC-Connection] Existing connection state:', {
                    connectionState: existingConnection?.connection.connectionState,
                    iceConnectionState: existingConnection?.connection.iceConnectionState,
                    signalingState: existingConnection?.connection.signalingState
                });
            }

            const peerConnection = createPeerConnection(peerId, true);

            // Create and send the offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            console.log('[WebRTC-Connection] Sending offer', {
                offerType: offer.type,
                sdpLength: offer.sdp?.length
            });

            sendSignalingMessage({
                type: 'offer' as const,
                fromId: currentUserId,
                toId: peerId,
                offer
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error('[WebRTC-Error] Connection attempt timed out');
                    reject(new Error('Connection timeout'));
                }, 20000);

                const checkConnection = setInterval(() => {
                    const conn = peerConnections.current.get(peerId);
                    if (conn?.connection.connectionState === 'connected') {
                        clearTimeout(timeout);
                        clearInterval(checkConnection);
                        resolve(true);
                    } else if (conn?.connection.connectionState === 'failed') {
                        clearTimeout(timeout);
                        clearInterval(checkConnection);
                        reject(new Error('Connection failed'));
                    }
                }, 500);
            });
        } catch (error) {
            console.error('[WebRTC-Error] Connection error:', error);
            return false;
        }
    };

    const getConnectionState = (peerId: string) => {
        const conn = peerConnections.current.get(peerId);
        if (!conn) return null;

        return {
            connectionState: conn.connection.connectionState,
            iceConnectionState: conn.connection.iceConnectionState,
            signalingState: conn.connection.signalingState,
            hasDataChannel: !!conn.dataChannel,
            dataChannelState: conn.dataChannel?.readyState
        };
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
        const connected = peerData?.dataChannel?.readyState === 'open';

        console.log('[WebRTC-State] Connection check', {
            peerId,
            hasConnection: !!peerData,
            dataChannelState: peerData?.dataChannel?.readyState,
            connected
        });

        return connected;
    };

    const sendFile = async (peerId: string, file: File) => {
        console.log(`[WebRTC] Attempting to send file to peer: ${peerId}`);
        let peerData = peerConnections.current.get(peerId);

        // If no connection or data channel isn't open, try to establish one
        if (!peerData?.dataChannel || peerData.dataChannel.readyState !== 'open') {
            console.log(`[WebRTC] No open data channel, attempting to establish connection`);
            const isConnected = await createConnection(peerId);
            if (!isConnected) {
                console.error(`[WebRTC] Failed to establish connection with peer: ${peerId}`);
                throw new Error('Could not establish peer connection for file transfer');
            }

            // Get the updated peer data after connection
            peerData = peerConnections.current.get(peerId);
            if (!peerData?.dataChannel || peerData.dataChannel.readyState !== 'open') {
                throw new Error('Data channel not available after connection');
            }
        }

        try {
            console.log(`[WebRTC] Starting file transfer to peer: ${peerId}`);
            const metadata = await fileTransferService.current.prepareFileTransfer(file);
            const { dataChannel } = peerData;

            // Send file metadata
            dataChannel.send(JSON.stringify({
                type: 'file-metadata',
                metadata
            }));

            updateTransferState(metadata.id, { status: 'transferring' });

            // Send file chunks
            for await (const chunk of fileTransferService.current.getFileChunks(file, metadata)) {
                // Check data channel state before each chunk
                if (dataChannel.readyState !== 'open') {
                    throw new Error('Data channel closed during transfer');
                }

                // Create a buffer that includes transfer ID and chunk index
                const buffer = new ArrayBuffer(8 + chunk.data.byteLength);
                const view = new DataView(buffer);
                view.setUint32(0, parseInt(metadata.id)); // Transfer ID
                view.setUint32(4, chunk.chunkIndex);     // Chunk index

                // Copy chunk data
                new Uint8Array(buffer, 8).set(new Uint8Array(chunk.data));

                dataChannel.send(buffer);

                updateTransferState(metadata.id, {
                    progress: (chunk.chunkIndex / chunk.totalChunks) * 100
                });

                // Add a small delay to prevent overwhelming the data channel
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            console.log(`[WebRTC] File transfer completed to peer: ${peerId}`);
            updateTransferState(metadata.id, { status: 'completed', progress: 100 });
        } catch (error) {
            console.error(`[WebRTC] Error during file transfer:`, error);
            throw error;
        }
    };


    const contextValue = {
        createConnection,
        closeConnection,
        sendFile,
        isConnected,
        transfers
    };

    console.log('[WebRTC-Context] Providing context', {
        hasCreateConnection: !!contextValue.createConnection,
        hasIsConnected: !!contextValue.isConnected,
        hasSendFile: !!contextValue.sendFile
    });

    return (
        <WebRTCContext.Provider value={contextValue}>
            {children}
        </WebRTCContext.Provider>
    );
};