# Effect Model 设计稿

## 状态

草稿。讨论中。

## 背景：今天"副作用"的四条路径

仓库里目前存在四种"产出动作 / 影响上下文"的路径，长得各不一样，没有统一模型：

| 路径                                    | 形态                                                                                                                                | 例子                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **A. 工具返字符串**                     | `executeTyped → Promise<string>`，框架包成 tool_result                                                                              | bash, calc, send_message      |
| **B. 工具通过 ctx 触发 session 副作用** | 工具调 `rootAgentSession.xxx(...)`，session 内部把 state.onFocus 产出的 `LlmMessage[]` 塞进 pendingPostToolMessages，回合结束 flush | enter, back, back_to_portal   |
| **C. wait 工具阻塞**                    | 工具不立即返回，等事件到达再返回——把"事件输入"伪装成"工具返回"                                                                      | wait                          |
| **D. 事件 handler 直推上下文**          | 完全绕过工具系统，napcat 群消息 → event → `state.handleEvent` → pendingIncomingMessages → flush                                     | 群消息、news_article_ingested |

还有第五条"暗道"：

**E. LoopAgent 内部特权方法**：[ContextCompactionExtension](apps/server/src/agent/runtime/root-agent/extensions/context-compaction.extension.ts) 在每轮结束后调 `host.compactContextIfNeeded(...)`，内部直接 `context.replaceMessages(...)`。这条路径绕过工具、绕过 Effect、绕过任何形式的描述层，是 LoopAgent 私有的"破坏前缀"特权动作。

五条路径并存导致：

1. **概念发散**：新增 Agent 能力时要在五种范式里选，没有指南。
2. **state.onFocus 返 `LlmMessage[]` 抽象层级错乱**：state（业务层）直接构造 LLM 数据结构（底层），跨越了边界。
3. **wait 工具的"阻塞 + 假返回值"是 hack**。
4. **session 上堆积副作用收纳箱**（pendingPostToolMessages / pendingIncomingMessages / pendingPostToolEvents / pendingVisibleEvents 共 4 个）：临时队列散落多处，每条副作用自己管 flush 时机。
5. **LoopAgent 特权方法是暗道**：状态变更没有统一收口，加 telemetry / debugging / mock 都得改多处。

本文档提出 **Effect** 抽象统一这些路径，让 **Agent 状态变更收敛到唯一入口**。

## Event vs Effect：方向相反的两个概念

容易混淆，先讲清楚：

- **Event**：runtime **外部**世界推进来的输入。来源：NapcatGateway（群/私聊消息、好友列表）、News poller（new article ingested）、Story recall（recall 完成）、定时器（wake）。Event 进事件队列，由 `wait` 工具或事件循环消费。
- **Effect**：runtime **内部**由工具/钩子/extension 产出的"状态变更动作"描述。Effect 不进队列，由 Agent 的 Interpreter 立即解释。

它们方向相反：

```
外部世界 ──(Event)──→ runtime ──(Effect)──→ Interpreter
                          │
                          └── 工具/钩子/extension 产出
```

**唯一连接点**：事件 handler 拿到 Event 后产 Effect[]。比如群消息事件 → `QqGroupState.handleEvent({event})` → `[{type: "append_message", content: "<群消息渲染>"}]`。Event 进、Effect 出。

Event ≠ Effect。一个是刺激，一个是响应描述。

## 核心抽象

**Effect 是描述"Agent 状态变更动作"的结构化数据**。它不是 `LlmMessage`、不是 session 方法调用、不是 Event——而是这些底层动作的**意图描述**。Agent 的 Interpreter 负责解释执行。

设计原则：

**所有对 Agent 状态的变更，都应该是一个 Effect**。

- 上下文追加 → `append_message` Effect
- 上下文重建（compact） → `replace_messages` Effect
- 切 App → `switch_app` Effect
- 切 state → `switch_state` Effect
- TaskAgent 终止 → `terminate` Effect

Interpreter 是 Agent 状态变更的**唯一入口**。LoopAgent 不再有"私有特权方法"——ContextCompactionExtension、工具、App 钩子、事件 handler 都通过同一个 Interpreter 改状态。

