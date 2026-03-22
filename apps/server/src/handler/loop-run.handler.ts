import {
  LoopRunDetailResponseSchema,
  LoopRunListQuerySchema,
  LoopRunListResponseSchema,
} from "@kagami/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LoopRunQueryService } from "../service/loop-run-query.service.js";
import { registerQueryRoute } from "./route.helper.js";

const ParamsSchema = z.object({
  id: z.string().min(1),
});

type LoopRunHandlerDeps = {
  loopRunQueryService: LoopRunQueryService;
};

export class LoopRunHandler {
  public readonly prefix = "/loop-run";
  private readonly loopRunQueryService: LoopRunQueryService;

  public constructor({ loopRunQueryService }: LoopRunHandlerDeps) {
    this.loopRunQueryService = loopRunQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/query`,
      querySchema: LoopRunListQuerySchema,
      responseSchema: LoopRunListResponseSchema,
      execute: ({ query }) => {
        return this.loopRunQueryService.queryList(query);
      },
    });

    app.get(`${this.prefix}/:id`, async request => {
      const params = ParamsSchema.parse(request.params);
      const result = await this.loopRunQueryService.getDetail(params.id);
      return LoopRunDetailResponseSchema.parse(result);
    });
  }
}
