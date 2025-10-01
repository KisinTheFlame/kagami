# LLM 调用日志仓储（LlmCallLogRepository）

## 定义

LlmCallLogRepository 是 LLM 调用日志的数据访问层，采用 Repository 模式封装 LLM 调用日志的持久化操作。位于 `kagami-bot/src/infra/llm_call_log_repository.ts`。

## 核心功能

### 日志记录接口
```typescript
import { LlmCallStatus } from "../domain/llm_call_log.js";

async logLLMCall(
    status: LlmCallStatus,  // 使用领域层定义的类型
    input: string,
    output: string,
): Promise<void> {
    try {
        await this.database.prisma().llmCallLog.create({
            data: {
                status,
                input,
                output,
            },
        });
    } catch (error) {
        throw new Error(`Failed to log LLM call: ${String(error)}`);
    }
}
```

### 工厂函数
```typescript
export const newLlmCallLogRepository = (database: Database) => {
    return new LlmCallLogRepository(database);
};
```

## 设计特点

### Repository 模式
- **职责单一**：专注于 LLM 调用日志的数据访问操作
- **抽象数据访问**：隔离业务逻辑与数据库操作细节
- **依赖注入**：通过构造函数注入 Database 依赖
- **类型安全**：利用 Prisma 的类型系统和领域类型确保数据操作正确性

### 领域驱动设计集成
- **使用领域类型**：接口参数使用 [[domain_layer]] 定义的 `LlmCallStatus` 类型
- **统一语言**：数据访问层使用领域层的业务术语
- **依赖方向**：Repository 依赖领域层，而非相反
- **类型安全保障**：编译时检查状态值的合法性

### 架构优势
- **关注点分离**：将 LLM 日志存储逻辑从 [[database_layer]] 中分离
- **可测试性**：易于编写单元测试和 mock
- **可维护性**：修改日志存储逻辑不影响其他数据访问代码
- **可扩展性**：便于添加查询、分页、筛选等功能

## 依赖关系

### 依赖
- [[domain_layer]] - 使用 `LlmCallStatus` 类型定义接口参数
- [[database_layer]] - 通过 `Database.prisma()` 获取 Prisma 客户端访问数据库

### 被依赖
- [[llm_client]] - 在每次 LLM 调用后记录日志（成功或失败）
- [[llm_client_manager]] - 创建 LlmClient 时注入 LlmCallLogRepository 实例

## 数据模型

### llm_call_logs 表
- `id` - 自增主键 (INTEGER)
- `timestamp` - 创建时间戳，自动设置为当前时间 (TIMESTAMP)
- `status` - 调用状态：使用 [[domain_layer]] 定义的 `LlmCallStatus` 类型 ('success' 或 'fail') (VARCHAR(20))
- `input` - LLM 输入内容 (TEXT)
- `output` - LLM 输出内容或错误信息 (TEXT)

详细信息参考：[[database_layer]]

### 领域模型映射
Repository 负责将领域类型映射到数据库模型：
- 领域类型 `LlmCallStatus` → 数据库字段 `status` (VARCHAR)
- 未来可能支持将数据库记录转换为 `LlmCallLog` 领域实体

## 使用示例

```typescript
import { newDatabase } from './infra/db.js';
import { newLlmCallLogRepository } from './infra/llm_call_log_repository.js';
import { LlmCallStatus } from './domain/llm_call_log.js';

// 在 bootstrap 函数中创建实例
const database = newDatabase();
const llmCallLogRepository = newLlmCallLogRepository(database);

// 记录成功调用（使用领域类型）
const successStatus: LlmCallStatus = 'success';
await llmCallLogRepository.logLLMCall(
    successStatus,
    JSON.stringify(request),
    responseContent
);

// 记录失败调用（使用领域类型）
const failStatus: LlmCallStatus = 'fail';
await llmCallLogRepository.logLLMCall(
    failStatus,
    JSON.stringify(request),
    `模型调用失败: ${errorMessage}`
);

// 类型安全：以下代码会在编译时报错
// await llmCallLogRepository.logLLMCall('invalid', input, output); // ❌ 类型错误
```

## 架构集成

### 依赖注入流程
```
bootstrap() 函数创建顺序：
1. Database
2. LlmCallLogRepository (依赖: Database)
3. LlmClientManager (依赖: LlmCallLogRepository)
   └── LlmClient[] (依赖: LlmCallLogRepository)
```

### 调用流程
```
LlmClient.oneTurnChat()
    ↓
try { provider.oneTurnChat() }
    ↓
LlmCallLogRepository.logLLMCall(status: LlmCallStatus, ...)
    ↓
Database.prisma().llmCallLog.create()
```

### 类型流转
```
应用层（LlmClient）
    ↓ 使用领域类型
领域层（LlmCallStatus）
    ↓ Repository 接口参数
Repository 层（LlmCallLogRepository）
    ↓ 映射到数据库字段
基础设施层（Database + Prisma）
```

## 未来扩展

### 查询功能
- 按时间范围查询日志
- 按状态筛选日志
- 分页查询支持
- 全文搜索输入/输出内容

### 统计分析
- 计算成功率
- 分析失败原因分布
- 统计不同模型的调用情况
- 性能指标聚合

### 数据管理
- 日志归档
- 自动清理过期日志
- 数据导出功能

## 相关节点
- [[domain_layer]] - 提供领域类型定义（LlmCallStatus, LlmCallLog）
- [[database_layer]] - 提供数据库访问能力
- [[llm_client]] - 主要使用者，记录每次 LLM 调用
- [[llm_client_manager]] - 创建 LlmClient 时注入 Repository
- [[console_system]] - 通过 API 查询和展示日志数据
