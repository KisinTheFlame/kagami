import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import {
  schedulerTasksViewContract,
  type SchedulerTaskView,
  type SchedulerTasksViewResponse,
} from "@kagami/scheduler-api/tasks-view";
import type { SchedulerEngine } from "../application/scheduler-engine.js";
import { taskKeyString, type TaskRunStore } from "../infra/db/task-run-store.js";

type SchedulerTasksViewHandlerDeps = {
  engine: SchedulerEngine;
  store: TaskRunStore;
};

/**
 * 全局任务观测视图路由（scheduler B P4，issue #493）。前端第一次真正切到 scheduler：一次拿到全部
 * owner 的活任务 + 执行历史，取代原先经 agent listSchedulerTasks 中转。
 *
 * 装配方式是「活任务左连接执行历史」：
 * 1. engine.listActiveTasks() 拿跨全部 owner 的活任务（归属 / 名字 / 周期 / nextRunAt，纯派生态）。
 * 2. store.getRecentRunsForTasks(keys) 用一条 window function SQL 批量拉这些 (ownerId, taskName)
 *    的最近 N 条 run + isRunning（无 N+1）。
 * 3. 以活任务为主拼装：查得到历史就填上，查不到就 recentRuns=[] / isRunning=false。孤儿历史行
 *    （owner 已删该任务）不进 keys、也就不进视图。
 */
export class SchedulerTasksViewHandler {
  private readonly engine: SchedulerEngine;
  private readonly store: TaskRunStore;

  public constructor({ engine, store }: SchedulerTasksViewHandlerDeps) {
    this.engine = engine;
    this.store = store;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(
      app,
      schedulerTasksViewContract.listTasks,
      async (): Promise<SchedulerTasksViewResponse> => {
        const activeTasks = this.engine.listActiveTasks();
        const historyByKey = await this.store.getRecentRunsForTasks(
          activeTasks.map(task => ({ ownerId: task.ownerId, taskName: task.name })),
        );

        const tasks: SchedulerTaskView[] = activeTasks.map(task => {
          const history = historyByKey.get(taskKeyString(task.ownerId, task.name));
          return {
            ownerId: task.ownerId,
            name: task.name,
            schedule: task.schedule,
            nextRunAt: task.nextRunAt,
            isRunning: history?.isRunning ?? false,
            recentRuns: history?.recentRuns ?? [],
          };
        });

        return { tasks };
      },
    );
  }
}
