import React, { useState } from 'react';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setConnectedUser } from '../store/messageSlice'; // Changed from clearChat
import {
    deleteUserData,
    deleteContactHistory,
    deleteAllUserData
} from '../store/fileStorage';

export const DataManager: React.FC = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const messages = useAppSelector(state => state.messages.messages);

    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Get unique contacts from messages
    const contacts = Array.from(new Set(
        messages
            .map(msg => msg.fromId === currentUserId ? msg.toId : msg.fromId)
            .filter(id => id !== currentUserId)
    ));

    const handleDelete = async (
        action: () => Promise<void>,
        confirmMessage: string,
        successMessage: string,
        shouldDisconnect: boolean = false
    ) => {
        if (!window.confirm(confirmMessage)) return;

        setIsLoading(true);
        setStatus(null);

        try {
            await action();

            // Only disconnect from current chat if we're clearing that specific contact's history
            if (shouldDisconnect) {
                dispatch(setConnectedUser(null));
            }

            setStatus({ type: 'success', message: successMessage });
        } catch (error) {
            setStatus({ type: 'error', message: 'Operation failed. Please try again.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleClearContactHistory = async (contactId: string) => {
        const shouldDisconnect = contactId === connectedToUser;
        await handleDelete(
            () => deleteContactHistory(currentUserId!, contactId),
            `Delete all messages with ${contactId}?`,
            `Chat history with ${contactId} deleted.`,
            shouldDisconnect
        );
    };

    const handleDeleteUserData = async () => {
        await handleDelete(
            () => deleteUserData(currentUserId!),
            'Delete all your user data? This cannot be undone.',
            'Your data has been deleted.',
            true // Always disconnect when deleting user data
        );
    };

    const handleDeleteAllData = async () => {
        await handleDelete(
            async () => {
                await deleteAllUserData();
                // Force page reload after deleting all data
                setTimeout(() => window.location.reload(), 1000);
            },
            'Delete ALL data and reset the app? This action cannot be undone.',
            'All data has been deleted. The app will reload.',
            false // Page will reload anyway
        );
    };

    return (
        <div className="data-manager">
            <h3 className="mb-lg">Data Management</h3>

            {status && (
                <div className={`alert alert-${status.type} mb-md`}>
                    <span>{status.type === 'success' ? '✓' : '⚠️'}</span>
                    <span>{status.message}</span>
                </div>
            )}

            <div className="form">
                <div className="mb-lg">
                    <h4 className="text-muted text-small mb-sm">Your Data</h4>
                    <button
                        onClick={handleDeleteUserData}
                        disabled={isLoading}
                        className="btn btn-danger"
                    >
                        Delete My Data
                    </button>
                </div>

                {contacts.length > 0 && (
                    <div className="mb-lg">
                        <h4 className="text-muted text-small mb-sm">Chat History</h4>
                        <div className="user-grid">
                            {contacts.map(contactId => (
                                <div key={contactId} className="card" style={{ padding: '1rem' }}>
                                    <div className="text-center mb-sm">
                                        <strong>{contactId}</strong>
                                        {contactId === connectedToUser && (
                                            <div className="text-small text-muted">(Current chat)</div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleClearContactHistory(contactId)}
                                        disabled={isLoading}
                                        className="btn btn-secondary text-small"
                                    >
                                        Clear History
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="alert alert-warning mb-md">
                    <span>⚠️</span>
                    <span>Deleting all data will remove all messages and reset the app.</span>
                </div>

                <button
                    onClick={handleDeleteAllData}
                    disabled={isLoading}
                    className="btn btn-danger"
                >
                    {isLoading ? 'Processing...' : 'Delete All Data'}
                </button>
            </div>
        </div>
    );
};