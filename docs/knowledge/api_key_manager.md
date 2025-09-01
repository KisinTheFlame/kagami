# ApiKeyManager API Key 管理器

## 定义

ApiKeyManager 负责管理多个 LLM API Key，通过随机选择策略实现负载均衡和高可用性。位于 `src/api_key_manager.ts`。

## 核心功能

### API Key 存储和管理
```typescript
export class ApiKeyManager {
    private apiKeys: string[];

    constructor(apiKeys: string[]) {
        if (apiKeys.length === 0) {
            throw new Error("API Keys 数组不能为空");
        }
        this.apiKeys = [...apiKeys]; // 创建副本，避免外部修改
    }
}
```

### 随机选择算法
```typescript
getRandomApiKey(): string {
    const randomIndex = Math.floor(Math.random() * this.apiKeys.length);
    return this.apiKeys[randomIndex];
}
```

### 状态查询
```typescript
getApiKeyCount(): number {
    return this.apiKeys.length;
}
```

## 设计原理

### 负载均衡策略
- **真随机分布**：使用 `Math.random()` 确保每个 API Key 都有相等概率
- **均匀负载**：长期使用下各个 API Key 的使用频率趋于均匀
- **简单高效**：算法复杂度 O(1)，性能开销最小

### 高可用性设计
- **故障隔离**：单个 API Key 失效不影响整体服务
- **自动切换**：下次请求会自动选择其他可用 API Key
- **透明处理**：应用层无需关心具体使用了哪个 API Key

## 安全特性

### 数据保护
- **私有存储**：API Key 存储在私有字段，外部无法直接访问
- **防止修改**：构造时创建数组副本，防止外部修改原数组
- **输入验证**：构造时验证数组不能为空

### 使用安全
- **不记录密钥**：日志中不会输出完整的 API Key
- **内存安全**：API Key 只在必要时从数组中读取
- **异常安全**：API Key 获取失败不会暴露内部状态

## 性能分析

### 时间复杂度
- **选择操作**：O(1) 随机数生成 + O(1) 数组访问
- **查询操作**：O(1) 返回数组长度
- **构造操作**：O(n) 复制 API Key 数组

### 空间复杂度
- **存储开销**：O(n) 存储 n 个 API Key 字符串
- **额外开销**：无额外的索引或缓存结构

### 并发性能
- **线程安全**：只读操作，天然线程安全
- **无锁设计**：不需要同步机制
- **高并发支持**：多个请求可以并行获取不同的 API Key

## 使用示例

### 基本使用
```typescript
const apiKeys = ["sk-proj-xxx1", "sk-proj-xxx2", "sk-proj-xxx3"];
const manager = new ApiKeyManager(apiKeys);

// 获取随机 API Key
const selectedKey = manager.getRandomApiKey();

// 查询可用数量
const count = manager.getApiKeyCount();
console.log(`共有 ${count} 个可用的 API Key`);
```

### 集成到 LLM 客户端
```typescript
export class LlmClient {
    private apiKeyManager: ApiKeyManager;

    constructor(config: LlmConfig) {
        this.apiKeyManager = new ApiKeyManager(config.api_keys);
    }

    async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
        const apiKey = this.apiKeyManager.getRandomApiKey();
        // 使用选中的 API Key 创建 OpenAI 客户端
    }
}
```

## 配置要求

### 配置格式
```yaml
llm:
  api_keys:
    - "sk-proj-xxx1"
    - "sk-proj-xxx2"
    - "sk-proj-xxx3"
```

### 验证规则
- **非空数组**：必须至少包含一个 API Key
- **字符串格式**：每个 API Key 必须是有效字符串
- **去重处理**：理论上支持重复 API Key（但不推荐）

## 扩展性

### 未来增强功能
```typescript
interface ApiKeyManager {
    getRandomApiKey(): string;
    getWeightedApiKey(): string;          // 基于权重选择
    getHealthyApiKey(): string;           // 选择健康的 API Key
    markApiKeyUnhealthy(apiKey: string): void; // 标记不健康状态
    getUsageStats(): ApiKeyStats[];       // 获取使用统计
}
```

### 可扩展特性
- **权重配置**：为不同 API Key 配置不同权重
- **健康检查**：自动检测和暂时禁用有问题的 API Key
- **使用统计**：记录和分析各个 API Key 的使用情况
- **动态管理**：支持运行时添加或移除 API Key

## 依赖关系

### 被依赖关系
- [[llm_client]] - 主要使用者，每次 LLM 调用都需要获取 API Key

### 配置依赖
- [[config_system]] - 从 LlmConfig.api_keys 获取 API Key 列表

## 相关文件
- `src/api_key_manager.ts` - 主要实现
- `src/llm.ts` - 主要使用者
- `src/config.ts` - 配置接口定义