import React, { useState } from 'react';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { clearChat } from '../store/messageSlice';
import { deleteUserData, deleteContactHistory, deleteAllUserData } from '../store/fileStorage';
import styles from '../styles/modules/DataManager.module.css';

export const DataManager = () => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const messages = useAppSelector(state => state.messages.messages);

    const [showConfirm, setShowConfirm] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [activeOperation, setActiveOperation] = useState<string | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const uniqueContacts = currentUserId ?
        Array.from(new Set(
            messages
                .map(msg => msg.fromId === currentUserId ? msg.toId : msg.fromId)
                .filter(id => id !== currentUserId)
        )) : [];

    const handleOperation = async (
        operation: () => Promise<void>,
        operationType: string,
        confirmMessage: string
    ) => {
        if (!window.confirm(confirmMessage)) return;

        setIsLoading(true);
        setActiveOperation(operationType);
        setStatus(null);

        try {
            await operation();
            dispatch(clearChat());
            setStatus({
                type: 'success',
                message: 'Operation completed successfully'
            });
            if (operationType === 'all') setShowConfirm(false);
        } catch (error) {
            console.error(`Error during ${operationType}:`, error);
            setStatus({
                type: 'error',
                message: `Failed to complete operation. Please try again.`
            });
        } finally {
            setIsLoading(false);
            setActiveOperation(null);
        }
    };

    return (
        <div className={styles.container}>
            <h3 className={styles.title}>Data Management</h3>

            {status && (
                <div className={status.type === 'success' ? styles.successMessage : styles.errorMessage}>
                    {status.message}
                </div>
            )}

            {!showConfirm ? (
                <button
                    className={styles.manageButton}
                    onClick={() => setShowConfirm(true)}
                    disabled={isLoading}
                >
                    Manage Data
                </button>
            ) : (
                <div className={styles.optionsContainer}>
                    <div className={styles.section}>
                        <h4 className={styles.sectionTitle}>Delete Options</h4>
                        <button
                            className={styles.deleteButton}
                            onClick={() => handleOperation(
                                () => deleteUserData(currentUserId!),
                                'user',
                                'Are you sure you want to delete your user data? This cannot be undone.'
                            )}
                            disabled={isLoading}
                        >
                            {isLoading && activeOperation === 'user'
                                ? 'Deleting...'
                                : 'Delete My User Data'
                            }
                        </button>
                    </div>

                    {uniqueContacts.length > 0 && (
                        <div className={styles.section}>
                            <h4 className={styles.sectionTitle}>Contact History</h4>
                            <div className={styles.contactsList}>
                                {uniqueContacts.map(contactId => (
                                    <div key={contactId} className={styles.contactItem}>
                                        <span className={styles.contactId}>{contactId}</span>
                                        <button
                                            className={styles.deleteButton}
                                            onClick={() => handleOperation(
                                                () => deleteContactHistory(currentUserId!, contactId),
                                                `contact-${contactId}`,
                                                `Are you sure you want to delete all messages with ${contactId}?`
                                            )}
                                            disabled={isLoading}
                                        >
                                            {isLoading && activeOperation === `contact-${contactId}`
                                                ? 'Deleting...'
                                                : 'Delete History'
                                            }
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className={styles.section}>
                        <div className={styles.warning}>
                            Warning: This will remove all messages and user information.
                            This action cannot be undone.
                        </div>
                        <button
                            className={styles.deleteAllButton}
                            onClick={() => handleOperation(
                                deleteAllUserData,
                                'all',
                                'Are you sure you want to delete ALL data?'
                            )}
                            disabled={isLoading}
                        >
                            {isLoading && activeOperation === 'all'
                                ? 'Deleting All Data...'
                                : 'Delete All Data'
                            }
                        </button>
                    </div>

                    <button
                        className={styles.cancelButton}
                        onClick={() => {
                            setShowConfirm(false);
                            setStatus(null);
                        }}
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
};