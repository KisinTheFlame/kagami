package main

import (
	"fmt"
	"log"
	"path/filepath"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// LLMCallLog 表示 LLM 调用日志
type LLMCallLog struct {
	ID        int       `json:"id" gorm:"primaryKey;autoIncrement"`
	Timestamp time.Time `json:"timestamp" gorm:"column:timestamp;not null"`
	Status    string    `json:"status" gorm:"column:status;not null;check:status IN ('success','fail')"`
	Input     string    `json:"input" gorm:"column:input;not null"`
	Output    string    `json:"output" gorm:"column:output;not null"`
}

func (LLMCallLog) TableName() string {
	return "llm_call_logs"
}

func main() {
	// 数据库路径
	dbPath := filepath.Join("..", "kagami-bot", "data", "kagami.db")

	// 打开数据库连接
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// 创建表（如果不存在）
	if err := db.AutoMigrate(&LLMCallLog{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	fmt.Println("Test data created successfully!")
}
