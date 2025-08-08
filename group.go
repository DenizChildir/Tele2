// group.go - Backend implementation for group chat functionality
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Group represents a chat group
type Group struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Description  string     `json:"description,omitempty"`
	CreatedBy    string     `json:"createdBy"`
	CreatedAt    time.Time  `json:"createdAt"`
	AvatarURL    string     `json:"avatarUrl,omitempty"`
	MemberCount  int        `json:"memberCount"`
	LastActivity *time.Time `json:"lastActivity,omitempty"`
	LastMessage  *string    `json:"lastMessage,omitempty"`
}

// GroupMember represents a member of a group
type GroupMember struct {
	GroupID  string    `json:"groupId"`
	UserID   string    `json:"userId"`
	Role     string    `json:"role"` // "admin" or "member"
	JoinedAt time.Time `json:"joinedAt"`
	IsMuted  bool      `json:"isMuted"`
	IsBanned bool      `json:"isBanned"`
}

// GroupMemberWithDetails includes user information
type GroupMemberWithDetails struct {
	GroupMember
	Username string `json:"username,omitempty"`
	IsOnline bool   `json:"isOnline"`
}

// GroupMessage represents a message in a group
type GroupMessage struct {
	ID        string         `json:"id"`
	GroupID   string         `json:"groupId"`
	FromID    string         `json:"fromId"`
	Content   interface{}    `json:"content"`
	Timestamp time.Time      `json:"timestamp"`
	Delivered bool           `json:"delivered"`
	ReadBy    []string       `json:"readBy"`
	Status    string         `json:"status"`
	ReplyTo   *ReplyMetadata `json:"replyTo,omitempty"`
}

// AdminAction represents an admin action in a group
type AdminAction struct {
	Type         string    `json:"type"` // mute, unmute, ban, unban, promote, demote
	GroupID      string    `json:"groupId"`
	TargetUserID string    `json:"targetUserId"`
	PerformedBy  string    `json:"performedBy"`
	Timestamp    time.Time `json:"timestamp"`
	Reason       string    `json:"reason,omitempty"`
}

// GroupNotification represents a system notification in a group
type GroupNotification struct {
	ID        string                 `json:"id"`
	GroupID   string                 `json:"groupId"`
	Type      string                 `json:"type"`
	Message   string                 `json:"message"`
	Timestamp time.Time              `json:"timestamp"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Initialize group-related database tables
func initGroupDB() {
	// Create groups table
	createGroupsTableSQL := `
	CREATE TABLE IF NOT EXISTS groups (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		created_by TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		avatar_url TEXT
	);`

	_, err := db.Exec(createGroupsTableSQL)
	if err != nil {
		log.Fatal("Error creating groups table:", err)
	}

	// Create group members table
	createMembersTableSQL := `
	CREATE TABLE IF NOT EXISTS group_members (
		group_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		role TEXT DEFAULT 'member',
		joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		is_muted BOOLEAN DEFAULT FALSE,
		is_banned BOOLEAN DEFAULT FALSE,
		PRIMARY KEY (group_id, user_id),
		FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
	);`

	_, err = db.Exec(createMembersTableSQL)
	if err != nil {
		log.Fatal("Error creating group_members table:", err)
	}

	// Create group messages table
	createGroupMessagesTableSQL := `
	CREATE TABLE IF NOT EXISTS group_messages (
		id TEXT PRIMARY KEY,
		group_id TEXT NOT NULL,
		from_id TEXT NOT NULL,
		content TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		delivered BOOLEAN DEFAULT TRUE,
		read_by TEXT DEFAULT '[]',
		status TEXT DEFAULT 'sent',
		reply_to TEXT,
		FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
	);`

	_, err = db.Exec(createGroupMessagesTableSQL)
	if err != nil {
		log.Fatal("Error creating group_messages table:", err)
	}

	// Create indexes for performance
	db.Exec("CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_group_messages_timestamp ON group_messages(timestamp)")
}

// API Handlers

// handleCreateGroup creates a new group
func handleCreateGroup(c *fiber.Ctx) error {
	var req struct {
		Name           string   `json:"name"`
		Description    string   `json:"description"`
		CreatedBy      string   `json:"createdBy"`
		InitialMembers []string `json:"initialMembers"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Generate group ID
	groupID := "GROUP_" + generateShortID()

	// Start transaction
	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	// Create group
	_, err = tx.Exec(
		"INSERT INTO groups (id, name, description, created_by) VALUES (?, ?, ?, ?)",
		groupID, req.Name, req.Description, req.CreatedBy,
	)
	if err != nil {
		tx.Rollback()
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create group"})
	}

	// Add creator as admin
	_, err = tx.Exec(
		"INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')",
		groupID, req.CreatedBy,
	)
	if err != nil {
		tx.Rollback()
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add creator"})
	}

	// Add initial members
	for _, userID := range req.InitialMembers {
		if userID != req.CreatedBy && userID != "" {
			_, err = tx.Exec(
				"INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
				groupID, userID,
			)
			if err != nil {
				log.Printf("Failed to add member %s: %v", userID, err)
			}
		}
	}

	group := Group{
		ID:          groupID,
		Name:        req.Name,
		Description: req.Description,
		CreatedBy:   req.CreatedBy,
		CreatedAt:   time.Now(),
		MemberCount: len(req.InitialMembers) + 1,
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to commit"})
	}

	// Get the created group with member count
	group = Group{
		ID:          groupID,
		Name:        req.Name,
		Description: req.Description,
		CreatedBy:   req.CreatedBy,
		CreatedAt:   time.Now(),
		MemberCount: len(req.InitialMembers) + 1,
	}

	allMembers := append(req.InitialMembers, req.CreatedBy)
	for _, memberID := range allMembers {
		if memberID != "" {
			notifyUser(memberID, GroupNotification{
				ID:        generateShortID(),
				GroupID:   groupID,
				Type:      "member_added",
				Message:   fmt.Sprintf("You were added to group '%s'", req.Name),
				Timestamp: time.Now(),
				Metadata: map[string]interface{}{
					"userId":    memberID,
					"groupName": req.Name,
					"groupId":   groupID,
				},
			})
		}
	}

	// Send notification to all members
	notifyGroupMembers(groupID, GroupNotification{
		ID:        generateShortID(),
		GroupID:   groupID,
		Type:      "group_created",
		Message:   "Group created",
		Timestamp: time.Now(),
	})

	return c.JSON(group)
}

