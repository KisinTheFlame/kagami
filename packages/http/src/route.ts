import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

type QueryRouteDef<TQuerySchema extends z.ZodTypeAny, TResponseSchema extends z.ZodTypeAny> = {
  app: FastifyInstance;
  path: string;
  querySchema: TQuerySchema;
  responseSchema: TResponseSchema;
  execute: (params: {
    query: z.infer<TQuerySchema>;
    request: FastifyRequest;
    reply: FastifyReply;
  }) => Promise<z.infer<TResponseSchema>> | z.infer<TResponseSchema>;
};

type ParamRouteDef<TParamSchema extends z.ZodTypeAny, TResponseSchema extends z.ZodTypeAny> = {
  app: FastifyInstance;
  path: string;
  paramSchema: TParamSchema;
  responseSchema: TResponseSchema;
  execute: (params: {
    params: z.infer<TParamSchema>;
    request: FastifyRequest;
    reply: FastifyReply;
  }) => Promise<z.infer<TResponseSchema>> | z.infer<TResponseSchema>;
};

type CommandRouteDef<TBodySchema extends z.ZodTypeAny, TResponseSchema extends z.ZodTypeAny> = {
  app: FastifyInstance;
  path: string;
  bodySchema: TBodySchema;
  responseSchema: TResponseSchema;
  statusCode?: number;
  execute: (params: {
    body: z.infer<TBodySchema>;
    request: FastifyRequest;
    reply: FastifyReply;
  }) => Promise<z.infer<TResponseSchema>> | z.infer<TResponseSchema>;
};

export function registerQueryRoute<
  TQuerySchema extends z.ZodTypeAny,
  TResponseSchema extends z.ZodTypeAny,
>({
  app,
  path,
  querySchema,
  responseSchema,
  execute,
}: QueryRouteDef<TQuerySchema, TResponseSchema>): void {
  app.get(path, async (request, reply) => {
    const query = querySchema.parse(request.query) as z.infer<TQuerySchema>;
    const result = await execute({ query, request, reply });
    return responseSchema.parse(result);
  });
}

export function registerParamRoute<
  TParamSchema extends z.ZodTypeAny,
  TResponseSchema extends z.ZodTypeAny,
>({
  app,
  path,
  paramSchema,
  responseSchema,
  execute,
}: ParamRouteDef<TParamSchema, TResponseSchema>): void {
  app.get(path, async (request, reply) => {
    const params = paramSchema.parse(request.params) as z.infer<TParamSchema>;
    const result = await execute({ params, request, reply });
    return responseSchema.parse(result);
  });
}

export function registerCommandRoute<
  TBodySchema extends z.ZodTypeAny,
  TResponseSchema extends z.ZodTypeAny,
>({
  app,
  path,
  bodySchema,
  responseSchema,
  statusCode = 200,
  execute,
}: CommandRouteDef<TBodySchema, TResponseSchema>): void {
  app.post(path, async (request, reply) => {
    const body = bodySchema.parse(request.body) as z.infer<TBodySchema>;
    const result = await execute({ body, request, reply });
    const response = responseSchema.parse(result) as z.infer<TResponseSchema>;
    return reply.code(statusCode).send(response);
  });
}
