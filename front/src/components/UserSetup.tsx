import React, { useState, useEffect } from 'react';
import { useAppDispatch } from '../hooks/redux';
import { setCurrentUserAsync } from '../store/messageSlice';
import { generateShortId, getRecentUsers, StoredUser } from '../store/fileStorage';
import styles from '../styles/modules/UserSetup.module.css';

export const UserSetup = () => {
    const [userId, setUserId] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [recentUsers, setRecentUsers] = useState<StoredUser[]>([]);
    const [error, setError] = useState<string | null>(null);
    const dispatch = useAppDispatch();

    // Load recent users on component mount
    useEffect(() => {
        const loadRecentUsers = async () => {
            try {
                const users = await getRecentUsers();
                setRecentUsers(users);
            } catch (error) {
                setError('Failed to load recent users');
                console.error('Error loading recent users:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadRecentUsers();
    }, []);

    const generateNewId = () => {
        const newId = generateShortId();
        setUserId(newId);
        setSelectedId(newId);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userId.trim()) return;

        setIsLoading(true);
        setError(null);

        try {
            await dispatch(setCurrentUserAsync(userId)).unwrap();
        } catch (error) {
            setError('Failed to set user ID. Please try again.');
            console.error('Error setting user:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const selectUser = (user: StoredUser) => {
        setUserId(user.id);
        setSelectedId(user.id);
    };

    if (isLoading && !userId) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingIndicator}>Loading...</div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Setup User ID</h2>

            {error && (
                <div className={styles.errorMessage}>
                    {error}
                </div>
            )}

            {selectedId && (
                <div className={styles.selectedIdContainer}>
                    <span className={styles.selectedIdLabel}>Selected ID: </span>
                    <span className={styles.selectedId}>{selectedId}</span>
                </div>
            )}

            {recentUsers.length > 0 && (
                <div className={styles.recentUsersSection}>
                    <h3 className={styles.recentUsersTitle}>Recent Users</h3>
                    <div className={styles.recentUsersList}>
                        {recentUsers.map(user => (
                            <button
                                key={user.id}
                                onClick={() => selectUser(user)}
                                className={`${styles.userButton} ${
                                    user.id === selectedId ? styles.userButtonSelected : styles.userButtonUnselected
                                }`}
                                disabled={isLoading}
                            >
                                {user.id}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
                <input
                    type="text"
                    value={userId}
                    onChange={(e) => {
                        setUserId(e.target.value);
                        setSelectedId(e.target.value);
                    }}
                    placeholder="Enter user ID"
                    className={styles.input}
                    disabled={isLoading}
                />
                <div className={styles.buttonGroup}>
                    <button
                        type="button"
                        onClick={generateNewId}
                        disabled={isLoading}
                        className={styles.generateButton}
                    >
                        Generate ID
                    </button>
                    <button
                        type="submit"
                        disabled={isLoading || !userId.trim()}
                        className={`${styles.submitButton} ${isLoading ? styles.loading : ''}`}
                    >
                        {isLoading ? 'Connecting...' : 'Connect'}
                    </button>
                </div>
            </form>
        </div>
    );
};