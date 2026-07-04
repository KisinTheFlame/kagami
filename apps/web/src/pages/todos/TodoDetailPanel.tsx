import { type TodoItem } from "@kagami/console-api/todo";
import { Badge } from "@/components/ui/badge";
import { formatOptionalDateTime } from "@/lib/format";
import { formatRepeatEvery, toStatusBadgeVariant, toStatusLabel } from "./todo-status";

type TodoDetailPanelProps = {
  item: TodoItem | null;
};

export function TodoDetailPanel({ item }: TodoDetailPanelProps) {
  if (item === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">暂无选中待办</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Badge variant={toStatusBadgeVariant(item.status)}>{toStatusLabel(item.status)}</Badge>
          <span className="text-xs text-muted-foreground">#{item.id}</span>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <MetaItem label="提醒时间" value={formatOptionalDateTime(item.remindAt)} />
          <MetaItem label="Snooze 至" value={formatOptionalDateTime(item.snoozedUntil)} />
          <MetaItem label="重复间隔" value={formatRepeatEvery(item.repeatEveryMs)} />
          <MetaItem label="创建时间" value={formatOptionalDateTime(item.createdAt)} />
          <MetaItem label="更新时间" value={formatOptionalDateTime(item.updatedAt)} />
          <MetaItem label="完成时间" value={formatOptionalDateTime(item.completedAt)} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section className="space-y-2">
          <h3 className="text-base font-semibold">标题</h3>
          <pre className="whitespace-pre-wrap break-words rounded-none border bg-muted/20 p-3 text-sm leading-6">
            {item.title}
          </pre>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold">备注</h3>
          <pre className="whitespace-pre-wrap break-words rounded-none border bg-muted/20 p-3 text-xs leading-6">
            {item.note ?? "—"}
          </pre>
        </section>
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-none border bg-muted/20 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-foreground">{value}</p>
    </div>
  );
}
