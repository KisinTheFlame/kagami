# 控制台系统

## 概述

Kagami Console 是一个独立的 Web 控制台系统，用于监控和管理 Kagami QQ 机器人。由 Go 后端 API 和 React 前端组成，提供 LLM 调用历史的查询、筛选和分析功能。

## 架构设计

### 系统组成
```
Kagami Console System
├── kagami-console/          # Go 后端 API
│   ├── RESTful API 服务
│   ├── SQLite 数据库访问
│   └── CORS 跨域支持
├── kagami-console-web/      # React 前端
│   ├── Ant Design 深色主题
│   ├── 数据表格和筛选
│   └── 响应式界面
└── nginx 代理配置
    ├── 静态文件托管
    └── API 请求代理
```

### 独立架构原则
- **配置文件隔离**：每个子项目独立的 `package.json`、`tsconfig.json`、`env.yaml`
- **技术栈分离**：后端 Go、前端 React，与机器人的 Node.js 技术栈分离
- **部署独立**：可单独构建、部署和扩展

## 核心功能

### LLM 调用历史管理
- **数据查询**：分页查询 LLM 调用记录
- **状态筛选**：按成功/失败状态筛选
- **时间筛选**：按时间范围筛选调用记录
- **排序功能**：按时间升序/降序排序
- **详情查看**：查看完整的输入输出内容
- **卡片式输入展示**：LLM输入JSON数组以消息卡片形式展示，支持role标签和内容格式化

### 用户界面特性
- **深色主题**：使用 Ant Design 深色主题
- **响应式设计**：适配不同屏幕尺寸
- **实时数据**：通过 API 获取最新数据
- **操作便捷**：直观的筛选和排序控件

## 技术实现

### 后端 API (kagami-console)
**技术栈**：
- Go 1.21+
- Gin Web 框架
- GORM ORM
- SQLite 驱动

**核心 API**：
```
GET /api/v1/llm-logs
    参数：page, limit, status, start_time, end_time, order_by, order_direction
    功能：分页查询 LLM 调用历史

GET /api/v1/llm-logs/{id}
    功能：获取单条记录详情
```

**数据模型**：
```go
type LLMCallLog struct {
    ID        int    `json:"id"`
    Timestamp string `json:"timestamp"`
    Status    string `json:"status"`  // "success" | "fail"
    Input     string `json:"input"`   // JSON 格式的请求数据
    Output    string `json:"output"`  // 响应内容或错误信息
}
```

### 前端界面 (kagami-console-web)
**技术栈**：
- TypeScript
- React 18
- Ant Design 5.x
- Vite 构建工具
- Axios HTTP 客户端

**核心组件**：
- `LLMLogsTable`: 主要的数据表格组件
- `MessageCard`: LLM消息展示卡片组件，支持role标签和内容格式化
- 筛选控件：状态选择器、时间范围选择器、排序控件
- 详情模态框：展示完整的调用详情，采用卡片式消息展示
- 分页组件：支持页面大小调整和快速跳转

## 部署架构

### Nginx 配置
```nginx
# 静态文件托管
location /kagami/ {
    alias /path/to/kagami-console-web/dist/;
    try_files $uri $uri/ /kagami/index.html;
}

# API 代理
location /kagami/api/ {
    proxy_pass http://127.0.0.1:8080/api/;
}

# URL 规范化
location = /kagami {
    return 301 $scheme://$host:$server_port$request_uri/;
}
```

### 访问方式
- **控制台入口**：`https://domain.com:8888/kagami`
- **API 调用**：`https://domain.com:8888/kagami/api/v1/llm-logs`
- **静态资源**：自动通过 nginx 提供缓存优化

## 数据流

### 查询流程
```
用户操作 → React 组件 → Axios 请求 → nginx 代理 → Go API → GORM → SQLite → 返回数据 → 界面更新
```

### 关键路径
1. 用户在界面设置筛选条件
2. React 组件调用 `/kagami/api/v1/llm-logs`
3. nginx 将请求代理到 Go 后端 `:8080/api/v1/llm-logs`
4. Go 服务使用 GORM 查询 SQLite 数据库
5. 返回 JSON 数据给前端进行渲染

## 与机器人系统的集成

### 数据共享
- **数据库文件**：直接读取机器人创建的 `kagami.db`
- **表结构**：使用相同的 `llm_call_logs` 表
- **只读访问**：控制台只读数据，不修改机器人数据

### 实时性
- **数据更新**：机器人实时写入调用记录
- **查询刷新**：控制台支持手动刷新获取最新数据
- **无冲突**：只读访问避免数据库锁定问题

## 扩展规划

### 功能扩展
- 统计图表：调用成功率、频率趋势分析
- 用户管理：群组、用户维度的数据分析
- 配置管理：通过 Web 界面修改机器人配置
- 日志管理：系统日志查看和分析

### 技术优化
- 数据缓存：Redis 缓存热点数据
- 权限控制：用户登录和权限管理
- 性能优化：数据库索引、查询优化
- 容器化：Docker 部署支持

## 关联节点

- [[database_layer]] - 共享的数据库结构
- [[llm_client]] - 生成被监控的调用记录
- [[logger]] - 记录系统的数据来源