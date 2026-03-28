import type { FastifyInstance } from "fastify";
import {
  NapcatSendGroupMessageRequestSchema,
  NapcatSendGroupMessageResponseSchema,
} from "@kagami/shared/schemas/napcat-message";
import type { NapcatGatewayService } from "../service/napcat-gateway.service.js";
import { registerCommandRoute } from "../../common/http/route.helper.js";

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
      path: `${this.prefix}/group/send`,
      bodySchema: NapcatSendGroupMessageRequestSchema,
      responseSchema: NapcatSendGroupMessageResponseSchema,
      execute: ({ body }) => {
        return this.napcatGatewayService.sendGroupMessage(body);
      },
    });
  }
}
