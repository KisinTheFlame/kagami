# Effect Model 设计稿

## 状态

草稿。等 review 通过后开阶段 1 PR 落地。

## 背景：今天"副作用"的四条路径

仓库里目前存在四种"产出动作 / 影响上下文"的路径，长得各不一样，没有统一模型：

| 路径                                    | 形态                                                                                                                              | 例子                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **A. 工具返字符串**                     | `executeTyped → Promise<string>`，框架包成 tool_result                                                                            | bash, calc, send_message      |
| **B. 工具通过 ctx 触发 session 副作用** | 工具调 `rootAgentSession.xxx(...)`，session 内部把"state.onFocus 产出的 LlmMessage[]"塞进 pendingPostToolMessages，回合结束 flush | enter, back, back_to_portal   |
| **C. wait 工具阻塞**                    | 工具不立即返回，等事件到达再返回——把"事件输入"伪装成"工具返回"                                                                    | wait                          |
| **D. 事件 handler 直推上下文**          | 完全绕过工具系统，napcat 群消息 → event → `state.handleEvent` → pendingIncomingMessages → flush                                   | 群消息、news_article_ingested |

四条路径并存导致：

1. **概念发散**：新增一个 Agent 能力要在四种范式里选，没有指南。
2. **state.onFocus 返 `LlmMessage[]` 抽象层级错乱**：state（业务层）直接构造 LLM 数据结构（底层），跨越了边界。
3. **wait 工具的"阻塞 + 假返回值"是 hack**：它的语义其实是"我要等事件再继续这一轮"，不是普通 tool_result。
4. **session 上堆积副作用收纳箱**（pendingPostToolMessages / pendingIncomingMessages / pendingPostToolEvents / pendingVisibleEvents）：这些临时队列在 session 里散落多处，每条副作用都自己管 flush 时机。

本文档提出 **Effect** 抽象统一这四条路径，并定义工具 / Agent / Interpreter 之间的契约。

## 核心抽象：三方契约

**Effect 是描述"副作用动作"的结构化数据**。它不是 `LlmMessage`、不是 session 方法调用、不是事件——而是这些底层动作的**意图描述**。runtime 负责解释执行。

三方角色：

```
┌─────────┐         ┌─────────────────┐         ┌────────────────────┐
│  工具   │ ───产出─→│  Effect[]       │←── 校验 │  Agent             │
│         │         │                  │         │  - supportedEffects│
│         │         │  按数组顺序解释  │   解释  │  - interpreter     │
└─────────┘         └─────────────────┘ ←───── └────────────────────┘
```

- **工具**：执行后返回 `{ content: string; effects?: Effect[] }`。content 是给 LLM 看的字符串（落到 tool_result 里），effects 是附加给 runtime 解释的动作。工具**不知道**自己跑在哪个 Agent 里，也**不绑死** Agent 类型——它只声明自己**可能产**哪些 Effect。
- **Agent**：声明自己**支持**的 Effect 类型集合（`supportedEffects`）。拿到工具结果时，逐一校验 effects 中的 type 是否都在支持集里；不支持的类型直接抛错（不静默丢弃，避免业务上"以为生效了实际上没生效"）。校验通过后由 Agent 内置的 `EffectInterpreter` 按数组顺序应用每个 Effect。
- **Effect 类型本身**：开放结构 `{ type: string; ...payload }`。通用 Effect 在 agent-runtime 包里定义；Agent 专属 Effect 由各 Agent 实现方扩展。

为什么是双重校验（编译期 + 运行期）？

- **编译期**：TypeScript 让 Effect 联合可以被类型层面 narrow，便于工具签名声明意图、Agent 类型层面校验"工具产的 Effect 子集 ⊆ Agent 的支持集"。
- **运行期**：兜底。Effect 类型是开放结构，未来增加 Effect 类型时，老 Agent 拿到新 Effect 不能默默吞掉——必须显式失败，让你知道这里需要扩。

## Agent / 工具 / Effect 类层级

```
                LoopAgent <interface>             TaskAgent <interface>
                       △                                  △
                       │                                  │
                BaseLoopAgent                       BaseTaskAgent
                  (abstract)                         (abstract)
                       △                                  △
                       │                                  │
              ┌────────┴────────┐                  WebSearchTaskAgent
              │                 │                  ContextSummaryAgent (规划中)
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

LoopAgent 和 TaskAgent 是两条独立的代码线。各自承载自己的 Effect 联合：

```ts
// agent-runtime 包：所有 Agent 共有的最小 Effect
type CommonEffect = { type: "append_message"; content: string }; // 包成 role=user 追加到尾部

