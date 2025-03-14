package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"log"
	"math/rand"
	"os"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	_ "github.com/mattn/go-sqlite3"
)

type MessageContent struct {
	Type string    `json:"type,omitempty"`
	Text string    `json:"text,omitempty"`
	File *FileInfo `json:"file,omitempty"`
}

type FileInfo struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	Type         string `json:"type"`
	LastModified int64  `json:"lastModified,omitempty"`
}

type SignalingMessage struct {
	Type      string      `json:"type"`
	FromID    string      `json:"fromId"`
	ToID      string      `json:"toId"`
	Offer     interface{} `json:"offer,omitempty"`
	Answer    interface{} `json:"answer,omitempty"`
	Candidate interface{} `json:"candidate,omitempty"`
}

// Message represents a chat message
type Message struct {
	ID         string      `json:"id"`
	FromID     string      `json:"fromId"`
	ToID       string      `json:"toId"`
	Content    interface{} `json:"content"` // Can be string or MessageContent
	Timestamp  time.Time   `json:"timestamp"`
	Delivered  bool        `json:"delivered"`
	ReadStatus bool        `json:"readStatus"`
	Status     string      `json:"status"`
}

// Client represents a connected websocket client
type Client struct {
	ID       string
	Conn     *websocket.Conn
	IsOnline bool
}

// Global variables
var (
	clients    = make(map[string]*Client)
	clientsMux sync.RWMutex
	db         *sql.DB
)

type MessageType struct {
	MessageType string `json:"messageType"`
}

func main() {
	// Add command line flags for configuration
	port := flag.String("port", "3000", "Port to run the server on")
	certFile := flag.String("cert", "", "TLS certificate file path")
	keyFile := flag.String("key", "", "TLS key file path")
	flag.Parse()

	// Override with environment variables if present
	if envPort := os.Getenv("PORT"); envPort != "" {
		*port = envPort
	}
	if envCert := os.Getenv("TLS_CERT"); envCert != "" {
		*certFile = envCert
	}
	if envKey := os.Getenv("TLS_KEY"); envKey != "" {
		*keyFile = envKey
	}

	// Initialize random seed
	rand.Seed(time.Now().UnixNano())

	// Initialize SQLite database
	initDB()

	app := fiber.New(fiber.Config{
		// Add generous timeouts for WebSocket connections
		ReadTimeout:  time.Minute * 2,
		WriteTimeout: time.Minute * 2,
	})

	// Add CORS middleware with permissive settings for development
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		AllowMethods: "GET, POST, HEAD, PUT, DELETE, PATCH",
		// Don't use AllowCredentials with wildcard origins
		AllowCredentials: false,
	}))

	// Serve static files from the build directory
	app.Static("/", "./build")

	// WebSocket upgrade middleware
	app.Use("/ws/:id", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// API Routes
	app.Get("/ws/:id", websocket.New(handleWebSocket))
	app.Get("/api/generate-id", handleGenerateID)
	app.Get("/api/status/:id", handleUserStatus)
	app.Get("/api/messages/:userId", handleGetAllMessages)
	app.Delete("/api/messages/:userId/:contactId", handleDeleteMessages)

	// Catch-all route to serve index.html for client-side routing
	app.Get("/*", func(c *fiber.Ctx) error {
		return c.SendFile("./build/index.html")
	})

	// Create proper address string
	addr := fmt.Sprintf("0.0.0.0:%s", *port)

	// Log the server mode and address
	if *certFile != "" && *keyFile != "" {
		log.Printf("Server starting with HTTPS on %s", addr)
		if err := app.ListenTLS(addr, *certFile, *keyFile); err != nil {
			log.Fatalf("Error starting HTTPS server: %v", err)
		}
	} else {
		log.Printf("Server starting on %s (HTTP)", addr)
		if err := app.Listen(addr); err != nil {
			log.Fatalf("Error starting HTTP server: %v", err)
		}
	}
}
func getMessageContentString(content interface{}) string {
	switch v := content.(type) {
	case string:
		return v
	case map[string]interface{}:
		if text, ok := v["text"].(string); ok {
			return text
		}
		return ""
	default:
		return ""
	}
}
func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./messages.db")
	if err != nil {
		log.Fatal(err)
	}

	// Create messages table if it doesn't exist
	createTableSQL := `
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_id TEXT,
        to_id TEXT,
        content TEXT,
        timestamp DATETIME,
        delivered BOOLEAN,
        read_status BOOLEAN,
        status TEXT DEFAULT 'sent'
    );`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func handleDeleteMessages(c *fiber.Ctx) error {
	userID := c.Params("userId")
	contactID := c.Params("contactId")

	// Start a transaction
	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to start transaction",
		})
	}

	// Delete messages in both directions
	deleteQuery := `
        DELETE FROM messages 
        WHERE (from_id = ? AND to_id = ?) 
           OR (from_id = ? AND to_id = ?)
    `

	_, err = tx.Exec(deleteQuery, userID, contactID, contactID, userID)
	if err != nil {
		tx.Rollback()
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to delete messages",
		})
	}

	// Commit the transaction
	err = tx.Commit()
	if err != nil {
		tx.Rollback()
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
	})
}

