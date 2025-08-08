import React, { useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '../hooks/redux';
import { setConnectedUser } from '../store/messageSlice';

interface Notification {
    id: string;
    message: string;
    groupId: string;
    groupName?: string;
    timestamp: string;
}

export const GroupNotificationBanner: React.FC = () => {
    const dispatch = useAppDispatch();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const groups = useAppSelector(state => state.groups.groups);
    const groupMessages = useAppSelector(state => state.groups.groupMessages);
    const currentGroupId = useAppSelector(state => state.groups.currentGroupId);

    // Listen for new groups being added
    useEffect(() => {
        const groupIds = Object.keys(groups);
        groupIds.forEach(groupId => {
            const group = groups[groupId];
            // Check if this is a new group (created in last 5 seconds)
            const createdAt = new Date(group.createdAt).getTime();
            const now = Date.now();
            if (now - createdAt < 5000) {
                // Check if we already have a notification for this group
                const existingNotif = notifications.find(n => n.groupId === groupId);
                if (!existingNotif) {
                    const newNotification: Notification = {
                        id: `notif_${groupId}_${Date.now()}`,
                        message: `You were added to "${group.name}"`,
                        groupId: groupId,
                        groupName: group.name,
                        timestamp: new Date().toISOString()
                    };
                    setNotifications(prev => [...prev, newNotification]);

                    // Auto-remove after 5 seconds
                    setTimeout(() => {
                        removeNotification(newNotification.id);
                    }, 5000);
                }
            }
        });
    }, [groups]);

    // Listen for new messages in groups (when not viewing that group)
    useEffect(() => {
        Object.keys(groupMessages).forEach(groupId => {
            if (groupId === currentGroupId) return; // Don't notify for current group

            const messages = groupMessages[groupId];
            if (messages && messages.length > 0) {
                const lastMessage = messages[messages.length - 1];
                const messageTime = new Date(lastMessage.timestamp).getTime();
                const now = Date.now();

                // If message is from last 2 seconds and not from current user
                if (now - messageTime < 2000 && lastMessage.fromId !== 'system') {
                    const group = groups[groupId];
                    if (group) {
                        const existingNotif = notifications.find(
                            n => n.id === `msg_${lastMessage.id}`
                        );
                        if (!existingNotif) {
                            const newNotification: Notification = {
                                id: `msg_${lastMessage.id}`,
                                message: `New message in "${group.name}" from ${lastMessage.fromId}`,
                                groupId: groupId,
                                groupName: group.name,
                                timestamp: lastMessage.timestamp
                            };
                            setNotifications(prev => [...prev, newNotification]);

                            // Auto-remove after 5 seconds
                            setTimeout(() => {
                                removeNotification(newNotification.id);
                            }, 5000);
                        }
                    }
                }
            }
        });
    }, [groupMessages, currentGroupId, groups]);

    const removeNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const handleNotificationClick = (notification: Notification) => {
        dispatch(setConnectedUser(notification.groupId));
        removeNotification(notification.id);
    };

    if (notifications.length === 0) return null;

    return (
        <div className="notification-container">
            {notifications.map(notification => (
                <div
                    key={notification.id}
                    className="notification-banner"
                    onClick={() => handleNotificationClick(notification)}
                >
                    <div className="notification-content">
                        <span className="notification-icon">👥</span>
                        <span className="notification-message">{notification.message}</span>
                    </div>
                    <button
                        className="notification-close"
                        onClick={(e) => {
                            e.stopPropagation();
                            removeNotification(notification.id);
                        }}
                    >
                        ✕
                    </button>
                </div>
            ))}
        </div>
    );
};