类比 React：任何组件都能 `dispatch` action，但 reducer 决定如何响应、state 变更收敛到 reducer 这个唯一收口。我们的 Interpreter 起同样作用。

工具的执行结果分两部分：

```ts
type ToolExecutionResult = {
  content: string; // 必返。给 LLM 看的字符串，落到 tool_result 里（ReAct 协议要求每个 tool_call 都跟一个 tool_result）
  effects?: readonly Effect[]; // 可选。结构化副作用描述，由 Agent 的 Interpreter 解释
};
```

两部分**正交**：content 是"给 LLM 看的字面文本"，effects 是"附加给 runtime 解释的动作"。

工具签名上**不带 Effect 泛型**——工具自然可能产多种 Effect，泛型锁不出实际产出的子集，加上之后纯噪音。所有工具签名都是 `Promise<ToolExecutionResult>`。

Agent 也**不显式声明** `supportedEffects` 集合。Interpreter 是个 switch，遇到不认的 case 走 default 抛错——switch 已经隐式声明了"我支持哪些 type"。

## Effect 联合：单一开放结构

```ts
type Effect =
  | { type: "append_message"; content: string } // 包成 role=user 追加到上下文尾部
  | { type: "replace_messages"; messages: LlmMessage[] } // 重建上下文（compact 用）
  | { type: "switch_app"; appId: AppId | null } // root agent 切 currentApp
  | { type: "switch_state"; stateId: string } // root agent 切 focused state
  | { type: "terminate" }; // task agent 退出 invoke 循环
```

整个仓库共享**一个**顶层 Effect 联合（开放，按需扩）。不分 CommonEffect / TaskAgentEffect / RootAgentEffect——因为分层只在编译期有意义，而我们决定不靠编译期校验。运行期由各 Agent 的 Interpreter 决定能解释哪些。

**当前不引入**：

- `wait_for_event`：WaitTool 保持现状（executeTyped 阻塞 await eventQueue.take()，事件到达 stringify 当 content 返回）。阻塞是合法的 async 行为，没必要强包成 Effect。

Effect 类型只在**有具体使用场景**时才加，宁缺勿滥。

## Effect 的产出方

Effect 不只来自工具——所有"想改 Agent 状态"的组件都通过产 Effect 走 Interpreter。

```
                ┌── 工具的 execute()
                ├── App.onFocus / onBlur 钩子
Effect 产出方 ──→├── state.handleEvent（事件 handler）
                ├── LoopAgent extension（如 ContextCompactionExtension）
                └── LoopAgent 主循环本身（未来可能）
                              ↓
                         Effect[]
                              ↓
                     Interpreter.apply()
                              ↓
                       Agent 状态变更
```

四类产出方：

| 产出方                   | 时机                                   | 例子                                                                             |
| ------------------------ | -------------------------------------- | -------------------------------------------------------------------------------- |
| **工具 execute()**       | LLM 调工具时                           | EnterTool 产 `switch_app + append_message`；FinalizeWebSearchTool 产 `terminate` |
| **App.onFocus / onBlur** | 工具触发切 App 时（由 EnterTool 展开） | IthomeApp.onFocus 产 `[append_message{文章列表}]`                                |
| **state.handleEvent**    | 事件到达时                             | QqGroupState.handleEvent 产 `[append_message{群消息渲染}]`                       |
| **LoopAgent extension**  | 主循环钩子（onAfterCommit 等）         | ContextCompactionExtension 产 `replace_messages`（带 summary + keep messages）   |

无论哪种产出方，Effect 都喂给同一个 Interpreter。状态变更**没有暗道**。

## Agent / 工具 / Effect 层级关系

```
                LoopAgent <interface>             TaskAgent <interface>
                       △                                  △
                       │                                  │
                BaseLoopAgent                       BaseTaskAgent
                  (abstract)                         (abstract)
                       △                                  △
                       │                                  │
              ┌────────┴────────┐                  WebSearchTaskAgent
              │                 │                  ContextSummaryTaskAgent (规划中)
        RootLoopAgent      StoryLoopAgent
              │
              ▼ (持有)
       RootAgentSession
```

