import type { LoopRunDetailResponse, LoopRunTimelineItem } from "@kagami/shared";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  Hammer,
  MessageSquareText,
  Waypoints,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, truncateText } from "@/lib/utils";
import { useLoopRunDetail } from "./useLoopRunDetail";

export function LoopRunDetailPage() {
  const params = useParams<{ id: string }>();
  const query = useLoopRunDetail(params.id);

  if (!params.id) {
    return (
      <LoopRunEmptyState
        title="缺少 Loop ID"
        description="请通过有效的 `/loop-runs/:id` 地址访问。"
      />
    );
  }

  if (query.isLoading) {
    return <LoopRunLoadingState />;
  }

  if (query.isError) {
    return (
      <LoopRunEmptyState
        title="加载 Loop 详情失败"
        description={query.error instanceof Error ? query.error.message : "请稍后重试。"}
        action={
          <Button type="button" onClick={() => void query.refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!query.data) {
    return (
      <LoopRunEmptyState title="未找到 Loop 详情" description="当前记录不存在或尚未准备好。" />
    );
  }

  return (
    <div className="min-h-0 w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-4 md:px-6 md:py-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/loop-runs"
            className="inline-flex h-10 w-fit items-center rounded-full border border-border/70 bg-background/90 px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回链路回放
          </Link>
          <Badge variant="outline" className="font-mono text-[11px]">
            {query.data.id}
          </Badge>
        </div>

        <LoopRunHeader detail={query.data} />
        <LoopRunTriggerCard detail={query.data} />
        <LoopRunTimeline timeline={query.data.timeline} />
        <JsonCollapsePanel title="原始聚合数据" value={query.data.raw} defaultExpanded={false} />
      </div>
    </div>
  );
}

function LoopRunHeader({ detail }: { detail: LoopRunDetailResponse }) {
  const statusTone = getStatusTone(detail.status);

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.04),rgba(59,130,246,0.08)_55%,rgba(14,165,233,0.12))]">
      <div className="flex flex-col gap-6 px-5 py-6 md:px-7 md:py-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                className={cn("gap-1.5 rounded-full px-3 py-1 text-sm", statusTone.badgeClass)}
              >
                <statusTone.Icon className="h-4 w-4" />
                {statusTone.label}
              </Badge>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                启动于 {formatDateTime(detail.startedAt)}
              </div>
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                单次 Loop 全链路回放
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                从触发消息到工具执行结果，这里把本轮 agent loop 的关键步骤按时间顺序完整串起来。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:min-w-[260px]">
            <StatCard label="群号" value={detail.groupId} />
            <StatCard label="触发人" value={detail.trigger.nickname} />
            <StatCard label="LLM 调用" value={`${detail.summary.llmCallCount} 次`} />
            <StatCard label="工具调用" value={`${detail.summary.toolCallCount} 次`} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <HighlightMetric
            icon={Waypoints}
            label="总耗时"
            value={detail.durationMs === null ? "进行中" : formatDuration(detail.durationMs)}
          />
          <HighlightMetric
            icon={Bot}
            label="工具成功"
            value={`${detail.summary.toolSuccessCount} 次`}
          />
          <HighlightMetric
            icon={Hammer}
            label="工具失败"
            value={`${detail.summary.toolFailureCount} 次`}
          />
          <HighlightMetric
            icon={Activity}
            label="完成时间"
            value={detail.finishedAt ? formatDateTime(detail.finishedAt) : "尚未结束"}
          />
        </div>
      </div>
    </section>
  );
}

function LoopRunTriggerCard({ detail }: { detail: LoopRunDetailResponse }) {
  return (
    <section className="rounded-3xl border bg-card/70 p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <MessageSquareText className="h-4 w-4 text-primary" />
            触发信息
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.trigger.nickname} ({detail.trigger.userId}) 在{" "}
            {formatDateTime(detail.trigger.eventTime)}
            触发了本次 loop。
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">
          messageId: {detail.trigger.messageId ?? "—"}
        </Badge>
      </div>

      <div className="mt-4 rounded-2xl border bg-background/80 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">原始消息</p>
        <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
          {detail.trigger.rawMessage.length > 0 ? detail.trigger.rawMessage : "空消息"}
        </pre>
      </div>
    </section>
  );
}

