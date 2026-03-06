import type { FastifyInstance } from "fastify";
import {
  NapcatSendPrivateMessageRequestSchema,
  NapcatSendPrivateMessageResponseSchema,
} from "@kagami/shared";
import type { NapcatGatewayService } from "../service/napcat-gateway.service.js";
import { registerCommandRoute } from "./route.helper.js";

type NapcatHandlerDeps = {
  napcatGatewayService: NapcatGatewayService;
};

export class NapcatHandler {
  public readonly prefix = "/napcat";
  private readonly napcatGatewayService: NapcatGatewayService;

  public constructor({ napcatGatewayService }: NapcatHandlerDeps) {
    this.napcatGatewayService = napcatGatewayService;
  }

  public register(app: FastifyInstance): void {
    registerCommandRoute({
      app,
      path: `${this.prefix}/private/send`,
      bodySchema: NapcatSendPrivateMessageRequestSchema,
      responseSchema: NapcatSendPrivateMessageResponseSchema,
      execute: ({ body }) => {
        return this.napcatGatewayService.sendPrivateText(body);
      },
    });
  }
}