| 维度     | LoopAgent                    | TaskAgent                         |
| -------- | ---------------------------- | --------------------------------- |
| 生命周期 | 长驻 `while(!stop)` 主循环   | 一次性 `invoke(input) → output`   |
| 上下文   | `AgentContext` 持久化        | 调用栈本地 `messages: TMessage[]` |
| 终止     | 显式 `stop()`                | 工具产 `terminate` Effect         |
| 状态     | LoopAgent 子类可能有 session | 无 session                        |

LoopAgent / TaskAgent 是两条独立的代码线。Effect 的产出和解释路径在两条线里语义一致，但 Interpreter 实现不同（能解释的 type 集合不同）。

## 工具接口

```ts
type ToolExecutionResult = {
  content: string;
  effects?: readonly Effect[];
};

interface ToolComponent {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(args, ctx): Promise<ToolExecutionResult>;
}
```

`ZodToolComponent` 是 ToolComponent 的具体抽象基类：它把"zod 参数校验"做成模板方法——public `execute` 用 `inputSchema.safeParse(args)`，成功后调子类的 abstract `executeTyped(parsed, ctx)`。Effect 模型下，`executeTyped` 的签名从 `Promise<string>` 改成 `Promise<ToolExecutionResult>`（或兼容 `Promise<string | ToolExecutionResult>`，便于渐进迁移：旧工具返字符串，自动包成 `{ content: string }`）。

工具不绑定 Agent 类型。同一个工具理论上可以挂在任意 Agent 上——挂错了的话，工具产某种 Effect 时 Agent 的 Interpreter 不认就抛错。这是运行时安全网。

## Agent 接口

每个 Agent 类型有自己的 `EffectInterpreter`，靠 switch 解释 Effect：

```ts
class RootEffectInterpreter {
  async apply(effect: Effect): Promise<void> {
    switch (effect.type) {
      case "append_message":
        await this.context.appendMessages([this.toUserMessage(effect.content)]);
        return;
      case "replace_messages":
        await this.context.replaceMessages(effect.messages);
        return;
      case "switch_app":
        this.session.setCurrentApp(effect.appId);
        return;
      case "switch_state":
        await this.session.enter({ id: effect.stateId });
        return;
      default:
        throw new Error(
          `RootEffectInterpreter does not handle Effect "${(effect as Effect).type}"`,
        );
    }
  }
}
```

TaskAgent 的 Interpreter 只认 `append_message` + `terminate`，遇到 root 专属的 `switch_app` / `replace_messages` 等就抛。

调用链（工具路径）：

```
ToolCatalog.execute(name, args, ctx)
  ↓
ToolComponent.execute(args, ctx) → Promise<{ content, effects }>
  ↓
ReActKernel 把 content 落进 tool_result
  ↓
EffectInterpreter 按数组顺序逐个 apply effects
```

extension 路径：

```
LoopAgent 主循环钩子（如 onAfterCommit）
  ↓
extension 自行产 Effect
  ↓
EffectInterpreter.apply(effect)
```

无论哪条路径，**Interpreter 是唯一收口**。

## App 接口扩展

```ts
interface App<TConfig = void> {
  // ...现有字段（id / displayName / tools / canInvoke / help / onStartup / onShutdown / configSchema）

  /** 进入 App 时调用。返回 Effect[] 由 Interpreter 解释。 */
  onFocus?(): Promise<Effect[]>;

  /** 退出 App 时调用。 */
  onBlur?(): Promise<Effect[]>;
}
```

EnterTool 处理 App 进入：

```ts
EnterTool.execute → {
  content: '已进入 ithome App',
  effects: [
    { type: "switch_app", appId: "ithome" },
    // ...展平 IthomeApp.onFocus() 的返回值
    { type: "append_message", content: "<articles markdown>" },
  ],
}
```

EnterTool 自己负责"先 switch_app 切上下文，再展开 App.onFocus 拼进自己的 Effect 列表"。**数组顺序 = apply 顺序**（switch_app 必须在 append_message 之前，因为 append_message 是"App 进来后给的屏幕"）。

## 关键场景：Effect 映射表

### 场景 1：ithome 进入

