import Fastify from "fastify";
import { HealthResponseSchema, createHealthResponse, z } from "@kagami/shared";
import { desc } from "drizzle-orm";
import { env } from "./env.js";
import { db } from "./db/client.js";
import { llmChatCall } from "./db/schema.js";
import { runAgentLoop } from "./agent/agent-loop.js";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  const response = createHealthResponse();
  return HealthResponseSchema.parse(response);
});

const AgentRequestSchema = z.object({
  input: z.string().min(1),
  maxSteps: z.coerce.number().int().positive().max(8).optional(),
});

const LlmChatCallListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

app.post("/test/agent", async (request) => {
  const payload = AgentRequestSchema.parse(request.body);
  return runAgentLoop(payload);
});

app.get("/llm/chat-calls", async (request) => {
  const { page, pageSize } = LlmChatCallListQuerySchema.parse(request.query);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select()
    .from(llmChatCall)
    .orderBy(desc(llmChatCall.createdAt), desc(llmChatCall.id))
    .limit(pageSize + 1)
    .offset(offset);

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    page,
    pageSize,
    hasMore,
    items,
  };
});

async function start() {
  // Keep the DB client initialized for future query handlers.
  void db;

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
