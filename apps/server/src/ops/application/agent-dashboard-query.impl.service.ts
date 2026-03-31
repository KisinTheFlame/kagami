import type {
  AgentDashboardLlmCall,
  AgentDashboardRuntimeError,
  AgentDashboardSnapshot,
  AgentDashboardToolCall,
} from "@kagami/shared/schemas/agent-dashboard";
import type { AgentEventQueue } from "../../agent/runtime/event/event.queue.js";
import type {
  RootAgentLlmCallSummary,
  RootAgentRuntimeErrorSummary,
  RootAgentToolCallSummary,
  RootLoopAgent,
} from "../../agent/runtime/root-agent/root-agent-runtime.js";
import type { AgentDashboardQueryService } from "./agent-dashboard-query.service.js";

type DefaultAgentDashboardQueryServiceDeps = {
  rootAgentRuntime: RootLoopAgent;
  eventQueue: AgentEventQueue;
  listenGroupIds: string[];
  listAvailableAgentProviders: () => Promise<AgentDashboardSnapshot["providers"]>;
};

export class DefaultAgentDashboardQueryService implements AgentDashboardQueryService {
  private readonly rootAgentRuntime: RootLoopAgent;
  private readonly eventQueue: AgentEventQueue;
  private readonly listenGroupIds: string[];
  private readonly listAvailableAgentProviders: () => Promise<AgentDashboardSnapshot["providers"]>;

  public constructor({
    rootAgentRuntime,
    eventQueue,
    listenGroupIds,
    listAvailableAgentProviders,
  }: DefaultAgentDashboardQueryServiceDeps) {
    this.rootAgentRuntime = rootAgentRuntime;
    this.eventQueue = eventQueue;
    this.listenGroupIds = listenGroupIds;
    this.listAvailableAgentProviders = listAvailableAgentProviders;
  }

  public async getCurrentSnapshot(): Promise<AgentDashboardSnapshot> {
    const [runtimeSnapshot, providers] = await Promise.all([
      this.rootAgentRuntime.getDashboardSnapshot(),
      this.listAvailableAgentProviders(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      runtime: {
        initialized: runtimeSnapshot.initialized,
        loopState: runtimeSnapshot.loopState,
        lastError: mapRuntimeError(runtimeSnapshot.lastError),
        lastActivityAt: toIsoString(runtimeSnapshot.lastActivityAt),
        lastRoundCompletedAt: toIsoString(runtimeSnapshot.lastRoundCompletedAt),
        lastCompactionAt: toIsoString(runtimeSnapshot.lastCompactionAt),
      },
      session: {
        kind: runtimeSnapshot.session.state.kind as AgentDashboardSnapshot["session"]["kind"],
        currentGroupId: runtimeSnapshot.session.currentGroupId,
        waitingDeadlineAt: toIsoString(runtimeSnapshot.session.waitingDeadlineAt),
        availableInvokeTools: runtimeSnapshot.availableInvokeTools,
      },
      queue: {
        pendingEventCount: this.eventQueue.size(),
      },
      groups: runtimeSnapshot.session.groups.map(group => ({
        groupId: group.groupId,
        ...(group.groupName ? { groupName: group.groupName } : {}),
        unreadCount: group.unreadCount,
        hasEntered: group.hasEntered,
      })),
      context: {
        messageCount: runtimeSnapshot.contextSummary.messageCount,
        compactionTotalTokenThreshold: runtimeSnapshot.contextCompactionTotalTokenThreshold,
        recentItems: runtimeSnapshot.contextSummary.recentItems,
        recentItemsTruncated: runtimeSnapshot.contextSummary.recentItemsTruncated,
      },
      activity: {
        lastToolCall: mapToolCall(runtimeSnapshot.lastToolCall),
        lastToolResultPreview: runtimeSnapshot.lastToolResultPreview,
        lastLlmCall: mapLlmCall(runtimeSnapshot.lastLlmCall),
      },
      providers,
      config: {
        listenGroupIds: [...this.listenGroupIds],
      },
    };
  }
}

function mapRuntimeError(
  value: RootAgentRuntimeErrorSummary | null,
): AgentDashboardRuntimeError | null {
  if (!value) {
    return null;
  }

  return {
    name: value.name,
    message: value.message,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function mapToolCall(value: RootAgentToolCallSummary | null): AgentDashboardToolCall | null {
  if (!value) {
    return null;
  }

  return {
    name: value.name,
    argumentsPreview: value.argumentsPreview,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function mapLlmCall(value: RootAgentLlmCallSummary | null): AgentDashboardLlmCall | null {
  if (!value) {
    return null;
  }

  return {
    provider: value.provider,
    model: value.model,
    assistantContentPreview: value.assistantContentPreview,
    toolCallNames: [...value.toolCallNames],
    totalTokens: value.totalTokens,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