**今天**：`IthomeState.onFocus()` 调 `ithomeNewsService.enterFeed()` 拉文章列表，把 `createIthomeArticleListMessage(...)` 这个 `UserMessage` 返出去，session 塞 pendingPostToolMessages。

**Effect 模型**：

```ts
IthomeApp.onFocus() →
  [{ type: "append_message", content: "<articles markdown>" }]
```

EnterTool 调 App.onFocus 把结果拼进自己的 effects 列表（见上文 EnterTool 处理示例）。

### 场景 2：FinalizeWebSearch（TaskAgent 终止）

**今天**：[FinalizeWebSearchTool](apps/server/src/agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.ts) 自己 executeTyped 返回 summary 字符串。WebSearchTaskAgent 通过 `terminalToolPredicate(toolCall) => toolCall.args?.tool === "finalize_web_search"` 识别终止，把 result.content 喂给 buildResult。

**Effect 模型**：

```ts
FinalizeWebSearchTool.execute → {
  content: '<final summary>',
  effects: [{ type: "terminate" }],
}
```

`BaseTaskAgent.invoke` 看到任何 Effect 是 terminate 就退出循环，content 作为 buildResult 入参。`terminalToolPredicate` 字段、嵌套 dispatcher 匹配逻辑——全部删掉。

### 场景 3：群消息事件

**今天**：napcat 群消息 → event 队列 → `RootAgentSession.consumeIncomingEvent(event)` → state.handleEvent 产 `{ shouldTriggerRound, messages?, events? }` → session 塞 pendingIncomingMessages / pendingVisibleEvents → flush。

**Effect 模型**：

```ts
QqGroupState.handleEvent({ event }) →
  [
    { type: "append_message", content: "<群消息渲染>" },
    // 可能还有"是否触发下一轮"的信号，见未决问题
  ]
```

事件 handler 也走 Effect[]。Interpreter 立即 apply，不再"先攒、后 flush"。

### 场景 4：WaitTool

不动。WaitTool 的 executeTyped 继续阻塞 await eventQueue.take()，事件到达后 stringify 作为 content 返回。**不产 Effect**。

理由：阻塞是合法的 async 行为，引入 `wait_for_event` Effect 只把语义换地方放，没有简化也没有解耦收益。

### 场景 5：back_to_portal

**今天**：BackToPortalTool 调 `rootAgentSession.setCurrentApp(undefined)`。

**Effect 模型**：

```ts
BackToPortalTool.execute → {
  content: '已回到桌面',
  effects: [
    { type: "switch_app", appId: null },
    // ...展开 App.onBlur() 的返回值
  ],
}
```

### 场景 6：上下文压缩（compact）

**今天**：ContextCompactionExtension 在每轮 commit 后调 `host.compactContextIfNeeded(...)`，内部 while 循环：计算 plan → 调 ContextSummaryOperation 产 summary → `context.replaceMessages([summary, ...keep])`。LoopAgent 的"私有特权方法"。

**Effect 模型**：

```ts
class ContextCompactionExtension {
  async onAfterCommit({ context, interpreter, totalTokens }) {
    while (true) {
      const plan = createContextCompactionPlan({
        messages: (await context.getSnapshot()).messages,
        totalTokens,
        threshold: this.threshold,
      });
      if (!plan) return;

      // summarizer 是隔离 TaskAgent，自身循环里也用 terminate Effect 终止
      const summary = await this.summaryTaskAgent.invoke({
        systemPrompt: snapshot.systemPrompt,
        messages: plan.messagesToSummarize,
      });
      if (!summary) return;

      // 不再直接调 host.replaceMessages
      // 产 Effect 给 Interpreter
      await interpreter.apply({
        type: "replace_messages",
        messages: [createConversationSummaryMessage(summary), ...plan.messagesToKeep],
      });
    }
  }
}
```

ContextSummaryOperation 改造成 `ContextSummaryTaskAgent extends BaseTaskAgent`，summary 工具产 `{ content: summary, effects: [{ type: "terminate" }] }`。summarizer 是隔离 TaskAgent，它的 Effect 只影响自己的本地 messages，不影响主 Agent。

