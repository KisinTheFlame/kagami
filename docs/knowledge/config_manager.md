# ConfigManager（配置管理器）

## 定义

ConfigManager 是 kagami-bot 的配置管理核心类，负责加载、验证和提供项目配置访问。它封装了 YAML 配置文件的读取逻辑，提供类型安全的配置访问接口，支持命令行参数指定配置文件路径，替代了原有的函数式配置系统。位于 `kagami-bot/src/config_manager.ts`。

## 核心功能

### 1. 配置加载与验证
- 支持通过构造函数参数指定配置文件路径
- 默认读取 `env.yaml` 配置文件
- 验证所有配置的模型都有对应的 LLM 提供商
- 在构造时打印配置内容用于调试
- 配置文件不存在时抛出明确错误

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

### 基本用法
```typescript
// 使用默认路径创建配置管理器实例
const configManager = newConfigManager("env.yaml");

// 获取各类配置
const napcatConfig = configManager.getNapcatConfig();
const llmConfig = configManager.getLlmConfig();
const masterConfig = configManager.getMasterConfig();

// 查找模型对应的提供商
const provider = configManager.getProviderForModel("gpt-4");
```

### 命令行参数支持
```typescript
// main.ts 中解析命令行参数
function parseArgs(): { configPath: string, promptPath: string } {
    const args = process.argv.slice(2);
    let configPath = "env.yaml"; // 默认值

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--config" && i + 1 < args.length) {
            configPath = args[i + 1];
        }
    }

    return { configPath, promptPath };
}

// 使用解析的路径创建 ConfigManager
const { configPath } = parseArgs();
const configManager = newConfigManager(configPath);
```

### Docker 环境中使用
```dockerfile
# 在 Dockerfile CMD 中指定配置文件路径
CMD ["node", "kagami-bot/dist/main.js", "--config", "kagami-bot/env.yaml"]
```
这使得在 workspace 结构中可以明确指定配置文件的相对路径。

## 配置结构

### LlmConfig
```typescript
type LlmConfig = {
    models: string[],  // 按优先级排序的模型列表
};
```

### NapcatConfig
```typescript
type NapcatConfig = {
    base_url: string,
    access_token: string,
    reconnection: NapcatReconnectionConfig,
    groups: number[],
    bot_qq: number,
};
```

### MasterConfig (可选)
```typescript
type MasterConfig = {
    qq: number,
    nickname: string,
};
```

### AgentConfig (可选)
```typescript
type AgentConfig = {
    history_turns: number,  // 历史消息轮数
};
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
6. **路径可配置** - 支持通过命令行参数或构造函数参数指定配置文件路径
7. **Workspace 兼容** - 路径参数支持使得在 monorepo 结构中能明确指定配置文件位置

## 实现细节

### 构造函数签名
```typescript
class ConfigManager {
    private config: Config;

    constructor(configPath: string) {
        if (!fs.existsSync(configPath)) {
            throw new Error(`配置文件不存在: ${configPath}`);
        }
        const configContent = fs.readFileSync(configPath, "utf-8");
        this.config = yaml.parse(configContent);
        // ... 验证和初始化逻辑
    }
}
```

### 工厂函数
```typescript
export const newConfigManager = (configPath: string) => {
    return new ConfigManager(configPath);
};
```

### 命令行参数解析
在 `kagami-bot/src/main.ts:11-25` 中实现：
```typescript
function parseArgs(): { configPath: string, promptPath: string } {
    const args = process.argv.slice(2);
    let configPath = "env.yaml"; // 默认值
    let promptPath = "static/prompt.txt"; // 默认值

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--config" && i + 1 < args.length) {
            configPath = args[i + 1];
        } else if (args[i] === "--prompt" && i + 1 < args.length) {
            promptPath = args[i + 1];
        }
    }

    return { configPath, promptPath };
}
```

## 与 config_system 的关系

ConfigManager 是对原有 [[config_system]] 的重构，主要改进：
- 从函数式设计改为类封装
- 提供更清晰的配置访问接口
- 便于依赖注入和测试
- 集成配置验证逻辑
- 支持路径参数化，适配 workspace 结构

## 相关变更

### 与 pnpm workspace 迁移的关系
- 在 workspace 结构中，配置文件路径需要明确指定
- Docker 构建时需要使用子项目路径前缀（如 `kagami-bot/env.yaml`）
- 命令行参数支持使得路径配置更加灵活

### 与 deployment_system 的集成
- Docker CMD 中使用 `--config kagami-bot/env.yaml` 明确指定路径
- 生产环境和开发环境可以使用不同的配置文件
- 支持通过环境变量或卷挂载更改配置文件位置

## 相关文件
- `kagami-bot/src/config_manager.ts:50-111` - ConfigManager 类实现
- `kagami-bot/src/main.ts:11-25` - parseArgs 命令行参数解析
- `kagami-bot/src/main.ts:27-50` - bootstrap 函数中的使用
- `kagami-bot/env.yaml` - 默认配置文件
- `kagami-bot/Dockerfile` - Docker 构建配置（指定配置路径）