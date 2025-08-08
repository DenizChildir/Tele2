import React, { useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setConnectedUser } from '../store/messageSlice';
import { resetGroupUnreadCount, fetchGroupMessagesAsync } from '../store/groupSlice';

interface ContactSwitcherProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ContactSwitcher: React.FC<ContactSwitcherProps> = ({ isOpen, onClose }) => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const connectedToUser = useAppSelector(state => state.messages.connectedToUser);
    const messages = useAppSelector(state => state.messages.messages);
    const users = useAppSelector(state => state.messages.users);

    // Access group state using the main useAppSelector
    const groups = useAppSelector(state => state.groups.groups);
    const groupUnreadCounts = useAppSelector(state => state.groups.unreadCounts);
    const groupMessages = useAppSelector(state => state.groups.groupMessages);

    // Calculate contacts and unread counts
    const contactsWithUnread = useMemo(() => {
        if (!currentUserId) return [];

        // Get unique contacts from messages
        const contactMap = new Map<string, {
            userId: string;
            lastMessage: string;
            unreadCount: number;
            lastMessageTime: string;
        }>();

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

            const contactId = msg.fromId === currentUserId ? msg.toId : msg.fromId;

            if (contactId === currentUserId) return; // Skip self

            if (!contactMap.has(contactId)) {
                contactMap.set(contactId, {
                    userId: contactId,
                    lastMessage: msg.timestamp,
                    unreadCount: 0,
                    lastMessageTime: msg.timestamp
                });
            }

            // Update last message time
            const contact = contactMap.get(contactId)!;
            if (new Date(msg.timestamp) > new Date(contact.lastMessageTime)) {
                contact.lastMessage = msg.timestamp;
                contact.lastMessageTime = msg.timestamp;
            }

            // Count unread messages (messages from contact that are not read)
            if (msg.fromId === contactId && msg.toId === currentUserId && !msg.readStatus) {
                contact.unreadCount++;
            }
        });

        // Convert to array and sort by last message time
        return Array.from(contactMap.values())
            .sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());
    }, [messages, currentUserId]);

    const handleContactClick = (contactId: string) => {
        // If it's a group, reset unread count and fetch messages if needed
        if (contactId.startsWith('GROUP_')) {
            dispatch(resetGroupUnreadCount(contactId));

            // Fetch group messages if not already loaded
            if (!groupMessages[contactId]) {
                dispatch(fetchGroupMessagesAsync(contactId));
            }
        }

        dispatch(setConnectedUser(contactId));
        onClose();
    };

    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;

        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    if (!isOpen) return null;

    return (
        <div className="contact-switcher">
            <div className="contact-switcher-header">
                <h3>Chats</h3>
                <button
                    onClick={onClose}
                    className="btn btn-icon"
                    aria-label="Close contact switcher"
                >
                    ✕
                </button>
            </div>

            <div className="contact-switcher-list">
                {contactsWithUnread.length === 0 && Object.keys(groups).length === 0 ? (
                    <div className="contact-switcher-empty">
                        <p className="text-muted text-center">No conversations yet</p>
                    </div>
                ) : (
                    <>
                        {contactsWithUnread.length > 0 && (
                            <>
                                <div className="contact-switcher-section-header">
                                    <h4>Direct Messages</h4>
                                </div>
                                {contactsWithUnread.map(contact => (
                                    <div
                                        key={contact.userId}
                                        onClick={() => handleContactClick(contact.userId)}
                                        className={`contact-switcher-item ${
                                            contact.userId === connectedToUser ? 'contact-switcher-item-active' : ''
                                        }`}
                                    >
                                        <div className="contact-switcher-item-main">
                                            <div className="contact-switcher-item-header">
                                            <span className="contact-switcher-item-name">
                                                {contact.userId}
                                            </span>
                                                {users[contact.userId]?.online && (
                                                    <span className="status-dot status-online" title="Online"></span>
                                                )}
                                            </div>
                                            <span className="contact-switcher-item-time">
                                            {formatTime(contact.lastMessage)}
                                        </span>
                                        </div>

                                        {contact.unreadCount > 0 && contact.userId !== connectedToUser && (
                                            <div className="contact-switcher-unread-badge">
                                                {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}

                        {Object.keys(groups).length > 0 && (
                            <>
                                <div className="contact-switcher-section-header">
                                    <h4>Groups</h4>
                                </div>
                                {Object.values(groups).map(group => {
                                    // Calculate unread count for this group
                                    const unreadCount = groupUnreadCounts[group.id] || 0;

                                    // Get last message timestamp
                                    const groupMsgs = groupMessages[group.id];
                                    const lastMessageTime = groupMsgs && groupMsgs.length > 0
                                        ? groupMsgs[groupMsgs.length - 1].timestamp
                                        : group.lastActivity;

                                    return (
                                        <div
                                            key={group.id}
                                            onClick={() => handleContactClick(group.id)}
                                            className={`contact-switcher-item contact-switcher-item-group ${
                                                group.id === connectedToUser ? 'contact-switcher-item-active' : ''
                                            }`}
                                        >
                                            <div className="contact-switcher-item-main">
                                                <div className="contact-switcher-item-header">
                                                <span className="contact-switcher-item-name">
                                                    {group.name}
                                                </span>
                                                </div>
                                                <span className="contact-switcher-item-time">
                                                {lastMessageTime ? formatTime(lastMessageTime) : 'New'}
                                            </span>
                                            </div>

                                            {unreadCount > 0 && group.id !== connectedToUser && (
                                                <div className="contact-switcher-unread-badge">
                                                    {unreadCount > 99 ? '99+' : unreadCount}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};