// agent-runtime 包：TaskAgent 共有的 Effect
type TaskAgentEffect = CommonEffect | { type: "terminate" }; // 退出 invoke 循环，content 作为 buildResult 入参

// apps/server 的 root agent：扩自己的 Effect 联合
type RootAgentEffect =
  | CommonEffect
  | { type: "switch_app"; appId: AppId | null }
  | { type: "switch_state"; stateId: string }
  | { type: "wait_for_event"; maxWaitMs?: number };

// StoryLoopAgent 暂时也只用 CommonEffect。未来如果需要 story 专属再扩。
type StoryAgentEffect = CommonEffect;
```

`terminate` 暂时只放在 `TaskAgentEffect` 里——LoopAgent 不需要被工具中断主循环。未来 LoopAgent 有这需求再加。

## 工具接口

```ts
type ToolExecutionResult<TEffect extends { type: string }> = {
  content: string; // 必返，ReAct 协议每个 tool_call 必须跟一个 tool_result
  effects?: readonly TEffect[];
};

interface ToolComponent<TEffect extends { type: string }> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(args, ctx): Promise<ToolExecutionResult<TEffect>>;
}
```

`TEffect` 由工具自己声明，落在工具实现的类型参数上。通用工具用 `CommonEffect`，特定 Agent 专属工具用对应 Agent 的 Effect 联合。

工具不指定自己属于哪个 Agent。挂载工具时由 Agent 检查 `工具.TEffect ⊆ Agent.supportedEffects`。

### 跨 Agent 复用工具

如果一个工具想给多个 Agent 用（比如 SearchMemoryTool 给 RootLoopAgent 和未来某个 sub-task 都用），它的 TEffect 必须是各 Agent 支持集的**交集**——也就是只产 CommonEffect。这样的工具是"通用工具"。

如果工具产 Agent 专属 Effect（比如 EnterTool 产 `switch_app`），它就只能挂在那种 Agent 里。挂错了类型检查会失败。

## Agent 接口

每个 Agent 类型实现 `Agent<TEffect>`：

```ts
interface Agent<TEffect extends { type: string }> {
  readonly supportedEffects: ReadonlySet<TEffect["type"]>;
  applyEffects(effects: readonly TEffect[]): Promise<void>;
}
```

- `supportedEffects`：Effect type 字面量集合，运行时校验用。
- `applyEffects`：按数组顺序 apply 每个 Effect，内部委托给 Agent 自己的 `EffectInterpreter`。

工具执行完毕后，调用链是：

```
ToolCatalog.execute(name, args, ctx)
  ↓
ToolComponent.execute(args, ctx)
  ↓ Promise<{ content, effects }>
ReActKernel 收到结果
  ↓ 把 content 落进 tool_result
  ↓ 把 effects 转给 Agent
Agent.applyEffects(effects)
  ↓ 校验每个 effect.type ∈ supportedEffects
  ↓ EffectInterpreter 按 index 顺序 apply
```

## App 接口扩展

```ts
interface App<TConfig = void> {
  // ...现有字段（id / displayName / tools / canInvoke / help / onStartup / onShutdown / configSchema）

  /** 进入 App 时调用。返回 Effect[] 由 root agent 的 Interpreter 解释。 */
  onFocus?(): Promise<RootAgentEffect[]>;

  /** 退出 App 时调用。 */
  onBlur?(): Promise<RootAgentEffect[]>;
}
```

App 的 `onFocus` / `onBlur` 是 root agent 专属概念——只 root agent 上下文里才有"App 焦点切换"这件事。所以它们直接绑 `RootAgentEffect`。

## 关键场景：Effect 映射表

下面是若干"今天怎么做、Effect 模型下怎么做"的对照：

### 场景 1：ithome 进入

**今天**：`IthomeState.onFocus()` 调 `ithomeNewsService.enterFeed()` 拉文章列表，把 `createIthomeArticleListMessage(...)` 这个 `UserMessage` 返出去，session 塞 pendingPostToolMessages。

**Effect 模型**：

```ts
IthomeApp.onFocus() →
  [{ type: "append_message", content: "<articles markdown>" }]
