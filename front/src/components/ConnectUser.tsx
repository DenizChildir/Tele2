import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { setConnectedUser } from '../store/messageSlice';
import { getRecentContacts, saveRecentContact, RecentContact } from '../store/fileStorage';
import styles from '../styles/modules/ConnectUser.module.css';
import {config} from "../config";

export const ConnectUser = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);

    const [targetUserId, setTargetUserId] = useState('');
    const [recentContacts, setRecentContacts] = useState<RecentContact[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'error'; message: string } | null>(null);

    useEffect(() => {
        const loadContacts = async () => {
            if (!currentUserId) return;

            try {
                const contacts = await getRecentContacts(currentUserId);
                setRecentContacts(contacts);
            } catch (error) {
                console.error('Error loading recent contacts:', error);
                setStatus({
                    type: 'error',
                    message: 'Failed to load recent contacts'
                });
            }
        };

        loadContacts();
    }, [currentUserId]);

    const handleConnect = async (userId: string) => {
        if (!userId.trim() || !currentUserId || userId === currentUserId) return;

        setIsLoading(true);
        setStatus(null);

        try {
            // Verify user exists
            const response = await fetch(`${config.apiUrl}/api/status/${userId}`);
            if (!response.ok) throw new Error('User not found');

            // Save to recent contacts and update state
            await saveRecentContact(currentUserId, userId);
            setRecentContacts(prev => {
                const newContact: RecentContact = {
                    userId,
                    lastInteraction: new Date().toISOString()
                };
                return [newContact, ...prev.filter(c => c.userId !== userId)].slice(0, 5);
            });

            dispatch(setConnectedUser(userId));
        } catch (error) {
            console.error('Error connecting to user:', error);
            setStatus({
                type: 'error',
                message: 'Failed to connect. Please check the ID and try again.'
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Connect to User</h2>

            {status && (
                <div className={styles.errorMessage}>
                    {status.message}
                </div>
            )}

            <div className={styles.userInfo}>
                Your ID: <span className={styles.userId}>{currentUserId}</span>
            </div>

            {recentContacts.length > 0 && (
                <div className={styles.recentContactsSection}>
                    <h3 className={styles.recentContactsTitle}>Recent Contacts</h3>
                    <div className={styles.contactsList}>
                        {recentContacts.map(contact => (
                            <button
                                key={contact.userId}
                                onClick={() => handleConnect(contact.userId)}
                                className={styles.contactButton}
                                disabled={isLoading}
                            >
                                {contact.userId}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleConnect(targetUserId);
                }}
                className={styles.form}
            >
                <div className={styles.inputGroup}>
                    <input
                        type="text"
                        value={targetUserId}
                        onChange={(e) => setTargetUserId(e.target.value)}
                        placeholder="Enter recipient's user ID"
                        className={styles.input}
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={
                            isLoading ||
                            !targetUserId.trim() ||
                            targetUserId === currentUserId
                        }
                        className={styles.connectButton}
                    >
                        {isLoading ? 'Connecting...' : 'Connect'}
                    </button>
                </div>
            </form>
        </div>
    );
};