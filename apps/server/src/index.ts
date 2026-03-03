import Fastify from "fastify";
import { HealthResponseSchema, createHealthResponse, z } from "@kagami/shared";
import { env } from "./env.js";
import { db } from "./db/client.js";
import * as schema from "./db/schema.js";
import { runAgentLoop } from "./agent/agent-loop.js";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  const response = createHealthResponse();
  return HealthResponseSchema.parse(response);
});

app.get("/", async () => {
  const users = await db.select().from(schema.users);
  return users;
});

const AgentRequestSchema = z.object({
  input: z.string().min(1),
  maxSteps: z.coerce.number().int().positive().max(8).optional(),
});

app.post("/agent", async (request) => {
  const payload = AgentRequestSchema.parse(request.body);
  return runAgentLoop(payload);
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