func handleGetAllMessages(c *fiber.Ctx) error {
	userID := c.Params("userId")

	query := `
    SELECT id, from_id, to_id, content, timestamp, delivered, read_status
    FROM messages
    WHERE from_id = ? OR to_id = ?
    ORDER BY timestamp ASC
    `

	rows, err := db.Query(query, userID, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to fetch messages",
		})
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		err := rows.Scan(
			&msg.ID,
			&msg.FromID,
			&msg.ToID,
			&msg.Content,
			&msg.Timestamp,
			&msg.Delivered,
			&msg.ReadStatus,
		)
		if err != nil {
			continue
		}
		messages = append(messages, msg)
	}

	return c.JSON(messages)
}

func handleGenerateID(c *fiber.Ctx) error {
	// Generate a 4-character ID
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 4)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return c.JSON(fiber.Map{
		"id": string(b),
	})
}

func handleUserStatus(c *fiber.Ctx) error {
	userID := c.Params("id")
	clientsMux.RLock()
	client, exists := clients[userID]
	clientsMux.RUnlock()

	return c.JSON(fiber.Map{
		"online": exists && client.IsOnline,
	})
}

func handleWebSocket(c *websocket.Conn) {
	userID := c.Params("id")
	log.Printf("New WebSocket connection established for user: %s", userID)

	// Register new client
	client := &Client{
		ID:       userID,
		Conn:     c,
		IsOnline: true,
	}

	clientsMux.Lock()
	clients[userID] = client
	log.Printf("Registered client. Total connected clients: %d", len(clients))
	clientsMux.Unlock()

	// Broadcast that user is online
	log.Printf("Broadcasting online status for user: %s", userID)
	broadcastUserStatus(userID, true)

	// Send all messages
	log.Printf("Sending all messages for user: %s", userID)
	sendAllMessages(userID)

	// Send current online users status
	log.Printf("Sending online users status to user: %s", userID)
	sendCurrentOnlineUsers(client)

	// WebSocket message handling loop
	for {
		_, rawMessage, err := c.ReadMessage() // Remove unused messageType variable
		if err != nil {
			log.Printf("Error reading message: %v", err)
			break
		}

		// First try to determine the message type
		var msgType MessageType
		if err := json.Unmarshal(rawMessage, &msgType); err == nil {
			if msgType.MessageType == "webrtc_signaling" {
				var signalingMsg SignalingMessage
				if err := json.Unmarshal(rawMessage, &signalingMsg); err != nil {
					log.Printf("Error parsing signaling message: %v", err)
					continue
				}
				log.Printf("Processing WebRTC signaling message type %s from %s to %s",
					signalingMsg.Type, signalingMsg.FromID, signalingMsg.ToID)
				handleSignalingMessage(signalingMsg)
				continue
			}
		}

		// If not a signaling message, parse as a regular chat message
		var msg Message
		if err := json.Unmarshal(rawMessage, &msg); err != nil {
			log.Printf("Error parsing message: %v", err)
			continue
		}

		log.Printf("Processing message from %s to %s: %+v", msg.FromID, msg.ToID, msg)

		// Ensure timestamp is set
		if msg.Timestamp.IsZero() {
			msg.Timestamp = time.Now()
		}

		// Ensure status is set
		if msg.Status == "" {
			msg.Status = "sent"
		}

		switch content := getMessageContentString(msg.Content); content {
		case "delivered":
			// Handle delivery confirmation
			log.Printf("Processing delivery confirmation from %s for message to %s",
				msg.FromID, msg.ToID)
			updateMessageStatus(msg.ToID, true, false)
			msg.Status = "delivered"
			delivered := deliverMessage(msg)
			if !delivered {
				log.Printf("Storing undelivered delivery confirmation")
				storeMessage(msg)
			}

		case "read":
			// Handle read receipt
			log.Printf("Processing read receipt from %s for message to %s",
				msg.FromID, msg.ToID)
			updateMessageStatus(msg.ToID, true, true)
			msg.Status = "read"
			delivered := deliverMessage(msg)
			if !delivered {
				log.Printf("Storing undelivered read receipt")
				storeMessage(msg)
			}

		case "status_update":
			log.Printf("Processing status update from %s", msg.FromID)
			continue

		default:
			log.Printf("Processing regular message from %s to %s", msg.FromID, msg.ToID)
			delivered := deliverMessage(msg)
			if !delivered {
				log.Printf("Storing undelivered message")
				storeMessage(msg)
			}
		}
	}

	// Cleanup when connection closes
	clientsMux.Lock()
	if client, exists := clients[userID]; exists {
		client.IsOnline = false
		delete(clients, userID)
	}
	clientsMux.Unlock()

	// Broadcast that user is offline
	broadcastUserStatus(userID, false)
	log.Printf("WebSocket connection closed for user: %s", userID)
}

