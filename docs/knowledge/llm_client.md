# LlmClient LLM 客户端

## 定义

LlmClient 封装 OpenAI API 调用，支持多 LLM 提供商配置，集成 [[api_key_manager]] 实现多 API Key 轮询和负载均衡。位于 `src/llm.ts`。

## 核心功能

### API 调用封装
```typescript
async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
    const apiKey = this.apiKeyManager.getRandomApiKey();
    const openai = new OpenAI({
        baseURL: this.baseURL,
        apiKey: apiKey,
    });

    const response = await openai.chat.completions.create({
        model: this.model,
        messages: messages,
        response_format: {
            type: "json_object",
        },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error("OpenAI API 返回空内容");
    }

    return content;
}
```

### 多提供商架构
- **自动提供商选择**：根据指定模型自动选择对应的 LLM 提供商
- **统一接口**：所有提供商使用相同的 OpenAI API 格式
- **运维友好**：配置文件中灵活定义提供商与模型的关系

### 动态客户端创建
- **每次请求创建**：每次调用时创建新的 OpenAI 实例
- **随机 API Key**：通过 [[api_key_manager]] 获取随机 API Key
- **无状态设计**：不保持固定的客户端连接

## 设计特点

### 多 API Key 支持
- **负载均衡**：随机选择 API Key 分散请求压力
- **高可用性**：单个 API Key 失效不影响整体服务
- **透明切换**：上层无需关心具体使用哪个 API Key

### JSON 模式强制
```typescript
response_format: {
    type: "json_object",
}
```
- **结构化输出**：确保 LLM 返回有效的 JSON 格式
- **解析保证**：避免非结构化文本导致的解析错误
- **思考链支持**：配合系统提示词实现结构化思考

### 错误处理
- **异常透明传递**：所有错误（网络错误、API错误等）直接抛出给上层处理
- **空响应检查**：验证 API 返回内容的有效性，空内容时抛出异常
- **详细错误信息**：原始异常信息完整传递给调用方进行日志记录
- **职责分离**：LlmClient 专注 API 调用，错误处理和日志记录由调用方（[[base_message_handler]]）负责

## 依赖关系

### 直接依赖
- [[api_key_manager]] - API Key 管理和选择
- **OpenAI SDK** - 官方 OpenAI 客户端
- [[config_system]] - LLM 配置参数

### 被依赖关系
- [[base_message_handler]] - 所有消息处理器都使用 LlmClient
- [[kagami_bot]] - 主应用创建和管理 LlmClient 实例

## 配置要求

### 构造函数参数
```typescript
constructor(providers: Record<string, ProviderConfig>, model: string)
```

- `providers`: 包含所有 LLM 提供商配置的对象
- `model`: 要使用的模型名称（必须被某个提供商支持）

### ProviderConfig 接口
```typescript
export interface ProviderConfig {
    base_url: string;    // API 基础 URL
    api_keys: string[];  // API Key 数组（必须至少一个）
    models: string[];    // 该提供商支持的模型列表
}
```

### 配置示例
```yaml
llm_providers:
  openai:
    base_url: "https://api.openai.com/v1"
    api_keys:
      - "sk-proj-xxx1"
      - "sk-proj-xxx2"
    models:
      - "gpt-4"
      - "gpt-3.5-turbo"
  gemini:
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/"
    api_keys:
      - "AIzaSy-xxx1"
      - "AIzaSy-xxx2"
    models:
      - "gemini-2.5-flash"
      - "gemini-1.5-pro"

llm:
  model: "gemini-2.5-flash"  # 选择上面某个提供商支持的模型
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
- ✅ **日志记录分离** - 日志记录由上层（[[base_message_handler]]）负责，职责更清晰
- 可以集成 API Key 健康检查

## 相关文件
- `src/llm.ts` - 主要实现
- `src/api_key_manager.ts` - API Key 管理
- `src/config.ts` - LlmConfig 接口定义