```

EnterTool 处理：

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

也就是说 EnterTool 自己负责"展开 App 的 onFocus 钩子并把结果拼进自己的 Effect 列表"。

### 场景 2：wait 工具

**今天**：wait 工具 `executeTyped` 阻塞 await event queue，事件到达后 stringify 当作 tool_result 返回。

**Effect 模型**：

```ts
WaitTool.execute → {
  content: '正在等待事件...',  // 占位说明，给 LLM 看（但 LLM 看不到——见下文）
  effects: [{ type: "wait_for_event", maxWaitMs: 600_000 }],
}
```

`wait_for_event` Interpreter 的语义：本回合不结束、不进 LLM——而是阻塞到事件到达，事件到达后产生 `append_message` 推到上下文，然后继续。

但这暴露一个细节：wait 不该让 content 进 tool_result，否则 LLM 会看到"正在等待事件..."这种没用的占位。可能需要扩展 wait_for_event 的语义，让 Interpreter 在 apply 时**取消** tool_result 落地（或者 ToolExecutionResult 加一个 `suppressContent?: boolean` 标志？）。

这是设计稿里待定的细节，留到阶段 3 实现 wait 时再决定。

### 场景 3：enter App

**今天**：EnterTool 调 `rootAgentSession.setCurrentApp(targetApp.id)`，没有任何"进入时给屏幕"的能力。

**Effect 模型**：见场景 1。EnterTool 现在产 `switch_app` + 展开 App.onFocus 的 Effect。

### 场景 4：FinalizeWebSearch（task agent 终止）

**今天**：[FinalizeWebSearchTool](apps/server/src/agent/capabilities/web-search/task-agent/tools/finalize-web-search.tool.ts) 自己 executeTyped 返回 summary 字符串。WebSearchTaskAgent 通过 `terminalToolPredicate(toolCall) => toolCall.args?.tool === "finalize_web_search"` 识别终止，把 result.content 喂给 buildResult。

**Effect 模型**：

```ts
FinalizeWebSearchTool.execute → {
  content: '<final summary>',
  effects: [{ type: "terminate" }],
}
```

BaseTaskAgent.invoke 看到任何 Effect 是 terminate 就退出循环，content 作为最终 buildResult 入参。`terminalToolPredicate` 字段、嵌套 dispatcher 匹配逻辑——全部删掉。

### 场景 5：群消息事件

**今天**：napcat 群消息 → event 队列 → `RootAgentSession.handleEvent(event)` → state.handleEvent 产 `{ shouldTriggerRound, messages?, events? }` → session 塞 pendingIncomingMessages → flush。

**Effect 模型**：

```ts
QqGroupState.handleEvent({ event }) →
  [
    { type: "append_message", content: "<群消息渲染>" },
    // 可能还有 trigger_round 标志？
  ]
```

事件 handler 也走 Effect[]。`shouldTriggerRound` 这种返回字段可能要变成另一个 Effect（`trigger_round`），或者 LoopAgent 主循环检查"上一次 flush 有没有新 user message 进上下文，有就触发下一轮"。后者更隐式，前者更显式——阶段 4 再定。

### 场景 6：状态切换的 onBlur（暂未实现）

**Effect 模型**：

```ts
TerminalApp.onBlur() →
  []  // 大多数 App 不需要离开提示
```

```ts
QqGroupState.onBlur() →
  [{ type: "append_message", content: "已离开群聊 xxx" }]  // 如果业务上有需要
```

## 运行时校验机制

```ts
class RootLoopAgent implements Agent<RootAgentEffect> {
  public readonly supportedEffects: ReadonlySet<RootAgentEffect["type"]> = new Set([
    "append_message",
    "switch_app",
    "switch_state",
    "wait_for_event",
  ]);

