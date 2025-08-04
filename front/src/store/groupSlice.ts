// groupSlice.ts - Redux state management for group chat
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import {
    Group,
    GroupMember,
    GroupMemberWithDetails,
    GroupMessage,
    GroupState,
    CreateGroupRequest,
    UpdateGroupRequest,
    AddMembersRequest,
    AdminAction,
    GroupNotification
} from '../types/GroupTypes';
import * as fileStorage from './fileStorage';
import { config } from '../config';

const initialState: GroupState = {
    groups: {},
    groupMembers: {},
    groupMessages: {},
    currentGroupId: null,
    loading: false,
    error: null,
    unreadCounts: {}
};

// Async thunks for API calls
export const createGroupAsync = createAsyncThunk(
    'groups/createGroup',
    async ({ request, userId }: { request: CreateGroupRequest; userId: string }) => {
        const response = await fetch(`${config.apiUrl}/api/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, createdBy: userId })
        });

        if (!response.ok) throw new Error('Failed to create group');
        const group: Group = await response.json();

        // Save to local storage
        await fileStorage.saveGroup(group);

        return group;
    }
);

export const fetchUserGroupsAsync = createAsyncThunk(
    'groups/fetchUserGroups',
    async (userId: string) => {
        const response = await fetch(`${config.apiUrl}/api/users/${userId}/groups`);
        if (!response.ok) throw new Error('Failed to fetch groups');

        const groups: Group[] = await response.json();

        // Save to local storage
        for (const group of groups) {
            await fileStorage.saveGroup(group);
        }

        return groups;
    }
);

export const fetchGroupMembersAsync = createAsyncThunk(
    'groups/fetchGroupMembers',
    async (groupId: string) => {
        const response = await fetch(`${config.apiUrl}/api/groups/${groupId}/members`);
        if (!response.ok) throw new Error('Failed to fetch group members');

        const members: GroupMemberWithDetails[] = await response.json();
        return { groupId, members };
    }
);

export const fetchGroupMessagesAsync = createAsyncThunk(
    'groups/fetchGroupMessages',
    async (groupId: string) => {
        const response = await fetch(`${config.apiUrl}/api/groups/${groupId}/messages`);
        if (!response.ok) throw new Error('Failed to fetch group messages');

        const messages: GroupMessage[] = await response.json();

        // Save to local storage
        for (const message of messages) {
            await fileStorage.saveGroupMessage(message);
        }

        return { groupId, messages };
    }
);

export const addGroupMembersAsync = createAsyncThunk(
    'groups/addMembers',
    async (request: AddMembersRequest) => {
        const response = await fetch(`${config.apiUrl}/api/groups/${request.groupId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: request.userIds })
        });

        if (!response.ok) throw new Error('Failed to add members');
        const members: GroupMemberWithDetails[] = await response.json();

        return { groupId: request.groupId, members };
    }
);

export const performAdminActionAsync = createAsyncThunk(
    'groups/performAdminAction',
    async (action: AdminAction) => {
        const response = await fetch(`${config.apiUrl}/api/groups/${action.groupId}/admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action)
        });

        if (!response.ok) throw new Error('Failed to perform admin action');
        return action;
    }
);

export const leaveGroupAsync = createAsyncThunk(
    'groups/leaveGroup',
    async ({ groupId, userId }: { groupId: string; userId: string }) => {
        const response = await fetch(`${config.apiUrl}/api/groups/${groupId}/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });

        if (!response.ok) throw new Error('Failed to leave group');

        // Clean up local storage
        await fileStorage.deleteGroupData(groupId, userId);

        return { groupId, userId };
    }
);

