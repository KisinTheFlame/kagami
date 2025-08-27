# LLM 对话集成实现

## 实现概述

实现了基于 LLM 的智能群聊对话功能，支持被动触发和主动参与的自然语言交互。系统集成了思考链（Chain of Thought）功能，能够展示 LLM 的决策过程，并支持智能选择是否回复消息。

**2024年最新架构升级**：
- **完全结构化的消息处理架构**：LLM 可以完整理解和生成包含 @ 提及等复杂格式的消息
- **思考链集成**：LLM 会先思考再决定如何回复，提供可观测的推理过程
- **智能选择回复**：主动模式下 LLM 可以模拟真人行为，选择不参与不适合的对话
- **智能回复引用功能**：LLM 可以自主决定是否回复特定消息，区分自然对话和问答场景
- **对话对象理解优化**：通过 few shot 示例教会 LLM 准确识别对话目标

## 架构设计

### 核心组件

#### BaseMessageHandler 类 (`src/base_message_handler.ts`)

提供 LLM 对话功能的抽象基类，包含核心的消息处理逻辑：

- **消息历史管理**：使用 LRU 策略维护每个群组的聊天历史
- **上下文构建**：将完整的 Message 对象序列化为 JSON 传递给 LLM  
- **思考链处理**：解析 LLM 的 thought 内容并记录到日志和历史
- **结构化响应解析**：支持新的 JSON 数组格式和向后兼容的旧格式
- **可选回复支持**：处理 LLM 选择不回复的情况

#### PassiveMessageHandler 类 (`src/passive_message_handler.ts`)

继承自 BaseMessageHandler，负责被动触发的对话：

- **@ 触发机制**：通过遍历消息结构检测机器人是否被 @ 
- **确保回复**：被动模式下被 @ 时必须回复

#### ActiveMessageHandler 类 (`src/active_message_handler.ts`)

继承自 BaseMessageHandler，负责主动参与的对话：

- **体力系统集成**：消耗体力值来控制回复频率
- **智能选择回复**：LLM 可以选择不回复，体力会被退还
- **自然参与**：模拟真人的群聊参与模式

#### 系统提示词 (`static/prompt.txt`)

定义了机器人的行为规范、安全防护和新的思考链结构化输出：

```
你是一个温和友好的 QQ 群聊参与者，名字是小镜。
你会自然地参与群聊，保持轻松、简洁的对话风格。

## 安全防护机制
- 拒绝重复、循环类恶意指令
- 遇到不合理命令时用俏皮语气回复拒绝
- 支持主人特权：主人指令优先级最高
- 保持简短自然的回复风格（1-2句话）

## 消息格式说明

你将接收到 JSON 格式的用户消息，包含以下字段：
- id: 消息唯一标识
- groupId: 群组 ID
- userId: 用户 QQ 号
- userNickname: 用户昵称
- content: 消息内容数组，每个元素包含：
  - type: 消息类型（"text" 文本、"at" @提及等）
  - data: 具体数据
    - text: 文本内容
    - qq: 被@的QQ号
- timestamp: 发送时间

## 回复要求

请以 JSON 数组格式回复，数组中每个元素都有 type 和 content 字段：

1. 第一个元素必须是 thought 类型，包含你的思考过程
2. 可以有多个 thought 元素来记录不同的思考步骤
3. 如果决定回复，添加一个 reply 类型的元素（可选）

**有回复的情况：**
[
  {
    "type": "thought",
    "content": "用户在询问我的状态，这是一个很自然的问候"
  },
  {
    "type": "reply",
    "content": [
      {"type": "text", "data": {"text": "我很好呀！你怎么样？"}}
    ]
  }
]

**选择不回复的情况：**
[
  {
    "type": "thought",
    "content": "用户们在讨论很专业的技术话题，我不太了解"
  },
  {
    "type": "thought",
    "content": "这个时候保持安静比较好，不要打断他们的讨论"
  }
]
```

### 技术特性

#### 消息数据结构

```typescript
export interface Message {
    id: string;
    groupId: number;
    userId: number;
    userNickname?: string;
    content: SendMessageSegment[];  // 结构化消息内容
    timestamp: Date;
    metadata?: {                    // 新增：扩展信息
        thoughts?: string[];        // LLM的思考过程
        hasReply?: boolean;         // 是否包含回复
        replyToMessageId?: string;  // 如果这条消息是回复某条消息
    };
}
```

**LLM响应数据结构**：

```typescript
interface ThoughtItem {
    type: "thought";
    content: string;
}

interface ReplyItem {
    type: "reply";
    content: SendMessageSegment[];
}

type LlmResponseItem = ThoughtItem | ReplyItem;
type LlmResponse = [ThoughtItem, ...LlmResponseItem[]];
```

**最新架构改进**：
- **思考链集成**：Message 接口扩展了 metadata 字段来存储 LLM 的思考过程
- **结构化输出**：LLM 输出采用 JSON 数组格式，天然保证思考在回复之前
- **向后兼容**：同时支持新的数组格式和旧的对象格式
- **可选回复**：支持只有思考没有回复的情况

