# HTTP API 层

## 概述

HTTP API 层是集成在 kagami-bot 中的 RESTful API 服务，使用 Express.js 构建，为前端控制台提供数据查询接口。这个架构将原本独立的 Go 后端服务整合到 TypeScript/Node.js 技术栈中，简化了项目的技术栈和部署复杂度。

位于 `kagami-bot/src/api/`。

## 架构设计

### 模块组成
```
api/
├── server.ts              # HTTP 服务器入口
├── middleware/
│   └── cors.ts           # CORS 中间件
├── routes/
│   └── llm_logs.ts       # LLM 日志查询路由
└── types/
    └── api_types.ts      # API 类型定义和验证
```

### 分层架构
```
HTTP 服务层 (server.ts)
    ↓
路由层 (routes/llm_logs.ts)
    ↓
Repository 层 (LlmCallLogRepository)
    ↓
数据库层 (Database + Prisma)
```

## 核心组件

### HTTP 服务器 (server.ts)

**核心功能**：
- 创建和配置 Express 应用
- 注册全局中间件（CORS、JSON 解析）
- 注册路由
- 启动 HTTP 服务监听

**实现**：
```typescript
import express, { Express, Router } from "express";
import { createCorsMiddleware } from "./middleware/cors.js";
import { HttpConfig } from "../config_manager.js";

export const createHttpServer = async (
    llmLogsRouter: Router,
    httpConfig: HttpConfig
): Promise<Express> => {
    const app = express();

    app.use(createCorsMiddleware(httpConfig.cors));
    app.use(express.json());

    app.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    app.use("/api/v1/llm-logs", llmLogsRouter);

    return new Promise<Express>(resolve => {
        app.listen(httpConfig.port, () => {
            resolve(app);
        });
    });
};
```

**特点**：
- 工厂函数模式，通过依赖注入接收路由和配置
- Promise 封装确保服务器完全启动后返回
- 提供健康检查端点 `/health`

### CORS 中间件 (middleware/cors.ts)

**核心功能**：
- 配置跨域资源共享（CORS）
- 支持来自前端控制台的跨域请求

**实现**：
```typescript
import cors from "cors";
import { CorsConfig } from "../../config_manager.js";

export const createCorsMiddleware = (config: CorsConfig) => {
    return cors({
        origin: config.allowed_origins,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    });
};
```

**配置项**：
- `allowed_origins`: 允许的源列表（从配置文件读取）
- 支持的 HTTP 方法：GET, POST, PUT, DELETE, OPTIONS
- 允许的请求头：Content-Type, Authorization

### LLM 日志路由 (routes/llm_logs.ts)

**核心功能**：
- 提供 LLM 调用日志的查询接口
- 支持分页、筛选、排序
- 参数验证和错误处理

**API 端点**：

1. **列表查询**：`GET /api/v1/llm-logs`
   - 支持的查询参数（通过 Zod 验证）：
     - `page`: 页码（默认 1）
     - `limit`: 每页数量（默认 20，最大 100）
     - `status`: 状态筛选（'success' | 'fail'）
     - `startTime`: 开始时间（ISO datetime）
     - `endTime`: 结束时间（ISO datetime）
     - `orderBy`: 排序字段（'timestamp' | 'status' | 'id'，默认 'timestamp'）
     - `orderDirection`: 排序方向（'asc' | 'desc'，默认 'desc'）
   - 响应格式：`LlmLogListResponse`

2. **详情查询**：`GET /api/v1/llm-logs/:id`
   - 路径参数：`id` (数字)
   - 响应格式：`LlmCallLog` 或 404 错误

**实现**：
```typescript
import { Router, Request, Response } from "express";
import { LlmCallLogRepository } from "../../infra/llm_call_log_repository.js";
import { llmLogQueryParamsSchema, LlmLogListResponse, ErrorResponse } from "../types/api_types.js";

export const createLlmLogsRouter = (repository: LlmCallLogRepository): Router => {
    const router = Router();

    router.get("/", async (req: Request, res: Response<LlmLogListResponse | ErrorResponse>) => {
        try {
            const params = llmLogQueryParamsSchema.parse(req.query);
            const result = await repository.find({
                page: params.page,
                limit: params.limit,
                status: params.status,
                startTime: params.startTime ? new Date(params.startTime) : undefined,
                endTime: params.endTime ? new Date(params.endTime) : undefined,
                orderBy: params.orderBy,
                orderDirection: params.orderDirection,
            });

            res.json({
                data: result.data,
                total: result.total,
                page: params.page,
                limit: params.limit,
            });
        } catch (error) {
            if (error instanceof ZodError) {
                res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
            } else {
                console.error("Error querying LLM logs:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        }
    });

    router.get("/:id", async (req: Request, res: Response<LlmCallLog | ErrorResponse>) => {
        // ... 实现详情查询
    });

    return router;
};
```

