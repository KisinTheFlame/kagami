# 数据库层（Database Layer）

## 概述

数据库层提供了 Kagami 项目的数据持久化能力，基于 Prisma ORM + PostgreSQL 实现。该层封装了数据库操作，提供类型安全的数据库访问接口。

## 核心组件

### Database 类
位置：`src/infra/db.ts`

负责管理 PostgreSQL 数据库连接，基于 Prisma ORM 提供类型安全的数据库操作接口。采用依赖注入模式，通过工厂函数 `newDatabase()` 创建实例。

**主要功能：**
- 自动管理 Prisma 客户端连接
- 提供专门的 LLM 日志记录方法
- 动态构建数据库连接URL
- 类型安全的数据库操作

**连接配置：**
- 支持环境变量配置数据库连接参数
- 默认连接到本地 PostgreSQL 实例
- 连接信息从环境变量构建：`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`

## 技术架构

### Prisma Schema
位置：`prisma/schema.prisma`

Prisma schema 定义了数据模型和数据库映射：

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = ""
}

model LlmCallLog {
  id        Int      @id @default(autoincrement())
  timestamp DateTime @default(now())
  status    String   @db.VarChar(20)
  input     String   @db.Text
  output    String   @db.Text

  @@map("llm_call_logs")
  @@index([timestamp])
  @@index([status])
}
```

### 生成的客户端
- Prisma 客户端代码生成到 `src/generated/prisma/`
- 提供完全类型安全的数据库访问API
- 支持自动补全和编译时类型检查

## 数据库设计

### 表结构

#### llm_call_logs
存储 LLM 调用的完整日志记录。

**字段：**
- `id` - 自增主键 (INTEGER)
- `timestamp` - 创建时间戳，自动设置为当前时间 (TIMESTAMP)
- `status` - 调用状态，限制为 'success' 或 'fail' (VARCHAR(20))
- `input` - 输入内容 (TEXT)
- `output` - 输出内容 (TEXT)

**索引：**
- `timestamp` - 按时间查询优化
- `status` - 按状态查询优化

## API 接口

### Database 类方法

```typescript
class Database {
    constructor() // 自动配置 Prisma 客户端

    // 记录 LLM 调用日志
    async logLLMCall(
        status: "success" | "fail",
        input: string,
        output: string,
    ): Promise<void>;
}

// 工厂函数
export const newDatabase = () => Database;
```

## 使用示例

```typescript
import { newDatabase } from './infra/db';

// 创建数据库实例（通常在 bootstrap 函数中）
const database = newDatabase();

// 记录 LLM 调用日志（通过依赖注入传递给需要的组件）
await database.logLLMCall('success', 'user input', 'llm response');
```

## 依赖关系

### 被依赖
- [[llm_client]] - 接收 Database 实例，直接调用 logLLMCall 记录 LLM 调用日志
- [[llm_client_manager]] - 创建 LlmClient 时注入 Database 实例

### 依赖
- Prisma Client - ORM 客户端
- PostgreSQL - 数据库服务器

## 技术特点

### Prisma ORM 优势
- **类型安全**：编译时类型检查，避免 SQL 注入和类型错误
- **自动生成**：基于 schema 自动生成类型安全的客户端代码
- **连接管理**：Prisma 自动管理数据库连接池和生命周期
- **查询优化**：内置查询优化和缓存机制
- **迁移管理**：内置数据库迁移和版本管理

### 依赖注入设计
- **工厂模式**：通过 `newDatabase()` 工厂函数创建实例
- **无全局单例**：避免全局状态，便于测试和替换实现
- **显式依赖**：Database 实例通过构造函数注入到需要的组件
- **生命周期管理**：由应用层统一管理 Database 实例的创建和生命周期

### PostgreSQL 优势
- **ACID 事务**：支持完整的事务特性
- **并发性能**：优秀的多用户并发处理能力
- **扩展性**：支持水平和垂直扩展
- **JSON 支持**：原生 JSON 数据类型支持
- **高可用性**：支持主从复制和故障转移

### 错误处理
- **统一错误处理**：数据库操作失败时抛出描述性错误
- **类型安全错误**：编译时捕获潜在的数据库操作错误
- **异步操作**：所有数据库操作均为异步，避免阻塞主线程

## 构建集成

### Docker 构建流程
```dockerfile
# 生成 Prisma 客户端
RUN npm run prisma:generate

# 编译 TypeScript
RUN npm run build

# 复制 Prisma 引擎二进制文件
RUN cp src/generated/prisma/libquery*.node dist/generated/prisma/
```

### 环境配置
```bash
# 数据库连接配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kagami
DB_USER=kagami
DB_PASSWORD=kagami123
```

## 扩展性

Prisma + PostgreSQL 架构提供了强大的扩展能力：
- **Schema 演进**：通过 Prisma 迁移管理数据库 schema 变更
- **新模型添加**：在 schema.prisma 中定义新的数据模型
- **关系映射**：支持复杂的表关系定义（一对多、多对多等）
- **性能优化**：通过索引和查询优化提升性能
- **多数据库支持**：Prisma 支持切换到其他数据库（MySQL、SQLite 等）
- **高级查询**：支持复杂的查询操作、聚合和事务