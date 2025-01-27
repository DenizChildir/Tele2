import React, { useState, useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from './store/store';
import ServerConfig from './components/ServerConfig';
import { UserSetup } from './components/UserSetup';
import { Chat } from './components/chat';
import { useAppSelector, useAppDispatch } from './hooks/redux';
import { UserMenu } from './components/UserMenu';
import { ConnectUser } from './components/ConnectUser';
import { DataManager } from './components/DataManagment';
import { WebSocketManager } from './components/WebSocketManager';
import { WebRTCManager } from './components/WebRTCManager';
import { initializeStorage } from './store/fileStorage';
import { initializeAllMessagesAsync } from './store/messageSlice';
import './App.css';

interface StorageState {
    isInitialized: boolean;
    error: string | null;
    hasPermission: boolean;
}

const InitializationScreen = ({
                                  error,
                                  onInitialize
                              }: {
    error: string | null;
    onInitialize: () => void;
}) => (
    <div className="initialization-screen">
        <h2>Welcome to Chat App</h2>
        <p>To get started, please select a directory where your chat messages will be stored.</p>
        {error ? (
            <div className="error-container">
                <p>{error}</p>
                <button onClick={onInitialize}>Try Again</button>
            </div>
        ) : (
            <button onClick={onInitialize}>Select Storage Directory</button>
        )}
    </div>
);

const AppContent = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const [storageState, setStorageState] = useState<StorageState>({
        isInitialized: false,
        error: null,
        hasPermission: false
    });
    const [showConfig, setShowConfig] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);

    const toggleConfig = (e: React.MouseEvent) => {
        e.preventDefault();
        setShowConfig(!showConfig);
    };

    const handleInitialize = async () => {
        try {
            await initializeStorage();
            setStorageState({
                isInitialized: true,
                error: null,
                hasPermission: true
            });
        } catch (error) {
            console.error('Storage initialization error:', error);
            const errorMessage = error instanceof Error && error.name === 'NotAllowedError'
                ? 'Permission to access file system was denied. Please try again.'
                : 'Failed to initialize storage system. Please try again.';

            setStorageState({
                isInitialized: false,
                error: errorMessage,
                hasPermission: false
            });
        }
    };

    useEffect(() => {
        const loadAllMessages = async () => {
            if (!currentUserId || isLoadingMessages) return;

            setIsLoadingMessages(true);
            try {
                await dispatch(initializeAllMessagesAsync(currentUserId)).unwrap();
            } catch (error) {
                console.error('Error loading all messages:', error);
            } finally {
                setIsLoadingMessages(false);
            }
        };

        loadAllMessages();
    }, [currentUserId, dispatch]);

    return (
        <div className="app-container">
            <button
                onClick={toggleConfig}
                className="config-button"
            >
                ⚙️
            </button>

            {showConfig && (
                <div className="config-overlay">
                    <div className="config-content">
                        <button
                            onClick={toggleConfig}
                            className="close-button"
                        >
                            ✕
                        </button>
                        <ServerConfig />
                    </div>
                </div>
            )}

            <div className="main-content">
                {!storageState.isInitialized ? (
                    <InitializationScreen
                        error={storageState.error}
                        onInitialize={handleInitialize}
                    />
                ) : !currentUserId ? (
                    <UserSetup />
                ) : (
                    <WebSocketManager>
                        <WebRTCManager>
                            <div className="content-wrapper">
                                <UserMenu />
                                {!connectedToUser ? (
                                    <ConnectUser />
                                ) : (
                                    <>
                                        <DataManager />
                                        <Chat />
                                    </>
                                )}
                            </div>
                        </WebRTCManager>
                    </WebSocketManager>
                )}
            </div>
        </div>
    );
};

export const App = () => (
    <Provider store={store}>
        <AppContent />
    </Provider>
);

export default App;