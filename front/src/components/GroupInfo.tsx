// GroupInfo.tsx - Helper component for displaying group information
import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { fetchGroupMembersAsync } from '../store/groupSlice';

interface GroupInfoProps {
    groupId: string;
    onManageClick?: () => void;
}

export const GroupInfo: React.FC<GroupInfoProps> = ({ groupId, onManageClick }) => {
    const dispatch = useAppDispatch();
    const group = useAppSelector(state => state.groups.groups[groupId]);
    const members = useAppSelector(state => state.groups.groupMembers[groupId] || []);
    const currentUserId = useAppSelector(state => state.messages.currentUserId);

    useEffect(() => {
        if (groupId && (!members || members.length === 0)) {
            dispatch(fetchGroupMembersAsync(groupId));
        }
    }, [groupId, members, dispatch]);

    if (!group) return null;

    const onlineCount = members.filter(m => m.isOnline).length;
    const isUserAdmin = members.find(m => m.userId === currentUserId)?.role === 'admin';
    const isMuted = members.find(m => m.userId === currentUserId)?.isMuted || false;

    return (
        <div className="group-info-bar">
        <div className="group-info-bar-text">
            <span>{group.memberCount || members.length} members</span>
    {onlineCount > 0 && <span> • {onlineCount} online</span>}
        {isMuted && <span className="text-warning"> • You are muted</span>}
        </div>
            {onManageClick && (
                <button
                    onClick={onManageClick}
                className="group-info-bar-action"
                    >
                    {isUserAdmin ? 'Manage Group' : 'View Members'}
                    </button>
            )}
            </div>
        );
};