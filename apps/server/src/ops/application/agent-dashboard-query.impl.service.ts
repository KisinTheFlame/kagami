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
  listAvailableAgentProviders: () => Promise<RootAgentDashboardSnapshot["providers"]>;
};

export class DefaultAgentDashboardQueryService implements AgentDashboardQueryService {
  private readonly rootAgentRuntime: RootLoopAgent;
  private readonly storyAgentRuntime: StoryLoopAgent;
  private readonly eventQueue: AgentEventQueue;
  private readonly listAvailableAgentProviders: () => Promise<
    RootAgentDashboardSnapshot["providers"]
  >;

  public constructor({
    rootAgentRuntime,
    storyAgentRuntime,
    eventQueue,
    listAvailableAgentProviders,
  }: DefaultAgentDashboardQueryServiceDeps) {
    this.rootAgentRuntime = rootAgentRuntime;
    this.storyAgentRuntime = storyAgentRuntime;
    this.eventQueue = eventQueue;
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
      focusedStateId: runtimeSnapshot.session.focusedStateId,
      focusedStateDisplayName: runtimeSnapshot.session.focusedStateDisplayName,
      focusedStateDescription: runtimeSnapshot.session.focusedStateDescription,
      stateStack: runtimeSnapshot.session.stateStack.map(item => ({
        id: item.id,
        displayName: item.displayName,
      })),
      children: runtimeSnapshot.session.children.map(child => ({
        id: child.id,
        displayName: child.displayName,
        description: child.description,
      })),
      availableInvokeTools: runtimeSnapshot.session.availableInvokeTools,
      waiting: {
        active: runtimeSnapshot.session.waiting.active,
        deadlineAt: toIsoString(runtimeSnapshot.session.waiting.deadlineAt),
        resumeStateId: runtimeSnapshot.session.waiting.resumeStateId,
      },
    },
    queue: {
      pendingEventCount,
    },
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
