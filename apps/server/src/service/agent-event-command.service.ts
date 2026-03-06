import type { AgentEventEnqueueRequest, AgentEventEnqueueResponse } from "@kagami/shared";

export interface AgentEventCommandService {
  enqueueEvent(payload: AgentEventEnqueueRequest): AgentEventEnqueueResponse;
}