主 Agent 的 Interpreter 处理 `replace_messages` Effect 完成实际重建。LoopAgent 不再有 `compactContextIfNeeded` 这种私有特权方法——状态变更走 Effect。

## 4 个 pending\* 收纳箱被替代

四个收纳箱按"产生时机 × 形态"分两维：

|                                                                                  | Messages（已渲染 LlmMessage，直接 appendMessages） | Events（保留 Event 对象，flush 时由 appendEvents 渲染） |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| **回合外（事件消费阶段）** 由 `consumeIncomingEvent → state.handleEvent` 累积    | `pendingIncomingMessages`                          | `pendingVisibleEvents`                                  |
| **回合内（工具执行阶段）** 由 enter/back 切 state 调 `state.onFocus/onBlur` 累积 | `pendingPostToolMessages`                          | `pendingPostToolEvents`                                 |

Effect 模型下：

- `pendingIncomingMessages` / `pendingPostToolMessages` → 由 `append_message` Effect 替代。Interpreter 拿到就立刻 `context.appendMessages([...])`，不再"先攒、后 flush"。
- `pendingVisibleEvents` / `pendingPostToolEvents` 是"保留原始 Event 延迟渲染"——这层在 Effect 模型里不必存在。state.handleEvent 直接产已经描述好的 `append_message` Effect（自己负责渲染），延迟渲染这层省掉。

最终 session 只剩**持久状态**（stateStack、currentApp、groupStates、privateChatStates、ithomeFeedState），不再有临时副作用队列。

## 运行时校验

```ts
class RootEffectInterpreter {
  async apply(effect: Effect): Promise<void> {
    switch (effect.type) {
      case "append_message": ...
      case "replace_messages": ...
      case "switch_app": ...
      case "switch_state": ...
      default:
        throw new Error(
          `RootEffectInterpreter does not handle Effect "${(effect as Effect).type}". ` +
            `Likely the tool is attached to the wrong agent, or Interpreter needs extension.`,
        );
    }
  }
}
```

- 抛错而非静默丢弃：让你知道"工具产了我不认的 Effect"，立即修复。
- 不必显式 `supportedEffects` 集合——switch case 隐式声明。

## 守门：约定式 vs 类型式

把 `replace_messages` 做成 Effect 意味着**理论上**任何工具都能产它，从而触发"破坏 KV 缓存前缀"的昂贵操作。这是真实风险吗？

不是。理由：

1. **约定 + code review**：CLAUDE.md 已明确"replaceMessages 只在上下文压缩用"。review 时检查工具产 Effect 列表里有没有 `replace_messages`。
2. **类比 React `dispatch`**：任何组件都能 dispatch 任何 action，但 reducer 决定如何响应、state 变更收敛到 reducer。我们不会因为"理论上谁都能 dispatch RESET"而把 RESET 排除出 action 体系。
3. **未来 enforcement 的口子留着**：真撞上滥用，可以加工具白名单（只有 ContextSummaryTaskAgent 这类系统组件能产 `replace_messages`），但**不是现在**——避免过早抽象。

设计原则：**Effect 模型的价值是"状态变更的统一收口"，不是"工具能做什么的限制器"**。守门是上层职责（约定 / lint / review），不是 Effect 联合的形态职责。

## 迁移路径

### 阶段 0（本文档）

设计稿，讨论。

### 阶段 1：基础设施 + IthomeApp 作为 PoC

- agent-runtime 定义 `Effect` 联合 + `ToolExecutionResult` + `EffectInterpreter` 抽象。
- 工具签名扩展为 `Promise<string | ToolExecutionResult>`（兼容旧工具，便于渐进）。
- App 接口加 `onFocus?` / `onBlur?` 返 `Effect[]`。
- apps/server 实现 `RootEffectInterpreter`，初版支持 `append_message` + `switch_app` + `switch_state`。
- RootLoopAgent 接 Interpreter，工具执行后走 `interpreter.apply` 链。
- 写 IthomeApp 用 `onFocus` 产 `append_message`，删 IthomeState，迁 config，更新 EnterTool 让它能展开 App.onFocus。
- 验收：ithome 进入 → 看文章列表 → open_ithome_article → back_to_portal 路径走通。

