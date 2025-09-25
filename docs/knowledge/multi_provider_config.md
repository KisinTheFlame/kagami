# 多提供商配置系统

## 定义

多提供商配置系统允许在单个配置文件中定义多个 LLM 提供商，并通过模型名称自动选择对应的提供商。位于 `src/config.ts`。

## 核心概念

### ProviderConfig 提供商配置
```typescript
export interface ProviderConfig {
    base_url: string;    // API 基础 URL
    api_keys: string[];  // API Key 数组
    models: string[];    // 支持的模型列表
}
```

### 配置映射机制
```typescript
function findProviderByModel(providers: Record<string, ProviderConfig>, model: string): string | null
function getProviderForModel(providers: Record<string, ProviderConfig>, model: string): ProviderConfig
```

## 配置结构

### 完整配置示例
```yaml
llm_providers:
  openai:
    base_url: "https://api.openai.com/v1"
    api_keys:
      - "sk-proj-xxx1"
      - "sk-proj-xxx2"
    models:
      - "gpt-4"
      - "gpt-4-turbo"
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
  model: "gemini-2.5-flash"
```

## 功能特点

### 自动提供商选择
- **模型到提供商映射**：根据指定模型自动查找支持该模型的提供商
- **配置验证**：启动时验证指定模型是否被任何提供商支持
- **运维友好**：通过配置文件灵活定义提供商与模型关系

### 配置验证机制
- **提供商完整性**：验证每个提供商包含必要的 base_url、api_keys 和 models
- **模型可用性**：确保指定的 llm.model 被至少一个提供商支持
- **API Key 有效性**：检查每个提供商至少有一个 API Key

## 使用场景

### 多厂商支持
- **OpenAI**：官方 API 和兼容的第三方服务
- **Google Gemini**：通过 OpenAI 兼容接口
- **Anthropic Claude**：通过代理服务的 OpenAI 兼容接口

### 运维优势
- **成本优化**：根据需要选择不同价格的模型
- **风险分散**：避免对单一提供商的依赖
- **灵活切换**：通过修改配置文件快速切换模型

## 依赖关系

### 核心函数
- `findProviderByModel()` - 查找支持指定模型的提供商
- `getProviderForModel()` - 获取支持指定模型的提供商配置
- `loadConfig()` - 加载和验证配置文件

### 被依赖组件
- [[llm_client]] - 使用提供商配置初始化 LLM 客户端
- [[kagami_bot]] - 主应用加载多提供商配置

## 扩展性

### 新增提供商
1. 在 `llm_providers` 中添加新的提供商配置
2. 配置相应的 `base_url` 和 `api_keys`
3. 在 `models` 数组中列出支持的模型

### 模型管理
- **版本升级**：在提供商的 models 列表中添加新版本
- **模型切换**：修改 `llm.model` 配置项
- **多模型支持**：同一提供商可配置多个模型选项

## 安全考虑

### API Key 管理
- **分离存储**：每个提供商的 API Key 独立管理
- **权限最小化**：为不同提供商创建专用的 API Key
- **定期轮换**：支持多 API Key 轮询，便于密钥轮换

### 配置保护
- **敏感信息**：API Key 等敏感配置需要妥善保护
- **访问控制**：限制配置文件的读取权限
- **日志脱敏**：确保 API Key 不出现在日志中

## 相关文件
- `src/config.ts` - 配置接口和验证逻辑
- `kagami-bot/env.yaml` - 配置文件
- `kagami-bot/env.yaml.example` - 配置模板