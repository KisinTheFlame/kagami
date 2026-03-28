import type { Event } from "../agent/runtime/event/event.js";
import type { MultiGroupRootAgentRuntimeManager } from "../agent/runtime/root-agent/multi-group-root-agent-runtime-manager.js";
import { AppLogger } from "../logger/logger.js";
import type {
  NapcatGatewayService,
  NapcatGroupMessageData,
} from "../napcat/service/napcat-gateway.service.js";

const logger = new AppLogger({ source: "bootstrap" });

type HydrateStartupContextFromRecentMessagesOptions = {
  listenGroupIds: string[];
  startupContextRecentMessageCount: number;
  napcatGatewayService: NapcatGatewayService;
  agentRuntimeManager: MultiGroupRootAgentRuntimeManager;
};

export async function hydrateStartupContextFromRecentMessages({
  listenGroupIds,
  startupContextRecentMessageCount,
  napcatGatewayService,
  agentRuntimeManager,
}: HydrateStartupContextFromRecentMessagesOptions): Promise<void> {
  if (startupContextRecentMessageCount === 0) {
    logger.info("Startup context hydration disabled", {
      event: "agent.startup_context_hydration_disabled",
      requestedCount: startupContextRecentMessageCount,
      status: "disabled",
    });
    return;
  }

  for (const groupId of listenGroupIds) {
    try {
      const recentMessages = await napcatGatewayService.getRecentGroupMessages({
        groupId,
        count: startupContextRecentMessageCount,
      });
      const startupEvents = recentMessages.map(createStartupEventFromGroupMessage);

      await agentRuntimeManager.hydrateStartupEvents(groupId, startupEvents);

      logger.info("Startup context hydrated from recent group messages", {
        event: "agent.startup_context_hydrated",
        groupId,
        requestedCount: startupContextRecentMessageCount,
        actualCount: startupEvents.length,
        status: startupEvents.length === 0 ? "empty" : "hydrated",
      });
    } catch (error) {
      logger.errorWithCause("Failed to hydrate startup context from recent group messages", error, {
        event: "agent.startup_context_hydrate_failed",
        groupId,
        requestedCount: startupContextRecentMessageCount,
        status: "failed",
      });
    }
  }
}

function createStartupEventFromGroupMessage(message: NapcatGroupMessageData): Event {
  return {
    type: "napcat_group_message",
    data: message,
  };
}
