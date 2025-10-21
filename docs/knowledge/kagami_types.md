# kagami-types

## 定义

`kagami-types` 是 Kagami monorepo 中的共享类型库，采用独立子项目形式，提供跨项目使用的类型定义、DTO 和转换器。

## 目录结构

```
kagami-types/
├── package.json           # 独立的包配置，包含多路径 exports
├── tsconfig.json          # TypeScript 配置（composite 模式）
└── src/
    ├── domain/           # 领域层类型定义（业务核心概念）
    │   ├── llm.ts                    # LLM 相关类型（工具调用、消息、响应）
    │   ├── llm_call_log.ts          # LLM 调用日志领域模型
    │   └── provider_config.ts       # LLM 提供商配置类型
    │
    ├── dto/              # 数据传输对象（API 层传输格式）
    │   └── llm_call_log.ts          # LLM 日志 DTO 和查询参数
    │
    └── converter/        # 领域模型与 DTO 之间的转换器
        └── llm_call_log.ts          # LLM 日志转换函数
```

## 核心功能

### 1. 领域层类型定义 (`domain/`)

定义业务核心概念，不依赖任何框架或外部库：

- **LLM 类型** (`domain/llm.ts`):
  - `Tool`, `ToolParam`, `ToolCall` - 工具调用系统类型
  - `ChatMessage`, `ChatMessagePart` - 消息格式定义
  - `OneTurnChatRequest`, `LlmResponse` - LLM 请求/响应
  - `LlmProvider` - 提供商接口定义

- **LLM 调用日志** (`domain/llm_call_log.ts`):
  - `LlmCallStatus` - 调用状态类型（"success" | "fail"）
  - `LlmCallLog` - 完整日志实体（包含 ID，使用原生 Date）
  - `LlmCallLogCreateRequest` - 创建请求类型

- **提供商配置** (`domain/provider_config.ts`):
  - `OpenAIProviderConfig` - OpenAI 提供商配置
  - `GenAIProviderConfig` - Google GenAI 提供商配置
  - `ProviderConfig` - 联合类型

### 2. DTO 定义 (`dto/`)

用于 HTTP API 传输的数据格式，使用序列化友好的类型：

- **LLM 日志 DTO** (`dto/llm_call_log.ts`):
  - `LlmCallLogDTO` - 日志传输对象（timestamp 为 ISO 8601 字符串）
  - `LlmLogQueryParams` - 查询参数类型（基于 Zod schema）
  - `llmLogQueryParamsSchema` - Zod 验证 schema
  - `LlmLogListResponse` - 分页列表响应
  - `ErrorResponse` - 错误响应

### 3. 转换器 (`converter/`)

在领域模型和 DTO 之间转换数据：

- **LLM 日志转换器** (`converter/llm_call_log.ts`):
  - `llmCallLogToDTO()` - 领域模型 → DTO（Date → ISO 字符串）
  - `llmCallLogFromDTO()` - DTO → 领域模型（ISO 字符串 → Date）
  - `llmCallLogsToDTO()` - 批量转换到 DTO
  - `llmCallLogsFromDTO()` - 批量转换到领域模型

## 依赖关系

### 被依赖关系

- [[kagami_bot]] - 使用所有三层类型（domain, dto, converter）
- [[kagami_console_web]] - 使用 dto 层类型用于 API 通信

### 依赖项

- **生产依赖**: `zod` - DTO 验证和类型推导
- **开发依赖**: `typescript` - 类型编译

## 模块导出

通过 `package.json` 的 `exports` 字段提供多路径导出：

```javascript
// 使用领域类型
import type { LlmCallLog } from "kagami-types/domain/llm_call_log";
import type { Tool, ChatMessage } from "kagami-types/domain/llm";

// 使用 DTO
import type { LlmCallLogDTO, LlmLogQueryParams } from "kagami-types/dto/llm_call_log";

// 使用转换器
import { llmCallLogToDTO } from "kagami-types/converter/llm_call_log";
```

## 设计原则

### 1. 分层清晰

- **Domain 层**: 纯类型定义，不依赖外部库（除基础库），表达业务概念
- **DTO 层**: API 传输格式，依赖 Zod 进行验证和类型推导
- **Converter 层**: 双向转换逻辑，隔离不同层级的类型差异

### 2. 类型安全

- 使用 TypeScript strict 模式
- 通过 Zod schema 在运行时验证 API 输入
- 使用 `readonly` 修饰符保护数据不变性

### 3. 语义化时间类型

- **Domain 层**: 使用原生 `Date` 对象（便于业务逻辑操作）
- **DTO 层**: 使用 ISO 8601 字符串（便于网络传输和序列化）
- **Converter**: 负责两种格式之间的转换

## 构建配置

### TypeScript 配置

- `composite: true` - 支持 project references
- `declaration: true` - 生成 `.d.ts` 类型定义文件
- `declarationMap: true` - 生成声明映射，支持 IDE 跳转
- `module: "NodeNext"` - 使用 Node.js 原生 ESM 模块

### 构建命令

```bash
# 在根目录执行
pnpm build              # 构建所有项目（包括 kagami-types）

# 或进入 kagami-types 目录
cd kagami-types
pnpm build             # 编译 TypeScript 生成 dist/
pnpm clean             # 清理构建产物
```

## 使用示例

### 示例 1: 在 kagami-bot 中使用领域类型

```typescript
// kagami-bot/src/llm_client.ts
import type { LlmProvider, OneTurnChatRequest } from "kagami-types/domain/llm";
import type { LlmCallLog, LlmCallLogCreateRequest } from "kagami-types/domain/llm_call_log";

class LlmClient {
    async chat(request: OneTurnChatRequest): Promise<LlmResponse> {
        // 使用共享类型
    }
}
```

### 示例 2: 在 HTTP API 中使用 DTO 和转换器

```typescript
// kagami-bot/src/api/routes/llm_logs.ts
import type { LlmLogQueryParams, LlmLogListResponse } from "kagami-types/dto/llm_call_log";
import { llmCallLogsToDTO } from "kagami-types/converter/llm_call_log";

router.get("/logs", async (req, res) => {
    const params: LlmLogQueryParams = llmLogQueryParamsSchema.parse(req.query);

    // 从 Repository 获取领域模型
    const logs: LlmCallLog[] = await repository.findAll(params);

    // 转换为 DTO 返回
    const response: LlmLogListResponse = {
        data: llmCallLogsToDTO(logs),
        total: logs.length,
        page: params.page,
        limit: params.limit,
    };

    res.json(response);
});
```

### 示例 3: 在前端使用 DTO 类型

```typescript
// kagami-console-web/src/services/api.ts
import type { LlmCallLogDTO, LlmLogListResponse } from "kagami-types/dto/llm_call_log";

export async function fetchLlmLogs(): Promise<LlmLogListResponse> {
    const response = await axios.get<LlmLogListResponse>("/api/llm-logs");
    return response.data;
}
```

## 关联节点

- [[domain_layer]] - kagami-types 的 domain/ 目录是领域层的实现
- [[http_api_layer]] - 使用 DTO 和转换器进行数据传输
- [[llm_call_log_repository]] - 使用 domain 层的 LlmCallLog 类型
- [[llm_client]] - 使用 domain 层的 LLM 相关类型
- [[console_system]] - 前端使用 DTO 层类型
