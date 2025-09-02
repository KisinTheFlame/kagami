# 时区工具 (Timezone Utils)

## 概述

时区工具模块提供了处理 Asia/Shanghai 时区的时间戳格式化功能，确保系统中的时间戳使用中国标准时间而非 UTC 时间。

## 核心功能

### 时间戳格式化
- 将当前时间或指定时间转换为上海时区
- 输出标准化的时间戳格式：`"YYYY-MM-DD HH:mm:ss"`
- 不包含毫秒信息和时区标识

### 主要函数

#### `getShanghaiTimestamp(): string`
- **功能**：获取当前上海时区的时间戳字符串
- **返回值**：格式为 `"YYYY-MM-DD HH:mm:ss"` 的字符串
- **使用场景**：创建新消息时的时间戳

#### `formatShanghaiTimestamp(date: Date): string`
- **功能**：将指定 Date 对象转换为上海时区时间戳
- **参数**：`date` - 要转换的 Date 对象
- **返回值**：格式为 `"YYYY-MM-DD HH:mm:ss"` 的字符串
- **使用场景**：转换历史时间戳

## 技术实现

### 时区转换原理
1. 获取本地时间的 UTC 时间戳
2. 计算 UTC+8 偏移量（8 * 3600000 毫秒）
3. 创建目标时区的 Date 对象
4. 格式化为指定字符串格式

### 代码示例
```typescript
import { getShanghaiTimestamp, formatShanghaiTimestamp } from './utils/timezone.js';

// 获取当前上海时间
const now = getShanghaiTimestamp();
// 输出: "2024-01-01 20:00:00"

// 转换指定时间
const utcTime = new Date('2024-01-01T12:00:00.000Z');
const shanghaiTime = formatShanghaiTimestamp(utcTime);
// 输出: "2024-01-01 20:00:00"
```

## 关联关系

### 依赖关系
- **无外部依赖**：使用原生 JavaScript Date API

### 被使用关系
- [[session]] - 用户消息时间戳创建
- [[base_message_handler]] - 机器人消息时间戳创建

## 使用位置

### 消息创建
- `src/session.ts:56` - 用户消息时间戳
- `src/base_message_handler.ts:74` - 机器人消息时间戳

## 设计考虑

### 为什么使用字符串格式
1. **可读性**：`"2024-01-01 20:00:00"` 比 ISO 格式更易读
2. **一致性**：统一的时区表示，避免混淆
3. **简化**：LLM 处理时不需要解析复杂的时区信息

### 为什么使用上海时区
1. **用户体验**：与中国用户的本地时间一致
2. **上下文相关性**：LLM 能更好理解时间相关的对话

## 维护注意事项

1. **夏令时处理**：中国不使用夏令时，固定 UTC+8
2. **精度考虑**：目前精确到秒，如需更高精度可扩展
3. **性能优化**：函数调用频繁时可考虑缓存优化