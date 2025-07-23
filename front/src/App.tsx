import React, { useState, useEffect } from 'react';
import { Provider } from 'react-redux';
import { store } from './store/store';
import { useAppSelector, useAppDispatch } from './hooks/redux';
import { UserManager } from './components/UserManager';
import { Chat } from './components/Chat';
import { DataManager } from './components/DataManager';
import { WebSocketManager } from './components/WebSocketManager';
import { WebRTCManager } from './components/WebRTCManager';
import { initializeStorage } from './store/fileStorage';
import { initializeAllMessagesAsync } from './store/messageSlice';
import './styles/app.css'; // Single CSS file

const AppContent: React.FC = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);

    const [storageInitialized, setStorageInitialized] = useState(false);
    const [storageError, setStorageError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    const handleStorageInit = async () => {
        try {
            await initializeStorage();
            setStorageInitialized(true);
            setStorageError(null);
        } catch (error) {
            const message = error instanceof Error && error.name === 'NotAllowedError'
                ? 'Permission denied. Please try again and allow file system access.'
                : 'Failed to initialize storage. Please refresh and try again.';
            setStorageError(message);
        }
    };

    // Load all messages when user logs in
    useEffect(() => {
        if (currentUserId) {
            dispatch(initializeAllMessagesAsync(currentUserId));
        }
    }, [currentUserId, dispatch]);

    // Initial storage setup screen
    if (!storageInitialized) {
        return (
            <div className="app-container">
                <div className="app-main">
                    <div className="card fade-in">
                        <h1 className="card-title">Welcome to SecureChat</h1>
                        <p className="text-center text-muted mb-lg">
                            A peer-to-peer encrypted chat application
                        </p>

                        {storageError && (
                            <div className="alert alert-error mb-md">
                                <span>⚠️</span>
                                <span>{storageError}</span>
                            </div>
                        )}

                        <p className="text-center mb-lg">
                            To begin, we need to set up local storage for your messages.
                            Your data stays on your device.
                        </p>

                        <button
                            onClick={handleStorageInit}
                            className="btn btn-primary"
                        >
                            Initialize Storage
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // User setup screen
    if (!currentUserId) {
        return (
            <div className="app-container">
                <div className="app-main">
                    <UserManager mode="setup" />
                </div>
            </div>
        );
    }

    // Main app with WebSocket and WebRTC
    return (
        <WebSocketManager>
            <WebRTCManager>
                <div className="app-container">
                    <header className="app-header">
                        <UserManager mode="menu" />
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="btn btn-icon"
                            title="Settings"
                        >
                            ⚙️
                        </button>
                    </header>

                    <main className="app-main">
                        {!connectedToUser ? (
                            <UserManager mode="connect" />
                        ) : (
                            <Chat />
                        )}
                    </main>

                    {showSettings && (
                        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
                            <div className="modal" onClick={(e) => e.stopPropagation()}>
                                <div className="mb-lg">
                                    <h2 className="card-title">Settings</h2>
                                    <button
                                        onClick={() => setShowSettings(false)}
                                        className="btn btn-icon"
                                        style={{ position: 'absolute', top: '1rem', right: '1rem' }}
                                    >
                                        ✕
                                    </button>
                                </div>
                                <DataManager />
                            </div>
                        </div>
                    )}
                </div>
            </WebRTCManager>
        </WebSocketManager>
    );
};

export const App: React.FC = () => (
    <Provider store={store}>
        <AppContent />
    </Provider>
);

export default App;