func handleSignalingMessage(msg SignalingMessage) {
	log.Printf("Handling WebRTC signaling message: %v", msg)
	clientsMux.RLock()
	recipient, exists := clients[msg.ToID]
	clientsMux.RUnlock()

	if exists && recipient.Conn != nil {
		if err := recipient.Conn.WriteJSON(msg); err != nil {
			log.Printf("Error sending signaling message: %v", err)
		}
	} else {
		log.Printf("Recipient %s not available for signaling message", msg.ToID)
	}
}

func broadcastUserStatus(userID string, online bool) {
	statusMsg := Message{
		ID:      "status_" + userID,
		Content: "status_update",
		FromID:  userID,
		Status:  map[bool]string{true: "online", false: "offline"}[online],
	}

	clientsMux.RLock()
	defer clientsMux.RUnlock()

	// Broadcast to all connected clients except the user themselves
	for _, client := range clients {
		if client.IsOnline && client.ID != userID {
			client.Conn.WriteJSON(statusMsg)
		}
	}
}

func sendAllMessages(userID string) {
	query := `
    SELECT id, from_id, to_id, content, timestamp, delivered, read_status
    FROM messages
    WHERE from_id = ? OR to_id = ?
    ORDER BY timestamp ASC
    `

	rows, err := db.Query(query, userID, userID)
	if err != nil {
		log.Printf("Error querying all messages: %v", err)
		return
	}
	defer rows.Close()

	clientsMux.RLock()
	recipient := clients[userID]
	clientsMux.RUnlock()

	if recipient == nil {
		return
	}

	// Prepare a transaction for updating message status
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		return
	}

	updateStmt, err := tx.Prepare(`
        UPDATE messages
        SET delivered = true
        WHERE id = ? AND to_id = ? AND delivered = false
    `)
	if err != nil {
		log.Printf("Error preparing update statement: %v", err)
		tx.Rollback()
		return
	}
	defer updateStmt.Close()

	for rows.Next() {
		var msg Message
		err := rows.Scan(
			&msg.ID,
			&msg.FromID,
			&msg.ToID,
			&msg.Content,
			&msg.Timestamp,
			&msg.Delivered,
			&msg.ReadStatus,
		)
		if err != nil {
			log.Printf("Error scanning message: %v", err)
			continue
		}

		// Send message to user
		err = recipient.Conn.WriteJSON(msg)
		if err != nil {
			log.Printf("Error sending message: %v", err)
			continue
		}

		// If this is a received message that hasn't been delivered yet
		if msg.ToID == userID && !msg.Delivered {
			// Mark as delivered in database
			_, err = updateStmt.Exec(msg.ID, userID)
			if err != nil {
				log.Printf("Error updating message status: %v", err)
				continue
			}

			// Send delivery confirmation to original sender
			deliveryConfirmation := Message{
				ID:        "delivery_" + msg.ID,
				FromID:    msg.ToID,
				ToID:      msg.FromID,
				Content:   "delivered",
				Timestamp: time.Now(),
				Delivered: true,
				Status:    "delivered",
			}

			clientsMux.RLock()
			sender := clients[msg.FromID]
			clientsMux.RUnlock()

			if sender != nil {
				sender.Conn.WriteJSON(deliveryConfirmation)
			}
		}
	}

	// Commit the transaction
	err = tx.Commit()
	if err != nil {
		log.Printf("Error committing transaction: %v", err)
		tx.Rollback()
	}
}

