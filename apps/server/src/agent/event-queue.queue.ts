export type AgentEvent = {
  message: string;
};

export interface AgentEventQueue {
  enqueue(event: AgentEvent): number;
  drainAll(): AgentEvent[];
  size(): number;
  waitForEvent(): Promise<void>;
}