func notifyUser(userID string, notification GroupNotification) {
	clientsMux.RLock()
	client, exists := clients[userID]
	clientsMux.RUnlock()

	if exists && client.IsOnline {
		message := map[string]interface{}{
			"messageType": "group_notification",
			"groupId":     notification.GroupID,
			"data":        notification,
		}

		err := client.Conn.WriteJSON(message)
		if err != nil {
			log.Printf("Error sending notification to user %s: %v", userID, err)
		} else {
			log.Printf("Successfully sent group notification to user %s", userID)
		}
	} else {
		log.Printf("User %s is not online, cannot send notification", userID)
	}
}

// handleGetUserGroups returns all groups a user is a member of
func handleGetUserGroups(c *fiber.Ctx) error {
	userID := c.Params("userId")

	query := `
		SELECT g.id, g.name, g.description, g.created_by, g.created_at, g.avatar_url,
			   COUNT(gm.user_id) as member_count
		FROM groups g
		JOIN group_members gm ON g.id = gm.group_id
		WHERE g.id IN (
			SELECT group_id FROM group_members WHERE user_id = ? AND is_banned = FALSE
		)
		GROUP BY g.id
	`

	rows, err := db.Query(query, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		var g Group
		err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.CreatedBy, &g.CreatedAt, &g.AvatarURL, &g.MemberCount)
		if err != nil {
			continue
		}
		groups = append(groups, g)
	}

	return c.JSON(groups)
}

// handleGetGroupMembers returns all members of a group
func handleGetGroupMembers(c *fiber.Ctx) error {
	groupID := c.Params("groupId")

	// First check if the group exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM groups WHERE id = ?)", groupID).Scan(&exists)
	if err != nil {
		log.Printf("Error checking group existence: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	if !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Group not found"})
	}

	// Updated query - removed the invalid u.id as username part
	query := `
        SELECT gm.group_id, gm.user_id, gm.role, gm.joined_at, gm.is_muted, gm.is_banned
        FROM group_members gm
        WHERE gm.group_id = ?
        ORDER BY gm.role DESC, gm.joined_at ASC
    `

	rows, err := db.Query(query, groupID)
	if err != nil {
		log.Printf("Error querying group members for %s: %v", groupID, err)
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var members []GroupMemberWithDetails
	for rows.Next() {
		var m GroupMemberWithDetails
		err := rows.Scan(
			&m.GroupID, &m.UserID, &m.Role, &m.JoinedAt,
			&m.IsMuted, &m.IsBanned,
		)
		if err != nil {
			log.Printf("Error scanning member row: %v", err)
			continue
		}

		// Check if user is online
		clientsMux.RLock()
		_, m.IsOnline = clients[m.UserID]
		clientsMux.RUnlock()

		// For now, use UserID as username since we don't have a users table
		m.Username = m.UserID

		members = append(members, m)
	}

	// If no members array was created, return empty array instead of null
	if members == nil {
		members = []GroupMemberWithDetails{}
	}

	return c.JSON(members)
}

