# PassiveMessageHandler 被动消息处理器

## 定义

PassiveMessageHandler 实现传统的被动回复策略，仅在机器人被 @ 时触发回复。继承自 [[base_message_handler]]。位于 `src/passive_message_handler.ts`。

## 核心功能

### 被动触发机制
```typescript
async handleMessage(message: Message): Promise<void> {
    // 1. 保存用户消息到历史记录
    this.addMessageToHistory(message);

    // 2. 检查是否被 @
    if (this.isBotMentioned(message)) {
        await this.processAndReply();
    }
}
```

### @ 检测逻辑
```typescript
private isBotMentioned(message: Message): boolean {
    return message.content.some(item => 
        item.type === "at" && item.data.qq === this.botQQ.toString(),
    );
}
```

## 设计特点

### 简单直接
- **触发明确**：只有被 @ 时才会回复
- **无额外逻辑**：不需要体力值、队列等复杂机制
- **确保回复**：被 @ 时必定尝试回复

### 继承优势
- **复用基础功能**：继承 [[base_message_handler]] 的 LLM 集成功能
- **统一接口**：与 [[active_message_handler]] 使用相同的 MessageHandler 接口
- **共享配置**：使用相同的系统提示词和历史管理

## 使用场景

### 适合场景
- **问答机器人**：只在被明确询问时回复
- **低活跃群组**：避免在安静的群组中打扰用户
- **资源节约**：减少不必要的 LLM API 调用
- **传统模式**：保持传统机器人的使用习惯

### 与主动模式对比
| 特性 | 被动模式 | 主动模式 |
|------|----------|----------|
| 触发条件 | 仅 @ 触发 | 所有消息 |
| 回复频率 | 低 | 中等（体力限制） |
| LLM 调用 | 少 | 多 |
| 用户体验 | 传统 | 自然 |
| 资源消耗 | 低 | 中等 |

## 消息处理流程

### 完整流程
1. **接收消息**：[[session]] 传递群组消息
2. **历史记录**：调用 `addMessageToHistory()` 保存消息
3. **@ 检测**：遍历 `message.content` 数组查找 @ 段
4. **条件回复**：仅在检测到 @ 时调用 `processAndReply()`
5. **LLM 处理**：使用继承的 LLM 集成功能生成回复

### @ 检测细节
```typescript
// 检查消息结构中的 at 类型段
message.content.some(item => 
    item.type === "at" &&           // 是 @ 类型
    item.data.qq === this.botQQ.toString() // @ 的是机器人
);
```

## 构造函数
```typescript
constructor(
    llmClient: LlmClient,
    botQQ: number,
    groupId: number,
    session: Session,
    masterConfig?: MasterConfig,
    maxHistorySize = 40,
) {
    super(llmClient, botQQ, groupId, session, masterConfig, maxHistorySize);
}
```

## 依赖关系

### 继承关系
- [[base_message_handler]] - 父类，提供所有核心功能

### 配置依赖
- **botQQ**：用于 @ 检测的机器人 QQ 号
- **masterConfig**：主人特权配置（可选）
- **maxHistorySize**：历史消息保留数量

### 运行时依赖
- [[llm_client]] - 通过父类获得 LLM 功能
- [[session]] - 通过父类获得消息发送功能

## 策略选择

### 配置方式
```yaml
behavior:
  message_handler_type: "passive"  # 选择被动策略
```

### 创建方式
```typescript
// 在 SessionManager 中根据配置创建
if (this.behaviorConfig.message_handler_type === "active") {
    handler = new ActiveMessageHandler(/*参数*/);
} else {
    handler = new PassiveMessageHandler(/*参数*/);
}
```

## 性能特点

### 低资源消耗
- **按需调用**：只在被 @ 时才调用 LLM
- **无定时器**：不需要体力恢复等后台任务
- **内存友好**：不需要额外的队列和状态管理

### 响应特性
- **响应及时**：被 @ 时立即处理，无排队延迟
- **确定性高**：被 @ 时必定尝试回复
- **简单可靠**：逻辑简单，故障点较少

## 扩展性

### 触发条件扩展
- 可以扩展 `isBotMentioned()` 方法支持更多触发条件
- 可以添加关键词触发、时间触发等机制
- 可以支持私聊消息处理

### 功能增强
- 可以添加回复延迟机制
- 可以集成简单的频率限制
- 可以支持特定用户的白名单/黑名单

## 相关文件
- `src/passive_message_handler.ts` - 主要实现
- `src/base_message_handler.ts` - 父类
- `src/session_manager.ts` - 策略选择逻辑