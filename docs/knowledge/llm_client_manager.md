# LlmClientManager LLM 客户端管理器

## 定义

LlmClientManager 是统一的 LLM 客户端管理器，负责管理多个 [[llm_client]] 实例并实现模型降级机制。位于 `src/llm_client_manager.ts`。

## 核心功能

### 支持工具调用的模型降级调用
```typescript
async callWithFallback(request: OneTurnChatRequest): Promise<LlmResponse> {
    const configuredModels = this.configManager.getLlmConfig().models;
    for (const model of configuredModels) {
        try {
            const client = this.getLlmClient(model);
            return await client.oneTurnChat(request);
        } catch (error) {
            console.warn(`模型 ${model} 调用失败:`, error);
            // 继续尝试下一个模型
        }
    }

    throw new Error("所有配置的模型都调用失败");
}
```

### 请求参数接口
```typescript
interface OneTurnChatRequest {
    messages: ChatMessage[];      // 包含工具调用历史的对话消息
    tools: Tool[];               // 可用的工具列表
    outputFormat: OutputFormat;   // 输出格式配置（json | text）
}
```

### 响应数据结构
```typescript
interface LlmResponse {
    content?: string;       // 文本回复内容
    toolCalls?: ToolCall[]; // 工具调用请求（如果LLM决定调用工具）
}
```

### 依赖注入初始化
```typescript
class LlmClientManager {
    constructor(configManager: ConfigManager, llmCallLogRepository: LlmCallLogRepository) {
        this.configManager = configManager;
        this.clients = {};

        const llmConfig = configManager.getLlmConfig();
        // 为每个模型创建对应的 LlmClient
        for (const model of llmConfig.models) {
            const providerConfig = configManager.getProviderForModel(model);
            this.clients[model] = newLlmClient(providerConfig, model, llmCallLogRepository);
        }
    }
}

// 工厂函数
export const newLlmClientManager = (configManager: ConfigManager, llmCallLogRepository: LlmCallLogRepository) => {
    return new LlmClientManager(configManager, llmCallLogRepository);
};
```

## 设计特点

### 依赖注入
- **工厂模式**：通过 `newLlmClientManager()` 工厂函数创建实例
- **ConfigManager 注入**：通过构造函数接收 ConfigManager 依赖
- **Repository 注入**：通过构造函数接收 [[llm_call_log_repository]] 依赖，传递给 LlmClient
- **无全局单例**：避免全局状态，便于测试和替换实现
- **显式依赖**：LlmClientManager 实例通过参数传递给需要的组件

### 降级策略
- **顺序降级**：按照配置数组顺序依次尝试模型
- **快速失败**：单个模型失败后立即尝试下一个
- **全面跟踪**：记录尝试过的所有模型路径

### 客户端管理
- **预创建**：在构造函数中为每个模型预创建客户端
- **统一接口**：所有模型都通过相同的 `oneTurnChat` 接口调用
- **错误隔离**：单个模型的错误不影响其他模型

## 降级机制

### 失败判断标准
- [[llm_client]] 的 `oneTurnChat()` 方法抛出任何异常时判定为失败
- 无需区分具体错误类型，所有异常都触发降级

### 降级流程
1. **按序尝试**：按照 `config.llm.models` 数组顺序尝试每个模型
2. **记录失败**：每次失败记录警告日志，但不中断流程
3. **成功返回**：首次成功调用立即返回结果
4. **全面失败**：所有模型都失败时抛出汇总错误

### 日志记录
```typescript
// 单个模型失败
console.warn(`模型 ${model} 调用失败，尝试降级到下一个模型`);

// 降级成功
console.log(`模型降级成功: gpt-4o → gpt-4 → gemini-2.0-flash-001`);

// 全面失败
console.error(`所有配置的模型都调用失败，尝试过的模型: gpt-4o → gpt-4 → gemini-2.0-flash-001`);
```

## 配置要求

### LlmConfig 接口变更
```typescript
export interface LlmConfig {
    models: string[];  // 从单个 model 改为 models 数组
}
```

### 配置示例
```yaml
llm_providers:
  openai:
    interface: "openai"
    base_url: "https://api.openai.com/v1"
    api_keys: ["sk-proj-xxx1", "sk-proj-xxx2"]
    models: ["gpt-4o", "gpt-4", "gpt-3.5-turbo"]
  gemini:
    interface: "genai"
    api_keys: ["AIzaSy-xxx1", "AIzaSy-xxx2"]
    models: ["gemini-2.0-flash-001", "gemini-1.5-pro"]

llm:
  models: ["gpt-4o", "gpt-4", "gemini-2.0-flash-001"]  # 按优先级排列
```