// handleGetGroupMessages returns messages for a group
func handleGetGroupMessages(c *fiber.Ctx) error {
	groupID := c.Params("groupId")
	userID := c.Query("userId")

	// Check if user is a member
	var isMember bool
	err := db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND is_banned = FALSE)",
		groupID, userID,
	).Scan(&isMember)

	if err != nil || !isMember {
		return c.Status(403).JSON(fiber.Map{"error": "Not a member"})
	}

	query := `
		SELECT id, group_id, from_id, content, timestamp, delivered, read_by, status, reply_to
		FROM group_messages
		WHERE group_id = ?
		ORDER BY timestamp DESC
		LIMIT 100
	`

	rows, err := db.Query(query, groupID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var messages []GroupMessage
	for rows.Next() {
		var m GroupMessage
		var readByJSON string
		var replyToJSON sql.NullString

		err := rows.Scan(
			&m.ID, &m.GroupID, &m.FromID, &m.Content,
			&m.Timestamp, &m.Delivered, &readByJSON, &m.Status, &replyToJSON,
		)
		if err != nil {
			continue
		}

		// Parse read_by JSON
		json.Unmarshal([]byte(readByJSON), &m.ReadBy)

		// Parse reply_to if exists
		if replyToJSON.Valid {
			var replyTo ReplyMetadata
			if err := json.Unmarshal([]byte(replyToJSON.String), &replyTo); err == nil {
				m.ReplyTo = &replyTo
			}
		}

		messages = append(messages, m)
	}

	// Reverse to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return c.JSON(messages)
}

