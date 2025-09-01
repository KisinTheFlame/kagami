# EnergyManager 体力值管理器

## 定义

EnergyManager 实现体力值系统，通过体力消耗和恢复机制控制机器人的回复频率，防止过度活跃。位于 `src/energy_manager.ts`。

## 核心功能

### 体力值状态管理
```typescript
export class EnergyManager {
    private currentEnergy: number;      // 当前体力值
    private maxEnergy: number;          // 最大体力值
    private costPerMessage: number;     // 每次回复消耗的体力
    private recoveryRate: number;       // 体力恢复速度
    private recoveryInterval: number;   // 恢复间隔（秒）
    private recoveryTimer?: NodeJS.Timeout; // 恢复定时器
}
```

### 体力消耗机制
```typescript
canSendMessage(): boolean {
    return this.currentEnergy >= this.costPerMessage;
}

consumeEnergy(): boolean {
    if (!this.canSendMessage()) {
        return false;
    }
    
    this.currentEnergy -= this.costPerMessage;
    console.log(`[体力系统] 消耗体力 ${String(this.costPerMessage)}，当前体力: ${String(this.currentEnergy)}/${String(this.maxEnergy)}`);
    return true;
}
```

### 体力恢复机制
```typescript
private startRecoveryTimer(): void {
    this.recoveryTimer = setInterval(() => {
        this.recoverEnergy();
    }, this.recoveryInterval * 1000);
}

private recoverEnergy(): void {
    if (this.currentEnergy < this.maxEnergy) {
        const newEnergy = Math.min(this.currentEnergy + this.recoveryRate, this.maxEnergy);
        const recovered = newEnergy - this.currentEnergy;
        
        if (recovered > 0) {
            this.currentEnergy = newEnergy;
            console.log(`[体力系统] 恢复体力 ${String(recovered)}，当前体力: ${String(this.currentEnergy)}/${String(this.maxEnergy)}`);
        }
    }
}
```

### 体力退还机制
```typescript
refundEnergy(): void {
    const newEnergy = Math.min(this.currentEnergy + this.costPerMessage, this.maxEnergy);
    const refunded = newEnergy - this.currentEnergy;
    
    if (refunded > 0) {
        this.currentEnergy = newEnergy;
        console.log(`[体力系统] 退还体力 ${String(refunded)}，当前体力: ${String(this.currentEnergy)}/${String(this.maxEnergy)}`);
    }
}
```

## 设计原理

### 频率控制
- **自然限制**：通过体力值模拟人类的回复频率
- **防止刷屏**：避免机器人过度活跃影响群聊体验
- **智能节约**：LLM 选择不回复时自动退还体力

### 可配置参数
```typescript
constructor(
    maxEnergy: number,          // 体力上限
    costPerMessage: number,     // 每次回复消耗
    recoveryRate: number,       // 恢复速度
    recoveryInterval: number,   // 恢复间隔
) {
    this.maxEnergy = maxEnergy;
    this.currentEnergy = maxEnergy;    // 初始体力满额
    this.costPerMessage = costPerMessage;
    this.recoveryRate = recoveryRate;
    this.recoveryInterval = recoveryInterval;
    this.startRecoveryTimer();         // 启动恢复定时器
}
```

## 默认配置

### 推荐参数
```yaml
behavior:
  energy_max: 100              # 体力上限
  energy_cost: 1               # 每次回复消耗 1 点体力
  energy_recovery_rate: 5      # 每次恢复 5 点体力
  energy_recovery_interval: 60 # 每 60 秒恢复一次
```

### 参数效果分析
- **回复频率**：满体力可连续回复 100 次
- **恢复周期**：空体力到满体力需要 20 分钟（100÷5×60秒）
- **稳定频率**：长期稳定在每 12 秒可回复一次（60÷5）

## 生命周期管理

### 初始化
1. 设置体力值参数
2. 初始体力值设为最大值
3. 启动恢复定时器

### 运行时
1. 响应体力检查请求
2. 处理体力消耗和退还
3. 定时执行体力恢复

### 清理
```typescript
destroy(): void {
    if (this.recoveryTimer) {
        clearInterval(this.recoveryTimer);
        this.recoveryTimer = undefined;
    }
}
```

## 状态查询

### 体力状态
```typescript
getCurrentEnergy(): number {
    return this.currentEnergy;
}

getMaxEnergy(): number {
    return this.maxEnergy;
}

getEnergyStatus(): string {
    return `${String(this.currentEnergy)}/${String(this.maxEnergy)}`;
}
```

## 日志记录

### 详细日志
- **消耗记录**：每次体力消耗都会记录到控制台
- **恢复记录**：每次体力恢复都会记录当前状态
- **退还记录**：体力退还时记录退还数量

### 日志格式
```
[体力系统] 消耗体力 1，当前体力: 99/100
[体力系统] 恢复体力 5，当前体力: 104/100 -> 100/100
[体力系统] 退还体力 1，当前体力: 100/100
```

## 依赖关系

### 被依赖关系
- [[active_message_handler]] - 主要使用者，集成体力系统

### 配置依赖
- [[config_system]] - 从 BehaviorConfig 获取体力参数

### 独立性
- **无外部依赖**：仅依赖 Node.js 标准库
- **状态封装**：所有状态都在内部管理
- **接口简单**：提供清晰的操作接口

## 扩展性

### 可扩展功能
1. **体力策略**：不同类型消息消耗不同体力
2. **动态调整**：根据群组活跃度动态调整参数
3. **体力加速**：特定条件下加速体力恢复
4. **体力统计**：记录体力使用模式和效率

### 扩展接口设计
```typescript
interface EnergyManager {
    // 现有接口
    canSendMessage(): boolean;
    consumeEnergy(): boolean;
    refundEnergy(): void;
    
    // 可能的扩展接口
    consumeEnergyByType(messageType: string): boolean;
    setRecoveryMultiplier(multiplier: number): void;
    getUsageStatistics(): EnergyStats;
}
```

## 性能特性

### 轻量级设计
- **内存占用最小**：只存储几个数值变量
- **CPU 开销低**：定时器和数值计算的开销可忽略
- **无网络调用**：完全本地计算，无外部依赖

### 实时响应
- **即时检查**：体力检查操作为 O(1)
- **即时更新**：体力消耗和恢复立即生效
- **准确计时**：基于系统定时器的精确恢复

## 调试支持

### 状态可视化
- **详细日志**：记录所有体力变化
- **状态字符串**：`getEnergyStatus()` 返回友好的状态显示
- **实时监控**：可以实时查询当前体力状态

### 测试友好
- **确定性行为**：相同参数下行为完全可预测
- **状态可控**：可以通过消耗和恢复操作模拟任意状态
- **清理机制**：`destroy()` 方法确保测试后资源清理

## 相关文件
- `src/energy_manager.ts` - 主要实现
- `src/active_message_handler.ts` - 主要使用者
- `src/config.ts` - BehaviorConfig 接口定义