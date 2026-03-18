import type { EmbeddingCacheItem } from "@kagami/shared";

type EmbeddingCacheDetailPanelProps = {
  item: EmbeddingCacheItem | null;
};

export function EmbeddingCacheDetailPanel({ item }: EmbeddingCacheDetailPanelProps) {
  if (item === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">暂无选中记录</p>
        </div>
      </div>
    );
  }

  const isTruncated = item.embeddingDim > item.embeddingPreview.length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <MetaItem label="ID" value={String(item.id)} mono />
          <MetaItem label="Provider" value={item.provider} />
          <MetaItem label="Model" value={item.model} />
          <MetaItem label="Task Type" value={item.taskType} mono />
          <MetaItem label="输出维度" value={String(item.outputDimensionality)} mono />
          <MetaItem label="Embedding 维度" value={String(item.embeddingDim)} mono />
          <MetaItem label="Text Hash" value={item.textHash} mono />
          <MetaItem label="时间" value={formatDate(item.createdAt)} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Embedding 摘要</h3>
            <p className="text-xs text-muted-foreground">
              前 {item.embeddingPreview.length} 项{isTruncated ? " / 已截断" : ""}
            </p>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs leading-6">
            [{item.embeddingPreview.join(", ")}]
          </pre>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold">文本</h3>
          <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs leading-6">
            {item.text}
          </pre>
        </section>
      </div>
    </div>
  );
}

function MetaItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={mono ? "break-all font-mono text-xs text-foreground" : "text-xs text-foreground"}
      >
        {value}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
