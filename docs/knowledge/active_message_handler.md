# ActiveMessageHandler 主动消息处理器

## 定义

ActiveMessageHandler 实现主动回复策略，集成体力值系统和消息队列，支持智能的群聊参与。继承自 [[base_message_handler]]。位于 `src/active_message_handler.ts`。

## 核心功能

### 主动回复机制
- **智能参与**：LLM 自主决定是否回复每条消息
- **体力限制**：通过体力值系统控制回复频率
- **自然交互**：模拟真人的群聊参与模式

### 消息队列处理
```typescript
async handleMessage(message: Message): Promise<void> {
    // 1. 将消息加入队列
    this.messageQueue.push(message);

    // 2. 触发队列处理（如果当前没有LLM处理中）
    if (!this.isLlmProcessing) {
        await this.processQueueLoop();
    }
}

private async processQueueLoop(): Promise<void> {
    this.isLlmProcessing = true;

    try {
        while (this.messageQueue.length > 0) {
            // 1. 一次性取出所有消息并加入历史记录
            const messages = [...this.messageQueue];
            this.messageQueue.length = 0;
            
            // 2. 将所有消息加入历史
            messages.forEach(message => {
                this.addMessageToHistory(message);
            });

            // 3. 检查体力值并处理
            if (this.canReply()) {
                if (this.energyManager.consumeEnergy()) {
                    const didReply = await this.processAndReply();
                    if (!didReply) {
                        this.energyManager.refundEnergy();
                    }
                }
            }
        }
    } finally {
        this.isLlmProcessing = false;
    }
}
```

### 并发控制
- **状态标志**：`isLlmProcessing` 防止并发 LLM 调用
- **消息队列**：`messageQueue` 缓存等待处理的消息
- **原子处理**：确保队列中的所有消息都被完整处理

## 体力值系统集成

### 体力检查
```typescript
private canReply(): boolean {
    if (!this.energyManager.canSendMessage()) {
        console.log(`[群 ${String(this.groupId)}] 体力不足 (${this.energyManager.getEnergyStatus()})`);
        return false;
    }
    return true;
}
```

### 体力消耗和退还
```typescript
// 消耗体力
if (!this.energyManager.consumeEnergy()) {
    console.log(`[群 ${String(this.groupId)}] 体力不足，无法回复`);
    continue;
}

// LLM 选择不回复时退还体力
if (!didReply) {
    this.energyManager.refundEnergy();
    console.log(`[群 ${String(this.groupId)}] LLM 选择不回复，已退还体力`);
}
```

## 设计优势

### 智能化决策
- **上下文感知**：基于完整的群聊历史做决策
- **自然参与**：LLM 可以选择性参与对话
- **思考透明**：完整记录 LLM 的决策过程

### 性能控制
- **频率限制**：通过体力值避免过度回复
- **并发安全**：防止重复的 LLM 调用
- **资源管理**：自动管理定时器和队列资源

### 用户体验
- **自然交互**：不会强制回复每条消息
- **智能判断**：理解对话情境，适时参与
- **频率合理**：避免刷屏或过度活跃

## 依赖关系

### 直接依赖
- [[base_message_handler]] - 继承基础功能
- [[energy_manager]] - 体力值管理系统

### 配置依赖
- **BehaviorConfig**：体力值相关配置参数
- **MasterConfig**：主人特权配置
- **AgentConfig**：历史消息长度配置

### 生命周期管理
```typescript
destroy(): void {
    this.energyManager.destroy(); // 清理体力恢复定时器
}
```

## 配置参数

### BehaviorConfig 相关
```typescript
constructor(
    llmClient: LlmClient,
    botQQ: number,
    groupId: number,
    session: Session,
    behaviorConfig: BehaviorConfig,  // 体力值配置
    masterConfig?: MasterConfig,
    maxHistorySize = 40,
) {
    super(llmClient, botQQ, groupId, session, masterConfig, maxHistorySize);
    
    this.energyManager = new EnergyManager(
        behaviorConfig.energy_max,
        behaviorConfig.energy_cost,
        behaviorConfig.energy_recovery_rate,
        behaviorConfig.energy_recovery_interval,
    );
}
```

## 状态查询

### 体力状态
```typescript
getEnergyStatus(): string {
    return this.energyManager.getEnergyStatus(); // 返回 "当前/最大" 格式
}
```

### 处理状态
- `isLlmProcessing` - 是否正在处理 LLM 对话
- `messageQueue.length` - 队列中等待处理的消息数量

## 消息处理流程

### 完整流程
1. **消息入队**：新消息加入 `messageQueue`
2. **触发处理**：检查 LLM 是否空闲，空闲时启动处理循环
3. **批量历史**：将队列中所有消息加入历史记录
4. **体力检查**：验证是否有足够体力回复
5. **体力消耗**：扣除回复所需体力值
6. **LLM 对话**：基于完整历史调用 LLM
7. **条件发送**：根据 LLM 决策发送或不发送回复
8. **体力退还**：LLM 选择不回复时退还体力
9. **循环继续**：处理队列中剩余消息

### 并发保护
- 通过 `isLlmProcessing` 标志确保同时只有一个 LLM 对话
- 使用 try-finally 确保标志正确重置
- 队列机制保证消息不会丢失

## 错误处理

### LLM 调用错误
- **API 错误**：记录错误但不影响后续消息处理
- **解析错误**：跳过当前消息，继续处理队列
- **网络错误**：由 [[llm_client]] 统一处理

### 体力系统错误
- **计算错误**：由 [[energy_manager]] 内部处理
- **定时器错误**：在 destroy() 中安全清理

## 相关文件
- `src/active_message_handler.ts` - 主要实现
- `src/base_message_handler.ts` - 父类
- `src/energy_manager.ts` - 体力管理依赖