  public async applyEffects(effects: readonly RootAgentEffect[]): Promise<void> {
    for (const effect of effects) {
      if (!this.supportedEffects.has(effect.type)) {
        throw new Error(
          `RootLoopAgent does not support Effect type "${effect.type}". ` +
            `This means a tool produced an effect that this agent can't interpret. ` +
            `Either fix the tool or extend supportedEffects.`,
        );
      }
      await this.interpreter.apply(effect);
    }
  }
}
```

- **抛错而不静默丢弃**：让你知道"工具产了我不认的 Effect"——通常是接错了 Agent 或者忘了扩 Effect 联合。
- **校验在 apply 之前**：避免应用了一半发现不认。

## 迁移路径

### 阶段 0（本文档）

- 定型设计稿，等 review。

### 阶段 1（基础设施 + ithome App 化作为 PoC）

- 在 agent-runtime 定义 `CommonEffect`、`TaskAgentEffect`、`Agent<TEffect>` 接口。
- 工具签名扩展为 `Promise<string | ToolExecutionResult<TEffect>>`（兼容旧返字符串，便于渐进迁移）。
- App 接口加 `onFocus?` / `onBlur?` 返 `RootAgentEffect[]`。
- 在 apps/server 定义 `RootAgentEffect` 联合、`RootEffectInterpreter`。
- RootLoopAgent 接 Interpreter，工具结果走 `applyEffects`。
- 写 IthomeApp 用 `onFocus` 产 `append_message`，删 IthomeState，迁 config。
- 验收：ithome 进入 → 看文章列表 → open_ithome_article → back_to_portal 这条路径走通。

### 阶段 2（terminate 替代 terminalToolPredicate）

- TaskAgentEffect 加 terminate。
- BaseTaskAgent.invoke 看到 terminate 退出循环。
- 删 `terminalToolPredicate` 入参，WebSearchTaskAgent / FinalizeWebSearchTool 改造。

### 阶段 3（enter / back / wait 工具迁到 Effect）

- EnterTool 产 `switch_app` + 展开 App.onFocus；BackToPortalTool 产 `switch_app{appId:null}` + 展开 App.onBlur；BackTool 产 `switch_state`。
- WaitTool 产 `wait_for_event`。决定 wait 的 content/suppress 细节。
- 删 RootAgentSessionController 上对应的副作用方法。

### 阶段 4（事件 handler / state 钩子全转 Effect）

- state.onFocus / onBlur / handleEvent 返 `RootAgentEffect[]`。
- session 删 pendingPostToolMessages / pendingIncomingMessages / pendingPostToolEvents / pendingVisibleEvents 这些临时收纳箱，全部走 Interpreter。
- 决定 `trigger_round` 是显式 Effect 还是隐式由 LoopAgent 决定。
- 消除"返 LlmMessage"的所有路径。

### 阶段 5（可选）

- ContextSummaryOperation 改造成 TaskAgent，产 terminate Effect 带 summary 内容，LoopAgent 拿到后 `replaceMessages`。compact 路径也对齐到 Effect 模型。

## 风险与未决问题

1. **wait 工具的 content 处理**：wait 工具产 `wait_for_event` Effect 时，content 字段该填什么？是否需要 `suppressContent` 让 tool_result 不落地？阶段 3 决定。
2. **trigger_round 的位置**：事件 handler 产 Effect 后，是否需要显式 `trigger_round` Effect 通知 LoopAgent 跑下一轮，还是 LoopAgent 自己看 Interpreter 应用后有没有新 user message 自动决定？阶段 4 决定。
3. **App.onFocus 失败怎么办**：onFocus 抛异常的话，switch_app 已经生效了，但 onFocus 的 append_message 没追加。Interpreter 要不要事务化（任一 Effect 失败回滚已应用的）？倾向不事务化——onFocus 抛错是 bug，让它抛出来人工排查。文档里强调 onFocus 必须容错。
4. **Effect 顺序的语义清晰度**：现在规则是"数组顺序"。但 EnterTool 产 `[switch_app, append_message]` 时，switch_app 必须先于 append_message（因为 append_message 是 App 进来后给的"屏幕"）。这是工具自己拼数组时要保证的——文档明确写"工具产 Effect 时按预期的 apply 顺序排"。
5. **跨 Agent 工具复用是不是真有需求**：SearchMemoryTool 今天只在 root agent，story-recall.scheduler 内部直接调 LLM 借用 root 的工具定义。如果未来 StoryLoopAgent 真要独立调 search_memory，要么 SearchMemoryTool 改成只产 CommonEffect（"通用工具"），要么写两个版本。先看是否真的撞上。

## 与 KV 缓存原则的兼容性

- Effect 不影响系统提示（startup 固定不变）。
- 所有 `append_message` 都是追加到尾部，不修改前缀。
- `switch_app` / `switch_state` 不直接动消息列表，只动 session 的 currentApp / stateStack 字段。
- Effect 解释器**不允许**做 `replaceMessages` 这类破坏前缀的动作——`replaceMessages` 只能由 ContextCompactionExtension 在每轮结束后单独触发。
