# LlmClient LLM 客户端

## 定义

LlmClient 是单个 LLM 模型的调用客户端，通过 [[llm_provider_abstraction]] 抽象层支持多种 LLM 提供商。现在由 [[llm_client_manager]] 统一管理。位于 `src/llm.ts`。

## 核心功能

### 带日志记录的调用接口
```typescript
async oneTurnChat(messages: ChatMessages[]): Promise<string> {
    let status: "success" | "fail" = "fail";
    let llmResponse = "";

    // 生成输入字符串用于记录（保持原有格式）
    const inputForLog = JSON.stringify(messages, null, 2);

    try {
        llmResponse = await this.provider.oneTurnChat(this.model, messages);

        if (llmResponse === "") {
            status = "fail";
            void logger.logLLMCall(status, inputForLog, "LLM调用失败");
            throw new Error("LLM调用失败");
        }

        status = "success";
        void logger.logLLMCall(status, inputForLog, llmResponse);
        return llmResponse;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
        void logger.logLLMCall("fail", inputForLog, `模型 ${this.model} 调用失败: ${errorMessage}`);
        throw error;
    }
}
```

### 抽象层架构
- **提供商抽象**：通过 [[llm_provider_factory]] 创建具体的 LLM 提供商实例
- **Interface 支持**：支持 `openai` 和 `genai` 两种 interface 类型
- **自动选择**：根据配置的模型自动选择对应的提供商

### 简化设计
- **单一职责**：一个 LlmClient 实例只负责一个模型
- **日志集成**：内置日志记录功能，自动记录每次调用
- **统一管理**：由 [[llm_client_manager]] 统一创建和管理

## 设计特点

### 抽象层集成
- **统一接口**：所有提供商都实现相同的 LlmProvider 接口
- **多 SDK 支持**：支持原生 OpenAI SDK、Google GenAI SDK 等
- **透明切换**：上层调用代码无需关心具体使用哪种 SDK

### 配置驱动
- **Interface 字段**：通过 `interface` 字段指定使用的 SDK 类型
- **自动实例化**：根据配置自动创建对应的提供商实例
- **模型匹配**：根据模型名称自动选择支持该模型的提供商

### 错误处理
- **异常透明传递**：所有错误直接从具体提供商传递到上层
- **统一错误格式**：不同提供商的错误都转换为统一格式
- **职责分离**：LlmClient 专注调用协调，具体实现由提供商负责

## 依赖关系

### 直接依赖
- [[api_key_manager]] - API Key 管理和选择（通过 provider 层）
- **LLM Provider** - 具体的 LLM SDK 实现
- [[logger]] - LLM 调用日志记录

### 被依赖关系
- [[llm_client_manager]] - 统一管理多个 LlmClient 实例
- [[message_handler]] - 通过 LlmClientManager 间接使用

## 配置要求

### 构造函数参数（简化后）
```typescript
constructor(providerConfig: ProviderConfig, model: string)
```

- `providerConfig`: 单个提供商的配置对象
- `model`: 要使用的模型名称（必须被该提供商支持）

### ProviderConfig 接口
```typescript
export interface ProviderConfig {
    base_url: string;    // API 基础 URL
    api_keys: string[];  // API Key 数组（必须至少一个）
    models: string[];    // 该提供商支持的模型列表
}
```

### 配置示例（通过 LlmClientManager 管理）
```yaml
llm_providers:
  openai:
    interface: "openai"
    base_url: "https://api.openai.com/v1"
    api_keys:
      - "sk-proj-xxx1"
      - "sk-proj-xxx2"
    models:
      - "gpt-4o"
      - "gpt-4"
  gemini:
    interface: "genai"
    api_keys:
      - "AIzaSy-xxx1"
      - "AIzaSy-xxx2"
    models:
      - "gemini-2.0-flash-001"
      - "gemini-1.5-pro"

llm:
  models: ["gpt-4o", "gpt-4", "gemini-2.0-flash-001"]  # 支持降级
```

## 性能特性

### API Key 轮询优势
- **并发提升**：多个 API Key 可以绕过单账户的并发限制
- **限制分散**：避免单个 API Key 达到频率限制
- **响应均衡**：请求分散到不同的 API 端点

### 开销分析
- **额外开销最小**：每次请求只增加一次随机数生成
- **内存占用轻微**：只存储 API Key 数组的副本
- **网络开销无**：API Key 选择完全在本地进行

## 安全考虑

### API Key 保护
- **不记录完整密钥**：日志中不输出完整 API Key
- **私有存储**：API Key 存储在 ApiKeyManager 的私有字段
- **配置文件保护**：需要保护 YAML 配置文件的访问权限

### 最佳实践
- **专用 API Key**：为机器人创建专用的 API Key
- **定期轮换**：建议定期更换 API Key
- **权限最小化**：API Key 仅具备必要的权限

## 扩展性

### 模型支持
- 支持任何兼容 OpenAI API 的模型
- 可以通过配置文件灵活切换模型
- 支持自定义 API 端点（如 Azure OpenAI）

### 功能扩展
- 可以添加重试机制
- 可以支持流式响应
- ✅ **内置日志记录** - 每次 API 调用都自动记录到数据库
- 可以集成 API Key 健康检查
- 可以添加性能指标统计

## 相关文件
- `src/llm.ts` - 主要实现
- `src/api_key_manager.ts` - API Key 管理
- `src/config.ts` - LlmConfig 接口定义