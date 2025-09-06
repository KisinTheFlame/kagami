package main

import (
	"log"
	"path/filepath"

	"kagami-console/internal/database"
	"kagami-console/internal/handlers"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	// 初始化数据库
	dbPath := filepath.Join("../kagami-bot/data/kagami.db")
	if err := database.InitDB(dbPath); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	// 创建 Gin 路由器
	r := gin.Default()

	// 配置 CORS
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization"}
	r.Use(cors.New(config))

	// 健康检查接口
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// API 路由组
	api := r.Group("/api/v1")
	{
		api.GET("/llm-logs", handlers.GetLLMLogs)
		api.GET("/llm-logs/:id", handlers.GetLLMLog)
	}

	// 启动服务器
	log.Println("Starting server on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