// handleAddGroupMembers adds new members to a group
func handleAddGroupMembers(c *fiber.Ctx) error {
	groupID := c.Params("groupId")
	var req struct {
		UserIDs []string `json:"userIds"`
		AddedBy string   `json:"addedBy"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Check if requester is admin (or remove this check if you want any member to add)
	var isAdmin bool
	err := db.QueryRow(
		"SELECT role = 'admin' FROM group_members WHERE group_id = ? AND user_id = ?",
		groupID, req.AddedBy,
	).Scan(&isAdmin)

	// For now, allow any member to add others (you can re-enable admin check later)
	// if err != nil || !isAdmin {
	//     return c.Status(403).JSON(fiber.Map{"error": "Not authorized"})
	// }

	// Get group name for notification
	var groupName string
	db.QueryRow("SELECT name FROM groups WHERE id = ?", groupID).Scan(&groupName)

	// Add members
	successCount := 0
	for _, userID := range req.UserIDs {
		if userID != "" {
			_, err = db.Exec(
				"INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
				groupID, userID,
			)
			if err == nil {
				successCount++

				// Send notification to the added member
				notifyUser(userID, GroupNotification{
					ID:        generateShortID(),
					GroupID:   groupID,
					Type:      "member_added",
					Message:   fmt.Sprintf("You were added to group '%s'", groupName),
					Timestamp: time.Now(),
					Metadata: map[string]interface{}{
						"userId":    userID,
						"groupName": groupName,
						"addedBy":   req.AddedBy,
					},
				})

				// Notify other group members
				notifyGroupMembers(groupID, GroupNotification{
					ID:        generateShortID(),
					GroupID:   groupID,
					Type:      "member_added",
					Message:   fmt.Sprintf("%s was added to the group", userID),
					Timestamp: time.Now(),
					Metadata:  map[string]interface{}{"userId": userID},
				})
			} else {
				log.Printf("Failed to add member %s: %v", userID, err)
			}
		}
	}

	log.Printf("Added %d members to group %s", successCount, groupID)

	// Return updated member list
	return handleGetGroupMembers(c)
}

// handleAdminAction performs admin actions (mute, ban, etc.)
func handleAdminAction(c *fiber.Ctx) error {
	groupID := c.Params("groupId")
	var action AdminAction

	if err := c.BodyParser(&action); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Verify performer is admin
	var isAdmin bool
	err := db.QueryRow(
		"SELECT role = 'admin' FROM group_members WHERE group_id = ? AND user_id = ?",
		groupID, action.PerformedBy,
	).Scan(&isAdmin)

	if err != nil || !isAdmin {
		return c.Status(403).JSON(fiber.Map{"error": "Not authorized"})
	}

	// Perform action
	switch action.Type {
	case "mute":
		_, err = db.Exec(
			"UPDATE group_members SET is_muted = TRUE WHERE group_id = ? AND user_id = ?",
			groupID, action.TargetUserID,
		)
	case "unmute":
		_, err = db.Exec(
			"UPDATE group_members SET is_muted = FALSE WHERE group_id = ? AND user_id = ?",
			groupID, action.TargetUserID,
		)
	case "ban":
		_, err = db.Exec(
			"UPDATE group_members SET is_banned = TRUE WHERE group_id = ? AND user_id = ?",
			groupID, action.TargetUserID,
		)
		// Disconnect banned user
		disconnectUserFromGroup(action.TargetUserID, groupID)
	case "unban":
		_, err = db.Exec(
			"UPDATE group_members SET is_banned = FALSE WHERE group_id = ? AND user_id = ?",
			groupID, action.TargetUserID,
		)
	case "promote":
		_, err = db.Exec(
			"UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?",
			groupID, action.TargetUserID,
		)
	case "demote":
		_, err = db.Exec(
			"UPDATE group_members SET role = 'member' WHERE group_id = ? AND user_id = ?",
			groupID, action.TargetUserID,
		)
	default:
		return c.Status(400).JSON(fiber.Map{"error": "Invalid action"})
	}

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to perform action"})
	}

	// Send notification
	notifyGroupMembers(groupID, GroupNotification{
		ID:        generateShortID(),
		GroupID:   groupID,
		Type:      "admin_action",
		Message:   action.Type + " " + action.TargetUserID,
		Timestamp: time.Now(),
		Metadata:  map[string]interface{}{"action": action.Type, "userId": action.TargetUserID},
	})

	return c.JSON(action)
}

// handleLeaveGroup removes a user from a group
func handleLeaveGroup(c *fiber.Ctx) error {
	groupID := c.Params("groupId")
	var req struct {
		UserID string `json:"userId"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Check if user is the only admin
	var adminCount int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM group_members WHERE group_id = ? AND role = 'admin'",
		groupID,
	).Scan(&adminCount)

	if err == nil && adminCount == 1 {
		var isAdmin bool
		db.QueryRow(
			"SELECT role = 'admin' FROM group_members WHERE group_id = ? AND user_id = ?",
			groupID, req.UserID,
		).Scan(&isAdmin)

		if isAdmin {
			return c.Status(400).JSON(fiber.Map{"error": "Cannot leave - you are the only admin"})
		}
	}

	// Remove from group
	_, err = db.Exec(
		"DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
		groupID, req.UserID,
	)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to leave group"})
	}

	// Send notification
	notifyGroupMembers(groupID, GroupNotification{
		ID:        generateShortID(),
		GroupID:   groupID,
		Type:      "member_left",
		Message:   req.UserID + " left the group",
		Timestamp: time.Now(),
		Metadata:  map[string]interface{}{"userId": req.UserID},
	})

	return c.JSON(fiber.Map{"success": true})
}

// WebSocket message handling for groups

