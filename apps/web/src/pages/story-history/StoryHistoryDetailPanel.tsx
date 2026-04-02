import { type StoryItem } from "@kagami/shared/schemas/story";
import ReactMarkdown from "react-markdown";
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
      <div className="space-y-5">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold leading-tight">{item.title}</h2>
          <div className="space-y-1 text-sm text-muted-foreground">
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
          <h3 className="text-sm font-medium text-foreground">Markdown 记忆</h3>
          <div className="rounded-md border bg-muted/20 p-3 text-sm leading-7 text-foreground/90">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-lg font-semibold leading-tight">{children}</h1>
                ),
                ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                p: ({ children }) => <p>{children}</p>,
              }}
            >
              {item.markdown}
            </ReactMarkdown>
          </div>
        </section>
      </div>
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
