# 控制台系统

## 概述

Kagami Console 是一个 Web 控制台系统，用于监控和管理 Kagami QQ 机器人。由 kagami-bot 的 HTTP API 和 React 前端组成，提供 LLM 调用历史的查询、筛选和分析功能。

## 架构设计

### 系统组成
```
Kagami Console System
├── kagami-bot HTTP API      # TypeScript/Express 后端 API
│   ├── RESTful API 服务
│   ├── PostgreSQL 数据库访问（通过 Repository）
│   └── CORS 跨域支持
├── kagami-console-web/      # React 前端
│   ├── Ant Design 深色主题
│   ├── 数据表格和筛选
│   └── 响应式界面
└── nginx 代理配置
    ├── 静态文件托管
    └── API 请求代理
```

### 架构特点
- **技术栈统一**：后端 API 与机器人同为 TypeScript/Node.js，简化技术栈
- **统一部署**：HTTP API 与 QQ 机器人运行在同一进程中
- **代码复用**：Repository 层和领域类型被 HTTP API 和机器人共享
- **前端独立**：前端仍保持独立的 `package.json`、`tsconfig.json` 配置

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
- **全视口适配**：移除宽度限制，页面充满整个视口，支持移动端友好体验
- **响应式设计**：适配不同屏幕尺寸，使用 Antd Grid 系统实现断点适配
- **移动端优化**：768px以下自动切换为紧凑布局，表格仅显示关键列（时间、状态、操作）
- **智能分页**：桌面端完整功能，移动端简化为simple模式
- **实时数据**：通过 API 获取最新数据
- **操作便捷**：直观的筛选和排序控件，时间排序集成在表格列标题中

## 技术实现

### 后端 API (kagami-bot HTTP API)
**技术栈**：
- TypeScript
- Express.js
- Zod 类型验证
- Prisma ORM
- PostgreSQL

**核心 API**：
```
GET /api/v1/llm-logs
    参数：page, limit, status, startTime, endTime, orderBy, orderDirection
    功能：分页查询 LLM 调用历史

GET /api/v1/llm-logs/{id}
    功能：获取单条记录详情
```

**数据模型**：
```typescript
type LlmCallLog = {
    id: number,
    timestamp: Date,
    status: LlmCallStatus,  // "success" | "fail"
    input: string,          // JSON 格式的请求数据
    output: string,         // 响应内容或错误信息
};
```

详细信息参考：[[http_api_layer]]

### 前端界面 (kagami-console-web)
**技术栈**：
- TypeScript
- React 18
- Ant Design 5.x
- Vite 构建工具
- Axios HTTP 客户端

**核心组件**：
- `LLMLogsTable`: 主要的数据表格组件
  - 响应式列显示：桌面端显示全部列，移动端仅显示时间、状态、操作
  - 内置排序：时间列支持点击标题切换升序/降序
  - 横向滚动：防止表格溢出，支持移动端滑动查看
- `MessageCard`: LLM消息展示卡片组件，支持role标签和内容格式化
- 筛选控件：响应式布局，支持Antd Grid断点自动换行
  - 状态选择器、时间范围选择器
  - 移动端优化：xs(24) sm(12) md(6-8)断点适配
- 详情模态框：展示完整的调用详情，采用卡片式消息展示
- 分页组件：智能模式切换
  - 桌面端：完整功能（总数、快速跳转、分页大小选择）
  - 移动端：简化模式（仅上一页/下一页按钮）
  - 居中对齐：使用Flexbox布局确保居中显示

## 部署架构

### Docker Compose 配置
```yaml
services:
  kagami-bot:
    ports:
      - "8080:8080"  # HTTP API 端口
      - "6099:6099"  # NapCat 端口

  kagami-console-web:
    ports:
      - "10000:80"   # 前端控制台端口
```

### Nginx 配置（在 kagami-console-web 容器内）
```nginx
# 静态文件托管
location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
}

# API 代理
location /api/ {
    proxy_pass http://kagami-bot:8080/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### 访问方式
- **控制台入口**：`http://localhost:10000`
- **API 调用（内部）**：`http://kagami-bot:8080/api/v1/llm-logs`
- **API 调用（通过 nginx）**：`http://localhost:10000/api/v1/llm-logs`

## 数据流

### 查询流程
```
用户操作 → React 组件 → Axios 请求 → nginx 代理 → kagami-bot HTTP API → LlmCallLogRepository → Prisma → PostgreSQL → 返回数据 → 界面更新
```

### 关键路径
1. 用户在界面设置筛选条件
2. React 组件调用 `/api/v1/llm-logs`
3. nginx 将请求代理到 kagami-bot `:8080/api/v1/llm-logs`
4. HTTP API 使用 Zod 验证请求参数
5. 调用 LlmCallLogRepository.find() 查询数据
6. Repository 通过 Prisma 查询 PostgreSQL 数据库
7. 返回 JSON 数据给前端进行渲染

## 与机器人系统的集成

### 数据共享
- **共享数据库**：HTTP API 与机器人共享同一个 PostgreSQL 数据库
- **共享 Repository**：HTTP API 和机器人使用同一个 LlmCallLogRepository
- **共享领域类型**：使用统一的 `LlmCallLog` 和 `LlmCallStatus` 类型

### 实时性
- **数据更新**：机器人通过 Repository 实时写入调用记录
- **查询刷新**：控制台支持手动刷新获取最新数据
- **并发安全**：PostgreSQL 和 Prisma 确保并发读写的一致性

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

- [[http_api_layer]] - 提供 HTTP API 服务
- [[llm_call_log_repository]] - 数据访问层
- [[database_layer]] - 共享的数据库结构
- [[domain_layer]] - 领域类型定义
- [[llm_client]] - 生成被监控的调用记录
- [[message_card_component]] - LLM消息卡片展示组件