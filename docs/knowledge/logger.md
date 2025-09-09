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
    // 记录 LLM 调用日志（接收已格式化的字符串）
    async logLLMCall(
        status: "success" | "fail",
        input: string,
        output: string
    ): Promise<void>
}

// 导出单例实例
export const logger = new Logger();
```

## 使用场景

### 在消息处理器中集成

```typescript
// src/base_message_handler.ts
import { logger } from './middleware/logger.js';

export class BaseMessageHandler {
    protected async processAndReply(): Promise<boolean> {
        let inputForLog = "";
        let status: "success" | "fail" = "fail";
        let llmResponse = "";
        
        try {
            // 构建数据结构和LLM请求
            const chatMessageData = this.buildChatMessageData();
            const chatMessages = this.buildChatMessages();
            
            // 生成美观的输入字符串用于记录
            inputForLog = JSON.stringify(chatMessageData, null, 2);
            
            llmResponse = await this.llmClient.oneTurnChat(chatMessages);
            
            if (llmResponse === "") {
                status = "fail";
                void logger.logLLMCall(status, inputForLog, "LLM调用失败");
                throw new Error("LLM调用失败");
            }
            
            status = "success";
            // 记录成功的LLM调用
            void logger.logLLMCall(status, inputForLog, llmResponse);
            
            // ... 处理响应
        } catch (error) {
            // 记录失败的LLM调用 - 使用JSON序列化确保复杂错误对象能被完整记录
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
            if (inputForLog) {
                void logger.logLLMCall("fail", inputForLog, errorMessage);
            }
            throw error;
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
- **增强错误记录**：对于复杂错误对象，使用JSON序列化记录完整信息，避免"[object Object]"问题

### 错误容忍
- 日志记录过程中的错误不会中断 LLM 调用
- 提供详细的错误日志用于问题诊断

### 数据持久化
- 基于SQLite数据库存储日志记录
- 自动生成时间戳和自增ID
- 支持复杂数据类型的JSON序列化

## 关联组件

- [[database_layer]] - 底层数据库操作支持
- [[base_message_handler]] - 主要使用场景，在消息处理层进行日志记录

## 技术实现

### 时间戳处理
```typescript
const timestamp = new Date().toISOString();  // 生成标准 ISO 8601 格式
```

### 数据存储
```typescript
// input和output都已经是格式化好的字符串，直接存储
await db.run(
    "INSERT INTO llm_call_logs (timestamp, status, input, output) VALUES ($1, $2, $3, $4)",
    [timestamp, status, input, output],
);
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