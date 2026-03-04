import Fastify from "fastify";
import { AgentLoop } from "./agent/agent-loop.js";
import { AgentContextManager } from "./agent/context-manager.js";
import { env } from "./env.js";
import { closeDb, db } from "./db/client.js";
import { DrizzleLlmChatCallDao } from "./dao/impl/llm-chat-call.impl.dao.js";
import { HealthHandler } from "./handler/health.handler.js";
import { LlmChatCallHandler } from "./handler/llm-chat-call.handler.js";
import { createLlmClient } from "./llm/client.js";

const app = Fastify({ logger: true });
const SHUTDOWN_TIMEOUT_MS = 10_000;

const llmChatCallDao = new DrizzleLlmChatCallDao({ database: db });
const llmClient = createLlmClient({ llmChatCallDao });
const contextManager = new AgentContextManager({});
const agentLoop = new AgentLoop({ llmClient, contextManager });

const healthHandler = new HealthHandler();
const llmChatCallHandler = new LlmChatCallHandler({ llmChatCallDao });

healthHandler.register(app);
llmChatCallHandler.register(app);

let isServerStarted = false;
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    app.log.warn({ signal }, "Shutdown already in progress");
    return;
  }

  isShuttingDown = true;
  app.log.info({ signal }, "Received shutdown signal, starting graceful shutdown");

  const forceExitTimer = setTimeout(() => {
    app.log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timeout, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  let exitCode = 0;

  if (isServerStarted) {
    try {
      await app.close();
      app.log.info("Fastify server closed");
    } catch (error) {
      exitCode = 1;
      app.log.error({ error }, "Failed to close Fastify server");
    }
  }

  try {
    await closeDb();
    app.log.info("Database connection closed");
  } catch (error) {
    exitCode = 1;
    app.log.error({ error }, "Failed to close database connection");
  }

  clearTimeout(forceExitTimer);
  process.exit(exitCode);
}

function registerShutdownSignals(): void {
  const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

  for (const signal of shutdownSignals) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}

async function start() {
  registerShutdownSignals();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });
    isServerStarted = true;

    try {
      const result = await agentLoop.run();
      app.log.info({ result }, "Agent loop completed");
    } catch (error) {
      app.log.error({ error }, "Agent loop failed");
    }
  } catch (error) {
    app.log.error(error);
    try {
      await closeDb();
    } catch (closeError) {
      app.log.error({ error: closeError }, "Failed to close database after startup failure");
    }
    process.exit(1);
  }
}

void start();
