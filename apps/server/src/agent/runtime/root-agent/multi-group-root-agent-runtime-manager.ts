import type { AgentEventQueue } from "../event/event.queue.js";
import type { Event } from "../event/event.js";
import { RootAgentRuntime } from "./root-agent-runtime.js";

export type GroupRootAgentRuntime = {
  groupId: string;
  eventQueue: AgentEventQueue;
  rootAgentRuntime?: RootAgentRuntime;
  agentLoop?: RootAgentRuntime;
};

export class MultiGroupRootAgentRuntimeManager {
  private readonly runtimesByGroupId: Map<string, GroupRootAgentRuntime>;

  public constructor({ runtimes }: { runtimes: GroupRootAgentRuntime[] }) {
    this.runtimesByGroupId = new Map<string, GroupRootAgentRuntime>();

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
    const runtime = this.runtimesByGroupId.get(event.data.groupId);
    if (!runtime) {
      return 0;
    }

    return runtime.eventQueue.enqueue(event);
  }

  public async run(): Promise<never> {
    const runPromises = [...this.runtimesByGroupId.values()].map(async runtime => {
      try {
        const rootAgentRuntime = runtime.rootAgentRuntime ?? runtime.agentLoop;
        if (!rootAgentRuntime) {
          throw new Error(`Missing root agent runtime for group ${runtime.groupId}`);
        }

        await rootAgentRuntime.run();
        throw new Error(`Root agent runtime exited unexpectedly for group ${runtime.groupId}`);
      } catch (error) {
        throw new Error(`Root agent runtime crashed for group ${runtime.groupId}`, {
          cause: error,
        });
      }
    });

    return (await Promise.race(runPromises)) as never;
  }
}
