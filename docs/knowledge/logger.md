# 日志服务（logger）

## 概述

日志服务提供了 LLM 调用的完整记录功能，基于 [[database_layer]] 实现数据持久化。该服务专门负责记录每次 LLM API 调用的详细信息，用于后续的分析和问题排查。

## 核心功能

### LLM 调用日志记录
位置：`src/middleware/logger.ts`

**主要职责：**
- 异步记录 LLM 调用的完整信息
- 处理各种数据类型的输入输出
- 确保记录失败不影响主业务流程

## 数据模型

### LLMCallLog 接口
```typescript
interface LLMCallLog {
    id?: number;           // 自增主键
    timestamp: string;     // ISO 8601 时间戳
    status: "success" | "fail";  // 调用状态
    input: string;         // 输入内容（JSON 字符串）
    output: string;        // 输出内容（包括错误信息）
}
```

## API 接口

### Logger 类方法

```typescript
class Logger {
    // 记录 LLM 调用日志
    async logLLMCall(
        status: "success" | "fail",
        input: unknown,
        output: unknown
    ): Promise<void>
}

// 导出单例实例
export const logger = new Logger();
```

## 使用场景

### 在 LLM 客户端中集成

```typescript
// src/llm.ts
import { logger } from './middleware/logger.js';

export class LlmClient {
    async oneTurnChat(messages: ChatCompletionMessageParam[]): Promise<string> {
        const input = { model: this.model, messages };
        let output = '';
        let status: 'success' | 'fail' = 'fail';

        try {
            // ... LLM API 调用
            output = content;
            status = 'success';
            return content;
        } catch (error) {
            const errorMessage = `LLM 请求失败: ${error instanceof Error ? error.message : String(error)}`;
            output = errorMessage;
            throw new Error(errorMessage);
        } finally {
            // 异步记录日志，不阻塞主流程
            void logger.logLLMCall(status, input, output);
        }
    }
}
```

## 核心特性

### 异步记录
- 使用 `void` 调用，确保不阻塞 LLM 请求流程
- 记录失败时只输出错误日志，不影响业务逻辑

### 数据完整性
- 记录完整的输入参数（model、messages 等）
- 保存原始输出内容，包括无效 JSON
- 自动序列化非字符串类型的数据

### 错误容忍
- 日志记录过程中的错误不会中断 LLM 调用
- 提供详细的错误日志用于问题诊断

### 数据持久化
- 基于SQLite数据库存储日志记录
- 自动生成时间戳和自增ID
- 支持复杂数据类型的JSON序列化

## 关联组件

- [[database_layer]] - 底层数据库操作支持
- [[llm_client]] - 主要使用场景，记录每次 API 调用

## 技术实现

### 时间戳处理
```typescript
const timestamp = new Date().toISOString();  // 生成标准 ISO 8601 格式
```

### 数据序列化
```typescript
const inputStr = typeof input === "string" ? input : JSON.stringify(input);
const outputStr = typeof output === "string" ? output : JSON.stringify(output);
```

### 错误处理
```typescript
try {
    await this.database.run(/* SQL 操作 */);
} catch (error) {
    console.error("Failed to log LLM call:", error);
    // 不抛出错误，避免影响主业务流程
}
```

## 扩展可能性

当前实现提供了基础的日志记录功能，未来可以扩展：
- 增加日志查询和统计方法
- LLM 调用性能分析
- 成功率统计和监控
- 异常模式识别
- 调用成本分析
- 日志导出和归档功能