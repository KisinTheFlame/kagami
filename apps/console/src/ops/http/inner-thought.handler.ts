import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { consoleApiContract } from "@kagami/console-api/contract";
import type { InnerThoughtQueryService } from "../application/inner-thought-query.service.js";

type InnerThoughtHandlerDeps = {
  innerThoughtQueryService: InnerThoughtQueryService;
};

/** inner-voice 念头查询路由。路由与 schema 的单一事实源在 @kagami/console-api（issue #359）。 */
export class InnerThoughtHandler {
  private readonly innerThoughtQueryService: InnerThoughtQueryService;

  public constructor({ innerThoughtQueryService }: InnerThoughtHandlerDeps) {
    this.innerThoughtQueryService = innerThoughtQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, consoleApiContract.queryInnerThoughts, ({ input }) =>
      this.innerThoughtQueryService.queryList(input),
    );
  }
}