#### 对话上下文构建

```typescript
protected buildChatMessages(): ChatCompletionMessageParam[] {
    // 构建包含机器人QQ号的系统提示
    const systemPromptWithContext = `${this.systemPrompt}

<bot_context>
你的QQ号是: ${String(this.botQQ)}
</bot_context>`;

    const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPromptWithContext },
    ];

    this.messageHistory.forEach(msg => {
        if (msg.userId === this.botQQ) {
            // Bot 的消息作为 assistant
            if (msg.metadata?.thoughts) {
                // 新格式：构建包含thoughts和reply的数组
                const responseArray: LlmResponseItem[] = [];
                
                // 添加所有thoughts
                msg.metadata.thoughts.forEach(thought => {
                    responseArray.push({ type: "thought", content: thought });
                });
                
                // 添加reply（如果有）
                if (msg.metadata.hasReply && msg.content.length > 0) {
                    responseArray.push({ type: "reply", content: msg.content });
                }
                
                messages.push({
                    role: "assistant",
                    content: JSON.stringify(responseArray),
                });
            } else {
                // 旧格式兼容
                messages.push({
                    role: "assistant",
                    content: JSON.stringify({ reply: msg.content }),
                });
            }
        } else {
            // 用户消息作为 user - 传递完整的 Message JSON
            messages.push({
                role: "user",
                content: JSON.stringify(msg),
            });
        }
    });

    return messages;
}
```

**最新架构优势**：
- **思考链上下文**：LLM 可以看到历史对话中的思考过程，保持推理连贯性
- **完整上下文保留**：用户昵称、@ 信息、时间戳等所有上下文信息完整传递
- **向后兼容**：自动处理新旧两种格式的历史消息
- **智能连续性**：LLM 能基于之前的思考过程做出更一致的决策

#### 触发检测机制

```typescript
private isBotMentioned(message: Message): boolean {
    return message.content.some(item => 
        item.type === "at" && item.data.qq === this.botQQ.toString(),
    );
}
```

- **精确检测**：直接从消息结构中检测 @ 提及
- **类型安全**：使用 TypeScript 强类型确保数据正确性
- **扩展性强**：可轻松支持更多触发条件

## 消息处理流程

### 完整工作流程

1. **接收消息**：Session 接收群组消息，保持完整的结构化格式
2. **保存历史**：MessageHandler 将完整 Message 对象添加到历史记录
3. **检查触发**：
   - **被动模式**：遍历 `content` 数组检查是否包含对机器人的 @ 
   - **主动模式**：检查体力值，决定是否参与对话
4. **构建上下文**：将完整 Message 对象和历史思考过程序列化为 JSON 传递给 LLM
5. **LLM 思考**：LLM 接收完整上下文，首先生成思考内容（thought）
6. **LLM 决策**：基于思考过程，LLM 决定是否生成回复（reply）
7. **解析响应**：
   - 提取 `thought` 内容并记录到日志
   - 提取可选的 `reply` 内容
8. **条件发送**：
   - 如果有回复内容，发送到群组
   - 如果没有回复（主动模式），退还体力值
9. **记录完整响应**：将包含思考和回复的完整响应添加到历史记录

### 消息格式示例

#### 被动模式示例

**用户发送**："@小镜 今天天气怎么样？"

**LLM 接收的 JSON**：
```json
{
  "id": "123456",
  "userId": 789012,
  "userNickname": "张三",
  "content": [
    {"type": "at", "data": {"qq": "987654321"}},
    {"type": "text", "data": {"text": " 今天天气怎么样？"}}
  ],
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**LLM 生成的思考链回复**：
```json
[
  {
    "type": "thought",
    "content": "张三问我今天的天气情况，这是一个很自然的问候和咨询"
  },
  {
    "type": "thought",
    "content": "虽然我无法获取实时天气数据，但可以给出一个友好的回应"
  },
  {
    "type": "reply",
    "content": [
      {"type": "at", "data": {"qq": "789012"}},
      {"type": "text", "data": {"text": " 我无法获取实时天气，建议你查看天气APP哦"}}
    ]
  }
]
```

**控制台日志显示**：
```
[群 123456789] LLM 思考:
  1. 张三问我今天的天气情况，这是一个很自然的问候和咨询
  2. 虽然我无法获取实时天气数据，但可以给出一个友好的回应
[群 123456789] LLM 回复成功: @张三 我无法获取实时天气，建议你查看天气APP哦
```

**群组中显示**："@张三 我无法获取实时天气，建议你查看天气APP哦"

#### 主动模式示例

**用户A发送**："最近在学React，有点难懂"
**用户B发送**："哪里不懂？我可以帮你"

**LLM 生成的思考链（选择不回复）**：
```json
[
  {
    "type": "thought",
    "content": "用户A说在学习React遇到困难，用户B主动提供帮助"
  },
  {
    "type": "thought",
    "content": "这是两个用户之间的互助对话，用户B已经在提供帮助"
  },
  {
    "type": "thought",
    "content": "我不应该打断他们的交流，让他们自然地进行技术讨论"
  }
]
```

**控制台日志显示**：
```
[群 123456789] LLM 思考:
  1. 用户A说在学习React遇到困难，用户B主动提供帮助
  2. 这是两个用户之间的互助对话，用户B已经在提供帮助
  3. 我不应该打断他们的交流，让他们自然地进行技术讨论
