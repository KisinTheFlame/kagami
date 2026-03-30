import type { Event } from "../agent/runtime/event/event.js";
import type { RootAgentRuntime } from "../agent/runtime/root-agent/root-agent-runtime.js";
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
  rootAgentRuntime: RootAgentRuntime;
};

export async function hydrateStartupContextFromRecentMessages({
  listenGroupIds,
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
    const startupEvents: Event[] = [];

    for (const groupId of listenGroupIds) {
      try {
        const recentMessages = await napcatGatewayService.getRecentGroupMessages({
          groupId,
          count: startupContextRecentMessageCount,
        });
        startupEvents.push(...recentMessages.map(createStartupEventFromGroupMessage));
      } catch (error) {
        logger.errorWithCause("Failed to load startup context for listen group", error, {
          event: "agent.startup_context_group_hydrate_failed",
          groupId,
          requestedCount: startupContextRecentMessageCount,
          status: "failed",
        });
      }
    }

    startupEvents.sort(compareStartupEvent);

    await rootAgentRuntime.hydrateStartupEvents(startupEvents);

    logger.info("Startup context hydrated from recent group messages", {
      event: "agent.startup_context_hydrated",
      groupIds: listenGroupIds,
      requestedCount: startupContextRecentMessageCount,
      actualCount: startupEvents.length,
      status: startupEvents.length === 0 ? "empty" : "hydrated",
    });
  } catch (error) {
    logger.errorWithCause("Failed to hydrate startup context from recent group messages", error, {
      event: "agent.startup_context_hydrate_failed",
      groupIds: listenGroupIds,
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

function compareStartupEvent(left: Event, right: Event): number {
  if (left.type !== "napcat_group_message" || right.type !== "napcat_group_message") {
    return 0;
  }

  const leftTime = left.data.time ?? 0;
  const rightTime = right.data.time ?? 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftMessageId = left.data.messageId ?? 0;
  const rightMessageId = right.data.messageId ?? 0;
  if (leftMessageId !== rightMessageId) {
    return leftMessageId - rightMessageId;
  }

  return left.data.groupId.localeCompare(right.data.groupId);
}
