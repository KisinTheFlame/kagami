import type { Queue } from "@kagami/agent-runtime";
import type { Event } from "./event.js";

/**
 * Type alias for the generic Queue primitive, specialized to the root
 * agent's Event union.
 */
export type AgentEventQueue = Queue<Event>;
