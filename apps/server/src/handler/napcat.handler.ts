import type { FastifyInstance } from "fastify";
import {
  NapcatSendPrivateMessageRequestSchema,
  NapcatSendPrivateMessageResponseSchema,
} from "@kagami/shared";
import { AppLogger } from "../logger/logger.js";
import type { NapcatGatewayService } from "../service/napcat-gateway.service.js";
import { NapcatGatewayError } from "../service/napcat-gateway.service.js";

type NapcatHandlerDeps = {
  napcatGatewayService: NapcatGatewayService;
};

const logger = new AppLogger({ source: "handler.napcat" });

export class NapcatHandler {
  public readonly prefix = "/napcat";
  private readonly napcatGatewayService: NapcatGatewayService;

  public constructor({ napcatGatewayService }: NapcatHandlerDeps) {
    this.napcatGatewayService = napcatGatewayService;
  }

  public register(app: FastifyInstance): void {
    app.post(`${this.prefix}/private/send`, async (request, reply) => {
      const payload = NapcatSendPrivateMessageRequestSchema.parse(request.body);

      try {
        const result = await this.napcatGatewayService.sendPrivateText(payload);
        const response = NapcatSendPrivateMessageResponseSchema.parse(result);
        return reply.code(200).send(response);
      } catch (error) {
        logger.errorWithCause("Failed to send NapCat private message", error, {
          event: "napcat.private.send.failed",
          userId: payload.userId,
        });

        if (error instanceof NapcatGatewayError) {
          return reply.code(502).send({
            code: "NAPCAT_UPSTREAM_ERROR",
            message: "NapCat 上游服务不可用",
          });
        }

        throw error;
      }
    });
  }
}
