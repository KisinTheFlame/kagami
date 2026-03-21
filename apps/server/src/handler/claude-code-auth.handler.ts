import type { FastifyInstance } from "fastify";
import {
  ClaudeCodeAuthLoginUrlResponseSchema,
  ClaudeCodeAuthLogoutResponseSchema,
  ClaudeCodeAuthRefreshResponseSchema,
  ClaudeCodeAuthStatusResponseSchema,
} from "@kagami/shared";
import { z } from "zod";
import type { ClaudeCodeAuthService } from "../service/claude-code-auth.service.js";
import { registerCommandRoute, registerQueryRoute } from "./route.helper.js";

type ClaudeCodeAuthHandlerDeps = {
  claudeCodeAuthService: ClaudeCodeAuthService;
};

const EmptyBodySchema = z.object({}).strict();
const EmptyQuerySchema = z.object({});
const CallbackQuerySchema = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export class ClaudeCodeAuthHandler {
  public readonly prefix = "/claude-code-auth";
  private readonly claudeCodeAuthService: ClaudeCodeAuthService;

  public constructor({ claudeCodeAuthService }: ClaudeCodeAuthHandlerDeps) {
    this.claudeCodeAuthService = claudeCodeAuthService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/status`,
      querySchema: EmptyQuerySchema,
      responseSchema: ClaudeCodeAuthStatusResponseSchema,
      execute: () => this.claudeCodeAuthService.getStatus(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/login-url`,
      bodySchema: EmptyBodySchema,
      responseSchema: ClaudeCodeAuthLoginUrlResponseSchema,
      execute: () => this.claudeCodeAuthService.createLoginUrl(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/logout`,
      bodySchema: EmptyBodySchema,
      responseSchema: ClaudeCodeAuthLogoutResponseSchema,
      execute: () => this.claudeCodeAuthService.logout(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/refresh`,
      bodySchema: EmptyBodySchema,
      responseSchema: ClaudeCodeAuthRefreshResponseSchema,
      execute: () => this.claudeCodeAuthService.refresh(),
    });

    app.get(`${this.prefix}/callback`, async (request, reply) => {
      const query = CallbackQuerySchema.parse(request.query);
      const result = await this.claudeCodeAuthService.handleCallback(query);
      return reply.redirect(result.redirectUrl);
    });
  }
}
