import type {
  AgentDashboardContextItem,
  AgentDashboardGroup,
  AgentLoopState,
} from "@kagami/shared/schemas/agent-dashboard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useAgentDashboardSnapshot } from "./useAgentDashboardSnapshot";

export function AgentDashboardPage() {
  const query = useAgentDashboardSnapshot();
  const snapshot = query.data;
  const isInitialLoading = query.isLoading && !snapshot;

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
    <div className="flex h-full min-h-0 w-full flex-col overflow-auto p-3 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent 仪表盘</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            展示当前整套 Agent 系统的运行态，前端每秒轮询一次最新快照。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={getLoopStateClassName(snapshot.runtime.loopState)}>
            {formatLoopState(snapshot.runtime.loopState)}
          </Badge>
          <Badge variant={query.isError ? "destructive" : "secondary"}>
            {query.isError ? "刷新失败" : query.isFetching ? "刷新中" : "轮询正常"}
          </Badge>
          <Badge variant="outline">更新于 {formatDateTime(snapshot.generatedAt) ?? "未知"}</Badge>
        </div>
      </div>

      {query.isError ? (
        <p className="mt-3 text-sm text-destructive">
          最近一次刷新失败，当前仍展示上一帧成功快照。
        </p>
      ) : null}

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        <OverviewCard
          title="系统概览"
          description="当前运行时与事件处理负载"
          rows={[
            ["已初始化", snapshot.runtime.initialized ? "是" : "否"],
            ["Loop 状态", formatLoopState(snapshot.runtime.loopState)],
            ["待处理事件", String(snapshot.queue.pendingEventCount)],
            ["最近活动", formatDateTime(snapshot.runtime.lastActivityAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="会话状态"
          description="当前 Root Agent 所处位置"
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
          description="当前上下文规模与压缩情况"
          rows={[
            ["消息数", String(snapshot.context.messageCount)],
            ["压缩阈值", String(snapshot.context.compactionThreshold)],
            ["最近压缩", formatDateTime(snapshot.runtime.lastCompactionAt) ?? "暂无"],
            ["最近完成轮次", formatDateTime(snapshot.runtime.lastRoundCompletedAt) ?? "暂无"],
          ]}
        />
        <OverviewCard
          title="Providers / 配置"
          description="可用 Agent Provider 与监听配置"
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

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>群状态</CardTitle>
            <CardDescription>当前监听群的未读与进入情况</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[640px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">群 ID</TableHead>
                  <TableHead>群名</TableHead>
                  <TableHead className="w-[120px]">未读数</TableHead>
                  <TableHead className="w-[120px]">已进入</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.groups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      当前没有监听中的群
                    </TableCell>
                  </TableRow>
                ) : (
                  snapshot.groups.map(group => <GroupRow key={group.groupId} group={group} />)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>最近活动</CardTitle>
            <CardDescription>最近的 LLM 调用、工具调用和错误摘要</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>最近上下文摘要</CardTitle>
            <CardDescription>
              展示最近 {snapshot.context.recentItems.length} 条轻量预览
              {snapshot.context.recentItemsTruncated ? "，更早内容已省略" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.context.recentItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前上下文还没有可展示的内容。</p>
            ) : (
              <div className="space-y-3">
                {snapshot.context.recentItems.map((item, index) => (
                  <ContextItemCard key={`${item.kind}-${index}`} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function OverviewCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<[string, string]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="max-w-[70%] text-right text-sm font-medium break-words">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GroupRow({ group }: { group: AgentDashboardGroup }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{group.groupId}</TableCell>
      <TableCell>{group.groupName ?? "未获取到群名"}</TableCell>
      <TableCell>{group.unreadCount}</TableCell>
      <TableCell>{group.hasEntered ? "是" : "否"}</TableCell>
    </TableRow>
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
          "whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground",
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
        <span className="text-sm font-medium">{item.label}</span>
        {item.truncated ? <span className="text-xs text-muted-foreground">已截断</span> : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
        {item.preview || "空内容"}
      </p>
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
