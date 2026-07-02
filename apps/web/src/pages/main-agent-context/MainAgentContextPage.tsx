import type { MainAgentContextItem } from "@kagami/agent-api/main-agent-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMainAgentContext } from "./useMainAgentContext";

export function MainAgentContextPage() {
  const query = useMainAgentContext();
  const snapshot = query.data;
  const isInitialLoading = query.isLoading && !snapshot;

  if (isInitialLoading) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">正在加载主 Agent 上下文…</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <p className="text-sm text-destructive">加载失败，请检查后端服务是否运行。</p>
      </div>
    );
  }

  const items = snapshot.recentItems;
  const truncated = snapshot.recentItemsTruncated;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-3 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">主 Agent 最近上下文</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={query.isError ? "destructive" : "scheduler"}
            className="min-w-[5.5rem] justify-center"
          >
            {query.isError ? "刷新失败" : "轮询中"}
          </Badge>
          <Badge variant="outline" className="min-w-[19ch] justify-center font-mono tabular-nums">
            更新于 {formatStableDateTime(snapshot.generatedAt) ?? "----/--/-- --:--:--"}
          </Badge>
        </div>
      </div>

      {query.isError ? (
        <p className="mt-3 text-sm text-destructive">
          最近一次刷新失败，当前仍展示上一帧成功快照。
        </p>
      ) : null}

      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden">
          <CardHeader className="pb-4">
            <CardTitle>主 Agent · 最近上下文</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden">
            {items.length === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-none border border-dashed text-sm text-muted-foreground">
                当前上下文还没有可展示的内容。
              </div>
            ) : (
              <div className="h-full overflow-y-auto pr-1">
                <div className="space-y-3">
                  {/* 上下文 item 没有天然唯一键（schema 只有 kind/label/preview/truncated），列表为 append-only 顺序稳定，故用 index 作 key 是可接受的。 */}
                  {items.map((item, index) => (
                    <ContextItemCard key={`${item.kind}-${index}`} item={item} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          <div className="border-t px-6 py-3 text-xs text-muted-foreground">
            当前已拉取 {items.length} 条上下文摘要{truncated ? "，更早内容已折叠" : ""}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ContextItemCard({ item }: { item: MainAgentContextItem }) {
  return (
    <div className="rounded-none border bg-card p-3">
      <div className="flex items-center gap-2">
        <Badge variant={item.kind === "event" ? "signal" : "llm"}>
          {item.kind === "event" ? "事件" : "消息"}
        </Badge>
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

function formatStableDateTime(value: string | null): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  const hours = `${parsed.getHours()}`.padStart(2, "0");
  const minutes = `${parsed.getMinutes()}`.padStart(2, "0");
  const seconds = `${parsed.getSeconds()}`.padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}
