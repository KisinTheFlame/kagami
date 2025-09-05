package handlers

import (
	"net/http"
	"strconv"

	"kagami-console/internal/database"
	"kagami-console/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetLLMLogs 获取 LLM 调用日志列表
func GetLLMLogs(c *gin.Context) {
	var params models.LogQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 构建查询
	query := database.DB.Model(&models.LLMCallLog{})

	// 状态筛选
	if params.Status != nil {
		query = query.Where("status = ?", *params.Status)
	}

	// 时间范围筛选
	if params.StartTime != nil {
		query = query.Where("timestamp >= ?", *params.StartTime)
	}
	if params.EndTime != nil {
		query = query.Where("timestamp <= ?", *params.EndTime)
	}

	// 获取总数
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count records"})
		return
	}

	// 排序
	orderClause := params.OrderBy + " " + params.OrderDirection
	query = query.Order(orderClause)

	// 分页
	offset := (params.Page - 1) * params.Limit
	query = query.Offset(offset).Limit(params.Limit)

	// 执行查询
	var logs []models.LLMCallLog
	if err := query.Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch records"})
		return
	}

	// 返回响应
	response := models.LogQueryResponse{
		Data:  logs,
		Total: total,
		Page:  params.Page,
		Limit: params.Limit,
	}

	c.JSON(http.StatusOK, response)
}

// GetLLMLog 获取单个 LLM 调用日志详情
func GetLLMLog(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var log models.LLMCallLog
	if err := database.DB.First(&log, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Log not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch record"})
		return
	}

	c.JSON(http.StatusOK, log)
}
