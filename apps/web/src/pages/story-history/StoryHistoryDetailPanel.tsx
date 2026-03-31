import { type StoryItem } from "@kagami/shared/schemas/story";
import type { ReactNode } from "react";

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
      <div className="space-y-5">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold leading-tight">{item.title}</h2>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div>创建时间：{formatDateTime(item.createdAt)}</div>
            <div>更新时间：{formatDateTime(item.updatedAt)}</div>
            <div>时间：{item.time || "—"}</div>
            <div>场景：{item.scene || "—"}</div>
            <div>当前状态：{item.status || "—"}</div>
            <div>
              来源消息：seq {item.sourceMessageSeqStart} - {item.sourceMessageSeqEnd}
            </div>
            {item.score !== null ? <div>相关度：{item.score.toFixed(3)}</div> : null}
            {item.matchedKinds.length > 0 ? (
              <div>命中视角：{item.matchedKinds.join("、")}</div>
            ) : null}
          </div>
        </section>

        <StoryDetailSection
          title="人物"
          content={item.people.length > 0 ? item.people.join("、") : "—"}
        />
        <StoryDetailSection title="起因" content={item.cause || "—"} />
        <StoryDetailSection
          title="经过"
          content={
            item.process.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-5">
                {item.process.map((step, index) => (
                  <li key={`${item.id}-process-${index}`}>{step}</li>
                ))}
              </ol>
            ) : (
              "—"
            )
          }
        />
        <StoryDetailSection title="结果" content={item.result || "—"} />
      </div>
    </div>
  );
}

function StoryDetailSection({ title, content }: { title: string; content: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="rounded-md border bg-muted/20 p-3 text-sm leading-6 text-foreground/90">
        {content}
      </div>
    </section>
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
