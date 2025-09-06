package database

import (
	"fmt"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

// InitDB 初始化数据库连接
func InitDB() error {
	var err error

	// 从环境变量读取数据库配置
	host, err := getEnv("DB_HOST")
	if err != nil {
		return fmt.Errorf("failed to get DB_HOST: %w", err)
	}
	port, err := getEnv("DB_PORT")
	if err != nil {
		return fmt.Errorf("failed to get DB_PORT: %w", err)
	}
	dbName, err := getEnv("DB_NAME")
	if err != nil {
		return fmt.Errorf("failed to get DB_NAME: %w", err)
	}
	user, err := getEnv("DB_USER")
	if err != nil {
		return fmt.Errorf("failed to get DB_USER: %w", err)
	}
	password, err := getEnv("DB_PASSWORD")
	if err != nil {
		return fmt.Errorf("failed to get DB_PASSWORD: %w", err)
	}

	// 构建 PostgreSQL DSN
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbName)

	// GORM 配置
	config := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	}

	// 打开数据库连接
	DB, err = gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	// 配置连接池
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get sql.DB: %w", err)
	}

	// 设置连接池参数
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	return nil
}

// getEnv 获取环境变量
func getEnv(key string) (string, error) {
	if value := os.Getenv(key); value != "" {
		return value, nil
	}
	return "", fmt.Errorf("environment variable %s not set", key)
}
