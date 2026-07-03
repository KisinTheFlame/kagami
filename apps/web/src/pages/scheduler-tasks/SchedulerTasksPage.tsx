import type {
  SchedulerTaskRun,
  SchedulerTaskSchedule,
  SchedulerTaskStatus,
} from "@kagami/agent-api/scheduler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatOptionalDateTime } from "@/lib/format";
import { useSchedulerTasks, useTriggerSchedulerTask } from "./useSchedulerTasks";

export function SchedulerTasksPage() {
  const query = useSchedulerTasks();
  const triggerMutation = useTriggerSchedulerTask();

  if (query.isLoading && !query.data) {
    return <PageShell>{<EmptyBlock label="正在加载调度任务…" />}</PageShell>;
  }

  if (query.isError || !query.data) {
    return (
      <PageShell>
        <div className="flex min-h-[120px] items-center justify-center rounded-none border border-dashed text-sm text-destructive">
          调度任务查询失败，请检查后端 /scheduler/tasks 接口
        </div>
      </PageShell>
    );
  }

  const tasks = query.data.tasks;

  if (tasks.length === 0) {
    return (
      <PageShell>
        <EmptyBlock label="当前没有注册的调度任务" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="h-full overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {tasks.map(task => (
            <SchedulerTaskCard
              key={task.name}
              task={task}
              isTriggering={triggerMutation.isPending && triggerMutation.variables === task.name}
              onTrigger={() => triggerMutation.mutate(task.name)}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-3 md:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">调度任务</h1>
      <div className="mt-4 min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function SchedulerTaskCard({
  task,
  isTriggering,
  onTrigger,
}: {
  task: SchedulerTaskStatus;
  isTriggering: boolean;
  onTrigger: () => void;
}) {
  const latest = task.recentRuns.at(-1) ?? null;
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="font-mono text-sm">{task.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{formatSchedule(task.schedule)}</Badge>
          <Badge variant={task.isRunning ? "story" : "outline"}>
            {task.isRunning ? "运行中" : "空闲"}
          </Badge>
          <Badge variant="outline" className="font-mono tabular-nums">
            下次：{formatOptionalDateTime(task.nextRunAt)}
          </Badge>
        </div>

        {latest ? (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">最近：</span>
              <Badge
                variant={
                  latest.status === "error"
                    ? "signal"
                    : latest.status === "skipped_overlap"
                      ? "scheduler"
                      : "story"
                }
              >
                {formatRunStatus(latest.status)}
              </Badge>
              <span className="text-muted-foreground">
                {formatOptionalDateTime(latest.startedAt)}
                {latest.durationMs !== null ? ` · ${latest.durationMs} ms` : ""}
              </span>
            </div>
            {latest.errorMessage ? (
              <p className="whitespace-pre-wrap break-words text-destructive">
                {latest.errorMessage}
              </p>
            ) : null}
            {latest.metadata ? (
              <pre className="whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-[11px]">
                {formatMetadata(latest.metadata)}
              </pre>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">尚未运行</p>
        )}

        {task.recentRuns.length > 1 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              最近 {task.recentRuns.length} 次
            </summary>
            <ul className="mt-1 space-y-1 font-mono tabular-nums">
              {[...task.recentRuns]
                .reverse()
                .slice(1)
                .map((run, index) => (
                  <li key={`${run.startedAt}-${index}`}>
                    {formatOptionalDateTime(run.startedAt)} · {formatRunStatus(run.status)}
                    {run.durationMs !== null ? ` · ${run.durationMs} ms` : ""}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}

        <div className="pt-1">
          <Button size="sm" variant="outline" disabled={isTriggering} onClick={onTrigger}>
            {isTriggering ? "触发中…" : "立即触发"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-none border border-dashed text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function formatSchedule(schedule: SchedulerTaskSchedule): string {
  if (schedule.kind === "cron") {
    return `cron: ${schedule.expression}`;
  }
  return `间隔: ${schedule.intervalMs} ms`;
}

function formatRunStatus(status: SchedulerTaskRun["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "success":
      return "成功";
    case "error":
      return "失败";
    case "skipped_overlap":
      return "重入跳过";
  }
}

function formatMetadata(metadata: Record<string, unknown>): string {
  try {
    return JSON.stringify(metadata);
  } catch {
    return "[unserializable metadata]";
  }
}
