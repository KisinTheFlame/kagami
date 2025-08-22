# napcat Session 架构知识点

## Session 封装模式

### 设计理念

Session 封装模式是一种面向对象的设计模式，将与单一实体相关的所有状态和行为封装在一个类中。在 Kagami 项目中，每个 QQ 群组都有一个对应的 Session 实例。

### 核心优势

1. **状态隔离**
   - 每个群组的连接状态、消息队列、错误状态完全独立
   - 单个群组出现问题不会影响其他群组的正常运行

2. **职责清晰**
   - Session 类专注于单一群组的生命周期管理
   - SessionManager 负责多个 Session 的统一调度

3. **扩展性强**
   - 可以为不同群组设置不同的行为策略
   - 便于添加群组特定的功能和配置

4. **便于测试**
   - 可以单独测试每个 Session 的功能
   - Mock 和单元测试更加容易

## WebSocket 连接管理

### node-napcat-ts 特性

- 基于 WebSocket 协议的长连接
- 内置重连机制
- 事件驱动的消息处理
- 支持多种消息类型

### 连接策略

```typescript
// 每个 Session 独立管理连接
class Session {
    private napcat: NCWebsocket;
    
    constructor(groupId: number, config: NapcatConfig) {
        this.napcat = new NCWebsocket({
            baseUrl: config.base_url,
            accessToken: config.access_token,
            reconnection: config.reconnection
        }, false);
    }
}
```

### 错误恢复

- 连接失败时的自动重连
- 重连间隔和次数可配置
- 优雅的错误日志记录

## 消息处理流程

### 接收流程

1. **事件监听**：监听 `message.group` 事件
2. **消息过滤**：检查消息是否来自目标群组
3. **内容提取**：从消息数组中提取文本内容
4. **队列存储**：将处理后的消息存入内存队列
5. **日志记录**：记录消息接收日志

### 发送流程

1. **连接检查**：确认 WebSocket 连接状态
2. **消息构造**：构造符合 napcat API 格式的消息
3. **发送请求**：调用 napcat 的 send_msg API
4. **结果处理**：处理发送结果和可能的错误

## 内存队列设计

### 数据结构

```typescript
interface Message {
    id: string;        // 消息ID
    groupId: number;   // 群组ID
    userId: number;    // 发送者ID
    content: string;   // 文本内容
    timestamp: Date;   // 接收时间
}
```

### 队列操作

- **入队**：新消息自动添加到队列尾部
- **获取**：返回队列副本，不影响原队列
- **清空**：支持按群组清空消息队列

### 内存管理

- 当前版本使用简单的数组存储
- 未来可扩展为 LRU 缓存或数据库存储
- 应用重启会丢失队列中的消息

## 配置管理

### 层次结构

```yaml
napcat:
  base_url: "ws://localhost:3001"  # WebSocket 地址
  access_token: "token"            # 访问令牌
  reconnection:                    # 重连配置
    enable: true
    attempts: 10
    delay: 5000
  groups: [123456, 789012]         # 目标群组列表
```

### 配置验证

- 启动时验证必需配置项
- 缺少配置时抛出明确的错误信息
- 支持环境特定的配置文件

## 生命周期管理

### 启动流程

1. 加载配置文件
2. 创建 SessionManager 实例
3. 根据群组列表创建 Session 实例
4. 并行初始化所有 Session 连接
5. 设置信号处理器用于优雅关闭

### 关闭流程

1. 接收 SIGINT 或 SIGTERM 信号
2. 调用 SessionManager 的关闭方法
3. 逐个断开 Session 连接
4. 清理资源并退出进程

### 错误处理

- Session 级别的错误隔离
- 详细的错误日志记录
- 优雅的错误恢复机制

## 扩展点

### 消息处理扩展

- 支持图片、文件等富媒体消息
- 消息内容的预处理和过滤
- 自定义消息格式转换

### 存储扩展

- 替换内存队列为数据库存储
- 消息持久化和历史查询
- 分布式存储支持

### 群组管理扩展

- 动态添加和删除群组
- 群组特定的配置和行为
- 群组权限和访问控制

### 监控扩展

- 连接状态监控
- 消息数量统计
- 性能指标采集