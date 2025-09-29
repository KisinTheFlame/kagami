# ConfigManager（配置管理器）

## 定义

ConfigManager 是 kagami-bot 的配置管理核心类，负责加载、验证和提供项目配置访问。它封装了 YAML 配置文件的读取逻辑，提供类型安全的配置访问接口，替代了原有的函数式配置系统。

## 核心功能

### 1. 配置加载与验证
- 读取 `env.yaml` 配置文件
- 验证所有配置的模型都有对应的 LLM 提供商
- 在构造时打印配置内容用于调试

### 2. 配置访问接口
提供类型安全的配置访问方法：
- `getNapcatConfig()` - 获取 NapCat 连接配置
- `getLlmConfig()` - 获取 LLM 模型列表配置
- `getLlmProvidersConfig()` - 获取所有 LLM 提供商配置
- `getMasterConfig()` - 获取主人配置（可选）
- `getAgentConfig()` - 获取智能体配置（可选）
- `getProviderForModel(model)` - 根据模型名查找对应的提供商配置

### 3. 模型-提供商映射
- 自动查找支持指定模型的提供商
- 在模型未找到提供商时抛出错误

## 使用示例

```typescript
// 创建配置管理器实例
const configManager = newConfigManager();

// 获取各类配置
const napcatConfig = configManager.getNapcatConfig();
const llmConfig = configManager.getLlmConfig();
const masterConfig = configManager.getMasterConfig();

// 查找模型对应的提供商
const provider = configManager.getProviderForModel("gpt-4");
```

## 配置结构

### LlmConfig
```typescript
interface LlmConfig {
    models: string[];  // 按优先级排序的模型列表
}
```

### NapcatConfig
```typescript
interface NapcatConfig {
    base_url: string;
    access_token: string;
    reconnection: NapcatReconnectionConfig;
    groups: number[];
    bot_qq: number;
}
```

### MasterConfig (可选)
```typescript
interface MasterConfig {
    qq: number;
    nickname: string;
}
```

### AgentConfig (可选)
```typescript
interface AgentConfig {
    history_turns: number;  // 历史消息轮数
}
```

## 依赖关系

### 被依赖
- [[session_manager]] - 接收 ConfigManager 注入，用于初始化会话
- [[llm_client_manager]] - 接收 ConfigManager 注入，用于创建 LLM 客户端
- [[connection_manager]] - 接收 ConfigManager 注入，用于连接 NapCat
- [[context_manager]] - 接收 ConfigManager 注入，用于构建上下文

### 依赖
- `yaml` 库 - 用于解析 YAML 配置文件
- `fs` 库 - 用于读取文件系统

## 实现位置

`kagami-bot/src/config_manager.ts`

## 设计特点

1. **类型安全** - 使用 TypeScript 接口定义所有配置结构
2. **依赖注入** - 通过工厂函数创建实例，便于测试
3. **配置验证** - 构造时验证配置的完整性和正确性
4. **单一职责** - 专注于配置管理，不涉及业务逻辑
5. **错误处理** - 配置文件缺失或模型未找到提供商时抛出明确错误

## 与 config_system 的关系

ConfigManager 是对原有 [[config_system]] 的重构，主要改进：
- 从函数式设计改为类封装
- 提供更清晰的配置访问接口
- 便于依赖注入和测试
- 集成配置验证逻辑