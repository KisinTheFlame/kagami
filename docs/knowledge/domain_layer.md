# 领域层（Domain Layer）

## 概述

领域层是 Kagami 项目采用领域驱动设计（DDD）的核心层，封装了业务领域的核心概念和规则。该层独立于具体的技术实现，专注于表达业务逻辑和领域知识。

位置：`kagami-bot/src/domain/`

## 设计原则

### 领域驱动设计（DDD）
- **业务语言**：使用业务领域的语言定义类型和实体
- **技术无关**：不依赖于具体的技术实现（数据库、API 等）
- **不变性**：领域实体使用 `readonly` 确保数据不可变
- **类型安全**：充分利用 TypeScript 类型系统表达业务约束

### 架构定位
```
应用层（Application Layer）
    ↓
领域层（Domain Layer）← 业务核心
    ↓
基础设施层（Infrastructure Layer）
```

领域层位于应用的核心，基础设施层（如 Repository）依赖领域层的类型定义，而非相反。

## 核心组件

### LlmCallLog 领域实体

位置：`src/domain/llm_call_log.ts`

表示 LLM 调用日志的业务实体，封装了 LLM 调用的核心信息。

```typescript
export class LlmCallLog {
    readonly id: number;
    readonly timestamp: Date;
    readonly status: LlmCallStatus;
    readonly input: string;
    readonly output: string;

    constructor(
        id: number,
        timestamp: Date,
        status: LlmCallStatus,
        input: string,
        output: string,
    ) {
        this.id = id;
        this.timestamp = timestamp;
        this.status = status;
        this.input = input;
        this.output = output;
    }
}
```

**特点**：
- **不可变性**：所有字段均为 `readonly`，确保实体状态不被意外修改
- **完整性**：封装了 LLM 调用的完整信息
- **类型安全**：使用 `LlmCallStatus` 类型约束状态值

### LlmCallStatus 类型

```typescript
export type LlmCallStatus = "success" | "fail";
```

表示 LLM 调用的状态，使用领域语言定义业务概念。

**优势**：
- **语义明确**：明确表达 LLM 调用只有成功和失败两种状态
- **类型安全**：编译时检查，避免使用非法状态值
- **统一语言**：在整个代码库中使用统一的领域类型

## 使用场景

### 基础设施层使用领域类型

[[llm_call_log_repository]] 使用 `LlmCallStatus` 定义接口：

```typescript
import { LlmCallStatus } from "../domain/llm_call_log.js";

class LlmCallLogRepository {
    async logLLMCall(
        status: LlmCallStatus,  // 使用领域类型
        input: string,
        output: string,
    ): Promise<void> {
        // ...
    }
}
```

### 应用层使用领域实体

未来可能的查询场景：

```typescript
import { LlmCallLog } from "../domain/llm_call_log.js";

class LlmCallLogRepository {
    async findById(id: number): Promise<LlmCallLog | null> {
        const record = await this.database.prisma().llmCallLog.findUnique({
            where: { id }
        });

        if (!record) return null;

        // 将数据库记录转换为领域实体
        return new LlmCallLog(
            record.id,
            record.timestamp,
            record.status as LlmCallStatus,
            record.input,
            record.output
        );
    }
}
```

## 依赖关系

### 被依赖
- [[llm_call_log_repository]] - 使用 `LlmCallStatus` 类型定义接口
- [[llm_client]] - 间接通过 Repository 使用领域类型
- 未来的应用服务层 - 将使用 `LlmCallLog` 实体进行业务逻辑处理

### 依赖
- 无 - 领域层不依赖任何其他层，保持业务逻辑的纯粹性

## 设计优势

### 1. 关注点分离
- 业务概念与技术实现分离
- 数据库模型与领域模型解耦
- 便于业务逻辑的理解和维护

### 2. 类型安全
- 使用 TypeScript 类型系统表达业务约束
- 编译时捕获类型错误
- IDE 自动补全和类型提示

### 3. 可测试性
- 领域实体和类型独立于外部依赖
- 便于编写单元测试
- 无需 mock 数据库或其他基础设施

### 4. 可维护性
- 业务规则集中在领域层
- 修改业务逻辑不影响基础设施层
- 清晰的依赖方向（向内依赖）

### 5. 可扩展性
- 易于添加新的领域实体和类型
- 支持复杂业务规则的表达
- 便于引入领域服务和值对象

## 架构演进

### 当前阶段
- 引入基础的领域实体和类型
- 建立领域层的基础架构
- Repository 层使用领域类型

### 未来扩展

#### 值对象（Value Objects）
```typescript
// 封装 LLM 输入输出的值对象
export class LlmMessage {
    readonly content: string;

    constructor(content: string) {
        if (!content || content.trim().length === 0) {
            throw new Error("LLM message content cannot be empty");
        }
        this.content = content;
    }
}
```

#### 领域服务（Domain Services）
```typescript
// 处理跨实体的业务逻辑
export class LlmCallAnalyzer {
    calculateSuccessRate(logs: LlmCallLog[]): number {
        const successCount = logs.filter(log => log.status === "success").length;
        return successCount / logs.length;
    }
}
```

#### 聚合根（Aggregate Roots）
```typescript
// 管理相关实体的一致性边界
export class LlmSession {
    readonly id: string;
    private callLogs: LlmCallLog[] = [];

    addCallLog(log: LlmCallLog): void {
        // 业务规则：限制单个会话的调用次数
        if (this.callLogs.length >= 100) {
            throw new Error("Session call limit exceeded");
        }
        this.callLogs.push(log);
    }
}
```

## 技术栈

- **语言**：TypeScript
- **设计模式**：领域驱动设计（DDD）
- **不可变性**：readonly 字段
- **类型系统**：TypeScript 类型约束

## 相关节点

- [[llm_call_log_repository]] - 使用领域类型定义数据访问接口
- [[database_layer]] - 基础设施层，存储领域实体
- [[llm_client]] - 应用层，使用领域类型记录调用日志
