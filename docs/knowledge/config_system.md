# Config System 配置系统

## 定义

配置系统负责从 YAML 文件加载、验证和管理机器人的所有配置参数。位于 `src/config.ts`。

## 核心功能

### 配置接口定义
```typescript
export interface Config {
    llm_providers: Record<string, ProviderConfig>; // 多提供商配置
    llm: LlmConfig;           // LLM 模型选择配置
    napcat: NapcatConfig;     // napcat 连接配置
    master?: MasterConfig;    // 主人特权配置
    agent?: AgentConfig;      // 对话历史配置
}
```

### 配置加载流程
1. **命令行解析**：读取 `--config` 参数指定的配置文件
2. **默认文件**：未指定时使用 `env.yaml`
3. **文件读取**：使用 `fs.readFileSync()` 读取 YAML 文件
4. **YAML 解析**：使用 `yaml.parse()` 解析配置内容
5. **配置验证**：检查必需字段的完整性
6. **默认值填充**：为可选配置提供默认值

## 配置分类

### LlmConfig - LLM 模型选择配置
```typescript
export interface LlmConfig {
    models: string[];    // 按优先级排列的模型数组，支持降级
}
```
**关联组件**：[[llm_client_manager]]、[[llm_client]]

### ProviderConfig - LLM 提供商配置
```typescript
export interface ProviderConfig {
    interface: "openai" | "genai";  // 提供商接口类型
    base_url?: string;              // API 基础 URL（OpenAI 类型需要）
    api_keys: string[];             // 多个 API Key 数组
    models: string[];               // 该提供商支持的模型列表
}
```
**关联组件**：[[multi_provider_config]]、[[api_key_manager]]

### NapcatConfig - napcat 连接配置
```typescript
export interface NapcatConfig {
    base_url: string;                    // napcat WebSocket URL
    access_token: string;                // 访问令牌
    reconnection: NapcatReconnectionConfig; // 重连配置
    groups: number[];                    // 目标群组列表
    bot_qq: number;                      // 机器人 QQ 号
}
```
**关联组件**：[[connection_manager]]、[[session_manager]]

## MasterConfig - 主人特权配置
```typescript
export interface MasterConfig {
    qq: number;          // 主人 QQ 号
    nickname: string;    // 主人昵称
}
```
**关联组件**：[[base_message_handler]]

### AgentConfig - 对话配置
```typescript
export interface AgentConfig {
    history_turns: number;  // 保留的历史消息条数
}
```
**关联组件**：[[base_message_handler]]

## 配置验证

### 模型与提供商匹配验证
```typescript
// 验证所有配置的模型都有对应的提供商
for (const model of config.llm.models) {
    const providerName = findProviderByModel(config.llm_providers, model);
    if (!providerName) {
        throw new Error(`未找到支持模型 "${model}" 的提供商`);
    }
}
```

### 提供商配置验证
```typescript
// 验证提供商配置完整性
for (const [providerName, providerConfig] of Object.entries(config.llm_providers)) {
    if (!providerConfig.api_keys || providerConfig.api_keys.length === 0) {
        throw new Error(`提供商 "${providerName}" 缺少 API Keys`);
    }
    if (!providerConfig.models || providerConfig.models.length === 0) {
        throw new Error(`提供商 "${providerName}" 缺少支持的模型列表`);
    }
}
```

### napcat 配置验证
```typescript
if (!config.napcat.base_url || !config.napcat.access_token ||
    !config.napcat.groups.length || !config.napcat.bot_qq) {
    throw new Error("配置文件缺少必要的 napcat 配置项");
}
```

## 配置文件格式

### 完整配置示例
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
      - "gpt-3.5-turbo"
  gemini:
    interface: "genai"  # 使用原生 Google GenAI SDK
    api_keys:
      - "AIzaSy-xxx1"
      - "AIzaSy-xxx2"
    models:
      - "gemini-2.0-flash-001"
      - "gemini-1.5-pro"
      - "gemini-1.5-flash"

llm:
  models: ["gpt-4o", "gpt-4", "gemini-2.0-flash-001"]  # 按优先级排列，支持降级

napcat:
  base_url: "ws://localhost:3001"
  access_token: "your-token"
  reconnection:
    enable: true
    attempts: 10
    delay: 5000
  bot_qq: 123456789
  groups: [123456789, 987654321]

master:
  qq: 987654321
  nickname: "主人"

agent:
  history_turns: 40
```

### 环境配置
- **默认配置**：`env.yaml`
- **命令行指定**：`--config custom.yaml`

## 使用方式

### 加载配置
```typescript
import { loadConfig } from "./config.js";

const config = loadConfig(); // 自动处理命令行参数和默认值
```

### 配置传递
```typescript
// LlmClientManager 自动加载配置
import { llmClientManager } from "./llm_client_manager.js";

// SessionManager 不再需要 LlmClient 参数
const sessionManager = new SessionManager(
    config.napcat,
    config.napcat.bot_qq,
    config.master,
    config.agent
);
```

## 错误处理

### 配置文件错误
- **文件不存在**：抛出文件路径错误
- **YAML 语法错误**：抛出解析错误
- **必需字段缺失**：抛出详细的缺失项错误

### 配置内容错误
- **模型无提供商**：验证每个模型都有对应的提供商支持
- **API Keys 为空**：验证数组不为空
- **无效 URL**：在运行时通过连接测试发现
- **群组列表为空**：验证至少配置一个群组
- **模型列表为空**：验证至少配置一个模型用于降级

## 扩展性

### 新增配置项
1. 在相应的接口中添加字段定义
2. 在 `loadConfig()` 中添加验证逻辑
3. 提供合理的默认值（如果适用）
4. 更新配置文件模板

### 配置分类
- **必需配置**：系统无法运行的核心配置
- **可选配置**：有默认值的可选功能配置
- **环境相关**：开发和生产环境的差异配置

## 相关文件
- `src/config.ts` - 配置系统实现
- `env.yaml.example` - 配置模板
