import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { setCurrentUserAsync, setConnectedUser, clearChat } from '../store/messageSlice';
import { getRecentUsers, getRecentContacts, StoredUser } from '../store/fileStorage';
import styles from '../styles/modules/UserMenu.module.css';

export const UserMenu = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const [recentUsers, setRecentUsers] = useState<StoredUser[]>([]);
    const [recentContacts, setRecentContacts] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            if (!currentUserId) return;

            try {
                const [users, contacts] = await Promise.all([
                    getRecentUsers(),
                    getRecentContacts(currentUserId)
                ]);

                setRecentUsers(users);
                setRecentContacts(contacts.map(contact => contact.userId));
            } catch (error) {
                console.error('Error loading user data:', error);
            }
        };

        loadData();
    }, [currentUserId]);

    const handleUserChange = async (userId: string) => {
        if (userId === currentUserId) return;

        setIsLoading(true);
        try {
            dispatch(clearChat());
            await dispatch(setCurrentUserAsync(userId)).unwrap();
        } catch (error) {
            console.error('Error switching user:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.menuContainer}>
            <div className={styles.currentStatus}>
                <span>Current User: {currentUserId}</span>
                <div>
                    {connectedToUser && (
                        <button
                            onClick={() => dispatch(setConnectedUser(null))}
                            className={styles.disconnectButton}
                            disabled={isLoading}
                        >
                            Disconnect
                        </button>
                    )}
                    <button
                        onClick={() => dispatch(clearChat())}
                        className={styles.logoutButton}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Processing...' : 'Logout'}
                    </button>
                </div>
            </div>

            <div className={styles.menuSections}>
                {recentContacts.length > 0 && (
                    <div className={styles.section}>
                        <h4 className={styles.sectionTitle}>Recent Contacts</h4>
                        <div className={styles.contactsList}>
                            {recentContacts.map(contact => (
                                <button
                                    key={contact}
                                    onClick={() => dispatch(setConnectedUser(contact))}
                                    className={`${styles.contactButton} ${
                                        contact === connectedToUser ? styles.activeContact : ''
                                    }`}
                                    disabled={isLoading}
                                >
                                    {contact}
                                    {contact === connectedToUser && (
                                        <span className={styles.currentIndicator}>(Current)</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className={styles.section}>
                    <h4 className={styles.sectionTitle}>Switch User</h4>
                    <div className={styles.userList}>
                        {recentUsers.map(user => (
                            <button
                                key={user.id}
                                onClick={() => handleUserChange(user.id)}
                                className={`${styles.userButton} ${
                                    user.id === currentUserId ? styles.activeUser : ''
                                }`}
                                disabled={isLoading || user.id === currentUserId}
                            >
                                {user.id}
                                {user.id === currentUserId && (
                                    <span className={styles.currentIndicator}>(Current)</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};