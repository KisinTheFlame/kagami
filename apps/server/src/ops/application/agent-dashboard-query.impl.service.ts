import type {
  AgentDashboardAgentSnapshot,
  AgentDashboardLlmCall,
  AgentDashboardRuntimeError,
  AgentDashboardSnapshot,
  AgentDashboardToolCall,
  RootAgentDashboardSnapshot,
  StoryAgentDashboardSnapshot,
} from "@kagami/shared/schemas/agent-dashboard";
import type {
  StoryAgentLlmCallSummary,
  StoryAgentRuntimeDashboardSnapshot,
  StoryAgentRuntimeErrorSummary,
  StoryAgentToolCallSummary,
  StoryLoopAgent,
} from "../../agent/capabilities/story/runtime/story-agent.runtime.js";
import type { AgentEventQueue } from "../../agent/runtime/event/event.queue.js";
import type {
  RootAgentLlmCallSummary,
  RootAgentRuntimeDashboardSnapshot,
  RootAgentRuntimeErrorSummary,
  RootAgentToolCallSummary,
  RootLoopAgent,
} from "../../agent/runtime/root-agent/root-agent-runtime.js";
import type { AgentDashboardQueryService } from "./agent-dashboard-query.service.js";

type DefaultAgentDashboardQueryServiceDeps = {
  rootAgentRuntime: RootLoopAgent;
  storyAgentRuntime: StoryLoopAgent;
  eventQueue: AgentEventQueue;
  listenGroupIds: string[];
  listAvailableAgentProviders: () => Promise<RootAgentDashboardSnapshot["providers"]>;
};

export class DefaultAgentDashboardQueryService implements AgentDashboardQueryService {
  private readonly rootAgentRuntime: RootLoopAgent;
  private readonly storyAgentRuntime: StoryLoopAgent;
  private readonly eventQueue: AgentEventQueue;
  private readonly listenGroupIds: string[];
  private readonly listAvailableAgentProviders: () => Promise<
    RootAgentDashboardSnapshot["providers"]
  >;

  public constructor({
    rootAgentRuntime,
    storyAgentRuntime,
    eventQueue,
    listenGroupIds,
    listAvailableAgentProviders,
  }: DefaultAgentDashboardQueryServiceDeps) {
    this.rootAgentRuntime = rootAgentRuntime;
    this.storyAgentRuntime = storyAgentRuntime;
    this.eventQueue = eventQueue;
    this.listenGroupIds = listenGroupIds;
    this.listAvailableAgentProviders = listAvailableAgentProviders;
  }

  public async getCurrentSnapshot(): Promise<AgentDashboardSnapshot> {
    const [rootRuntimeSnapshot, storyRuntimeSnapshot, providers] = await Promise.all([
      this.rootAgentRuntime.getDashboardSnapshot(),
      this.storyAgentRuntime.getDashboardSnapshot(),
      this.listAvailableAgentProviders(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      agents: [
        mapRootAgentSnapshot({
          runtimeSnapshot: rootRuntimeSnapshot,
          pendingEventCount: this.eventQueue.size(),
          providers,
        }),
        mapStoryAgentSnapshot(storyRuntimeSnapshot),
      ],
      config: {
        listenGroupIds: [...this.listenGroupIds],
      },
    };
  }
}

function mapRootAgentSnapshot(input: {
  runtimeSnapshot: RootAgentRuntimeDashboardSnapshot;
  pendingEventCount: number;
  providers: RootAgentDashboardSnapshot["providers"];
}): RootAgentDashboardSnapshot {
  const { runtimeSnapshot, pendingEventCount, providers } = input;

  return {
    id: "root",
    label: "主 Agent",
    kind: "root",
    runtime: mapRuntime(runtimeSnapshot),
    session: {
      kind: runtimeSnapshot.session.state.kind as RootAgentDashboardSnapshot["session"]["kind"],
      currentGroupId: runtimeSnapshot.session.currentGroupId,
      waitingDeadlineAt: toIsoString(runtimeSnapshot.session.waitingDeadlineAt),
      waitingResumeTarget:
        runtimeSnapshot.session.waitingResumeTarget &&
        mapWaitingResumeTarget(runtimeSnapshot.session.waitingResumeTarget),
      availableInvokeTools: runtimeSnapshot.availableInvokeTools,
    },
    queue: {
      pendingEventCount,
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
  };
}

function mapStoryAgentSnapshot(
  runtimeSnapshot: StoryAgentRuntimeDashboardSnapshot,
): StoryAgentDashboardSnapshot {
  return {
    id: "story",
    label: "Story Agent",
    kind: "story",
    runtime: mapRuntime(runtimeSnapshot),
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
    story: {
      lastProcessedMessageSeq: runtimeSnapshot.story.lastProcessedMessageSeq,
      pendingMessageCount: runtimeSnapshot.story.pendingMessageCount,
      pendingBatch: runtimeSnapshot.story.pendingBatch,
      batchSize: runtimeSnapshot.story.batchSize,
      idleFlushMs: runtimeSnapshot.story.idleFlushMs,
    },
  };
}

function mapRuntime(value: {
  initialized: boolean;
  loopState:
    | RootAgentRuntimeDashboardSnapshot["loopState"]
    | StoryAgentRuntimeDashboardSnapshot["loopState"];
  lastError: RootAgentRuntimeErrorSummary | StoryAgentRuntimeErrorSummary | null;
  lastActivityAt: Date | null;
  lastRoundCompletedAt: Date | null;
  lastCompactionAt: Date | null;
}): AgentDashboardAgentSnapshot["runtime"] {
  return {
    initialized: value.initialized,
    loopState: value.loopState,
    lastError: mapRuntimeError(value.lastError),
    lastActivityAt: toIsoString(value.lastActivityAt),
    lastRoundCompletedAt: toIsoString(value.lastRoundCompletedAt),
    lastCompactionAt: toIsoString(value.lastCompactionAt),
  };
}

function mapRuntimeError(
  value: RootAgentRuntimeErrorSummary | StoryAgentRuntimeErrorSummary | null,
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

function mapToolCall(
  value: RootAgentToolCallSummary | StoryAgentToolCallSummary | null,
): AgentDashboardToolCall | null {
  if (!value) {
    return null;
  }

  return {
    name: value.name,
    argumentsPreview: value.argumentsPreview,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function mapLlmCall(
  value: RootAgentLlmCallSummary | StoryAgentLlmCallSummary | null,
): AgentDashboardLlmCall | null {
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

function mapWaitingResumeTarget(
  value: NonNullable<RootAgentDashboardSnapshot["session"]["waitingResumeTarget"]>,
): NonNullable<RootAgentDashboardSnapshot["session"]["waitingResumeTarget"]> {
  return "groupId" in value ? { kind: value.kind, groupId: value.groupId } : { kind: value.kind };
}