### 阶段 2：terminate 替代 terminalToolPredicate

- `BaseTaskAgent.invoke` 看到 `terminate` Effect 退出循环。
- 删 `terminalToolPredicate` 入参。
- WebSearchTaskAgent / FinalizeWebSearchTool 改造，删嵌套 dispatcher 匹配逻辑。

### 阶段 3：enter / back 工具迁到 Effect

- EnterTool 产 `switch_app` / `switch_state` + 展开 App.onFocus；BackToPortalTool 产 `switch_app{null}` + 展开 App.onBlur；BackTool 产 `switch_state`。
- 删 RootAgentSessionController 上对应的副作用方法。

### 阶段 4：state.handleEvent / onFocus / onBlur 全转 Effect

- state.onFocus / onBlur / handleEvent 返 `Effect[]`。
- session 删 4 个 pending\* 收纳箱，全部走 Interpreter。
- 决定"是否触发下一轮"如何在 Effect 模型里表达（见未决问题）。

### 阶段 5：compact 收口到 Effect

- Interpreter 加 `replace_messages` case。
- ContextSummaryOperation 改造成 `ContextSummaryTaskAgent`，summary 工具产 `terminate` Effect。
- ContextCompactionExtension 不再调 `host.compactContextIfNeeded` 这种特权方法，改为产 `replace_messages` Effect 给 Interpreter。
- 删 RootLoopAgent / StoryLoopAgent 的 `compactContextIfNeeded` 方法（如果没有其他消费者）。
- 验收：完成此阶段后 LoopAgent 不再有任何"特权状态变更方法"，所有状态变更都通过 Interpreter。

## 未决问题

1. **触发下一轮的信号**：事件 handler 今天返 `shouldTriggerRound: boolean`。Effect 模型下，"是否要继续推 LoopAgent 跑下一轮"是隐式由 LoopAgent 主循环判断（看上次 flush 有没有新 user message 进上下文），还是显式 `trigger_round` Effect？倾向隐式（简单），阶段 4 决定。
2. **onFocus 抛错的事务化**：onFocus 抛异常时 switch_app 已经生效但 append_message 没追加。Interpreter 要不要事务化？倾向**不**事务化——onFocus 抛错是 bug，让它抛出来人工排查。文档明示"App.onFocus 必须容错"。
3. **Effect 顺序约定**：当前规则是"数组顺序 = apply 顺序"。工具/钩子拼数组时自己保证顺序对（比如 EnterTool 产 `[switch_app, append_message]` 而不是反过来）。要不要在 Interpreter 加 sanity check（比如禁止 append_message 在 switch_app 之前）？倾向先不加，撞 bug 再加。
4. **跨 Agent 工具复用**：今天 SearchMemoryTool 只在 RootLoopAgent 用，story-recall.scheduler 内部直接调 LLM 借用 root 的工具定义。如果未来 StoryLoopAgent 真要独立调 search_memory，要么 SearchMemoryTool 只产 `append_message`（"通用工具"），要么写两个版本。先看是否真撞上。
5. **compact 期间是否能产其他 Effect**：summarizer TaskAgent 跑的时候，理论上 LLM 调用可能产生 tool_calls（虽然我们用 toolChoice 强制 summary）。如果未来允许 summarizer 多步推理，那这些工具调用产的 Effect 是被 summarizer 自己的 Interpreter 解释（局限在本地 messages），还是有泄漏到主 Agent 的风险？阶段 5 决定，但目前的 one-shot 形态没有这个问题。

## KV 缓存兼容性

- Effect 不影响系统提示（startup 固定不变）。
- 所有 `append_message` 都是追加到尾部，不修改前缀。
- `switch_app` / `switch_state` 不直接动消息列表，只动 session 的 currentApp / stateStack 字段。
- `terminate` 只影响 TaskAgent 的本次 invoke，不影响主 Agent 的稳定前缀。
- `replace_messages` 是**昂贵动作**，破坏 KV 前缀。守门方式是**约定 + review**（见上文「守门：约定式 vs 类型式」），不是把它排除出 Effect 联合。当前唯一合法的产出方是 ContextCompactionExtension。
