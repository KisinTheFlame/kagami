import type { Event } from "../agent/runtime/event/event.js";
import type { RootAgentRuntime } from "../agent/runtime/root-agent/root-agent-runtime.js";
import { AppLogger } from "../logger/logger.js";
import type {
  NapcatGatewayService,
  NapcatGroupMessageData,
} from "../napcat/service/napcat-gateway.service.js";

const logger = new AppLogger({ source: "bootstrap" });

type HydrateStartupContextFromRecentMessagesOptions = {
  listenGroupId: string;
  startupContextRecentMessageCount: number;
  napcatGatewayService: NapcatGatewayService;
  rootAgentRuntime: RootAgentRuntime;
};

export async function hydrateStartupContextFromRecentMessages({
  listenGroupId,
  startupContextRecentMessageCount,
  napcatGatewayService,
  rootAgentRuntime,
}: HydrateStartupContextFromRecentMessagesOptions): Promise<void> {
  if (startupContextRecentMessageCount === 0) {
    logger.info("Startup context hydration disabled", {
      event: "agent.startup_context_hydration_disabled",
      requestedCount: startupContextRecentMessageCount,
      status: "disabled",
    });
    return;
  }

  try {
    const recentMessages = await napcatGatewayService.getRecentGroupMessages({
      groupId: listenGroupId,
      count: startupContextRecentMessageCount,
    });
    const startupEvents = recentMessages.map(createStartupEventFromGroupMessage);

    await rootAgentRuntime.hydrateStartupEvents(startupEvents);

    logger.info("Startup context hydrated from recent group messages", {
      event: "agent.startup_context_hydrated",
      groupId: listenGroupId,
      requestedCount: startupContextRecentMessageCount,
      actualCount: startupEvents.length,
      status: startupEvents.length === 0 ? "empty" : "hydrated",
    });
  } catch (error) {
    logger.errorWithCause("Failed to hydrate startup context from recent group messages", error, {
      event: "agent.startup_context_hydrate_failed",
      groupId: listenGroupId,
      requestedCount: startupContextRecentMessageCount,
      status: "failed",
    });
  }
}

function createStartupEventFromGroupMessage(message: NapcatGroupMessageData): Event {
  return {
    type: "napcat_group_message",
    data: message,
  };
}