### 配置验证
- **提供商匹配**：验证每个模型都有对应的提供商支持
- **早期失败**：配置错误在初始化时立即抛出异常
- **详细错误**：提供具体的错误信息和缺失模型名称

## 依赖关系

### 依赖
- [[config_manager]] - 接收 ConfigManager 注入，获取 LLM 配置和提供商配置
- [[llm_call_log_repository]] - 接收 LlmCallLogRepository 注入，传递给 LlmClient 用于日志记录
- [[llm_client]] - 为每个模型创建 LlmClient 实例

### 被依赖
- [[message_handler]] - 接收 LlmClientManager 实例，调用 `callWithFallback()` 进行 LLM 调用
- [[session_manager]] - 创建 MessageHandler 时注入 LlmClientManager

## 架构集成

### 依赖关系图
```
MessageHandler  →  LlmClientManager  →  LlmClient[]
                                    →  ConfigManager
                                    →  LlmCallLogRepository
```

- **移除直接依赖**：[[message_handler]] 不再直接依赖 [[llm_client]]
- **统一管理**：所有 LLM 调用都通过 LlmClientManager 统一管理
- **依赖注入链**：ConfigManager 和 LlmCallLogRepository 通过构造函数注入

## 使用方式

### 创建和使用
```typescript
import { newLlmClientManager } from "./llm_client_manager.js";
import { newConfigManager } from "./config_manager.js";
import { newDatabase } from "./infra/db.js";
import { newLlmCallLogRepository } from "./infra/llm_call_log_repository.js";

// 在 bootstrap 函数中创建
const configManager = newConfigManager();
const database = newDatabase();
const llmCallLogRepository = newLlmCallLogRepository(database);
const llmClientManager = newLlmClientManager(configManager, llmCallLogRepository);

// 在 MessageHandler 中使用（通过依赖注入）
const request: OneTurnChatRequest = {
    messages: chatMessages,
    tools: [],
    outputFormat: "json"
};
const llmResponse = await this.llmClientManager.callWithFallback(request);
```

### 错误处理
```typescript
try {
    const response = await llmClientManager.callWithFallback(request);

    // 处理文本回复
    if (response.content) {
        console.log("LLM回复:", response.content);
    }

    // 处理工具调用
    if (response.toolCalls) {
        for (const toolCall of response.toolCalls) {
            console.log("LLM请求调用工具:", toolCall.function.name);
        }
    }
} catch (error) {
    // 所有模型都失败，处理错误
    console.error("LLM 调用失败:", error);
}
```

## 性能考虑

### 内存使用
- **预创建客户端**：启动时为所有模型创建客户端，运行时无创建开销
- **配置缓存**：配置只在初始化时加载一次
- **连接复用**：每个客户端维护自己的连接池

### 响应时间
- **快速切换**：模型失败后立即切换，无等待时间
- **并行潜力**：为未来并行尝试多个模型预留空间
- **缓存优化**：客户端实例复用，避免重复初始化

## 可观测性

### 日志记录层次
1. **LlmClientManager 层**：记录降级过程和汇总信息
2. **LlmClient 层**：记录每次具体的 API 调用（通过 [[logger]]）
3. **Console 输出**：实时显示降级过程，便于调试

### 监控指标
- **成功率**：每个模型的成功调用次数
- **降级频率**：触发降级的频率和模式
- **响应时间**：不同模型的平均响应时间

## 扩展性

### 未来增强
- **智能降级**：根据历史成功率动态调整模型顺序
- **断路器模式**：临时跳过频繁失败的模型
- **并行尝试**：同时调用多个模型并选择最快响应
- **负载均衡**：在相同能力的模型间分配负载

### 配置扩展
- **重试策略**：为每个模型配置不同的重试次数
- **超时设置**：模型级别的超时配置
- **权重系统**：给不同模型分配不同的选择权重

## 实现位置

`kagami-bot/src/llm_client_manager.ts`

## 相关节点
- [[llm_client]] - 被管理的客户端实例
- [[llm_function_calling]] - 工具调用类型定义（OneTurnChatRequest, LlmResponse）
- [[config_manager]] - 配置管理器，提供 LLM 配置
- [[database_layer]] - 数据库层，传递给 LlmClient 记录日志
- [[message_handler]] - 主要使用者