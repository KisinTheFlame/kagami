# ActiveMessageHandler 主动消息处理器

## 定义

ActiveMessageHandler 实现主动回复策略，集成体力值系统和实时消息处理，支持智能的群聊参与。继承自 [[base_message_handler]]。位于 `src/active_message_handler.ts`。

## 核心功能

### 主动回复机制
- **智能参与**：LLM 自主决定是否回复每条消息
- **体力限制**：通过体力值系统控制回复频率
- **自然交互**：模拟真人的群聊参与模式

### 实时消息处理
```typescript
async handleMessage(message: Message): Promise<void> {
    // 1. 立即加入历史数组
    this.addMessageToHistory(message);

    // 2. 检查是否可以发起LLM调用
    if (!this.isLlmProcessing) {
        await this.tryProcessAndReply();
    } else {
        // 标记有待处理的消息
        this.hasPendingMessages = true;
    }
}

private async tryProcessAndReply(): Promise<void> {
    this.isLlmProcessing = true;
    this.hasPendingMessages = false;

    try {
        // 检查是否可以回复
        if (!this.canReply()) {
            return;
        }

        // 消耗体力值
        if (!this.energyManager.consumeEnergy()) {
            console.log(`[群 ${String(this.groupId)}] 体力不足，无法回复 (${this.energyManager.getEnergyStatus()})`);
            return;
        }

        // 基于完整历史进行LLM对话
        const didReply = await this.processAndReply();

        // 如果LLM选择不回复，退还体力值
        if (!didReply) {
            this.energyManager.refundEnergy();
            console.log(`[群 ${String(this.groupId)}] LLM 选择不回复，已退还体力`);
        }
    } finally {
        this.isLlmProcessing = false;
    }

    // 检查是否有待处理的消息并递归调用
    this.checkAndProcessPendingMessages();
}

private checkAndProcessPendingMessages(): void {
    if (this.hasPendingMessages) {
        void this.tryProcessAndReply();
    }
}
```

### 并发控制
- **状态标志**：`isLlmProcessing` 防止并发 LLM 调用
- **待处理标志**：`hasPendingMessages` 记录处理期间是否有新消息
- **递归处理**：处理完成后检查并处理期间的新消息

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
- **实时响应**：消息立即可见，LLM 基于最新状态做决策
- **资源管理**：自动管理定时器资源，无需队列维护

### 用户体验
- **自然交互**：不会强制回复每条消息
- **智能判断**：理解对话情境，适时参与
- **频率合理**：避免刷屏或过度活跃

## 架构优化

### 2024年9月优化前后对比

**优化前（队列模式）**：
- 消息缓存在 `messageQueue` 中，等待 LLM 处理完成后批量加入历史
- LLM 处理期间看不到新消息，可能影响对话连贯性
- 复杂的队列循环处理逻辑，代码维护难度较高

**优化后（实时模式）**：
- 消息立即加入历史数组，LLM 能实时看到最新对话状态
- 使用 `hasPendingMessages` 标志代替队列，逻辑更简洁
- 保持并发控制的同时提供更好的实时性

### 优化收益
- **更好的对话连贯性**：LLM 能基于最新的消息状态做决策
- **代码简化**：移除复杂的队列管理逻辑，提高可维护性
- **内存优化**：减少消息缓存，降低内存占用
- **响应及时性**：消息处理更加及时和准确

### 栈安全优化（2024年9月）

**问题发现**：
原实时模式实现存在递归调用风险，在高频消息场景下可能导致栈溢出：
```typescript
// 原有风险代码
tryProcessAndReply() → checkAndProcessPendingMessages() → tryProcessAndReply() → ...
```

**解决方案 - 通知式处理机制**：
```typescript
async handleMessage(message: Message): Promise<void> {
    // 1. 立即加入历史数组
    this.addMessageToHistory(message);

    // 2. 标记有新消息（每次都设置）
    this.hasPendingMessages = true;

    // 3. 尝试启动处理（如果已在处理则直接返回）
    await this.tryProcessAndReply();
}

private async tryProcessAndReply(): Promise<void> {
    // 如果已经在处理中，直接返回（关键：避免并发）
    if (this.isLlmProcessing) {
        return;
    }

    this.isLlmProcessing = true;
    try {
        // 持续处理直到没有新消息
        while (this.hasPendingMessages) {
            this.hasPendingMessages = false;
            // ... 处理逻辑
        }
    } finally {
        this.isLlmProcessing = false;
    }
}
```

**栈安全特性**：
- **零递归设计**：完全避免函数递归调用，调用栈深度始终为1
- **通知机制**：每个消息只是"通知"系统有新消息，不创建新的处理流程
- **单一处理者**：通过 `isLlmProcessing` 确保同时只有一个处理循环运行
- **批量感知**：while 循环能处理期间累积的所有新消息

**安全保障**：
- 无论消息频率多高，都不会出现栈溢出
- 高频场景下性能更优，避免重复函数调用开销
- 逻辑更清晰，所有处理集中在一个循环中

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
- `hasPendingMessages` - 处理期间是否有新消息等待

## 消息处理流程

### 完整流程
1. **实时历史**：新消息立即加入历史记录
2. **并发检查**：检查 LLM 是否空闲，空闲时启动处理
3. **标志设置**：设置处理状态，重置待处理标志
4. **体力检查**：验证是否有足够体力回复
5. **体力消耗**：扣除回复所需体力值
6. **LLM 对话**：基于最新历史调用 LLM
7. **条件发送**：根据 LLM 决策发送或不发送回复
8. **体力退还**：LLM 选择不回复时退还体力
9. **递归处理**：检查期间是否有新消息，有则再次处理

### 并发保护
- 通过 `isLlmProcessing` 标志确保同时只有一个 LLM 对话
- 使用 try-finally 确保标志正确重置
- `hasPendingMessages` 机制保证期间的新消息不会丢失

## 错误处理

### LLM 调用错误
- **API 错误**：记录错误但不影响后续消息处理
- **解析错误**：跳过当前处理，等待下次新消息触发
- **网络错误**：由 [[llm_client]] 统一处理

### 体力系统错误
- **计算错误**：由 [[energy_manager]] 内部处理
- **定时器错误**：在 destroy() 中安全清理

## 相关文件
- `src/active_message_handler.ts` - 主要实现
- `src/base_message_handler.ts` - 父类
- `src/energy_manager.ts` - 体力管理依赖