const groupSlice = createSlice({
    name: 'groups',
    initialState,
    reducers: {
        setCurrentGroup(state, action: PayloadAction<string | null>) {
            state.currentGroupId = action.payload;

            // Reset unread count for current group
            if (action.payload && state.unreadCounts[action.payload]) {
                state.unreadCounts[action.payload] = 0;
            }
        },

        addGroupMessage(state, action: PayloadAction<GroupMessage>) {
            const { groupId } = action.payload;
            if (!state.groupMessages[groupId]) {
                state.groupMessages[groupId] = [];
            }

            // Check if message already exists
            const exists = state.groupMessages[groupId].some(msg => msg.id === action.payload.id);
            if (!exists) {
                state.groupMessages[groupId].push(action.payload);

                // Update last activity and message
                if (state.groups[groupId]) {
                    state.groups[groupId].lastActivity = action.payload.timestamp;
                    state.groups[groupId].lastMessage =
                        typeof action.payload.content === 'string'
                            ? action.payload.content
                            : 'File';
                }

                // Increment unread count if not current group
                if (groupId !== state.currentGroupId) {
                    state.unreadCounts[groupId] = (state.unreadCounts[groupId] || 0) + 1;
                }
            }
        },

        markGroupMessageAsRead(state, action: PayloadAction<{ groupId: string; messageId: string; userId: string }>) {
            const { groupId, messageId, userId } = action.payload;
            const messages = state.groupMessages[groupId];

            if (messages) {
                const message = messages.find(msg => msg.id === messageId);
                if (message && !message.readBy.includes(userId)) {
                    message.readBy.push(userId);
                }
            }
        },

        updateGroupMemberStatus(state, action: PayloadAction<{ groupId: string; userId: string; updates: Partial<GroupMember> }>) {
            const { groupId, userId, updates } = action.payload;
            const members = state.groupMembers[groupId];

            if (members) {
                const member = members.find(m => m.userId === userId);
                if (member) {
                    Object.assign(member, updates);
                }
            }
        },

        updateGroupInfo(state, action: PayloadAction<{ groupId: string; updates: Partial<Group> }>) {
            const { groupId, updates } = action.payload;
            if (state.groups[groupId]) {
                Object.assign(state.groups[groupId], updates);
            }
        },

        addGroupNotification(state, action: PayloadAction<GroupNotification>) {
            const { groupId } = action.payload;

            // Convert notification to a system message
            const systemMessage: GroupMessage = {
                id: action.payload.id,
                groupId,
                fromId: 'system',
                content: action.payload.message,
                timestamp: action.payload.timestamp,
                delivered: true,
                readBy: [],
                status: 'delivered'
            };

            if (!state.groupMessages[groupId]) {
                state.groupMessages[groupId] = [];
            }
            state.groupMessages[groupId].push(systemMessage);
        },

        clearGroupMessages(state, action: PayloadAction<string>) {
            const groupId = action.payload;
            if (state.groupMessages[groupId]) {
                state.groupMessages[groupId] = [];
            }
        },

        clearGroupError(state) {
            state.error = null;
        }
    },

    extraReducers: (builder) => {
        // Create group
        builder.addCase(createGroupAsync.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(createGroupAsync.fulfilled, (state, action) => {
            state.groups[action.payload.id] = action.payload;
            state.loading = false;
        });
        builder.addCase(createGroupAsync.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message || 'Failed to create group';
        });

        // Fetch user groups
        builder.addCase(fetchUserGroupsAsync.fulfilled, (state, action) => {
            action.payload.forEach(group => {
                state.groups[group.id] = group;
                if (!state.unreadCounts[group.id]) {
                    state.unreadCounts[group.id] = 0;
                }
            });
        });

        // Fetch group members
        builder.addCase(fetchGroupMembersAsync.fulfilled, (state, action) => {
            state.groupMembers[action.payload.groupId] = action.payload.members;
        });

        // Fetch group messages
        builder.addCase(fetchGroupMessagesAsync.fulfilled, (state, action) => {
            state.groupMessages[action.payload.groupId] = action.payload.messages;
        });

        // Add members
        builder.addCase(addGroupMembersAsync.fulfilled, (state, action) => {
            state.groupMembers[action.payload.groupId] = action.payload.members;

            // Update member count
            if (state.groups[action.payload.groupId]) {
                state.groups[action.payload.groupId].memberCount = action.payload.members.length;
            }
        });

        // Admin actions
        builder.addCase(performAdminActionAsync.fulfilled, (state, action) => {
            const { groupId, targetUserId, type } = action.payload;
            const members = state.groupMembers[groupId];

            if (members) {
                const member = members.find(m => m.userId === targetUserId);
                if (member) {
                    switch (type) {
                        case 'mute':
                            member.isMuted = true;
                            break;
                        case 'unmute':
                            member.isMuted = false;
                            break;
                        case 'ban':
                            member.isBanned = true;
                            break;
                        case 'unban':
                            member.isBanned = false;
                            break;
                        case 'promote':
                            member.role = 'admin';
                            break;
                        case 'demote':
                            member.role = 'member';
                            break;
                    }
                }
            }
        });

        // Leave group
        builder.addCase(leaveGroupAsync.fulfilled, (state, action) => {
            const { groupId } = action.payload;

            // Remove group from state
            delete state.groups[groupId];
            delete state.groupMembers[groupId];
            delete state.groupMessages[groupId];
            delete state.unreadCounts[groupId];

            // Clear current group if it was the one we left
            if (state.currentGroupId === groupId) {
                state.currentGroupId = null;
            }
        });
    }
});

export const {
    setCurrentGroup,
    addGroupMessage,
    markGroupMessageAsRead,
    updateGroupMemberStatus,
    updateGroupInfo,
    addGroupNotification,
    clearGroupMessages,
    clearGroupError
} = groupSlice.actions;

export default groupSlice.reducer;