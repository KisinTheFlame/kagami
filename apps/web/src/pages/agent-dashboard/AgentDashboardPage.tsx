import { AgentDashboardResetContextResponseSchema } from "@kagami/shared/schemas/agent-dashboard";
import type {
  AgentDashboardContextItem,
  AgentDashboardGroup,
  AgentDashboardResetContextResponse,
  AgentLoopState,
} from "@kagami/shared/schemas/agent-dashboard";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AGENT_DASHBOARD_QUERY_KEY, useAgentDashboardSnapshot } from "./useAgentDashboardSnapshot";

type DashboardTab = "overview" | "context" | "control";
type ResetFeedback =
  | {
      kind: "success";
      message: string;
    }
  | {
      kind: "error";
      message: string;
    };

export function AgentDashboardPage() {
  const queryClient = useQueryClient();
  const query = useAgentDashboardSnapshot();
  const snapshot = query.data;
  const isInitialLoading = query.isLoading && !snapshot;
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [resetFeedback, setResetFeedback] = useState<ResetFeedback | null>(null);
  const resetContextMutation = useMutation({
    mutationFn: async (): Promise<AgentDashboardResetContextResponse> => {
      const response = await apiRequest("/agent-dashboard/reset-context", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(formatApiError(response));
      }

      return AgentDashboardResetContextResponseSchema.parse(response.body);
    },
    onMutate: () => {
      setResetFeedback(null);
    },
    onSuccess: async result => {
      setResetFeedback({
        kind: "success",
        message: `上下文已重置，时间：${formatStableDateTime(result.resetAt) ?? result.resetAt}`,
      });
      await queryClient.invalidateQueries({
        queryKey: AGENT_DASHBOARD_QUERY_KEY,
      });
    },
    onError: error => {
      setResetFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "重置失败，请稍后再试。",
      });
    },
  });

  if (isInitialLoading) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">正在加载 Agent 仪表盘…</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <p className="text-sm text-destructive">仪表盘加载失败，请检查后端服务是否运行。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-3 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent 仪表盘</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={getLoopStateClassName(snapshot.runtime.loopState)}>
            {formatLoopState(snapshot.runtime.loopState)}
          </Badge>
          <Badge
            variant={query.isError ? "destructive" : "secondary"}
            className="min-w-[5.5rem] justify-center"
          >
            {query.isError ? "刷新失败" : "轮询中"}
          </Badge>
          <Badge variant="outline" className="min-w-[19ch] justify-center font-mono tabular-nums">
            更新于 {formatStableDateTime(snapshot.generatedAt) ?? "----/--/-- --:--:--"}
          </Badge>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <TabButton
          active={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
          label="概览"
        />
        <TabButton
          active={activeTab === "context"}
          onClick={() => setActiveTab("context")}
          label={`最近上下文 (${snapshot.context.recentItems.length})`}
        />
        <TabButton
          active={activeTab === "control"}
          onClick={() => setActiveTab("control")}
          label="控制面板"
        />
      </div>

      {query.isError ? (
        <p className="mt-3 text-sm text-destructive">
          最近一次刷新失败，当前仍展示上一帧成功快照。
        </p>
      ) : null}

      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        {activeTab === "overview" ? <OverviewTab snapshot={snapshot} /> : null}
        {activeTab === "context" ? (
          <ContextTab
            items={snapshot.context.recentItems}
            totalCount={snapshot.context.recentItems.length}
          />
        ) : null}
        {activeTab === "control" ? (
          <ControlTab
            loopState={snapshot.runtime.loopState}
            pendingEventCount={snapshot.queue.pendingEventCount}
            feedback={resetFeedback}
            isResetting={resetContextMutation.isPending}
            onReset={() => {
              if (
                !window.confirm(
                  "确认重置 Agent 上下文吗？这会清空当前上下文、会话状态和待处理事件，并以当前 System Prompt 从新的初始态继续运行。",
                )
              ) {
                return;
              }

              resetContextMutation.mutate();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function OverviewTab({
  snapshot,
}: {
  snapshot: NonNullable<ReturnType<typeof useAgentDashboardSnapshot>["data"]>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        <OverviewCard
          title="系统概览"
          rows={[
            ["已初始化", snapshot.runtime.initialized ? "是" : "否"],
            ["Loop 状态", formatLoopState(snapshot.runtime.loopState)],
            ["待处理事件", String(snapshot.queue.pendingEventCount)],
            ["最近活动", formatDateTime(snapshot.runtime.lastActivityAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="会话状态"
          rows={[
            ["当前会话", snapshot.session.kind],
            ["当前群", snapshot.session.currentGroupId ?? "无"],
            ["等待截止", formatDateTime(snapshot.session.waitingDeadlineAt) ?? "无"],
            [
              "可用工具",
              snapshot.session.availableInvokeTools.length > 0
                ? snapshot.session.availableInvokeTools.join(", ")
                : "无",
            ],
          ]}
        />
        <OverviewCard
          title="上下文状态"
          rows={[
            ["消息数", String(snapshot.context.messageCount)],
            ["压缩阈值", String(snapshot.context.compactionThreshold)],
            ["最近压缩", formatDateTime(snapshot.runtime.lastCompactionAt) ?? "暂无"],
            ["最近完成轮次", formatDateTime(snapshot.runtime.lastRoundCompletedAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="Providers / 配置"
          rows={[
            ["Provider 数量", String(snapshot.providers.length)],
            [
              "Provider 列表",
              snapshot.providers.length > 0
                ? snapshot.providers.map(provider => provider.id).join(", ")
                : "无",
            ],
            ["监听群数量", String(snapshot.config.listenGroupIds.length)],
            [
              "监听群 ID",
              snapshot.config.listenGroupIds.length > 0
                ? snapshot.config.listenGroupIds.join(", ")
                : "无",
            ],
          ]}
        />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-h-0">
          <CardHeader className="pb-4">
            <CardTitle>群状态</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {snapshot.groups.length === 0 ? (
              <EmptyBlock label="当前没有监听中的群" />
            ) : (
              snapshot.groups.map(group => <GroupCard key={group.groupId} group={group} />)
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader className="pb-4">
            <CardTitle>最近活动</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3">
            <ActivityBlock
              title="最近 LLM 调用"
              value={
                snapshot.activity.lastLlmCall
                  ? [
                      `${snapshot.activity.lastLlmCall.provider} / ${snapshot.activity.lastLlmCall.model}`,
                      snapshot.activity.lastLlmCall.toolCallNames.length > 0
                        ? `工具：${snapshot.activity.lastLlmCall.toolCallNames.join(", ")}`
                        : "无工具调用",
                      snapshot.activity.lastLlmCall.assistantContentPreview || "无文本输出",
                      `时间：${formatDateTime(snapshot.activity.lastLlmCall.updatedAt) ?? "未知"}`,
                    ].join("\n")
                  : "暂无"
              }
            />
            <ActivityBlock
              title="最近工具调用"
              value={
                snapshot.activity.lastToolCall
                  ? [
                      `${snapshot.activity.lastToolCall.name}`,
                      `参数：${snapshot.activity.lastToolCall.argumentsPreview || "{}"}`,
                      snapshot.activity.lastToolResultPreview
                        ? `结果：${snapshot.activity.lastToolResultPreview}`
                        : "结果：无文本结果",
                      `时间：${formatDateTime(snapshot.activity.lastToolCall.updatedAt) ?? "未知"}`,
                    ].join("\n")
                  : "暂无"
              }
            />
            <ActivityBlock
              title="最近错误"
              value={
                snapshot.runtime.lastError
                  ? [
                      `${snapshot.runtime.lastError.name}`,
                      snapshot.runtime.lastError.message,
                      `时间：${formatDateTime(snapshot.runtime.lastError.updatedAt) ?? "未知"}`,
                    ].join("\n")
                  : "暂无"
              }
              destructive={snapshot.runtime.lastError !== null}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ContextTab({
  items,
  totalCount,
}: {
  items: AgentDashboardContextItem[];
  totalCount: number;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle>最近上下文</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        {items.length === 0 ? (
          <EmptyBlock label="当前上下文还没有可展示的内容。" />
        ) : (
          <div className="h-full overflow-y-auto pr-1">
            <div className="space-y-3">
              {items.map((item, index) => (
                <ContextItemCard key={`${item.kind}-${index}`} item={item} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <div className="border-t px-6 py-3 text-xs text-muted-foreground">
        当前已拉取 {totalCount} 条上下文摘要
      </div>
    </Card>
  );
}

function ControlTab({
  loopState,
  pendingEventCount,
  feedback,
  isResetting,
  onReset,
}: {
  loopState: AgentLoopState;
  pendingEventCount: number;
  feedback: ResetFeedback | null;
  isResetting: boolean;
  onReset: () => void;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="pb-4">
        <CardTitle>控制面板</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive">重置上下文</p>
            <p className="text-sm leading-6 text-muted-foreground">
              适用于 System Prompt 更新后，希望 Agent 丢弃旧上下文重新开始的场景。
              当前会清空上下文、session 和待处理事件队列，并立即生成新的初始 portal 上下文。
            </p>
            <p className="text-xs text-muted-foreground">
              当前 Loop：{formatLoopState(loopState)}，待处理事件：{pendingEventCount}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="destructive" onClick={onReset} disabled={isResetting}>
              {isResetting ? "重置中..." : "重置上下文"}
            </Button>
            {feedback ? (
              <p
                className={cn(
                  "text-sm",
                  feedback.kind === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {feedback.message}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}

function OverviewCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="max-w-[70%] break-words text-right text-sm font-medium">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GroupCard({ group }: { group: AgentDashboardGroup }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.groupName ?? "未获取到群名"}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{group.groupId}</p>
        </div>
        <Badge variant="outline">{group.hasEntered ? "已进入" : "未进入"}</Badge>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <span className="text-xs text-muted-foreground">未读消息</span>
        <span className="font-mono text-2xl font-semibold tabular-nums">{group.unreadCount}</span>
      </div>
    </div>
  );
}

function ActivityBlock({
  title,
  value,
  destructive = false,
}: {
  title: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className={cn("text-sm font-medium", destructive && "text-destructive")}>{title}</p>
      <pre
        className={cn(
          "line-clamp-5 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground",
          destructive && "bg-destructive/10 text-destructive",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

function formatApiError(response: Awaited<ReturnType<typeof apiRequest>>): string {
  if (
    response.body &&
    typeof response.body === "object" &&
    "message" in response.body &&
    typeof response.body.message === "string"
  ) {
    return response.body.message;
  }

  return `API error ${response.status}: ${response.statusText}`;
}

function ContextItemCard({ item }: { item: AgentDashboardContextItem }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{item.kind === "event" ? "事件" : "消息"}</Badge>
        <span className="truncate text-sm font-medium">{item.label}</span>
        {item.truncated ? (
          <span className="shrink-0 text-xs text-muted-foreground">已截断</span>
        ) : null}
      </div>
      <p className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-sm text-muted-foreground">
        {item.preview || "空内容"}
      </p>
    </div>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function formatLoopState(loopState: AgentLoopState): string {
  switch (loopState) {
    case "starting":
      return "启动中";
    case "idle":
      return "空闲";
    case "consuming_events":
      return "处理事件";
    case "calling_llm":
      return "调用 LLM";
    case "executing_tool":
      return "执行工具";
    case "waiting":
      return "等待中";
    case "crashed":
      return "已崩溃";
  }
}

function getLoopStateClassName(loopState: AgentLoopState): string {
  switch (loopState) {
    case "crashed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "waiting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "calling_llm":
    case "executing_tool":
    case "consuming_events":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-border";
  }
}

function formatDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function formatStableDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());

  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
