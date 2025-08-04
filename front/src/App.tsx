import React, { useState, useEffect, useMemo } from 'react';
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
import { GroupChatManager } from './components/GroupChatManager';


const AppContent: React.FC = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const messages = useAppSelector(state => state.messages.messages);

    const [storageInitialized, setStorageInitialized] = useState(false);
    const [storageError, setStorageError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showGroupManager, setShowGroupManager] = useState(false);

    // Calculate total unread count
    const totalUnreadCount = useMemo(() => {
        if (!currentUserId) return 0;

        let unreadCount = 0;
        const contactUnreadMap = new Map<string, number>();

        messages.forEach(msg => {
            // Skip non-chat messages
            if (!msg.content ||
                msg.content === 'delivered' ||
                msg.content === 'read' ||
                msg.content === 'status_update' ||
                (typeof msg.content === 'object' && 'type' in msg.content &&
                    ['offer', 'answer', 'ice-candidate'].includes((msg.content as any).type))) {
                return;
            }

            // Count unread messages from other users
            if (msg.fromId !== currentUserId && msg.toId === currentUserId && !msg.readStatus) {
                const currentCount = contactUnreadMap.get(msg.fromId) || 0;
                contactUnreadMap.set(msg.fromId, currentCount + 1);
            }
        });

        // Sum up unread counts, excluding current conversation
        contactUnreadMap.forEach((count, contactId) => {
            if (contactId !== connectedToUser) {
                unreadCount += count;
            }
        });

        return unreadCount;
    }, [messages, currentUserId, connectedToUser]);

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
                        <div className="app-header-actions">
                            {totalUnreadCount > 0 && (
                                <div className="app-unread-badge" title={`${totalUnreadCount} unread messages`}>
                                    <span className="app-unread-icon">💬</span>
                                    <span className="app-unread-count">{totalUnreadCount > 99 ? '99+' : totalUnreadCount}</span>
                                </div>
                            )}
                            <button
                                onClick={() => setShowGroupManager(!showGroupManager)}
                                className="btn btn-icon"
                                title="Groups"
                            >
                                👥
                            </button>
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className="btn btn-icon"
                                title="Settings"
                            >
                                ⚙️
                            </button>
                        </div>
                    </header>

                    <main className="app-main">
                        {!connectedToUser ? (
                            <UserManager mode="connect" />
                        ) : (
                            <Chat />
                        )}
                    </main>

                    <GroupChatManager
                        isOpen={showGroupManager}
                        onClose={() => setShowGroupManager(false)}
                    />

                    {showSettings && (
                        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
                            <div className="modal" onClick={(e) => e.stopPropagation()}>
                                {/* ... settings content ... */}
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