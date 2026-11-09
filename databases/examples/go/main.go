package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/tursodatabase/libsql-client-go/libsql"
)

func main() {
	url := os.Getenv("DB_URL")
	if url == "" {
		url = "http://test_user.localhost:8080"
	}
	token := os.Getenv("DB_TOKEN")
	if token == "" {
		log.Fatal("DB_TOKEN environment variable required")
	}

	// libsql connection string with auth token
	dbURL := fmt.Sprintf("%s?authToken=%s", url, token)
	fmt.Printf("[Go database/sql] Connecting to %s...\n", url)

	db, err := sql.Open("libsql", dbURL)
	if err != nil {
		log.Fatalf("Failed to open connection: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	// 1. Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS go_services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}

	// 2. Insert record
	serviceName := fmt.Sprintf("microservice-%d", time.Now().Unix())
	fmt.Printf("[Go database/sql] Inserting %s...\n", serviceName)
	res, err := db.Exec(`INSERT INTO go_services (name, status, created_at) VALUES (?, ?, ?);`,
		serviceName, "running", time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		log.Fatalf("Failed to insert record: %v", err)
	}

	insertedID, _ := res.LastInsertId()
	fmt.Printf("[Go database/sql] Inserted ID: %d\n", insertedID)

	// 3. Query record
	fmt.Printf("[Go database/sql] Querying service %d...\n", insertedID)
	var name, status, createdAt string
	var id int64
	err = db.QueryRow(`SELECT id, name, status, created_at FROM go_services WHERE id = ?;`, insertedID).
		Scan(&id, &name, &status, &createdAt)
	if err != nil {
		log.Fatalf("Failed to query row: %v", err)
	}
	fmt.Printf("[Go database/sql] Retrieved: ID=%d Name=%s Status=%s CreatedAt=%s\n", id, name, status, createdAt)

	// 4. Update record
	_, err = db.Exec(`UPDATE go_services SET status = ? WHERE id = ?;`, "active", insertedID)
	if err != nil {
		log.Fatalf("Failed to update row: %v", err)
	}

	err = db.QueryRow(`SELECT status FROM go_services WHERE id = ?;`, insertedID).Scan(&status)
	if err != nil {
		log.Fatalf("Failed to query updated status: %v", err)
	}
	fmt.Printf("[Go database/sql] Updated Status: %s\n", status)

	fmt.Println("✅ [Go database/sql] Test passed successfully!")
}
