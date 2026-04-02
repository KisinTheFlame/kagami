import { type StoryItem } from "@kagami/shared/schemas/story";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatStoryMatchedKinds, formatStoryScore } from "./story-display";

export function StoryHistoryDetailPanel({ item }: { item: StoryItem | null }) {
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        选择一条记忆后可查看详情
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-5">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold leading-tight">{item.title}</h2>
            <div className="flex flex-wrap gap-2">
              <DetailChip label="时间" value={item.time} />
              <DetailChip label="场景" value={item.scene} />
              <DetailChip label="影响" value={item.impact} />
            </div>
            {item.people.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {item.people.map(person => (
                  <Badge key={`${item.id}-${person}`} variant="secondary">
                    {person}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground">
            <div>创建时间：{formatDateTime(item.createdAt)}</div>
            <div>更新时间：{formatDateTime(item.updatedAt)}</div>
            <div>
              来源消息：seq {item.sourceMessageSeqStart} - {item.sourceMessageSeqEnd}
            </div>
            {item.score !== null ? <div>相关度：{formatStoryScore(item.score)}</div> : null}
            {item.matchedKinds.length > 0 ? (
              <div>命中视角：{formatStoryMatchedKinds(item.matchedKinds).join("、")}</div>
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">原始 Markdown</h3>
          <pre
            className={cn(
              "overflow-x-auto rounded-lg border bg-muted/20 px-4 py-3",
              "font-mono text-[13px] leading-6 text-foreground/90 whitespace-pre-wrap break-words",
            )}
          >
            {item.markdown}
          </pre>
        </section>
      </div>
    </div>
  );
}

function DetailChip({ label, value }: { label: string; value: string }) {
  if (!value.trim()) {
    return null;
  }

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
