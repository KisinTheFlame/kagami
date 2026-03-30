import type { Event } from "./event.js";
import type { AgentEventQueue } from "./event.queue.js";

export class InMemoryAgentEventQueue implements AgentEventQueue {
  private readonly events: Event[] = [];

  public enqueue(event: Event): number {
    this.events.push(event);

    return this.events.length;
  }

  public dequeue(): Event | null {
    if (this.events.length === 0) {
      return null;
    }

    return this.events.shift() ?? null;
  }

  public size(): number {
    return this.events.length;
  }

  public clear(): number {
    const clearedCount = this.events.length;
    this.events.splice(0, this.events.length);
    return clearedCount;
  }
}
