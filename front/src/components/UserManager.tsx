import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { setCurrentUserAsync, setConnectedUser } from '../store/messageSlice';
import {
    generateShortId,
    getRecentUsers,
    getRecentContacts,
    saveRecentContact,
    StoredUser,
    RecentContact
} from '../store/fileStorage';
import { config } from '../config';

interface UserManagerProps {
    mode: 'setup' | 'connect' | 'menu';
}

export const UserManager: React.FC<UserManagerProps> = ({ mode }) => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const users = useAppSelector(state => state.messages.users);

    const [userId, setUserId] = useState('');
    const [recentUsers, setRecentUsers] = useState<StoredUser[]>([]);
    const [recentContacts, setRecentContacts] = useState<RecentContact[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            try {
                const loadedUsers = await getRecentUsers();
                setRecentUsers(loadedUsers);

                if (currentUserId) {
                    const contacts = await getRecentContacts(currentUserId);
                    setRecentContacts(contacts);
                }
            } catch (error) {
                console.error('Error loading data:', error);
            }
        };

        loadData();
    }, [currentUserId]);

    const handleUserSetup = async (selectedUserId: string) => {
        if (!selectedUserId.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            await dispatch(setCurrentUserAsync(selectedUserId)).unwrap();
        } catch (error) {
            setError('Failed to set user ID. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnect = async (targetUserId: string) => {
        if (!targetUserId.trim() || !currentUserId || targetUserId === currentUserId) return;

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${config.apiUrl}/api/status/${targetUserId}`);
            if (!response.ok) throw new Error('User not found');

            await saveRecentContact(currentUserId, targetUserId);
            dispatch(setConnectedUser(targetUserId));
        } catch (error) {
            setError('Failed to connect. Please check the ID and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const generateNewId = () => {
        const newId = generateShortId();
        setUserId(newId);
    };

    // Setup Mode - Initial user selection
    if (mode === 'setup') {
        return (
            <div className="card fade-in">
                <h2 className="card-title">Welcome to Chat</h2>

                {error && (
                    <div className="alert alert-error mb-md">
                        <span>⚠️</span>
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={(e) => {
                    e.preventDefault();
                    handleUserSetup(userId);
                }} className="form">
                    <div className="form-group">
                        <label className="form-label">Choose or create your user ID</label>
                        <input
                            type="text"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            placeholder="Enter user ID"
                            className="input"
                            disabled={isLoading}
                        />
                    </div>

                    <div className="btn-group">
                        <button
                            type="button"
                            onClick={generateNewId}
                            disabled={isLoading}
                            className="btn btn-secondary"
                        >
                            Generate ID
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading || !userId.trim()}
                            className="btn btn-primary"
                        >
                            {isLoading ? 'Connecting...' : 'Continue'}
                        </button>
                    </div>
                </form>

                {recentUsers.length > 0 && (
                    <div className="mt-lg">
                        <h3 className="text-muted text-small mb-sm">Recent Users</h3>
                        <div className="user-grid">
                            {recentUsers.map(user => (
                                <div
                                    key={user.id}
                                    onClick={() => setUserId(user.id)}
                                    className={`user-card ${user.id === userId ? 'user-card-active' : ''}`}
                                >
                                    {user.id}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Connect Mode - Select contact to chat with
    if (mode === 'connect') {
        return (
            <div className="card fade-in">
                <h2 className="card-title">Connect to User</h2>

                <div className="alert alert-success mb-md">
                    <span>👤</span>
                    <span>Your ID: <strong>{currentUserId}</strong></span>
                </div>

                {error && (
                    <div className="alert alert-error mb-md">
                        <span>⚠️</span>
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={(e) => {
                    e.preventDefault();
                    handleConnect(userId);
                }} className="form">
                    <div className="form-group">
                        <label className="form-label">Enter recipient's user ID</label>
                        <input
                            type="text"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            placeholder="User ID to connect"
                            className="input"
                            disabled={isLoading}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || !userId.trim() || userId === currentUserId}
                        className="btn btn-primary"
                    >
                        {isLoading ? 'Connecting...' : 'Connect'}
                    </button>
                </form>

                {recentContacts.length > 0 && (
                    <div className="mt-lg">
                        <h3 className="text-muted text-small mb-sm">Recent Contacts</h3>
                        <div className="user-grid">
                            {recentContacts.map(contact => (
                                <div
                                    key={contact.userId}
                                    onClick={() => handleConnect(contact.userId)}
                                    className="user-card"
                                >
                                    {contact.userId}
                                    {users[contact.userId]?.online && (
                                        <div className="status mt-sm">
                                            <span className="status-dot status-online"></span>
                                            <span className="text-small">Online</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Menu Mode - Compact user menu
    return (
        <div className="user-menu-compact">
            <div className="status">
                <span>User: <strong>{currentUserId}</strong></span>
                {connectedToUser && (
                    <>
                        <span className="text-muted">→</span>
                        <span>Chat: <strong>{connectedToUser}</strong></span>
                    </>
                )}
            </div>
            <div className="btn-group">
                {connectedToUser && (
                    <button
                        onClick={() => dispatch(setConnectedUser(null))}
                        className="btn btn-secondary"
                    >
                        Disconnect
                    </button>
                )}
                <button
                    onClick={() => window.location.reload()}
                    className="btn btn-danger"
                >
                    Logout
                </button>
            </div>
        </div>
    );
};