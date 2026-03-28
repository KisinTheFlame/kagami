import type { AgentEventQueue } from "../../event/event.queue.js";
import type { Event } from "../../event/event.js";
import { AgentLoop } from "./agent-loop.js";

export type GroupAgentRuntime = {
  groupId: string;
  eventQueue: AgentEventQueue;
  agentLoop: AgentLoop;
};

export class MultiGroupAgentRuntimeManager {
  private readonly runtimesByGroupId: Map<string, GroupAgentRuntime>;

  public constructor({ runtimes }: { runtimes: GroupAgentRuntime[] }) {
    this.runtimesByGroupId = new Map<string, GroupAgentRuntime>();

    for (const runtime of runtimes) {
      if (this.runtimesByGroupId.has(runtime.groupId)) {
        throw new Error(`Duplicated group runtime: ${runtime.groupId}`);
      }

      this.runtimesByGroupId.set(runtime.groupId, runtime);
    }
  }

  public listGroupIds(): string[] {
    return [...this.runtimesByGroupId.keys()];
  }

  public enqueue(event: Event): number {
    const runtime = this.runtimesByGroupId.get(event.groupId);
    if (!runtime) {
      return 0;
    }

    return runtime.eventQueue.enqueue(event);
  }

  public async run(): Promise<never> {
    const runPromises = [...this.runtimesByGroupId.values()].map(async runtime => {
      try {
        await runtime.agentLoop.run();
        throw new Error(`Agent loop exited unexpectedly for group ${runtime.groupId}`);
      } catch (error) {
        throw new Error(`Agent loop crashed for group ${runtime.groupId}`, {
          cause: error,
        });
      }
    });

    return (await Promise.race(runPromises)) as never;
  }
}
