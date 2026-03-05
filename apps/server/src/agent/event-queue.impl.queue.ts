import type { AgentEvent, AgentEventQueue } from "./event-queue.queue.js";

export class InMemoryAgentEventQueue implements AgentEventQueue {
  private readonly events: AgentEvent[] = [];
  private waitPromise: Promise<void> | null = null;
  private waitResolve: (() => void) | null = null;

  public enqueue(event: AgentEvent): number {
    this.events.push(event);

    if (this.waitResolve !== null) {
      this.waitResolve();
      this.waitResolve = null;
      this.waitPromise = null;
    }

    return this.events.length;
  }

  public drainAll(): AgentEvent[] {
    if (this.events.length === 0) {
      return [];
    }

    const drained = this.events.slice();
    this.events.length = 0;
    return drained;
  }

  public size(): number {
    return this.events.length;
  }

  public async waitForEvent(): Promise<void> {
    if (this.events.length > 0) {
      return;
    }

    if (this.waitPromise === null) {
      this.waitPromise = new Promise<void>(resolve => {
        this.waitResolve = resolve;
      });
    }

    await this.waitPromise;
  }
}
