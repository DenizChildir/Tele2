// GroupChatManager.tsx - UI component for creating and managing group chats
import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import {
    createGroupAsync,
    fetchUserGroupsAsync,
    fetchGroupMembersAsync,
    addGroupMembersAsync,
    performAdminActionAsync,
    leaveGroupAsync,
    setCurrentGroup,
    clearGroupError
} from '../store/groupSlice';
import { setConnectedUser } from '../store/messageSlice';
import { GroupMemberWithDetails, AdminActionType } from '../types/GroupTypes';

interface GroupChatManagerProps {
    isOpen: boolean;
    onClose: () => void;
}

export const GroupChatManager: React.FC<GroupChatManagerProps> = ({ isOpen, onClose }) => {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector(state => state.messages.currentUserId);
    const groups = useAppSelector(state => state.groups.groups);
    const groupMembers = useAppSelector(state => state.groups.groupMembers);
    const currentGroupId = useAppSelector(state => state.groups.currentGroupId);
    const loading = useAppSelector(state => state.groups.loading);
    const error = useAppSelector(state => state.groups.error);

    const [activeTab, setActiveTab] = useState<'list' | 'create' | 'manage'>('list');
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDescription, setNewGroupDescription] = useState('');
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [addMemberUserId, setAddMemberUserId] = useState('');
    const [showAdminMenu, setShowAdminMenu] = useState<string | null>(null);

    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [memberInput, setMemberInput] = useState('');

    // Load user's groups on mount
    useEffect(() => {
        if (currentUserId && isOpen) {
            dispatch(fetchUserGroupsAsync(currentUserId));
        }
    }, [currentUserId, isOpen, dispatch]);

    // Load members when a group is selected
    useEffect(() => {
        if (selectedGroupId) {
            dispatch(fetchGroupMembersAsync(selectedGroupId));
        }
    }, [selectedGroupId, dispatch]);

    // Clear error on close
    useEffect(() => {
        if (!isOpen) {
            dispatch(clearGroupError());
        }
    }, [isOpen, dispatch]);

    const handleCreateGroup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newGroupName.trim() || !currentUserId) return;

        try {
            await dispatch(createGroupAsync({
                request: {
                    name: newGroupName.trim(),
                    description: newGroupDescription.trim()
                },
                userId: currentUserId
            })).unwrap();

            // Reset form and switch to list
            setNewGroupName('');
            setNewGroupDescription('');
            setActiveTab('list');

            // Refresh groups list
            dispatch(fetchUserGroupsAsync(currentUserId));
        } catch (error) {
            console.error('Failed to create group:', error);
        }
    };

    const handleJoinGroup = (groupId: string) => {
        dispatch(setCurrentGroup(groupId));
        dispatch(setConnectedUser(groupId));
        onClose();
    };

    const handleAddMember = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!addMemberUserId.trim() || !selectedGroupId) return;

        try {
            await dispatch(addGroupMembersAsync({
                groupId: selectedGroupId,
                userIds: [addMemberUserId.trim()]
            })).unwrap();

            setAddMemberUserId('');
        } catch (error) {
            console.error('Failed to add member:', error);
        }
    };

    const handleAdminAction = async (targetUserId: string, action: AdminActionType) => {
        if (!selectedGroupId || !currentUserId) return;

        try {
            await dispatch(performAdminActionAsync({
                type: action,
                groupId: selectedGroupId,
                targetUserId,
                performedBy: currentUserId,
                timestamp: new Date().toISOString()
            })).unwrap();

            setShowAdminMenu(null);
        } catch (error) {
            console.error('Failed to perform admin action:', error);
        }
    };

    const handleLeaveGroup = async (groupId: string) => {
        if (!currentUserId) return;

        if (!window.confirm('Are you sure you want to leave this group?')) return;

        try {
            await dispatch(leaveGroupAsync({
                groupId,
                userId: currentUserId
            })).unwrap();

            if (currentGroupId === groupId) {
                dispatch(setCurrentGroup(null));
                dispatch(setConnectedUser(null));
            }
        } catch (error) {
            console.error('Failed to leave group:', error);
        }
    };

    const isUserAdmin = (groupId: string): boolean => {
        const members = groupMembers[groupId];
        if (!members || !currentUserId) return false;
        const currentMember = members.find(m => m.userId === currentUserId);
        return currentMember?.role === 'admin';
    };

    const renderGroupList = () => {
        const groupList = Object.values(groups);

        if (groupList.length === 0) {
            return (
                <div className="empty-state">
                    <p className="text-muted">No groups yet. Create one to get started!</p>
                    <button
                        onClick={() => setActiveTab('create')}
                        className="btn btn-primary mt-md"
                    >
                        Create Group
                    </button>
                </div>
            );
        }

        return (
            <div className="group-list">
                {groupList.map(group => (
                    <div key={group.id} className="group-item">
                        <div className="group-item-info">
                            <h4 className="group-item-name">{group.name}</h4>
                            {group.description && (
                                <p className="group-item-description">{group.description}</p>
                            )}
                            <div className="group-item-meta">
                                <span>{group.memberCount} members</span>
                                {group.lastActivity && (
                                    <span className="text-muted">
                                        • Last active {new Date(group.lastActivity).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="group-item-actions">
                            <button
                                onClick={() => handleJoinGroup(group.id)}
                                className="btn btn-primary btn-sm"
                            >
                                Open Chat
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedGroupId(group.id);
                                    setActiveTab('manage');
                                }}
                                className="btn btn-secondary btn-sm"
                            >
                                Manage
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    // In GroupChatManager.tsx, update the create group form section
// Replace the existing renderCreateGroup function with this:

    const renderCreateGroup = () => {
        const handleAddMemberToList = () => {
            if (memberInput.trim() && !selectedMembers.includes(memberInput.trim())) {
                setSelectedMembers([...selectedMembers, memberInput.trim()]);
                setMemberInput('');
            }
        };

        const handleRemoveMemberFromList = (userId: string) => {
            setSelectedMembers(selectedMembers.filter(id => id !== userId));
        };

        const handleCreateGroupSubmit = async (e: React.FormEvent) => {
            e.preventDefault();
            if (!newGroupName.trim() || !currentUserId) return;

            try {
                await dispatch(createGroupAsync({
                    request: {
                        name: newGroupName.trim(),
                        description: newGroupDescription.trim(),
                        initialMembers: selectedMembers // Add selected members
                    },
                    userId: currentUserId
                })).unwrap();

                // Reset form and switch to list
                setNewGroupName('');
                setNewGroupDescription('');
                setSelectedMembers([]); // Reset selected members
                setMemberInput(''); // Reset input
                setActiveTab('list');

                // Refresh groups list
                dispatch(fetchUserGroupsAsync(currentUserId));
            } catch (error) {
                console.error('Failed to create group:', error);
            }
        };

        return (
            <form onSubmit={handleCreateGroupSubmit} className="form">
                <div className="form-group">
                    <label className="form-label">Group Name</label>
                    <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Enter group name"
                        className="input"
                        maxLength={50}
                        required
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Description (optional)</label>
                    <textarea
                        value={newGroupDescription}
                        onChange={(e) => setNewGroupDescription(e.target.value)}
                        placeholder="What's this group about?"
                        className="input"
                        rows={3}
                        maxLength={200}
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Add Members</label>
                    <div className="form-inline">
                        <input
                            type="text"
                            value={memberInput}
                            onChange={(e) => setMemberInput(e.target.value)}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddMemberToList();
                                }
                            }}
                            placeholder="Enter user ID"
                            className="input"
                            style={{ flex: 1 }}
                        />
                        <button
                            type="button"
                            onClick={handleAddMemberToList}
                            disabled={!memberInput.trim()}
                            className="btn btn-secondary"
                        >
                            Add
                        </button>
                    </div>

                    {selectedMembers.length > 0 && (
                        <div className="selected-members-list">
                            <div className="text-small text-muted mt-sm mb-sm">Members to add:</div>
                            {selectedMembers.map(userId => (
                                <div key={userId} className="selected-member-item">
                                    <span>{userId}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveMemberFromList(userId)}
                                        className="btn btn-icon btn-sm"
                                        title="Remove"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="btn-group">
                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab('list');
                            // Clear form when canceling
                            setSelectedMembers([]);
                            setMemberInput('');
                        }}
                        className="btn btn-secondary"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !newGroupName.trim()}
                        className="btn btn-primary"
                    >
                        {loading ? 'Creating...' : 'Create Group'}
                    </button>
                </div>
            </form>
        );
    };

    const renderManageGroup = () => {
        if (!selectedGroupId) return null;

        const group = groups[selectedGroupId];
        const members = groupMembers[selectedGroupId] || [];
        const isAdmin = isUserAdmin(selectedGroupId);

        return (
            <div className="group-manage">
                <div className="group-manage-header">
                    <h3>{group?.name}</h3>
                    <button
                        onClick={() => setActiveTab('list')}
                        className="btn btn-icon"
                    >
                        ← Back
                    </button>
                </div>

                {group?.description && (
                    <p className="text-muted mb-md">{group.description}</p>
                )}

                {isAdmin && (
                    <div className="group-manage-section">
                        <h4>Add Member</h4>
                        <form onSubmit={handleAddMember} className="form-inline">
                            <input
                                type="text"
                                value={addMemberUserId}
                                onChange={(e) => setAddMemberUserId(e.target.value)}
                                placeholder="User ID"
                                className="input"
                                style={{ flex: 1 }}
                            />
                            <button
                                type="submit"
                                disabled={!addMemberUserId.trim()}
                                className="btn btn-primary"
                            >
                                Add
                            </button>
                        </form>
                    </div>
                )}

                <div className="group-manage-section">
                    <h4>Members ({members.length})</h4>
                    <div className="member-list">
                        {members.map(member => (
                            <div key={member.userId} className="member-item">
                                <div className="member-info">
                                    <span className="member-name">
                                        {member.userId}
                                        {member.userId === currentUserId && ' (You)'}
                                    </span>
                                    <div className="member-badges">
                                        {member.role === 'admin' && (
                                            <span className="badge badge-admin">Admin</span>
                                        )}
                                        {member.isMuted && (
                                            <span className="badge badge-muted">Muted</span>
                                        )}
                                        {member.isOnline && (
                                            <span className="status-dot status-online"></span>
                                        )}
                                    </div>
                                </div>

                                {isAdmin && member.userId !== currentUserId && (
                                    <div className="member-actions">
                                        <button
                                            onClick={() => setShowAdminMenu(
                                                showAdminMenu === member.userId ? null : member.userId
                                            )}
                                            className="btn btn-icon"
                                        >
                                            ⋮
                                        </button>

                                        {showAdminMenu === member.userId && (
                                            <div className="admin-menu">
                                                {member.role !== 'admin' && (
                                                    <button
                                                        onClick={() => handleAdminAction(member.userId, 'promote')}
                                                        className="admin-menu-item"
                                                    >
                                                        Make Admin
                                                    </button>
                                                )}
                                                {member.role === 'admin' && (
                                                    <button
                                                        onClick={() => handleAdminAction(member.userId, 'demote')}
                                                        className="admin-menu-item"
                                                    >
                                                        Remove Admin
                                                    </button>
                                                )}
                                                {!member.isMuted ? (
                                                    <button
                                                        onClick={() => handleAdminAction(member.userId, 'mute')}
                                                        className="admin-menu-item"
                                                    >
                                                        Mute
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleAdminAction(member.userId, 'unmute')}
                                                        className="admin-menu-item"
                                                    >
                                                        Unmute
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleAdminAction(member.userId, 'ban')}
                                                    className="admin-menu-item admin-menu-item-danger"
                                                >
                                                    Ban from Group
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="group-manage-footer">
                    <button
                        onClick={() => handleLeaveGroup(selectedGroupId)}
                        className="btn btn-danger"
                    >
                        Leave Group
                    </button>
                </div>
            </div>
        );
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal group-chat-manager" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Group Chats</h2>
                    <button
                        onClick={onClose}
                        className="btn btn-icon"
                    >
                        ✕
                    </button>
                </div>

                {error && (
                    <div className="alert alert-error mb-md">
                        <span>⚠️</span>
                        <span>{error}</span>
                    </div>
                )}

                <div className="tabs">
                    <button
                        onClick={() => setActiveTab('list')}
                        className={`tab ${activeTab === 'list' ? 'tab-active' : ''}`}
                    >
                        My Groups
                    </button>
                    <button
                        onClick={() => setActiveTab('create')}
                        className={`tab ${activeTab === 'create' ? 'tab-active' : ''}`}
                    >
                        Create Group
                    </button>
                    {selectedGroupId && (
                        <button
                            onClick={() => setActiveTab('manage')}
                            className={`tab ${activeTab === 'manage' ? 'tab-active' : ''}`}
                        >
                            Manage
                        </button>
                    )}
                </div>

                <div className="modal-content">
                    {activeTab === 'list' && renderGroupList()}
                    {activeTab === 'create' && renderCreateGroup()}
                    {activeTab === 'manage' && renderManageGroup()}
                </div>
            </div>
        </div>
    );
};