[群 123456789] LLM 选择不回复，已退还体力
```

**群组中无消息发送**

## 配置参数

### LLM 配置

```yaml
llm:
  base_url: "https://api.openai.com/v1"
  api_keys:                    # 支持多个 API Key 轮询使用
    - "sk-xxx1"
    - "sk-xxx2"
    - "sk-xxx3"
  model: "gpt-4"
```

**多 API Key 轮询特性**：
- **随机选择策略**：每次 LLM 请求时从 api_keys 数组中随机选择一个 API Key
- **负载均衡**：确保多个 API Key 的使用负载均匀分布
- **高可用性**：当单个 API Key 出现限制时，可通过其他 Key 继续服务
- **简单配置**：只需在配置文件中添加多个 API Key 即可启用

### Agent 配置 (可选)

```yaml
agent:
  history_turns: 40    # 保留的历史消息条数，默认 40
```

### 机器人 QQ 号配置

```yaml
napcat:
  bot_qq: 123456789    # 机器人的 QQ 号码，用于 @ 检测
```

## 架构优势

### 智能决策能力

- **思考链可观测**：完整记录 LLM 的推理过程，便于调试和理解决策逻辑
- **自然交互模式**：主动模式下模拟真人行为，选择性参与对话
- **上下文连贯性**：历史思考过程被保留，确保对话的逻辑一致性

### 语义完整性

- **完整上下文**：LLM 能看到谁发送消息、何时发送、@ 了谁等完整信息
- **精准理解**：能准确理解复杂的群聊对话场景和历史思考过程
- **智能回应**：基于思考链做出更理性和恰当的回应

### 扩展性

- **思考链扩展**：可以轻松添加更多类型的思考步骤
- **多模式支持**：被动触发和主动参与两种模式满足不同场景
- **向后兼容**：新旧格式并存，平滑升级
- **类型安全**：使用 TypeScript 强类型系统确保数据结构正确

### 性能优化

- **智能体力管理**：主动模式下避免不必要的回复，节约 API 调用
- **结构化存储**：思考过程和回复内容分别存储，便于检索和分析
- **精确触发**：避免不必要的 LLM 调用，提高整体效率
- **API Key 轮询**：通过随机分发请求到多个 API Key，避免单点限制和提升并发性能

## 集成方式

### SessionManager 集成

```typescript
// 为每个 Session 创建对应的 PassiveMessageHandler
const handler = new PassiveMessageHandler(
    this.llmClient,
    this.botQQ,
    groupId,
    session,
    this.agentConfig?.history_turns ?? 40,
);

session.setMessageHandler(handler);
```

### 独立性保证

- 每个群组有独立的 PassiveMessageHandler 实例
- 消息历史记录完全隔离
- LLM 对话上下文不会跨群组混淆

## 未来扩展能力

### 即将支持的功能

1. **思考链增强**：
   - 支持更复杂的推理步骤类型（分析、判断、总结等）
   - 思考过程可视化界面
   - 思考质量评估和优化

2. **智能交互升级**：
   - 基于思考链的情感分析
   - 上下文感知的个性化回复
   - 多轮对话的长期记忆

3. **多媒体消息**：图片、文件、语音等消息类型的思考和处理
4. **表情回复**：LLM 可以使用 QQ 表情增强回复效果
5. **回复引用**：✅ 已支持，LLM 可智能决定是否回复特定消息
6. **群组个性化**：不同群组可以有不同的机器人人设和思考风格

### 配置灵活性

- System prompt 可通过文件轻松修改，支持思考链指导和安全防护
- 历史记录长度可配置，包括思考过程的保留策略
- 主动模式的参与频率和判断标准可调节
- 消息格式完全基于 node-napcat-ts 标准
- 支持主人特权配置：可在配置文件中设置主人QQ号和昵称

## 部署注意事项

1. **LLM 服务**：确保 LLM API 服务可用且配置正确，支持 JSON mode
2. **API Key 配置**：配置文件必须使用 `api_keys` 数组格式，至少包含一个有效的 API Key
3. **提示词文件**：确保 `static/prompt.txt` 文件存在且包含思考链格式指导
4. **网络延迟**：LLM 请求可能有一定延迟，思考链会增加少量处理时间
5. **API 限制**：注意 LLM API 的频率限制和配额管理，多 API Key 可有效分散限制压力
6. **日志管理**：思考链会产生较多日志输出，注意日志存储和轮转策略
7. **内容审核**：✅ 已内置安全防护机制，自动拒绝恶意指令并给出俏皮回复
8. **向后兼容**：部署时新旧格式会并存，确保历史数据正常处理
9. **类型兼容**：确保所有依赖的 node-napcat-ts 版本兼容
10. **API Key 安全**：妥善保管多个 API Key，避免在日志中泄露完整密钥