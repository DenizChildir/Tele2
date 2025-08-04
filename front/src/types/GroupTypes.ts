export interface Group {
    id: string;
    name: string;
    description?: string;
    createdBy: string;
    createdAt: string;
    avatarUrl?: string;
    memberCount: number;
    lastActivity?: string;
    lastMessage?: string;
}

export interface GroupMember {
    groupId: string;
    userId: string;
    role: 'admin' | 'member';
    joinedAt: string;
    isMuted: boolean;
    isBanned: boolean;
}

export interface GroupMemberWithDetails extends GroupMember {
    username?: string;
    isOnline?: boolean;
}

export interface GroupMessage {
    id: string;
    groupId: string;
    fromId: string;
    content: string | MessageContent;
    timestamp: string;
    delivered: boolean;
    readBy: string[]; // Array of user IDs who have read the message
    status: 'sent' | 'delivered' | 'read';
    replyTo?: ReplyMetadata;
}

// Admin action types
export type AdminActionType = 'mute' | 'unmute' | 'ban' | 'unban' | 'promote' | 'demote';

export interface AdminAction {
    type: AdminActionType;
    groupId: string;
    targetUserId: string;
    performedBy: string;
    timestamp: string;
    reason?: string;
}

// Group creation/update interfaces
export interface CreateGroupRequest {
    name: string;
    description?: string;
    initialMembers?: string[]; // User IDs to add initially
}

export interface UpdateGroupRequest {
    groupId: string;
    name?: string;
    description?: string;
    avatarUrl?: string;
}

export interface AddMembersRequest {
    groupId: string;
    userIds: string[];
}

export interface GroupNotification {
    id: string;
    groupId: string;
    type: 'member_added' | 'member_removed' | 'member_left' | 'admin_action' | 'group_updated';
    message: string;
    timestamp: string;
    metadata?: {
        userId?: string;
        action?: AdminActionType;
        updatedFields?: string[];
    };
}

// WebSocket message types for groups
export interface GroupWebSocketMessage {
    messageType: 'group_message' | 'group_notification' | 'group_admin_action';
    groupId: string;
    data: GroupMessage | GroupNotification | AdminAction;
}

// Group state for Redux
export interface GroupState {
    groups: { [groupId: string]: Group };
    groupMembers: { [groupId: string]: GroupMemberWithDetails[] };
    groupMessages: { [groupId: string]: GroupMessage[] };
    currentGroupId: string | null;
    loading: boolean;
    error: string | null;
    unreadCounts: { [groupId: string]: number };
}

// Import types from main types file to avoid duplication
import { MessageContent, ReplyMetadata } from '../types/types';