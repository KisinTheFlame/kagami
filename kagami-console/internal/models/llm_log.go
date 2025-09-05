package models

// LLMCallLog 表示 LLM 调用日志
type LLMCallLog struct {
	ID        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Timestamp string `json:"timestamp" gorm:"column:timestamp;not null"`
	Status    string `json:"status" gorm:"column:status;not null;check:status IN ('success','fail')"`
	Input     string `json:"input" gorm:"column:input;not null"`
	Output    string `json:"output" gorm:"column:output;not null"`
}

// TableName 指定表名
func (LLMCallLog) TableName() string {
	return "llm_call_logs"
}

// LogQueryParams LLM 日志查询参数
type LogQueryParams struct {
	Page           int     `form:"page,default=1" binding:"min=1"`
	Limit          int     `form:"limit,default=20" binding:"min=1,max=100"`
	Status         *string `form:"status" binding:"omitempty,oneof=success fail"`
	StartTime      *string `form:"start_time"`
	EndTime        *string `form:"end_time"`
	OrderBy        string  `form:"order_by,default=timestamp" binding:"oneof=timestamp status id"`
	OrderDirection string  `form:"order_direction,default=desc" binding:"oneof=asc desc"`
}

// LogQueryResponse LLM 日志查询响应
type LogQueryResponse struct {
	Data  []LLMCallLog `json:"data"`
	Total int64        `json:"total"`
	Page  int          `json:"page"`
	Limit int          `json:"limit"`
}
