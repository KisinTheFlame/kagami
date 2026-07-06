import type { SchedulerTaskSchedule } from "@kagami/scheduler-api/schedule";
import type { SchedulerTaskView, SchedulerTaskViewRun } from "@kagami/scheduler-api/tasks-view";
import type { SchedulerTriggerResponse } from "@kagami/scheduler-api/trigger";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOptionalDateTime } from "@/lib/format";
import {
  useSchedulerTasks,
  useTriggerSchedulerTask,
  type TriggerVariables,
} from "./useSchedulerTasks";

/** 一次执行的状态（含 P2 的 interrupted 残留态）。 */
type RunStatus = SchedulerTaskViewRun["status"];

export function SchedulerTasksPage() {
  const query = useSchedulerTasks();
  const triggerMutation = useTriggerSchedulerTask();

  const tasks = query.data?.tasks ?? [];
  const isInitialLoading = query.isLoading && !query.data;

  // 触发结果按 (ownerId, taskName) 定位，展示在对应行——无 toast 系统，就地反馈 outcome。
  const activeTriggerKey = triggerMutation.variables ? taskRowKey(triggerMutation.variables) : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-3 md:p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">调度任务</h1>
        <span className="ml-auto text-xs text-muted-foreground">共 {tasks.length} 个任务</span>
      </div>

      {query.isError ? (
        <p className="mt-3 text-sm text-destructive">
          调度任务查询失败，请检查 kagami-scheduler 是否运行（GET /scheduler/tasks）。
        </p>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-none border">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[112px]">归属</TableHead>
              <TableHead className="w-[196px]">任务</TableHead>
              <TableHead className="w-[168px]">周期</TableHead>
              <TableHead className="w-[168px]">下次触发</TableHead>
              <TableHead className="w-[88px]">状态</TableHead>
              <TableHead>最近执行</TableHead>
              <TableHead className="w-[120px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isInitialLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  正在加载调度任务…
                </TableCell>
              </TableRow>
            ) : tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  当前没有注册的调度任务
                </TableCell>
              </TableRow>
            ) : (
              tasks.map(task => {
                const rowKey = taskRowKey(task);
                const isTriggering = triggerMutation.isPending && activeTriggerKey === rowKey;
                const triggerOutcome =
                  triggerMutation.isSuccess && activeTriggerKey === rowKey
                    ? triggerMutation.data
                    : null;
                const triggerFailed = triggerMutation.isError && activeTriggerKey === rowKey;
                return (
                  <TableRow key={rowKey} className="align-top">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {task.ownerId}
                    </TableCell>
                    <TableCell className="font-mono text-sm break-all">{task.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      {formatSchedule(task.schedule)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatOptionalDateTime(task.nextRunAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={task.isRunning ? "scheduler" : "outline"}>
                        {task.isRunning ? "运行中" : "空闲"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <RecentRuns runs={task.recentRuns} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isTriggering}
                          onClick={() =>
                            triggerMutation.mutate({
                              ownerId: task.ownerId,
                              taskName: task.name,
                            })
                          }
                        >
                          {isTriggering ? "触发中…" : "立即触发"}
                        </Button>
                        <TriggerFeedback outcome={triggerOutcome} failed={triggerFailed} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RecentRuns({ runs }: { runs: SchedulerTaskViewRun[] }) {
  if (runs.length === 0) {
    return <span className="text-xs text-muted-foreground">尚未运行</span>;
  }

  const [latest, ...rest] = runs;
  return (
    <div className="space-y-1">
      <RunLine run={latest} emphasize />
      {rest.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">更早 {rest.length} 次</summary>
          <ul className="mt-1 space-y-1">
            {rest.map(run => (
              <li key={run.id}>
                <RunLine run={run} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function RunLine({ run, emphasize = false }: { run: SchedulerTaskViewRun; emphasize?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant={toRunBadgeVariant(run.status)}>{formatRunStatus(run.status)}</Badge>
      <span className="font-mono text-muted-foreground tabular-nums">
        {formatOptionalDateTime(run.startedAt)}
        {run.durationMs !== null ? ` · ${run.durationMs} ms` : ""}
      </span>
      {emphasize && run.error ? (
        <span className="w-full break-words whitespace-pre-wrap text-destructive">{run.error}</span>
      ) : null}
    </div>
  );
}

/** 触发结果就地反馈：accepted / rejected(unknown_task|overlap) / owner_unreachable / 请求异常。 */
function TriggerFeedback({
  outcome,
  failed,
}: {
  outcome: SchedulerTriggerResponse | null;
  failed: boolean;
}) {
  if (failed) {
    return <span className="text-xs text-destructive">请求失败</span>;
  }
  if (!outcome) {
    return null;
  }
  switch (outcome.outcome) {
    case "accepted":
      return <span className="text-xs text-story">已触发</span>;
    case "rejected":
      return (
        <span className="text-xs text-cost">
          {outcome.reason === "overlap" ? "运行中，已跳过" : "未知任务"}
        </span>
      );
    case "owner_unreachable":
      return <span className="text-xs text-destructive">调度未连</span>;
  }
}

function formatSchedule(schedule: SchedulerTaskSchedule): string {
  if (schedule.kind === "cron") {
    return `cron: ${schedule.expression}`;
  }
  return `间隔: ${schedule.intervalMs} ms`;
}

function formatRunStatus(status: RunStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "success":
      return "成功";
    case "failure":
      return "失败";
    case "interrupted":
      return "被打断";
  }
}

/**
 * 状态色遵循 DESIGN.md 语义映射（颜色是配给不是涂抹）：
 * - running → 黄（scheduler · 等待 / 进行中）
 * - success → 绿（story · 持久化的成功结果）
 * - failure → 红（signal · 错误）
 * - interrupted → 玫红（cost · 风险 / 异常残留），与「明确失败」的红区分开、克制。
 */
function toRunBadgeVariant(status: RunStatus): BadgeProps["variant"] {
  switch (status) {
    case "running":
      return "scheduler";
    case "success":
      return "story";
    case "failure":
      return "signal";
    case "interrupted":
      return "cost";
  }
}

function taskRowKey(task: TriggerVariables | SchedulerTaskView): string {
  const taskName = "taskName" in task ? task.taskName : task.name;
  // JSON 元组作复合键：owner/task 名里任何字符都被转义，两个不同任务绝不拼成同一 React key。
  return JSON.stringify([task.ownerId, taskName]);
}
