import { AppLogger } from "../logger/logger.js";
import type { Event, NapcatGroupMessageEvent } from "../agent/event.js";
import type { ContextEventEnricher } from "../context/agent-context.js";
import type { RagQueryPlannerService } from "./rag-query-planner.service.js";

const logger = new AppLogger({ source: "rag.context-enricher" });

export class RagContextEventEnricher implements ContextEventEnricher {
  private readonly ragQueryPlanner: RagQueryPlannerService;

  public constructor({ ragQueryPlanner }: { ragQueryPlanner: RagQueryPlannerService }) {
    this.ragQueryPlanner = ragQueryPlanner;
  }

  public async enrichAfterEvents(input: Parameters<ContextEventEnricher["enrichAfterEvents"]>[0]) {
    const lastGroupMessageEvent = findLastGroupMessageEvent(input.events);
    if (!lastGroupMessageEvent) {
      return [];
    }

    try {
      return await this.ragQueryPlanner.plan({
        groupId: lastGroupMessageEvent.groupId,
        contextMessages: input.snapshot.messages,
      });
    } catch (error) {
      try {
        logger.warn("Failed to enrich context from RAG planner", {
          event: "rag.context_enricher.failed",
          groupId: lastGroupMessageEvent.groupId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Ignore logging failures so RAG degradation never breaks the main flow.
      }
      return [];
    }
  }
}

function findLastGroupMessageEvent(events: Event[]): NapcatGroupMessageEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "napcat_group_message") {
      return event;
    }
  }

  return null;
}