function LoopRunTimeline({ timeline }: { timeline: LoopRunTimelineItem[] }) {
  return (
    <section className="rounded-3xl border bg-card/70 p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-center gap-2">
        <Waypoints className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold tracking-tight">执行时间线</h2>
      </div>

      <div className="space-y-5">
        {timeline.map((item, index) => (
          <LoopRunTimelineItemCard
            key={`${item.type}-${item.id}-${item.seq}`}
            item={item}
            isLast={index === timeline.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function LoopRunTimelineItemCard({ item, isLast }: { item: LoopRunTimelineItem; isLast: boolean }) {
  const tone = getStatusTone(item.status);
  const visual = getTimelineVisual(item.type);

  return (
    <div className="relative flex gap-4">
      <div className="flex w-10 shrink-0 flex-col items-center">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border shadow-sm",
            tone.nodeClass,
          )}
        >
          <visual.Icon className="h-4 w-4" />
        </div>
        {!isLast ? <div className="mt-2 min-h-12 w-px flex-1 bg-border" /> : null}
      </div>

      <article className="min-w-0 flex-1 rounded-2xl border bg-background/90 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">
                {visual.label}
              </Badge>
              <Badge className={cn("rounded-full", tone.badgeClass)}>{tone.label}</Badge>
            </div>
            <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDateTime(item.startedAt)}
              {item.durationMs !== null ? ` · ${formatDuration(item.durationMs)}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {renderTimelineSummary(item)}
          {renderTimelineJson(item)}
        </div>
      </article>
    </div>
  );
}

function renderTimelineSummary(item: LoopRunTimelineItem) {
  switch (item.type) {
    case "trigger_message":
      return (
        <div className="rounded-2xl bg-muted/40 p-3 text-sm leading-6">
          <p className="font-medium">
            {item.trigger.nickname} ({item.trigger.userId})
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
            {item.trigger.rawMessage}
          </p>
        </div>
      );
    case "llm_call": {
      const assistantText = getAssistantPreview(item.responsePayload);
      const toolCalls = getToolCallNames(item.responsePayload);

      return (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <InfoPanel
            title="LLM 摘要"
            rows={[
              ["Provider", item.provider],
              ["Model", item.model],
              ["Request ID", item.requestId],
              [
                "Assistant 输出",
                assistantText.length > 0
                  ? truncateText(assistantText, 220)
                  : "本次主要输出为工具调用",
              ],
            ]}
          />
          <InfoPanel
            title="工具调用意图"
            rows={[
              ["Tool Calls", toolCalls.length > 0 ? toolCalls.join(", ") : "无"],
              [
                "Usage",
                item.usage
                  ? `prompt=${getUsageNumber(item.usage, "promptTokens")} completion=${getUsageNumber(item.usage, "completionTokens")} total=${getUsageNumber(item.usage, "totalTokens")}`
                  : "—",
              ],
              ["错误", item.error ? truncateText(stringifyJson(item.error), 120) : "—"],
            ]}
          />
        </div>
      );
    }
    case "tool_call":
      return (
        <InfoPanel
          title="调用参数"
          rows={[
            ["工具名", item.toolName],
            ["Tool Call ID", item.toolCallId],
            ["参数预览", truncateText(stringifyJson(item.arguments), 200)],
          ]}
        />
      );
    case "tool_result":
      return (
        <InfoPanel
          title="执行结果"
          rows={[
            ["工具名", item.toolName],
            ["Tool Call ID", item.toolCallId],
            ["结果预览", truncateText(stringifyJson(item.result), 220)],
          ]}
        />
      );
    case "final_result":
      return (
        <InfoPanel
          title="收尾结果"
          rows={[
            ["最终状态", item.status],
            ["结果摘要", truncateText(stringifyJson(item.outcome), 220)],
          ]}
        />
      );
  }
}

function renderTimelineJson(item: LoopRunTimelineItem) {
  switch (item.type) {
    case "trigger_message":
      return <JsonCollapsePanel title="触发消息 Payload" value={item.trigger} />;
    case "llm_call":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <JsonCollapsePanel title="LLM Request Payload" value={item.requestPayload} />
          <JsonCollapsePanel title="LLM Response Payload" value={item.responsePayload} />
        </div>
      );
    case "tool_call":
      return <JsonCollapsePanel title="工具调用参数" value={item.arguments} />;
    case "tool_result":
      return <JsonCollapsePanel title="工具结果" value={item.result} />;
    case "final_result":
      return <JsonCollapsePanel title="最终结果" value={item.outcome} />;
  }
}

function JsonCollapsePanel({
  title,
  value,
  defaultExpanded = false,
}: {
  title: string;
  value: unknown;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const formatted = useMemo(() => stringifyJson(value), [value]);

  return (
    <div className="rounded-2xl border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="text-sm font-medium">{title}</span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded ? (
        <pre className="overflow-x-auto border-t px-4 py-3 text-xs leading-6 text-muted-foreground">
          {formatted}
        </pre>
      ) : null}
    </div>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-2xl border bg-muted/25 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 md:grid-cols-[84px_minmax(0,1fr)]">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="break-words text-sm text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/30 bg-background/80 px-4 py-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 break-all text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function HighlightMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-background/85 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-3 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function LoopRunLoadingState() {
  return (
    <div className="w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-4 md:px-6 md:py-6">
        <div className="h-12 w-40 animate-pulse rounded-xl bg-muted/60" />
        <div className="h-64 animate-pulse rounded-3xl bg-muted/50" />
        <div className="h-44 animate-pulse rounded-3xl bg-muted/40" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-3xl bg-muted/35" />
          ))}
        </div>
      </div>
    </div>
  );
}

function LoopRunEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border bg-card p-8 text-center shadow-sm">
        <CircleAlert className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          {action}
          <Link to="/loop-runs" className={buttonVariants({ variant: "outline" })}>
            返回链路回放
          </Link>
        </div>
      </div>
    </div>
  );
}

function getStatusTone(status: "success" | "failed" | "partial") {
  switch (status) {
    case "success":
      return {
        label: "成功",
        Icon: CheckCircle2,
        badgeClass: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        nodeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "failed":
      return {
        label: "失败",
        Icon: CircleAlert,
        badgeClass: "border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-300",
        nodeClass: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      };
    case "partial":
    default:
      return {
        label: "进行中",
        Icon: Clock3,
        badgeClass: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
        nodeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
  }
}

function getTimelineVisual(type: LoopRunTimelineItem["type"]) {
  switch (type) {
    case "trigger_message":
      return {
        label: "触发",
        Icon: MessageSquareText,
      };
    case "llm_call":
      return {
        label: "LLM",
        Icon: Bot,
      };
    case "tool_call":
    case "tool_result":
      return {
        label: "工具",
        Icon: Hammer,
      };
    case "final_result":
    default:
      return {
        label: "结果",
        Icon: Activity,
      };
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
}

function getAssistantPreview(responsePayload: Record<string, unknown> | null): string {
  const message = responsePayload?.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return "";
  }

  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}

function getToolCallNames(responsePayload: Record<string, unknown> | null): string[] {
  const message = responsePayload?.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return [];
  }

  const toolCalls = (message as Record<string, unknown>).toolCalls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map(item => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }

      const name = (item as Record<string, unknown>).name;
      return typeof name === "string" ? name : null;
    })
    .filter((name): name is string => name !== null);
}

function getUsageNumber(usage: Record<string, unknown>, key: string): string {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}
