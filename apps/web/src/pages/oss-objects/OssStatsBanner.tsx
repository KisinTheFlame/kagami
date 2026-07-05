import type { ReactNode } from "react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOssStats } from "./useOssStats";

/**
 * 存储统计条。DESIGN.md 配色铁律：90% 中性，饱和色只落在「活着 / 持久」的数据上——去重节省与物理
 * 占用属持久存储数据，用 `text-story`（绿 · 记忆 / 持久数据）点睛，其余中性。
 */
export function OssStatsBanner() {
  const { data, isLoading, isError } = useOssStats();

  if (isError) {
    return (
      <div className="rounded-none border p-3 text-sm text-destructive">存储统计加载失败。</div>
    );
  }

  const placeholder = isLoading || !data;

  return (
    <div className="grid grid-cols-2 gap-px rounded-none border bg-border sm:grid-cols-3 xl:grid-cols-5">
      <StatCell label="对象数" value={placeholder ? "—" : String(data.objectCount)} />
      <StatCell label="内容条目" value={placeholder ? "—" : String(data.blobCount)} />
      <StatCell
        label="物理占用"
        value={placeholder ? "—" : formatBytes(data.physicalBytes)}
        accent
      />
      <StatCell label="名义占用" value={placeholder ? "—" : formatBytes(data.logicalBytes)} />
      <StatCell
        label="去重节省"
        value={placeholder ? "—" : formatBytes(data.dedupSavedBytes)}
        accent
      />
    </div>
  );
}

function StatCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", accent && "text-story")}>
        {value}
      </span>
    </div>
  );
}
