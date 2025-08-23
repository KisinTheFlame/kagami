# 项目实现文档

## napcat 集成实现

### 实现概述

实现了与 napcat 的完整集成，支持接收和发送 QQ 群消息，包含 @ 消息解析和实时事件回调处理。采用 Session 封装模式，每个群组拥有独立的会话管理，支持基于 @ 提及的智能回复。

### 架构设计

#### 核心组件

1. **Session 类** (`src/session.ts`)
   - 封装单个群组的完整生命周期
   - 管理独立的 napcat WebSocket 连接
   - 基于回调的实时消息处理机制
   - 支持解析 QQ @ 消息和获取用户昵称
   - 处理消息接收、发送和错误处理

2. **SessionManager 类** (`src/session_manager.ts`)
   - 统一管理所有 Session 实例
   - 提供批量初始化和关闭功能
   - 支持消息发送和广播
   - 自动为每个 Session 创建 PassiveMessageHandler
   - 管理 LLM 客户端和机器人 QQ 号的传递

3. **PassiveMessageHandler 类** (`src/passive_message_handler.ts`)
   - 实现被动的 LLM 对话功能
   - 维护群组聊天历史记录
   - 基于 @ 提及触发智能回复
   - 支持自定义 system prompt 和历史记录长度

4. **配置系统扩展** (`src/config.ts`)
   - 扩展了原有配置结构
   - 支持 napcat 连接配置、群组列表和机器人QQ号
   - 包含重连机制配置和可选的 agent 配置
   - 新增 bot_qq 配置项，消除动态获取QQ号的复杂性

5. **主应用** (`src/main.ts`)
   - KagamiBot 类集成所有组件
   - 从配置文件读取机器人QQ号
   - 自动为每个群组创建独立的 PassiveMessageHandler
   - 提供完整的错误处理和中文日志记录

### 关键特性

#### Session 封装模式
- 每个群组一个独立的 Session 实例
- 群组间状态完全隔离，错误不会相互影响
- 便于后续扩展群组特定功能

#### 消息处理
- 群组消息自动过滤，只处理配置中的指定群组
- 实时事件回调处理，无消息队列缓存
- 完整解析消息内容，包括文本和 @ 提及信息
- 支持获取发送人昵称和 QQ 号码
- 基于 @ 提及的智能回复触发机制

#### 连接管理
- 基于 node-napcat-ts 的 WebSocket 连接
- 支持自动重连机制
- 连接状态实时监控

#### 错误处理
- Session 级别错误隔离
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
// SessionManager 自动为每个群组创建对应的 PassiveMessageHandler
const sessionManager = new SessionManager(
    napcatConfig, 
    llmClient, 
    botQQ, 
    agentConfig
);
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
```

#### 事件处理
- 监听 `message.group` 事件接收群组消息
- 自动过滤非目标群组的消息
- 解析完整消息结构，支持文本和 @ 类型
- 异步获取发送人昵称信息
- 实时回调处理，无延迟响应

#### 生命周期管理
1. 应用启动时初始化所有 Session
2. 建立 WebSocket 连接
3. 获取 bot 自身 QQ 号码
4. 设置消息处理回调函数
5. 开始监听和处理消息
6. 信号处理器支持优雅关闭

### 扩展性

#### 未来可扩展功能
1. **富媒体消息支持**：图片、文件等消息类型
2. **群组特定配置**：不同群组使用不同设置
3. **消息过滤器**：基于内容或用户的消息过滤
4. **统计功能**：消息数量、用户活跃度等统计
5. **主动对话模式**：基于时间或事件触发的主动发言
6. **多轮对话增强**：更复杂的上下文记忆和对话管理

#### 架构优势
- 模块化设计，易于单独测试和维护
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