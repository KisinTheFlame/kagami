# LlmClientManager LLM 客户端管理器

## 定义

LlmClientManager 是统一的 LLM 客户端管理器，负责管理多个 [[llm_client]] 实例并实现模型降级机制。位于 `src/llm_client_manager.ts`。

## 核心功能

### 模型降级调用
```typescript
async callWithFallback(messages: ChatMessages[]): Promise<string> {
    for (const model of this.configuredModels) {
        try {
            const client = this.getLlmClient(model);
            const result = await client.oneTurnChat(messages);

            // 如果不是第一个模型，记录降级成功
            if (attemptedModels.length > 1) {
                console.log(`模型降级成功: ${attemptedModels.slice(0, -1).join(" → ")} → ${model}`);
            }

            return result;
        } catch {
            console.warn(`模型 ${model} 调用失败，尝试降级到下一个模型`);
            // 继续尝试下一个模型
        }
    }

    throw new Error("所有配置的模型都调用失败");
}
```

### 自动配置加载
```typescript
class LlmClientManager {
    constructor() {
        // 自己加载配置，和 db.ts 的模式一致
        const config = loadConfig();

        this.clients = {};
        this.configuredModels = [...config.llm.models];

        // 为每个模型创建对应的 LlmClient
        for (const model of this.configuredModels) {
            const providerConfig = getProviderForModel(config.llm_providers, model);
            this.clients[model] = new LlmClient(providerConfig, model);
        }
    }
}
```

## 设计特点

### 单例模式
- **全局实例**：导出单例实例 `llmClientManager`，与 [[database_layer]] 模式一致
- **模块初始化**：在模块导入时自动初始化，尽早发现配置错误
- **配置自包含**：自己调用 `loadConfig()`，不依赖外部传递

### 降级策略
- **顺序降级**：按照配置数组顺序依次尝试模型
- **快速失败**：单个模型失败后立即尝试下一个
- **全面跟踪**：记录尝试过的所有模型路径

### 客户端管理
- **延迟创建**：在构造函数中为每个模型预创建客户端
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

## 架构集成

### 依赖关系简化
```
MessageHandler  →  LlmClientManager  →  LlmClient[]
                                    →  Config System
```

- **移除直接依赖**：[[message_handler]] 不再直接依赖 [[llm_client]]
- **统一管理**：所有 LLM 调用都通过 LlmClientManager 统一管理
- **配置集中**：配置加载和验证集中在一个地方

### 与现有组件的关系
- **替代 LlmClient 直接使用**：[[message_handler]] 现在使用 `llmClientManager.callWithFallback()`
- **保持日志系统**：每个 [[llm_client]] 仍然记录详细的调用日志
- **兼容现有接口**：`callWithFallback()` 接口与原来的 `oneTurnChat()` 兼容

## 使用方式

### 导入和使用
```typescript
import { llmClientManager } from "./llm_client_manager.js";

// 在MessageHandler中使用
const llmResponse = await llmClientManager.callWithFallback(chatMessages);
```

### 错误处理
```typescript
try {
    const response = await llmClientManager.callWithFallback(messages);
    // 处理成功响应
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

## 相关文件
- `src/llm_client_manager.ts` - 主要实现
- `src/config.ts` - LlmConfig 接口定义和验证逻辑
- `src/llm.ts` - LlmClient 实现
- `src/message_handler.ts` - 使用 LlmClientManager 的地方

## 相关节点
- [[llm_client]] - 被管理的客户端实例
- [[config_system]] - 配置加载和验证
- [[message_handler]] - 主要使用者
- [[logger]] - LLM 调用日志记录