func handleGroupMessage(msg Message) {
	// Extract group ID from toId (format: GROUP_XXXX)
	groupID := msg.ToID
	log.Printf("Handling group message for group: %s from user: %s", groupID, msg.FromID)

	// Check if sender is a valid member and not muted/banned
	var canSend bool
	var isMuted bool
	err := db.QueryRow(
		"SELECT is_muted = FALSE AND is_banned = FALSE, is_muted FROM group_members WHERE group_id = ? AND user_id = ?",
		groupID, msg.FromID,
	).Scan(&canSend, &isMuted)

	if err != nil {
		log.Printf("Error checking member status: %v", err)
		// Send error back to sender
		clientsMux.RLock()
		sender := clients[msg.FromID]
		clientsMux.RUnlock()

		if sender != nil {
			errorMsg := "You are not a member of this group"
			sender.Conn.WriteJSON(Message{
				ID:      "error_" + msg.ID,
				Content: errorMsg,
				FromID:  "system",
				ToID:    msg.FromID,
			})
		}
		return
	}

	if !canSend {
		// Send error back to sender
		clientsMux.RLock()
		sender := clients[msg.FromID]
		clientsMux.RUnlock()

		if sender != nil {
			errorMsg := "You are not a member of this group"
			if isMuted {
				errorMsg = "You are muted in this group"
			}
			sender.Conn.WriteJSON(Message{
				ID:      "error_" + msg.ID,
				Content: errorMsg,
				FromID:  "system",
				ToID:    msg.FromID,
			})
		}
		return
	}

	// Store message
	readByJSON, _ := json.Marshal([]string{msg.FromID})
	var replyToJSON sql.NullString
	if msg.ReplyTo != nil {
		replyToBytes, _ := json.Marshal(msg.ReplyTo)
		replyToJSON = sql.NullString{String: string(replyToBytes), Valid: true}
	}

	contentStr := ""
	switch content := msg.Content.(type) {
	case string:
		contentStr = content
	case map[string]interface{}:
		contentBytes, _ := json.Marshal(content)
		contentStr = string(contentBytes)
	default:
		contentBytes, _ := json.Marshal(content)
		contentStr = string(contentBytes)
	}

	_, err = db.Exec(
		"INSERT INTO group_messages (id, group_id, from_id, content, timestamp, read_by, status, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		msg.ID, groupID, msg.FromID, contentStr, msg.Timestamp, string(readByJSON), msg.Status, replyToJSON,
	)

	if err != nil {
		log.Printf("Failed to store group message: %v", err)
		return
	}

	log.Printf("Stored group message %s in database", msg.ID)

	// Get all group members
	rows, err := db.Query(
		"SELECT user_id FROM group_members WHERE group_id = ? AND is_banned = FALSE",
		groupID,
	)
	if err != nil {
		log.Printf("Failed to get group members: %v", err)
		return
	}
	defer rows.Close()

	// Collect all member IDs
	var memberIDs []string
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			continue
		}
		memberIDs = append(memberIDs, memberID)
	}

	log.Printf("Broadcasting to %d group members", len(memberIDs))

	// Broadcast to all online members
	clientsMux.RLock()
	defer clientsMux.RUnlock()

	successCount := 0
	for _, memberID := range memberIDs {
		if client, exists := clients[memberID]; exists && client.IsOnline {
			// Send as regular message so existing client code can handle it
			err := client.Conn.WriteJSON(Message{
				ID:         msg.ID,
				FromID:     msg.FromID,
				ToID:       groupID,
				Content:    msg.Content,
				Timestamp:  msg.Timestamp,
				Delivered:  true,
				ReadStatus: memberID == msg.FromID,
				Status:     "delivered",
				ReplyTo:    msg.ReplyTo,
			})

			if err != nil {
				log.Printf("Error sending to member %s: %v", memberID, err)
			} else {
				successCount++
				log.Printf("Successfully sent to member %s", memberID)
			}
		} else {
			log.Printf("Member %s is not online", memberID)
		}
	}

	log.Printf("Message broadcast complete. Sent to %d/%d online members", successCount, len(memberIDs))
}

// Helper functions

func generateShortID() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func notifyGroupMembers(groupID string, notification GroupNotification) {
	// Get all group members
	rows, err := db.Query(
		"SELECT user_id FROM group_members WHERE group_id = ? AND is_banned = FALSE",
		groupID,
	)
	if err != nil {
		return
	}
	defer rows.Close()

	clientsMux.RLock()
	defer clientsMux.RUnlock()

	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			continue
		}

		if client, exists := clients[memberID]; exists && client.IsOnline {
			client.Conn.WriteJSON(map[string]interface{}{
				"messageType": "group_notification",
				"groupId":     groupID,
				"data":        notification,
			})
		}
	}
}

func disconnectUserFromGroup(userID, groupID string) {
	clientsMux.RLock()
	client, exists := clients[userID]
	clientsMux.RUnlock()

	if exists && client.IsOnline {
		// Send disconnect notification
		client.Conn.WriteJSON(map[string]interface{}{
			"messageType": "group_disconnect",
			"groupId":     groupID,
			"reason":      "banned",
		})
	}
}

// Add these routes in main() after initDB()
func setupGroupRoutes(app *fiber.App) {
	// Initialize group database
	initGroupDB()

	// Group API routes
	app.Post("/api/groups", handleCreateGroup)
	app.Get("/api/users/:userId/groups", handleGetUserGroups)
	app.Get("/api/groups/:groupId/members", handleGetGroupMembers)
	app.Get("/api/groups/:groupId/messages", handleGetGroupMessages)
	app.Post("/api/groups/:groupId/members", handleAddGroupMembers)
	app.Post("/api/groups/:groupId/admin", handleAdminAction)
	app.Post("/api/groups/:groupId/leave", handleLeaveGroup)
}
