/**
 * Effect 是描述"Agent 状态变更动作"的结构化数据。
 *
 * Effect 是开放接口——agent-runtime 只规定它有 `type` 字段，具体 Effect 联合
 * 由各 Agent 实现方自己定义（比如 root-agent 用 `switch_app` / `append_message`
 * 这种字面量联合）。
 *
 * 工具 / App 钩子 / 事件 handler / LoopAgent extension 都产 Effect[]。
 * Agent 端用自己的 Interpreter 解释执行——Interpreter 的具体签名（同步/异步、
 * 返回值类型）由各 Agent 自行决定，agent-runtime 不强制接口形态。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export interface Effect {
  readonly type: string;
}
