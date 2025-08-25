# 项目实现文档

## napcat 集成实现

### 实现概述

实现了与 napcat 的完整集成，支持接收和发送 QQ 群消息，包含 @ 消息解析和实时事件回调处理。采用统一连接管理架构，通过 ConnectionManager 集中管理单一 WebSocket 连接，SessionManager 负责消息分发，Session 提供群组级别的消息处理接口，支持基于 @ 提及的智能回复。

### 架构设计

#### 核心组件

1. **ConnectionManager 类** (`src/connection_manager.ts`)
   - 管理唯一的 napcat WebSocket 连接
   - 提供统一的消息发送接口
   - 封装用户信息获取和机器人QQ号查询
   - 支持消息分发器注册机制
   - 集中化连接状态管理和错误处理

2. **SessionManager 类** (`src/session_manager.ts`)
   - 统一管理所有 Session 实例和 ConnectionManager
   - 实现消息分发逻辑，根据 groupId 路由消息
   - 提供批量初始化和关闭功能
   - 支持消息发送和广播
   - 自动为每个 Session 创建 PassiveMessageHandler

3. **Session 类** (`src/session.ts`)
   - 封装单个群组的消息处理逻辑
   - 通过 ConnectionManager 委托发送消息
   - 基于回调的实时消息处理机制
   - 支持解析 QQ @ 消息内容
   - 保持向后兼容的公共接口

4. **PassiveMessageHandler 类** (`src/passive_message_handler.ts`)
   - 实现被动的 LLM 对话功能
   - 维护群组聊天历史记录
   - 基于 @ 提及触发智能回复
   - 支持自定义 system prompt 和历史记录长度

5. **配置系统扩展** (`src/config.ts`)
   - 扩展了原有配置结构
   - 支持 napcat 连接配置、群组列表和机器人QQ号
   - 包含重连机制配置和可选的 agent 配置
   - 新增 bot_qq 配置项，消除动态获取QQ号的复杂性

6. **主应用** (`src/main.ts`)
   - KagamiBot 类集成所有组件
   - 从配置文件读取机器人QQ号
   - 自动为每个群组创建独立的 PassiveMessageHandler
   - 提供完整的错误处理和中文日志记录

### 关键特性

#### 统一连接管理
- 全局唯一的 WebSocket 连接，减少资源消耗
- 集中化连接状态管理和错误处理
- 基于消息分发器的事件路由机制

#### 分层架构设计
- ConnectionManager 专注连接管理
- SessionManager 负责消息分发和会话管理
- Session 提供群组级别的业务逻辑封装
- 职责分离，易于维护和扩展

#### 消息处理
- 群组消息自动过滤，只处理配置中的指定群组
- 实时事件回调处理，无消息队列缓存
- 完整解析消息内容，包括文本和 @ 提及信息
- 支持获取发送人昵称和 QQ 号码
- 基于 @ 提及的智能回复触发机制

#### 连接管理
- 基于 node-napcat-ts 的单一 WebSocket 连接
- 支持自动重连机制
- 连接状态集中监控和管理
- 消息分发器支持动态注册

#### 错误处理
- 连接级别的统一错误处理
- Session 级别的业务逻辑错误隔离
- 完整的日志记录
- 优雅的错误恢复机制

### 配置结构

```yaml
llm:
  base_url: "https://api.openai.com/v1"
  api_key: "your-api-key"
  model: "gpt-4o-mini"

napcat:
  base_url: "ws://localhost:3001"
  access_token: "your-napcat-token"
  reconnection:
    enable: true
    attempts: 10
    delay: 5000
  bot_qq: 123456789                    # 机器人的QQ号码
  groups: [123456789, 987654321]

agent:                                 # 可选的对话配置
  history_turns: 40                    # 保留的历史消息条数，默认40
```

### 使用方式

#### 启动应用
```bash
npm run dev    # 开发环境
npm start      # 生产环境
```

#### 发送消息
```typescript
// 向指定群组发送消息
await sessionManager.sendMessageToGroup(groupId, "消息内容");

// 广播消息到所有群组
await sessionManager.broadcastMessage("广播内容");
```

#### SessionManager 初始化
```typescript
// SessionManager 集成 ConnectionManager 并自动为每个群组创建对应的 PassiveMessageHandler
const sessionManager = new SessionManager(
    napcatConfig, 
    llmClient, 
    botQQ, 
    agentConfig
);
// 内部会先连接 ConnectionManager，然后为每个群组创建 Session
await sessionManager.initializeSessions();
```

### 技术细节

#### TypeScript 类型定义
```typescript
interface Message {
    id: string;
    groupId: number;
    userId: number;
    userNickname?: string;      // 发送人昵称
    content: string;
    timestamp: Date;
    mentions?: number[];        // 被 @ 的用户 QQ 号列表
    rawMessage?: { type: string; data: any }[];  // 原始消息结构
}

interface MessageHandler {
    handleMessage(message: Message): Promise<void>;
}

type MessageDispatcher = (context: unknown) => void;  // 消息分发器类型
```

#### 事件处理
- ConnectionManager 监听 `message.group` 事件接收群组消息
- 通过消息分发器将消息路由到 SessionManager
- SessionManager 根据 groupId 分发消息到对应 Session
- Session 解析完整消息结构，支持文本和 @ 类型
- 通过 ConnectionManager 异步获取发送人昵称信息
- 实时回调处理，无延迟响应

#### 生命周期管理
1. SessionManager 创建 ConnectionManager 实例
2. 建立唯一的 WebSocket 连接
3. 设置消息分发器回调函数
4. 为每个群组创建 Session 实例
5. 开始监听和处理消息
6. 信号处理器支持优雅关闭，统一断开连接

### 扩展性

#### 未来可扩展功能
1. **富媒体消息支持**：图片、文件等消息类型
2. **群组特定配置**：不同群组使用不同设置
3. **消息过滤器**：基于内容或用户的消息过滤
4. **统计功能**：消息数量、用户活跃度等统计
5. **主动对话模式**：基于时间或事件触发的主动发言
6. **多轮对话增强**：更复杂的上下文记忆和对话管理

#### 架构优势
- 分层模块化设计，职责分离清晰
- 统一连接管理，减少资源消耗
- 消息分发机制支持高效路由
- Session 模式支持动态添加/移除群组
- 事件回调机制提供实时响应能力
- 统一的管理接口简化上层逻辑
- 良好的错误隔离和恢复机制
- 完整的 @ 消息解析和用户信息获取

### 部署要求

1. **napcat 服务**：需要单独部署和配置 napcat 实例
2. **网络连接**：确保与 napcat 服务的 WebSocket 连接稳定
3. **配置文件**：按照配置结构创建对应的 YAML 文件
4. **QQ 群权限**：确保机器人账号在目标群组中有发言权限