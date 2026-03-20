import type { FastifyInstance } from "fastify";
import {
  CodexAuthLoginUrlResponseSchema,
  CodexAuthLogoutResponseSchema,
  CodexAuthRefreshResponseSchema,
  CodexAuthStatusResponseSchema,
} from "@kagami/shared";
import { z } from "zod";
import type { CodexAuthService } from "../service/codex-auth.service.js";
import { registerCommandRoute, registerQueryRoute } from "./route.helper.js";

type CodexAuthHandlerDeps = {
  codexAuthService: CodexAuthService;
};

const EmptyBodySchema = z.object({}).strict();
const EmptyQuerySchema = z.object({});
const CallbackQuerySchema = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export class CodexAuthHandler {
  public readonly prefix = "/codex-auth";
  private readonly codexAuthService: CodexAuthService;

  public constructor({ codexAuthService }: CodexAuthHandlerDeps) {
    this.codexAuthService = codexAuthService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/status`,
      querySchema: EmptyQuerySchema,
      responseSchema: CodexAuthStatusResponseSchema,
      execute: () => this.codexAuthService.getStatus(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/login-url`,
      bodySchema: EmptyBodySchema,
      responseSchema: CodexAuthLoginUrlResponseSchema,
      execute: () => this.codexAuthService.createLoginUrl(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/logout`,
      bodySchema: EmptyBodySchema,
      responseSchema: CodexAuthLogoutResponseSchema,
      execute: () => this.codexAuthService.logout(),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/refresh`,
      bodySchema: EmptyBodySchema,
      responseSchema: CodexAuthRefreshResponseSchema,
      execute: () => this.codexAuthService.refresh(),
    });

    app.get(`${this.prefix}/callback`, async (request, reply) => {
      const query = CallbackQuerySchema.parse(request.query);
      const result = await this.codexAuthService.handleCallback(query);
      return reply.redirect(result.redirectUrl);
    });
  }
}
