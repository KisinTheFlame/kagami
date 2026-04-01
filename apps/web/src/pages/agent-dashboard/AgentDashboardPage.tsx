import type {
  AgentDashboardAgentSnapshot,
  AgentDashboardContextItem,
  AgentDashboardGroup,
  AgentLoopState,
  RootAgentDashboardSnapshot,
  StoryAgentDashboardSnapshot,
} from "@kagami/shared/schemas/agent-dashboard";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAgentDashboardSnapshot } from "./useAgentDashboardSnapshot";

type DashboardTab = "overview" | "context";
type AgentId = AgentDashboardAgentSnapshot["id"];

export function AgentDashboardPage() {
  const query = useAgentDashboardSnapshot();
  const snapshot = query.data;
  const isInitialLoading = query.isLoading && !snapshot;
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("root");
  const selectedAgentIdOrFallback = snapshot?.agents.some(agent => agent.id === selectedAgentId)
    ? selectedAgentId
    : (snapshot?.agents[0]?.id ?? "root");
  const selectedAgent =
    snapshot?.agents.find(agent => agent.id === selectedAgentIdOrFallback) ??
    snapshot?.agents[0] ??
    null;

  if (isInitialLoading) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">正在加载 Agent 仪表盘…</p>
      </div>
    );
  }

  if (!snapshot || !selectedAgent) {
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
          <Badge
            variant="outline"
            className={getLoopStateClassName(selectedAgent.runtime.loopState)}
          >
            {selectedAgent.label} · {formatLoopState(selectedAgent.runtime.loopState)}
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {snapshot.agents.map(agent => (
          <Button
            key={agent.id}
            variant={agent.id === selectedAgent.id ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedAgentId(agent.id)}
          >
            {agent.label}
          </Button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <TabButton
          active={activeTab === "overview"}
          onClick={() => setActiveTab("overview")}
          label="概览"
        />
        <TabButton
          active={activeTab === "context"}
          onClick={() => setActiveTab("context")}
          label={`最近上下文 (${selectedAgent.context.recentItems.length})`}
        />
      </div>

      {query.isError ? (
        <p className="mt-3 text-sm text-destructive">
          最近一次刷新失败，当前仍展示上一帧成功快照。
        </p>
      ) : null}

      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        {activeTab === "overview" ? (
          <OverviewTab agent={selectedAgent} listenGroupIds={snapshot.config.listenGroupIds} />
        ) : null}
        {activeTab === "context" ? (
          <ContextTab
            label={selectedAgent.label}
            items={selectedAgent.context.recentItems}
            totalCount={selectedAgent.context.recentItems.length}
            truncated={selectedAgent.context.recentItemsTruncated}
          />
        ) : null}
      </div>
    </div>
  );
}

function OverviewTab({
  agent,
  listenGroupIds,
}: {
  agent: AgentDashboardAgentSnapshot;
  listenGroupIds: string[];
}) {
  if (agent.kind === "root") {
    return <RootOverviewTab agent={agent} listenGroupIds={listenGroupIds} />;
  }

  return <StoryOverviewTab agent={agent} />;
}

function RootOverviewTab({
  agent,
  listenGroupIds,
}: {
  agent: RootAgentDashboardSnapshot;
  listenGroupIds: string[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        <OverviewCard
          title="系统概览"
          rows={[
            ["已初始化", agent.runtime.initialized ? "是" : "否"],
            ["Loop 状态", formatLoopState(agent.runtime.loopState)],
            ["待处理事件", String(agent.queue.pendingEventCount)],
            ["最近活动", formatDateTime(agent.runtime.lastActivityAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="会话状态"
          rows={[
            ["当前会话", agent.session.kind],
            ["当前群", agent.session.currentGroupId ?? "无"],
            ["等待截止", formatDateTime(agent.session.waitingDeadlineAt) ?? "无"],
            ["等待后返回", formatWaitingResumeTarget(agent.session.waitingResumeTarget) ?? "无"],
            [
              "可用工具",
              agent.session.availableInvokeTools.length > 0
                ? agent.session.availableInvokeTools.join(", ")
                : "无",
            ],
          ]}
        />
        <OverviewCard
          title="上下文状态"
          rows={[
            ["消息数", String(agent.context.messageCount)],
            ["总 Token 阈值", String(agent.context.compactionTotalTokenThreshold)],
            ["最近压缩", formatDateTime(agent.runtime.lastCompactionAt) ?? "暂无"],
            ["最近完成轮次", formatDateTime(agent.runtime.lastRoundCompletedAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="Providers / 配置"
          rows={[
            ["Provider 数量", String(agent.providers.length)],
            [
              "Provider 列表",
              agent.providers.length > 0
                ? agent.providers.map(provider => provider.id).join(", ")
                : "无",
            ],
            ["监听群数量", String(listenGroupIds.length)],
            ["监听群 ID", listenGroupIds.length > 0 ? listenGroupIds.join(", ") : "无"],
          ]}
        />
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-h-0">
          <CardHeader className="pb-4">
            <CardTitle>群状态</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {agent.groups.length === 0 ? (
              <EmptyBlock label="当前没有监听中的群" />
            ) : (
              agent.groups.map(group => <GroupCard key={group.groupId} group={group} />)
            )}
          </CardContent>
        </Card>

        <RecentActivityCard agent={agent} />
      </section>
    </div>
  );
}

function StoryOverviewTab({ agent }: { agent: StoryAgentDashboardSnapshot }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <OverviewCard
          title="系统概览"
          rows={[
            ["已初始化", agent.runtime.initialized ? "是" : "否"],
            ["Loop 状态", formatLoopState(agent.runtime.loopState)],
            ["最近活动", formatDateTime(agent.runtime.lastActivityAt) ?? "暂无"],
            ["最近完成轮次", formatDateTime(agent.runtime.lastRoundCompletedAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="处理进度"
          rows={[
            ["已处理到 Seq", String(agent.story.lastProcessedMessageSeq)],
            ["待处理消息", String(agent.story.pendingMessageCount)],
            ["当前批次", formatPendingBatch(agent.story.pendingBatch)],
            ["批次大小", String(agent.story.batchSize)],
            ["空闲冲刷", `${agent.story.idleFlushMs} ms`],
          ]}
        />
        <OverviewCard
          title="上下文状态"
          rows={[
            ["消息数", String(agent.context.messageCount)],
            ["总 Token 阈值", String(agent.context.compactionTotalTokenThreshold)],
            ["最近压缩", formatDateTime(agent.runtime.lastCompactionAt) ?? "暂无"],
            ["上下文截断", agent.context.recentItemsTruncated ? "最近列表已截断" : "最近列表完整"],
          ]}
        />
      </section>

      <section className="min-h-0 flex-1">
        <RecentActivityCard agent={agent} />
      </section>
    </div>
  );
}

function RecentActivityCard({ agent }: { agent: AgentDashboardAgentSnapshot }) {
  return (
    <Card className="min-h-0">
      <CardHeader className="pb-4">
        <CardTitle>最近活动</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <ActivityBlock
          title="最近 LLM 调用"
          value={
            agent.activity.lastLlmCall
              ? [
                  `${agent.activity.lastLlmCall.provider} / ${agent.activity.lastLlmCall.model}`,
                  `总 Token：${agent.activity.lastLlmCall.totalTokens ?? "未知"}`,
                  agent.activity.lastLlmCall.toolCallNames.length > 0
                    ? `工具：${agent.activity.lastLlmCall.toolCallNames.join(", ")}`
                    : "无工具调用",
                  agent.activity.lastLlmCall.assistantContentPreview || "无文本输出",
                  `时间：${formatDateTime(agent.activity.lastLlmCall.updatedAt) ?? "未知"}`,
                ].join("\n")
              : "暂无"
          }
        />
        <ActivityBlock
          title="最近工具调用"
          value={
            agent.activity.lastToolCall
              ? [
                  `${agent.activity.lastToolCall.name}`,
                  `参数：${agent.activity.lastToolCall.argumentsPreview || "{}"}`,
                  agent.activity.lastToolResultPreview
                    ? `结果：${agent.activity.lastToolResultPreview}`
                    : "结果：无文本结果",
                  `时间：${formatDateTime(agent.activity.lastToolCall.updatedAt) ?? "未知"}`,
                ].join("\n")
              : "暂无"
          }
        />
        <ActivityBlock
          title="最近错误"
          value={
            agent.runtime.lastError
              ? [
                  `${agent.runtime.lastError.name}`,
                  agent.runtime.lastError.message,
                  `时间：${formatDateTime(agent.runtime.lastError.updatedAt) ?? "未知"}`,
                ].join("\n")
              : "暂无"
          }
          destructive={agent.runtime.lastError !== null}
        />
      </CardContent>
    </Card>
  );
}

function ContextTab({
  label,
  items,
  totalCount,
  truncated,
}: {
  label: string;
  items: AgentDashboardContextItem[];
  totalCount: number;
  truncated: boolean;
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle>{label} · 最近上下文</CardTitle>
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
        当前已拉取 {totalCount} 条上下文摘要{truncated ? "，更早内容已折叠" : ""}
      </div>
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

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function formatStableDateTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  const hours = `${parsed.getHours()}`.padStart(2, "0");
  const minutes = `${parsed.getMinutes()}`.padStart(2, "0");
  const seconds = `${parsed.getSeconds()}`.padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function formatWaitingResumeTarget(
  value: RootAgentDashboardSnapshot["session"]["waitingResumeTarget"],
): string | null {
  if (!value) {
    return null;
  }

  switch (value.kind) {
    case "portal":
      return "portal";
    case "qq_group":
      return `qq_group:${value.groupId}`;
    case "ithome":
      return "ithome";
    case "zone_out":
      return "zone_out";
  }
}

function formatPendingBatch(value: StoryAgentDashboardSnapshot["story"]["pendingBatch"]): string {
  if (!value) {
    return "无";
  }

  return `${value.firstSeq} - ${value.lastSeq}`;
}
