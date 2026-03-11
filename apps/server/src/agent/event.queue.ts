import type { Event } from "./event.js";

export interface AgentEventQueue {
  enqueue(event: Event): number;
  drainAll(): Event[];
  size(): number;
  waitForEvent(): Promise<void>;
}