**特点**：
- 工厂函数模式，依赖注入 Repository
- 使用 Zod 进行请求参数验证
- 完善的错误处理（验证错误 400、未找到 404、服务器错误 500）
- TypeScript 类型安全

### API 类型定义 (types/api_types.ts)

**核心功能**：
- 使用 Zod 定义和验证请求参数
- 定义响应类型

**类型定义**：
```typescript
import { z } from "zod";
import { LlmCallLog } from "../../domain/llm_call_log.js";

// 查询参数验证 Schema
export const llmLogQueryParamsSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["success", "fail"]).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    orderBy: z.enum(["timestamp", "status", "id"]).default("timestamp"),
    orderDirection: z.enum(["asc", "desc"]).default("desc"),
});

export type LlmLogQueryParams = z.infer<typeof llmLogQueryParamsSchema>;

// 响应类型
export type LlmLogListResponse = {
    data: LlmCallLog[],
    total: number,
    page: number,
    limit: number,
};

export type ErrorResponse = {
    error: string,
};
```

**特点**：
- 使用 Zod 进行运行时类型验证和自动类型推导
- 复用领域层的 `LlmCallLog` 类型
- 提供默认值和约束（如 limit 最大 100）

## 集成方式

### 在 bootstrap 中的初始化
```typescript
// 7. HTTP Handler 层
const httpConfig: HttpConfig = configManager.getHttpConfig();
const llmLogsRouter = createLlmLogsRouter(llmCallLogRepository);

// 8. HTTP 服务层
await createHttpServer(llmLogsRouter, httpConfig);
console.log(`HTTP 服务器已启动，监听端口 ${String(httpConfig.port)}`);
```

### 配置示例
```yaml
http:
  port: 8080
  cors:
    allowed_origins:
      - http://localhost:10000
      - http://localhost:3000
```

## 依赖关系

### 依赖
- [[llm_call_log_repository]] - 数据访问层，提供查询和持久化功能
- [[config_manager]] - 获取 HTTP 配置（端口、CORS 设置）
- [[domain_layer]] - 使用领域类型 `LlmCallLog`

### 被依赖
- [[console_system]] - 前端控制台通过 HTTP API 获取数据

## 技术特点

### 类型安全
- 使用 Zod 进行运行时验证
- TypeScript 提供编译时类型检查
- 请求参数、响应数据都有明确的类型定义

### 关注点分离
- 中间件层：处理跨域、请求解析
- 路由层：处理请求、参数验证、调用 Repository
- Repository 层：数据访问逻辑
- 领域层：业务类型定义

### 依赖注入
- 所有组件通过工厂函数创建
- 依赖通过参数注入，便于测试和替换

### 错误处理
- 参数验证错误返回 400
- 资源未找到返回 404
- 服务器错误返回 500
- 统一的错误响应格式

## 部署集成

### 与 kagami-bot 统一部署
- HTTP 服务和 QQ 机器人运行在同一进程中
- 共享数据库连接和配置
- 简化部署架构

### Docker 配置
```yaml
# docker-compose.yaml
kagami-bot:
  ports:
    - "8080:8080"  # HTTP API
    - "6099:6099"  # NapCat
```

### Nginx 代理配置
```nginx
# 前端控制台的 nginx 配置
location /api/ {
    proxy_pass http://kagami-bot:8080/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## 对比 Go 后端架构

### 旧架构（已废弃）
```
前端 → Nginx → Go 后端 (kagami-console) → SQLite
```

### 新架构（当前）
```
前端 → Nginx → kagami-bot HTTP API → PostgreSQL (通过 Prisma)
```

### 优势
- **技术栈统一**：从 Go + TypeScript 简化为纯 TypeScript
- **部署简化**：减少一个独立服务
- **类型复用**：HTTP API 直接使用领域层类型，无需维护重复的数据模型
- **数据库统一**：PostgreSQL 替代 SQLite，更强大的查询和并发能力
- **代码复用**：Repository 层被 QQ 机器人和 HTTP API 共同使用

## 未来扩展

### 功能扩展
- 用户认证和授权
- WebSocket 实时数据推送
- 更多资源的 CRUD 接口（配置管理、群组管理等）
- 统计和分析接口

### 技术优化
- 请求速率限制（Rate Limiting）
- 响应缓存（Redis）
- API 文档生成（OpenAPI/Swagger）
- 请求日志记录

## 相关节点

- [[llm_call_log_repository]] - 数据访问层
- [[console_system]] - 前端控制台
- [[config_manager]] - 配置管理
- [[domain_layer]] - 领域类型定义
- [[kagami_bot]] - 应用主入口和初始化
