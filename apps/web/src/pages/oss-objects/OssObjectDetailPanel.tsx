import type { OssObjectSummary } from "@kagami/oss-api/oss-object";
import { formatBytes, formatDateTime } from "@/lib/format";
import { OssObjectPreview } from "./OssObjectPreview";

export function OssObjectDetailPanel({ summary }: { summary: OssObjectSummary | null }) {
  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        选择左侧对象查看详情
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Key</dt>
        <dd className="break-all font-mono">{summary.key}</dd>
        <dt className="text-muted-foreground">类型</dt>
        <dd className="break-all">{summary.mime}</dd>
        <dt className="text-muted-foreground">大小</dt>
        <dd>{formatBytes(summary.size)}</dd>
        <dt className="text-muted-foreground">引用数</dt>
        <dd>{summary.refcount}</dd>
        <dt className="text-muted-foreground">sha256</dt>
        <dd className="break-all font-mono text-xs">{summary.sha256}</dd>
        <dt className="text-muted-foreground">创建时间</dt>
        <dd>{formatDateTime(summary.createdAt)}</dd>
      </dl>

      <div className="min-h-0">
        <OssObjectPreview objectKey={summary.key} mime={summary.mime} />
      </div>
    </div>
  );
}
