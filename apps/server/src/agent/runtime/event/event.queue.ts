import type { Event } from "./event.js";

export interface AgentEventQueue {
  enqueue(event: Event): number;
  dequeue(): Event | null;
  size(): number;
}
