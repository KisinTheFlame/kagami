import Fastify from "fastify";
import { env } from "./env.js";
import { db } from "./db/client.js";
import { AgentLoop } from "./agent/agent-loop.js";
import { DrizzleLlmChatCallDao } from "./dao/impl/llm-chat-call.impl.dao.js";
import { HealthHandler } from "./handler/health-handler.js";
import { LlmChatCallHandler } from "./handler/llm-chat-call-handler.js";
import { TestHandler } from "./handler/test-handler.js";
import { createLlmClient } from "./llm/client.js";

const app = Fastify({ logger: true });

const llmChatCallDao = new DrizzleLlmChatCallDao(db);
const llmClient = createLlmClient({ llmChatCallDao });
const agentLoop = new AgentLoop({ llmClient });

const healthHandler = new HealthHandler();
const testHandler = new TestHandler(agentLoop);
const llmChatCallHandler = new LlmChatCallHandler(llmChatCallDao);

healthHandler.register(app);
testHandler.register(app);
llmChatCallHandler.register(app);

async function start() {
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
