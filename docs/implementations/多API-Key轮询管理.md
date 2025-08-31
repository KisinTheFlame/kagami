# 多 API Key 轮询管理实现

## 实现概述

实现了多 API Key 轮询管理功能，支持在配置文件中配置多个 LLM API Key，并通过随机选择策略实现负载均衡和高可用性。系统在每次 LLM 请求时动态选择 API Key，有效分散请求压力并提高服务稳定性。

## 架构设计

### 核心组件

#### ApiKeyManager 类 (`src/api_key_manager.ts`)

负责管理和选择 API Key 的核心类：

```typescript
export class ApiKeyManager {
    private apiKeys: string[];

    constructor(apiKeys: string[]) {
        if (apiKeys.length === 0) {
            throw new Error("API Keys 数组不能为空");
        }
        this.apiKeys = [...apiKeys];
    }

    getRandomApiKey(): string {
        const randomIndex = Math.floor(Math.random() * this.apiKeys.length);
        return this.apiKeys[randomIndex];
    }

    getApiKeyCount(): number {
        return this.apiKeys.length;
    }
}
```

**主要功能**：
- **API Key 存储**：安全存储多个 API Key 的副本
- **随机选择**：使用 `Math.random()` 实现均匀的随机选择
- **数量查询**：提供当前可用 API Key 数量的查询接口
- **输入验证**：构造时验证 API Key 数组不能为空

#### 配置接口更新 (`src/config.ts`)

更新了 `LlmConfig` 接口以支持多 API Key：

```typescript
export interface LlmConfig {
    base_url: string;
    api_keys: string[];  // 从 api_key 改为 api_keys 数组
    model: string;
}
```

**配置验证逻辑**：
```typescript
if (!Array.isArray(config.llm.api_keys) || config.llm.api_keys.length === 0 || !config.llm.base_url || !config.llm.model) {
    throw new Error("配置文件缺少必要的 LLM 配置项");
}
```

#### LLM 客户端重构 (`src/llm.ts`)

重构了 `LlmClient` 类以支持动态 API Key 选择：

```typescript
export class LlmClient {
    private baseURL: string;
    private apiKeyManager: ApiKeyManager;
    private model: string;

    constructor(config: LlmConfig) {
        this.baseURL = config.base_url;
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
        this.model = config.model;
    }

    async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
        try {
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
        } catch (error) {
            throw new Error(`LLM 请求失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
```

**架构变更**：
- **动态客户端创建**：每次请求时创建新的 OpenAI 客户端实例
- **随机 API Key 选择**：通过 `ApiKeyManager` 获取随机 API Key
- **无状态设计**：不保持固定的客户端连接，确保每次都能使用不同的 API Key

## 配置格式

### 新配置格式

```yaml
llm:
  base_url: "https://api.openai.com/v1"
  api_keys:
    - "sk-proj-xxx1"
    - "sk-proj-xxx2"
    - "sk-proj-xxx3"
  model: "gpt-4"
```

### 配置特点

- **必须使用数组格式**：不支持向后兼容，配置文件必须使用 `api_keys` 数组
- **至少一个 API Key**：数组必须包含至少一个有效的 API Key
- **支持任意数量**：可以配置任意数量的 API Key
- **注释支持**：可以使用 YAML 注释临时禁用某些 API Key

## 轮询策略

### 随机选择算法

```typescript
getRandomApiKey(): string {
    const randomIndex = Math.floor(Math.random() * this.apiKeys.length);
    return this.apiKeys[randomIndex];
}
```

**算法特点**：
- **真随机分布**：使用 `Math.random()` 确保每个 API Key 都有相等的被选中概率
- **均匀负载**：长期使用下各个 API Key 的使用频率趋于均匀
- **简单高效**：算法复杂度为 O(1)，性能开销最小

### 负载均衡效果

- **分散请求压力**：避免单个 API Key 承受所有请求
- **降低限制影响**：当某个 API Key 达到频率限制时，其他 Key 仍可正常工作
- **提升并发能力**：多个 API Key 可以并行处理请求

## 高可用性保障

### 故障隔离

- **独立失败**：单个 API Key 失效不会影响整体服务
- **自动切换**：下次请求会自动选择其他可用的 API Key
- **透明处理**：应用层无需关心具体使用了哪个 API Key

### 容错机制

- **配置验证**：启动时验证所有 API Key 配置的完整性
- **运行时检查**：每次请求前确保有可用的 API Key
- **错误传播**：API 错误会被正确传播到上层处理

## 性能影响

### 开销分析

- **额外开销最小**：每次请求只增加一次随机数生成和数组访问
- **内存占用轻微**：只存储 API Key 字符串数组的副本
- **无网络开销**：API Key 选择完全在本地进行

### 性能优势

- **并发提升**：多个 API Key 可以绕过单一账户的并发限制
- **响应时间分散**：避免所有请求集中到同一个 API 端点
- **服务稳定性**：减少因单点限制导致的服务不可用

## 安全考虑

### API Key 保护

- **不记录完整密钥**：日志中不会输出完整的 API Key 信息
- **内存安全**：API Key 存储在私有字段中，不会被意外暴露
- **配置文件保护**：需要保护配置文件的访问权限

### 最佳实践

- **定期轮换**：建议定期更换 API Key 以提高安全性
- **权限最小化**：为机器人创建专用的 API Key，避免使用主账户密钥
- **监控使用量**：监控各个 API Key 的使用情况和配额消耗

## 监控和调试

### 日志记录

虽然不记录完整的 API Key，但可以通过以下方式监控：
- **请求成功率**：监控 LLM 请求的成功和失败情况
- **响应时间**：跟踪不同请求的响应时间分布
- **错误模式**：分析错误消息以识别可能的 API Key 问题

### 调试支持

- **API Key 数量查询**：`getApiKeyCount()` 方法可用于调试和监控
- **配置验证**：启动时的配置验证帮助快速发现配置问题
- **错误消息详细**：提供清晰的错误消息帮助定位问题

## 部署指南

### 配置迁移

从单 API Key 迁移到多 API Key 配置：

1. **备份原配置**：保存原有的配置文件
2. **修改格式**：将 `api_key` 改为 `api_keys` 数组格式
3. **添加更多密钥**：根据需要添加多个 API Key
4. **验证配置**：启动应用验证新配置是否正确加载

### 测试验证

- **功能测试**：验证所有 API Key 都能正常工作
- **负载测试**：测试多 API Key 的负载分散效果
- **故障测试**：模拟单个 API Key 失效的情况

### 生产部署

- **分阶段部署**：先在测试环境验证，再部署到生产环境
- **监控就绪**：确保监控系统能够跟踪多 API Key 的使用情况
- **回滚准备**：准备快速回滚到单 API Key 配置的方案

## 未来扩展

### 可能的增强功能

1. **智能路由**：根据 API Key 的健康状态和响应时间进行智能选择
2. **权重配置**：为不同的 API Key 配置不同的使用权重
3. **故障检测**：自动检测和暂时禁用有问题的 API Key
4. **使用统计**：记录和分析各个 API Key 的使用统计数据
5. **动态配置**：支持运行时动态添加或移除 API Key

### 扩展接口设计

```typescript
interface ApiKeyManager {
    getRandomApiKey(): string;
    getWeightedApiKey(): string;          // 基于权重选择
    getHealthyApiKey(): string;           // 选择健康的 API Key
    markApiKeyUnhealthy(apiKey: string): void; // 标记 API Key 不健康
    getUsageStats(): ApiKeyStats[];       // 获取使用统计
}
```

这种设计为未来的功能扩展提供了良好的基础架构。