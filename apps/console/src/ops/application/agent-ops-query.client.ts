import type { JsonClient } from "@kagami/rpc-client/client";
import type { agentApiContract } from "@kagami/agent-api/contract";

/**
 * agent 的 console-facing 只读查询口（epic #539 子 issue 4）。
 *
 * 只挑用到的两条路由，其余 agent 契约（main-agent-context 等）与本查询面无关。曾经还有第三条
 * `queryAppLogs`，自 #608 起 app_log 迁到 observatory，改由 `ObservatoryLogQueryClient` 承接。
 */
export type AgentOpsQueryClient = Pick<
  JsonClient<typeof agentApiContract>,
  "queryInnerThoughts" | "queryTodos"
>;
