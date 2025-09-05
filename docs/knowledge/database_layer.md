# 数据库层（Database Layer）

## 概述

数据库层提供了 Kagami 项目的数据持久化能力，基于 SQLite3 实现。该层封装了底层数据库操作，提供统一的异步接口。

## 核心组件

### Database 类
位置：`src/infra/db.ts`

负责管理 SQLite 数据库连接，提供基础的数据库操作接口。

**主要功能：**
- 自动初始化数据库连接
- 执行数据库初始化脚本
- 提供 run 等数据库操作方法
- 管理数据库连接

**初始化过程：**
1. 确保 `data/` 目录存在
2. 创建或连接到 `data/kagami.db`
3. 执行 `scripts/init.sql` 初始化脚本

## 数据库设计

### 文件结构
```
data/
└── kagami.db          # SQLite 数据库文件

scripts/
└── init.sql           # 数据库初始化脚本
```

### 表结构

#### llm_call_logs
存储 LLM 调用的完整日志记录。

```sql
CREATE TABLE llm_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'fail')),
    input TEXT NOT NULL,
    output TEXT NOT NULL
);
```

**索引：**
- `idx_llm_call_logs_timestamp` - 按时间查询
- `idx_llm_call_logs_status` - 按状态查询

## API 接口

### Database 类方法

```typescript
class Database {
    // 初始化数据库连接
    async initialize(): Promise<void>
    
    // 执行 SQL 语句（INSERT、UPDATE、DELETE）
    async run(sql: string, params?: unknown[]): Promise<void>
}

// 导出单例实例
export const db = new Database();
```

## 使用示例

```typescript
import { db } from '../infra/db';

// 插入数据
await db.run(
    'INSERT INTO llm_call_logs (timestamp, status, input, output) VALUES (?, ?, ?, ?)',
    ['2025-01-01T00:00:00.000Z', 'success', 'input', 'output']
);
```

## 关联组件

- [[log_service]] - 基于 Database 层实现的日志服务
- [[llm_client]] - 使用日志服务记录 LLM 调用

## 技术特点

- **类型安全**：使用 TypeScript 严格类型检查
- **异步操作**：所有数据库操作均为异步，避免阻塞
- **自动初始化**：首次使用时自动创建数据库和表结构
- **错误处理**：完善的错误捕获和处理机制
- **连接管理**：通过单例模式管理数据库连接

## 扩展性

数据库层设计为通用的 SQLite 操作封装，支持：
- 添加新的表结构到 `init.sql`  
- 创建新的服务层基于此数据库层
- 通过单例模式确保数据库连接的一致性
- 支持数据库迁移和版本管理（未来扩展）