func sendCurrentOnlineUsers(newClient *Client) {
	clientsMux.RLock()
	defer clientsMux.RUnlock()

	// Send status of all online users to the new client
	for clientID, client := range clients {
		if client.IsOnline && clientID != newClient.ID {
			statusMsg := Message{
				ID:      "status_" + clientID,
				Content: "status_update",
				FromID:  clientID,
				Status:  "online",
			}
			newClient.Conn.WriteJSON(statusMsg)
		}
	}
}
func updateMessageStatus(messageID string, delivered bool, read bool) {
	query := `
    UPDATE messages 
    SET delivered = ?, read_status = ?
    WHERE id = ?
    `

	_, err := db.Exec(query, delivered, read, messageID)
	if err != nil {
		log.Printf("Error updating message status: %v", err)
	}
}

func deliverMessage(msg Message) bool {
	clientsMux.RLock()
	recipient, exists := clients[msg.ToID]
	clientsMux.RUnlock()

	if exists && recipient.IsOnline {
		err := recipient.Conn.WriteJSON(msg)
		if err != nil {
			log.Printf("Error sending message: %v", err)
			return false
		}

		// Send delivery confirmation to sender if this is a regular message
		if msg.Content != "delivered" && msg.Content != "read" {
			deliveryConfirmation := Message{
				ID:        "delivery_" + msg.ID,
				FromID:    msg.ToID,
				ToID:      msg.FromID,
				Content:   "delivered",
				Timestamp: time.Now(),
				Delivered: true,
				Status:    "delivered",
			}

			clientsMux.RLock()
			sender := clients[msg.FromID]
			clientsMux.RUnlock()

			if sender != nil {
				sender.Conn.WriteJSON(deliveryConfirmation)
			}
		}

		// If this is a read receipt, update the message status in the database
		if msg.Content == "read" {
			updateMessageStatus(msg.ID, true, true)
		}

		return true
	}
	return false
}

func storeMessage(msg Message) {
	contentStr := ""
	switch content := msg.Content.(type) {
	case string:
		contentStr = content
	case map[string]interface{}:
		contentBytes, err := json.Marshal(content)
		if err == nil {
			contentStr = string(contentBytes)
		}
	}

	query := `
        INSERT INTO messages (id, from_id, to_id, content, timestamp, delivered, read_status, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `

	_, err := db.Exec(query,
		msg.ID,
		msg.FromID,
		msg.ToID,
		contentStr,
		msg.Timestamp,
		msg.Delivered,
		msg.ReadStatus,
		msg.Status,
	)

	if err != nil {
		log.Printf("Error storing message: %v", err)
	}
}

func sendOfflineMessages(userID string) {
	// First, get all undelivered messages
	query := `
    SELECT id, from_id, to_id, content, timestamp, delivered, read_status
    FROM messages
    WHERE to_id = ? AND delivered = false
    `

	rows, err := db.Query(query, userID)
	if err != nil {
		log.Printf("Error querying offline messages: %v", err)
		return
	}
	defer rows.Close()

	clientsMux.RLock()
	recipient := clients[userID]
	clientsMux.RUnlock()

	// Prepare a transaction for updating multiple messages
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error starting transaction: %v", err)
		return
	}

	updateStmt, err := tx.Prepare(`
        UPDATE messages
        SET delivered = true
        WHERE id = ?
    `)
	if err != nil {
		log.Printf("Error preparing update statement: %v", err)
		tx.Rollback()
		return
	}
	defer updateStmt.Close()

	for rows.Next() {
		var msg Message
		err := rows.Scan(
			&msg.ID,
			&msg.FromID,
			&msg.ToID,
			&msg.Content,
			&msg.Timestamp,
			&msg.Delivered,
			&msg.ReadStatus,
		)
		if err != nil {
			log.Printf("Error scanning message: %v", err)
			continue
		}

		// Send stored message to now-online user
		if recipient != nil {
			err = recipient.Conn.WriteJSON(msg)
			if err != nil {
				log.Printf("Error sending stored message: %v", err)
				continue
			}

			// Mark message as delivered within the transaction
			_, err = updateStmt.Exec(msg.ID)
			if err != nil {
				log.Printf("Error updating message status: %v", err)
				continue
			}

			// Send delivery confirmation to original sender
			deliveryConfirmation := Message{
				ID:        "delivery_" + msg.ID,
				FromID:    msg.ToID,
				ToID:      msg.FromID,
				Content:   "delivered",
				Timestamp: time.Now(),
				Delivered: true,
			}

			clientsMux.RLock()
			sender := clients[msg.FromID]
			clientsMux.RUnlock()

			if sender != nil {
				sender.Conn.WriteJSON(deliveryConfirmation)
			}
		}
	}

	// Commit the transaction
	err = tx.Commit()
	if err != nil {
		log.Printf("Error committing transaction: %v", err)
		tx.Rollback()
	}
}
