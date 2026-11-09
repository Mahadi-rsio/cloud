package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/glebarez/sqlite"
	_ "github.com/tursodatabase/libsql-client-go/libsql"
	"gorm.io/gorm"
)

type GormDeployment struct {
	ID        uint      `gorm:"primaryKey"`
	AppName   string    `gorm:"not null"`
	Region    string    `gorm:"not null"`
	Status    string    `gorm:"not null"`
	CreatedAt time.Time
}

func main() {
	url := os.Getenv("DB_URL")
	if url == "" {
		url = "http://test_user.localhost:8080"
	}
	token := os.Getenv("DB_TOKEN")
	if token == "" {
		log.Fatal("DB_TOKEN environment variable required")
	}

	dbURL := fmt.Sprintf("%s?authToken=%s", url, token)
	fmt.Printf("[GORM] Connecting through libsql driver to %s...\n", url)

	sqlDB, err := sql.Open("libsql", dbURL)
	if err != nil {
		log.Fatalf("Failed to open underlying libsql connection: %v", err)
	}
	defer sqlDB.Close()

	db, err := gorm.Open(&sqlite.Dialector{
		Conn: sqlDB,
	}, &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to initialize GORM: %v", err)
	}

	// 1. Auto Migrate schema
	fmt.Println("[GORM] Auto-migrating table...")
	if err := db.AutoMigrate(&GormDeployment{}); err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}

	// 2. Insert record via GORM
	deployment := GormDeployment{
		AppName:   fmt.Sprintf("web-worker-%d", time.Now().Unix()),
		Region:    "iad",
		Status:    "provisioning",
		CreatedAt: time.Now(),
	}
	fmt.Printf("[GORM] Creating record for %s...\n", deployment.AppName)
	result := db.Create(&deployment)
	if result.Error != nil {
		log.Fatalf("Create failed: %v", result.Error)
	}
	fmt.Printf("[GORM] Created record with ID: %d\n", deployment.ID)

	// 3. Query record via GORM
	fmt.Printf("[GORM] Querying record ID: %d...\n", deployment.ID)
	var found GormDeployment
	if err := db.First(&found, deployment.ID).Error; err != nil {
		log.Fatalf("First failed: %v", err)
	}
	fmt.Printf("[GORM] Retrieved: ID=%d AppName=%s Status=%s Region=%s\n",
		found.ID, found.AppName, found.Status, found.Region)

	// 4. Update record via GORM
	fmt.Println("[GORM] Updating status to 'healthy'...")
	if err := db.Model(&found).Update("Status", "healthy").Error; err != nil {
		log.Fatalf("Update failed: %v", err)
	}

	var updated GormDeployment
	db.First(&updated, deployment.ID)
	fmt.Printf("[GORM] Verified updated status: %s\n", updated.Status)

	fmt.Println("✅ [GORM] Test passed successfully!")
}
