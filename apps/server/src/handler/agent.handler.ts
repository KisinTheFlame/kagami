import type { FastifyInstance } from "fastify";
import { AgentEventEnqueueRequestSchema, AgentEventEnqueueResponseSchema } from "@kagami/shared";
import type { AgentEventCommandService } from "../service/agent-event-command.service.js";
import { registerCommandRoute } from "./route.helper.js";

type AgentHandlerDeps = {
  agentEventCommandService: AgentEventCommandService;
};

export class AgentHandler {
  public readonly prefix = "/agent";
  private readonly agentEventCommandService: AgentEventCommandService;

  public constructor({ agentEventCommandService }: AgentHandlerDeps) {
    this.agentEventCommandService = agentEventCommandService;
  }

  public register(app: FastifyInstance): void {
    registerCommandRoute({
      app,
      path: `${this.prefix}/event`,
      bodySchema: AgentEventEnqueueRequestSchema,
      responseSchema: AgentEventEnqueueResponseSchema,
      statusCode: 202,
      execute: ({ body }) => {
        return this.agentEventCommandService.enqueueEvent(body);
      },
    });
  }
}
