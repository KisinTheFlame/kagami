import type { AppLogItem } from "@kagami/shared";

type AppLogDetailPanelProps = {
  item: AppLogItem | null;
};

export function AppLogDetailPanel({ item }: AppLogDetailPanelProps) {
  if (item === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">暂无选中记录</p>
        </div>
      </div>
    );
  }

  const source = getSource(item.metadata);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <MetaItem label="ID" value={String(item.id)} mono />
          <MetaItem label="Level" value={item.level} />
          <MetaItem label="Source" value={source} />
          <MetaItem label="Trace ID" value={item.traceId} mono />
          <MetaItem label="时间" value={formatDate(item.createdAt)} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section className="space-y-2">
          <h3 className="text-base font-semibold">Message</h3>
          <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs leading-6">
            {item.message}
          </pre>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold">Metadata (JSON)</h3>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs leading-6">
            {safeStringify(item.metadata)}
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getSource(metadata: Record<string, unknown>): string {
  const source = metadata.source;
  return typeof source === "string" && source.length > 0 ? source : "—";
}
