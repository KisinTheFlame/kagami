import { AppLogger } from "../logger/logger.js";
import type { ContextEventEnricher } from "../context/agent-context.js";
import { createMessagesFromEvent } from "../context/context-message-factory.js";
import type { RagQueryPlannerService } from "./rag-query-planner.service.js";

const logger = new AppLogger({ source: "rag.context-enricher" });

export class RagContextEventEnricher implements ContextEventEnricher {
  private readonly ragQueryPlanner: RagQueryPlannerService;

  public constructor({ ragQueryPlanner }: { ragQueryPlanner: RagQueryPlannerService }) {
    this.ragQueryPlanner = ragQueryPlanner;
  }

  public async enrichAfterEvent(input: Parameters<ContextEventEnricher["enrichAfterEvent"]>[0]) {
    if (input.event.type !== "napcat_group_message") {
      return [];
    }

    const currentMessage = createMessagesFromEvent(input.event).at(-1)?.content;
    if (!currentMessage) {
      return [];
    }

    try {
      return await this.ragQueryPlanner.plan({
        groupId: input.event.groupId,
        currentMessage,
        contextMessages: input.snapshot.messages,
      });
    } catch (error) {
      try {
        logger.warn("Failed to enrich context from RAG planner", {
          event: "rag.context_enricher.failed",
          groupId: input.event.groupId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Ignore logging failures so RAG degradation never breaks the main flow.
      }
      return [];
    }
  }
}
