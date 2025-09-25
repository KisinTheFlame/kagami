# Config System 配置系统

## 定义

配置系统负责从 YAML 文件加载、验证和管理机器人的所有配置参数。位于 `src/config.ts`。

## 核心功能

### 配置接口定义
```typescript
export interface Config {
    llm: LlmConfig;           // LLM API 配置
    napcat: NapcatConfig;     // napcat 连接配置
    master?: MasterConfig;    // 主人特权配置
    agent?: AgentConfig;      // 对话历史配置
    behavior?: BehaviorConfig; // 消息处理行为配置
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

### LlmConfig - LLM 配置
```typescript
export interface LlmConfig {
    base_url: string;    // LLM API 基础 URL
    api_keys: string[];  // 多个 API Key 数组
    model: string;       // 使用的模型名称
}
```
**关联组件**：[[llm_client]]、[[api_key_manager]]

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

### BehaviorConfig - 行为配置
```typescript
export interface BehaviorConfig {
    energy_max: number;              // 体力值上限
    energy_cost: number;             // 每次回复消耗体力
    energy_recovery_rate: number;    // 体力恢复速度
    energy_recovery_interval: number; // 体力恢复间隔（秒）
    message_handler_type: "active" | "passive"; // 消息处理策略
}
```
**关联组件**：[[active_message_handler]]、[[energy_manager]]

### MasterConfig - 主人特权配置
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

### 必需字段验证
```typescript
// LLM 配置验证
if (!Array.isArray(config.llm.api_keys) || config.llm.api_keys.length === 0 || 
    !config.llm.base_url || !config.llm.model) {
    throw new Error("配置文件缺少必要的 LLM 配置项");
}

// napcat 配置验证
if (!config.napcat.base_url || !config.napcat.access_token || 
    !config.napcat.groups.length || !config.napcat.bot_qq) {
    throw new Error("配置文件缺少必要的 napcat 配置项");
}
```

### 默认值处理
```typescript
const defaultBehavior: BehaviorConfig = {
    energy_max: 100,
    energy_cost: 1,
    energy_recovery_rate: 5,
    energy_recovery_interval: 60,
    message_handler_type: "active",
};

config.behavior = { ...defaultBehavior, ...(config.behavior ?? {}) };
```

## 配置文件格式

### 完整配置示例
```yaml
llm:
  base_url: "https://api.openai.com/v1"
  api_keys:
    - "sk-proj-xxx1"
    - "sk-proj-xxx2"
  model: "gpt-4"

napcat:
  base_url: "ws://localhost:3001"
  access_token: "your-token"
  reconnection:
    enable: true
    attempts: 10
    delay: 5000
  bot_qq: 123456789
  groups: [123456789, 987654321]

behavior:
  energy_max: 100
  energy_cost: 1
  energy_recovery_rate: 5
  energy_recovery_interval: 60
  message_handler_type: "active"

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
// 传递给不同组件
const llmClient = new LlmClient(config.llm);
const sessionManager = new SessionManager(
    config.napcat,
    llmClient,
    config.napcat.bot_qq,
    config.behavior,
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
- **API Keys 为空**：验证数组不为空
- **无效 URL**：在运行时通过连接测试发现
- **群组列表为空**：验证至少配置一个群组

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